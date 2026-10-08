import type { Messaging } from 'firebase-admin/messaging';
import { supabaseAdmin } from '../config/supabase';
import { getFirebaseMessagingClient } from './firebaseAdmin';
import { estimateReportTimings } from './reportTiming';

type ResidentPushOutboxEvent = {
  id: number;
  report_id: string;
  resident_id: string;
  source_table?: string;
  report_title: string;
  display_status: string;
  revision: number;
  created_at: string;
  attempts: number;
  delivered_tokens: string[] | null;
};

let pushRelayTimer: ReturnType<typeof setInterval> | null = null;
let pushRelayRunning = false;
let retryAfter = 0;

function notificationSoundForStatus(status: string): { channelId: string; sound: string } {
  const normalized = status.toLowerCase();
  if (normalized.includes('resolved')) {
    return { channelId: 'resident_report_resolved', sound: 'report_resolved' };
  }
  if (normalized.includes('arrived')) {
    return { channelId: 'resident_responder_arrived', sound: 'resident_report_update' };
  }
  if (normalized.includes('accepted') || normalized.includes('dispatched') || normalized === 'responding') {
    return { channelId: 'resident_responder_enroute', sound: 'mdrrmo_dispatch' };
  }
  if (normalized.includes('review') || normalized.includes('inconclusive') || normalized.includes('false report') || normalized.includes('mdrrmo')) {
    return { channelId: 'resident_report_review', sound: 'report_review' };
  }
  return { channelId: 'resident_report_updates', sound: 'resident_report_update' };
}

