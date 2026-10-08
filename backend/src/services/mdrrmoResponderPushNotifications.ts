import type { Messaging } from 'firebase-admin/messaging';
import { supabaseAdmin } from '../config/supabase';
import { getFirebaseMessagingClient } from './firebaseAdmin';

type ResponderPushOutboxEvent = {
  id: number;
  assignment_id: string;
  report_id: string;
  responder_id: string;
  report_title: string;
  attempts: number;
  delivered_tokens: string[] | null;
};

let pushRelayTimer: ReturnType<typeof setInterval> | null = null;
let pushRelayRunning = false;
let retryAfter = 0;

async function markProcessed(eventId: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('mdrrmo_responder_push_outbox')
    .update({ processed_at: new Date().toISOString(), locked_until: null, last_error: null })
    .eq('id', eventId);
  if (error) throw error;
}

async function saveDeliveredTokens(eventId: number, tokens: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('mdrrmo_responder_push_outbox')
    .update({ delivered_tokens: tokens })
    .eq('id', eventId);
  if (error) throw error;
}

async function scheduleRetry(event: ResponderPushOutboxEvent, error: unknown): Promise<void> {
  const attempts = Math.max(1, Number(event.attempts) || 1);
  const retrySeconds = Math.min(300, Math.pow(2, Math.min(attempts, 8)));
  const message = error instanceof Error ? error.message : String(error);
  const { error: updateError } = await supabaseAdmin
    .from('mdrrmo_responder_push_outbox')
    .update({
      locked_until: null,
      available_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
      last_error: message.slice(0, 1000),
    })
    .eq('id', event.id);
  if (updateError) throw updateError;
}

async function sendAssignmentAlert(client: Messaging, event: ResponderPushOutboxEvent): Promise<void> {
  const { data: devices, error: devicesError } = await supabaseAdmin
    .from('mdrrmo_responder_push_tokens')
    .select('fcm_token')
    .eq('responder_id', event.responder_id);
  if (devicesError) throw devicesError;

  const delivered = new Set(event.delivered_tokens || []);
  const tokens = [...new Set((devices || []).map((device: any) => device.fcm_token).filter(Boolean))]
    .filter((token) => !delivered.has(token));
  if (tokens.length === 0) {
    await markProcessed(event.id);
    return;
  }

  for (let start = 0; start < tokens.length; start += 500) {
    const tokenBatch = tokens.slice(start, start + 500);
    const response = await client.sendEachForMulticast({
      tokens: tokenBatch,
      notification: {
        title: 'New MDRRMO dispatch',
        body: `${event.report_title || 'Incident report'} has been assigned to you.`,
      },
      data: {
        type: 'mdrrmo_report_assignment',
        report_id: event.report_id,
        assignment_id: event.assignment_id,
        responder_id: event.responder_id,
        report_title: event.report_title || 'Incident report',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'mdrrmo_dispatches',
          sound: 'mdrrmo_dispatch',
          tag: event.report_id,
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
      const { error } = await supabaseAdmin
        .from('mdrrmo_responder_push_tokens')
        .delete()
        .in('fcm_token', staleTokens);
      if (error) throw error;
    }

    // Save successful deliveries before retrying transient errors, so a retry
    // only targets devices Firebase has not already accepted this alert for.
    for (let index = 0; index < response.responses.length; index++) {
      if (response.responses[index].success || staleTokens.includes(tokenBatch[index])) {
        delivered.add(tokenBatch[index]);
      }
    }
    await saveDeliveredTokens(event.id, [...delivered]);

    const transientFailureCount = response.failureCount - staleTokens.length;
    if (transientFailureCount > 0) {
      throw new Error(`FCM failed for ${transientFailureCount} MDRRMO responder device(s).`);
    }
  }

  await markProcessed(event.id);
  console.info('MDRRMO responder assignment push processed', {
    report_id: event.report_id,
    responder_id: event.responder_id,
    device_count: tokens.length,
  });
}

async function processPushBatch(): Promise<void> {
  const client = getFirebaseMessagingClient();
  if (!client || pushRelayRunning || Date.now() < retryAfter) return;
  pushRelayRunning = true;
  try {
    const { data, error } = await supabaseAdmin.rpc('claim_mdrrmo_responder_push_outbox', {
      p_batch_size: 25,
    });
    if (error) throw error;
    retryAfter = 0;

    for (const event of (data || []) as ResponderPushOutboxEvent[]) {
      try {
        await sendAssignmentAlert(client, event);
      } catch (error) {
        try {
          await scheduleRetry(event, error);
        } catch (retryError) {
          console.error('Could not reschedule MDRRMO responder push:', retryError);
        }
        console.error(`MDRRMO responder push failed for outbox item ${event.id}:`, error);
      }
    }
  } catch (error) {
    retryAfter = Date.now() + 5000;
    console.error('MDRRMO responder push outbox relay failed:', error);
  } finally {
    pushRelayRunning = false;
  }
}

export function startMdrrmoResponderPushRelay(): void {
  if (pushRelayTimer) return;
  if (!getFirebaseMessagingClient()) {
    console.info('MDRRMO responder push relay idle: configure Firebase credentials to enable delivery.');
    return;
  }

  void processPushBatch();
  supabaseAdmin
    .channel('mdrrmo-responder-push-outbox-relay')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'mdrrmo_responder_push_outbox',
    }, () => void processPushBatch())
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('MDRRMO responder push outbox subscription status:', status, error);
      }
    });

  pushRelayTimer = setInterval(() => void processPushBatch(), 10000);
  pushRelayTimer.unref?.();
}
