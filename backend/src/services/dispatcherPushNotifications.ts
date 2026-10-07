import type { Messaging } from 'firebase-admin/messaging';
import { supabaseAdmin } from '../config/supabase';
import { getFirebaseMessagingClient } from './firebaseAdmin';

type PushOutboxEvent = {
  id: number;
  report_id: string;
  barangay_id: string;
  created_at: string;
  attempts: number;
  delivered_tokens: string[] | null;
};

let pushRelayTimer: ReturnType<typeof setInterval> | null = null;
let pushRelayRunning = false;
let retryAfter = 0;

function getMessagingClient(): Messaging | null {
  return getFirebaseMessagingClient();
}

async function markProcessed(eventId: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('dispatcher_push_outbox')
    .update({ processed_at: new Date().toISOString(), locked_until: null, last_error: null })
    .eq('id', eventId);
  if (error) throw error;
}

async function saveDeliveredTokens(eventId: number, tokens: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('dispatcher_push_outbox')
    .update({ delivered_tokens: tokens })
    .eq('id', eventId);
  if (error) throw error;
}

async function scheduleRetry(event: PushOutboxEvent, error: unknown): Promise<void> {
  const attempts = Math.max(1, Number(event.attempts) || 1);
  const retrySeconds = Math.min(300, Math.pow(2, Math.min(attempts, 8)));
  const message = error instanceof Error ? error.message : String(error);
  const { error: updateError } = await supabaseAdmin
    .from('dispatcher_push_outbox')
    .update({
      locked_until: null,
      available_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
      last_error: message.slice(0, 1000),
    })
    .eq('id', event.id);
  if (updateError) throw updateError;
}

async function sendReportAlert(client: Messaging, event: PushOutboxEvent): Promise<void> {
  const { data: report, error: reportError } = await supabaseAdmin
    .from('barangay_reports')
    .select('id, title, barangay_id, reporter_type')
    .eq('id', event.report_id)
    .maybeSingle();
  if (reportError) throw reportError;
  if (!report || report.reporter_type !== 'resident' || report.barangay_id !== event.barangay_id) {
    await markProcessed(event.id);
    return;
  }

  // Do not send a backlog of stale alerts if Firebase credentials are added
  // after the fact; the app's API catch-up path supplies current queue state.
  const createdAt = Date.parse(event.created_at);
  if (Number.isFinite(createdAt) && Date.now() - createdAt > 15 * 60 * 1000) {
    await markProcessed(event.id);
    return;
  }

  const { data: activeDispatchers, error: dispatcherError } = await supabaseAdmin
    .from('barangay_users')
    .select('id')
    .eq('barangay_id', event.barangay_id)
    .in('role', ['dispatcher', 'captain'])
    .eq('is_active', true);
  if (dispatcherError) throw dispatcherError;
  const dispatcherIds = (activeDispatchers || []).map((dispatcher: any) => dispatcher.id);
  if (dispatcherIds.length === 0) {
    await markProcessed(event.id);
    return;
  }

  const { data: devices, error: devicesError } = await supabaseAdmin
    .from('dispatcher_push_tokens')
    .select('fcm_token')
    .eq('barangay_id', event.barangay_id)
    .in('user_id', dispatcherIds);
  if (devicesError) throw devicesError;
  const delivered = new Set(event.delivered_tokens || []);
  const tokens = [...new Set((devices || []).map((device: any) => device.fcm_token).filter(Boolean))]
    .filter((token) => !delivered.has(token));
  if (tokens.length === 0) {
    await markProcessed(event.id);
    return;
  }

  // Keep the lock-screen text generic; report details and reporter identity
  // remain inside the authenticated app.
  const reportTitle = typeof report.title === 'string' ? report.title : 'Incident';
  for (let start = 0; start < tokens.length; start += 500) {
    const tokenBatch = tokens.slice(start, start + 500);
    const response = await client.sendEachForMulticast({
      tokens: tokenBatch,
      notification: {
        title: 'New incident report',
        body: `${reportTitle} is waiting for dispatch.`,
      },
      data: {
        type: 'incident_report',
        report_id: report.id,
        report_title: reportTitle,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'incident_reports',
          tag: report.id,
        },
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
      const { error } = await supabaseAdmin
        .from('dispatcher_push_tokens')
        .delete()
        .in('fcm_token', staleTokens);
      if (error) throw error;
    }

    // Remember FCM-accepted devices before retrying transient failures. The
    // outbox relay will only retry devices that have not accepted this event.
    for (let index = 0; index < response.responses.length; index++) {
      if (response.responses[index].success || staleTokens.includes(tokenBatch[index])) {
        delivered.add(tokenBatch[index]);
      }
    }
    await saveDeliveredTokens(event.id, [...delivered]);

    const transientFailureCount = response.failureCount - staleTokens.length;
    if (transientFailureCount > 0) {
      throw new Error(`FCM failed for ${transientFailureCount} dispatcher device(s).`);
    }
  }

  await markProcessed(event.id);
  console.info('Dispatcher incident push processed', {
    report_id: event.report_id,
    device_count: tokens.length,
  });
}

async function processPushBatch(): Promise<void> {
  const client = getMessagingClient();
  if (!client || pushRelayRunning || Date.now() < retryAfter) return;
  pushRelayRunning = true;
  try {
    const { data, error } = await supabaseAdmin.rpc('claim_dispatcher_push_outbox', {
      p_batch_size: 25,
    });
    if (error) throw error;
    retryAfter = 0;

    for (const event of (data || []) as PushOutboxEvent[]) {
      try {
        await sendReportAlert(client, event);
      } catch (error) {
        try {
          await scheduleRetry(event, error);
        } catch (retryError) {
          console.error('Could not reschedule dispatcher push:', retryError);
        }
        console.error(`Dispatcher push failed for outbox item ${event.id}:`, error);
      }
    }
  } catch (error) {
    retryAfter = Date.now() + 5000;
    console.error('Dispatcher push outbox relay failed:', error);
  } finally {
    pushRelayRunning = false;
  }
}

export function startDispatcherPushRelay(): void {
  if (pushRelayTimer) return;
  if (!getMessagingClient()) {
    console.info('Dispatcher push relay idle: configure Firebase credentials to enable delivery.');
    return;
  }

  void processPushBatch();
  supabaseAdmin
    .channel('dispatcher-push-outbox-relay')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'dispatcher_push_outbox',
    }, () => void processPushBatch())
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Dispatcher push outbox subscription status:', status, error);
      }
    });

  pushRelayTimer = setInterval(() => void processPushBatch(), 10000);
  pushRelayTimer.unref?.();
}