function formatEta(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `about ${hours} hour${hours === 1 ? '' : 's'}`
    : `about ${hours} hour${hours === 1 ? '' : 's'} ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
}

async function estimateAcceptedResponderArrival(event: ResidentPushOutboxEvent): Promise<number | null> {
  const table = event.source_table === 'mdrrmo_reports' ? 'mdrrmo_reports' : 'barangay_reports';
  try {
    const { data: report, error: reportError } = await supabaseAdmin
      .from(table)
      .select('id, barangay_id, type, severity, created_at, accepted_at, travel_distance_m')
      .eq('id', event.report_id)
      .maybeSingle();
    if (reportError) throw reportError;
    const distance = Number(report?.travel_distance_m);
    if (!report || !Number.isFinite(distance) || distance <= 0) return null;

    const historyQuery = supabaseAdmin
      .from(table)
      .select('barangay_id, type, severity, created_at, accepted_at, arrived_at, resolved_at, travel_distance_m')
      .not('accepted_at', 'is', null)
      .not('arrived_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5000);
    const { data: history, error: historyError } = report.barangay_id
      ? await historyQuery.eq('barangay_id', report.barangay_id)
      : await historyQuery;
    if (historyError) throw historyError;

    const estimate = estimateReportTimings(report, history || []);
    return estimate.arrival_method === 'historical_average'
      ? null
      : estimate.arrival_seconds;
  } catch (error) {
    console.warn('Could not estimate responder arrival for resident push:', error);
    return null;
  }
}

async function markProcessed(eventId: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('resident_push_outbox')
    .update({ processed_at: new Date().toISOString(), locked_until: null, last_error: null })
    .eq('id', eventId);
  if (error) throw error;
}

async function saveDeliveredTokens(eventId: number, tokens: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('resident_push_outbox')
    .update({ delivered_tokens: tokens })
    .eq('id', eventId);
  if (error) throw error;
}

async function scheduleRetry(event: ResidentPushOutboxEvent, error: unknown): Promise<void> {
  const attempts = Math.max(1, Number(event.attempts) || 1);
  const retrySeconds = Math.min(300, Math.pow(2, Math.min(attempts, 8)));
  const message = error instanceof Error ? error.message : String(error);
  const { error: updateError } = await supabaseAdmin
    .from('resident_push_outbox')
    .update({
      locked_until: null,
      available_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
      last_error: message.slice(0, 1000),
    })
    .eq('id', event.id);
  if (updateError) throw updateError;
}

async function sendStatusUpdate(
  client: Messaging,
  event: ResidentPushOutboxEvent,
): Promise<void> {
  const { data: rows, error } = await supabaseAdmin
    .from('resident_push_tokens')
    .select('fcm_token')
    .eq('resident_id', event.resident_id);
  if (error) throw error;

  const delivered = new Set(event.delivered_tokens || []);
  const tokens = [...new Set((rows || [])
    .map((row: any) => row.fcm_token)
    .filter((token: unknown): token is string => typeof token === 'string' && token.length > 0))]
    .filter((token) => !delivered.has(token));

  if (tokens.length === 0) {
    await markProcessed(event.id);
    return;
  }

  const reportTitle = event.report_title.trim() || 'Incident report';
  const status = event.display_status.trim() || 'updated';
  const notificationSound = notificationSoundForStatus(status);
  const accepted = status.toLowerCase() === 'responder accepted';
  const dispatched = status.toLowerCase() === 'responder dispatched';
  const etaSeconds = accepted ? await estimateAcceptedResponderArrival(event) : null;
  const notificationTitle = accepted
    ? 'Responder heading to your location'
    : dispatched
      ? 'Responder assigned to your report'
      : 'Incident report update';
  const notificationBody = accepted
    ? `A responder has accepted the dispatch for “${reportTitle}” and is heading to your location.${etaSeconds === null ? '' : ` Estimated arrival: ${formatEta(etaSeconds)}.`}`
    : dispatched
      ? `A dispatcher assigned your report “${reportTitle}” to a responder. We will notify you when they accept and head your way.`
      : `Your report “${reportTitle}” is ${status}.`;
  for (let start = 0; start < tokens.length; start += 500) {
    const tokenBatch = tokens.slice(start, start + 500);
    const response = await client.sendEachForMulticast({
      tokens: tokenBatch,
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        type: 'resident_report_status',
        report_id: event.report_id,
        report_title: reportTitle,
        status,
        revision: String(event.revision),
        ...(etaSeconds === null ? {} : { expected_arrival_seconds: String(etaSeconds) }),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: notificationSound.channelId,
          sound: notificationSound.sound,
          // Keep only the latest unread status notification for each report.
          tag: `resident-report-${event.report_id}`,
        },
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
    });

    const staleTokens = response.responses.flatMap((result, index) => {
      if (result.success) return [];
      const code = result.error?.code || '';
      return code.includes('registration-token-not-registered') ||
        code.includes('invalid-registration-token')
        ? [tokenBatch[index]]
        : [];
    });
    if (staleTokens.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('resident_push_tokens')
        .delete()
        .in('fcm_token', staleTokens);
      if (deleteError) throw deleteError;
    }

    // Persist successful devices before retrying transient failures so a
    // partial FCM failure does not resend to devices already accepted by FCM.
    for (let index = 0; index < response.responses.length; index++) {
      if (response.responses[index].success || staleTokens.includes(tokenBatch[index])) {
        delivered.add(tokenBatch[index]);
      }
    }
    await saveDeliveredTokens(event.id, [...delivered]);

    const transientFailureCount = response.failureCount - staleTokens.length;
    if (transientFailureCount > 0) {
      throw new Error(`FCM failed for ${transientFailureCount} resident device(s).`);
    }
  }

  await markProcessed(event.id);
  console.info('Resident report status push processed', {
    report_id: event.report_id,
    resident_id: event.resident_id,
    device_count: delivered.size,
    revision: event.revision,
  });
}

async function processPushBatch(): Promise<void> {
  const client = getFirebaseMessagingClient();
  if (!client || pushRelayRunning || Date.now() < retryAfter) return;
  pushRelayRunning = true;
  try {
    const { data, error } = await supabaseAdmin.rpc('claim_resident_push_outbox', {
      p_batch_size: 25,
    });
    if (error) throw error;
    retryAfter = 0;

    for (const event of (data || []) as ResidentPushOutboxEvent[]) {
      try {
        await sendStatusUpdate(client, event);
      } catch (error) {
        try {
          await scheduleRetry(event, error);
        } catch (retryError) {
          console.error('Could not reschedule resident push:', retryError);
        }
        console.error(`Resident push failed for outbox item ${event.id}:`, error);
      }
    }
  } catch (error) {
    retryAfter = Date.now() + 5000;
    console.error('Resident push outbox relay failed:', error);
  } finally {
    pushRelayRunning = false;
  }
}

export function startResidentPushRelay(): void {
  if (pushRelayTimer) return;
  if (!getFirebaseMessagingClient()) {
    console.info('Resident push relay idle: configure Firebase credentials to enable delivery.');
    return;
  }

  void processPushBatch();
  supabaseAdmin
    .channel('resident-push-outbox-relay')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'resident_push_outbox',
    }, () => void processPushBatch())
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Resident push outbox subscription status:', status, error);
      }
    });

  pushRelayTimer = setInterval(() => void processPushBatch(), 10000);
  pushRelayTimer.unref?.();
}
