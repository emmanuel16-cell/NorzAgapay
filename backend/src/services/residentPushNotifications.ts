import type { Messaging } from 'firebase-admin/messaging';
import { supabaseAdmin } from '../config/supabase';
import { getFirebaseMessagingClient } from './firebaseAdmin';

type ResidentPushOutboxEvent = {
  id: number;
  report_id: string;
  resident_id: string;
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
  for (let start = 0; start < tokens.length; start += 500) {
    const tokenBatch = tokens.slice(start, start + 500);
    const response = await client.sendEachForMulticast({
      tokens: tokenBatch,
      notification: {
        title: 'Incident report update',
        body: `Your report “${reportTitle}” is ${status}.`,
      },
      data: {
        type: 'resident_report_status',
        report_id: event.report_id,
        report_title: reportTitle,
        status,
        revision: String(event.revision),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'resident_report_updates',
          sound: 'resident_report_update',
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
