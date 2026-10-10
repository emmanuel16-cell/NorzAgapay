import type { Messaging } from 'firebase-admin/messaging';
import { supabaseAdmin } from '../config/supabase';
import { getFirebaseMessagingClient } from './firebaseAdmin';
import { getVerifiedBarangayIds } from './verifiedBarangayService';

type AssignmentPushEvent = {
  id: number;
  assignment_id: string;
  report_id: string;
  barangay_id: string;
  created_at: string;
  attempts: number;
  delivered_tokens: string[] | null;
};

let relayTimer: ReturnType<typeof setInterval> | null = null;
let relayRunning = false;
let retryAfter = 0;

async function markProcessed(eventId: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('mdrrmo_report_barangay_push_outbox')
    .update({ processed_at: new Date().toISOString(), locked_until: null, last_error: null })
    .eq('id', eventId);
  if (error) throw error;
}

async function saveDeliveredTokens(eventId: number, tokens: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('mdrrmo_report_barangay_push_outbox')
    .update({ delivered_tokens: tokens })
    .eq('id', eventId);
  if (error) throw error;
}

async function scheduleRetry(event: AssignmentPushEvent, error: unknown): Promise<void> {
  const attempts = Math.max(1, Number(event.attempts) || 1);
  const retrySeconds = Math.min(300, Math.pow(2, Math.min(attempts, 8)));
  const message = error instanceof Error ? error.message : String(error);
  const { error: updateError } = await supabaseAdmin
    .from('mdrrmo_report_barangay_push_outbox')
    .update({
      locked_until: null,
      available_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
      last_error: message.slice(0, 1000),
    })
    .eq('id', event.id);
  if (updateError) throw updateError;
}

async function sendAssignmentAlert(client: Messaging, event: AssignmentPushEvent): Promise<void> {
  const createdAt = Date.parse(event.created_at);
  if (Number.isFinite(createdAt) && Date.now() - createdAt > 15 * 60 * 1000) {
    await markProcessed(event.id);
    return;
  }

  const [{ data: assignment, error: assignmentError }, { data: report, error: reportError }, verifiedIds] = await Promise.all([
    supabaseAdmin.from('mdrrmo_report_barangay_assignments')
      .select('assignment_status, barangay_id').eq('id', event.assignment_id).maybeSingle(),
    supabaseAdmin.from('mdrrmo_reports')
      .select('id, title').eq('id', event.report_id).maybeSingle(),
    getVerifiedBarangayIds(),
  ]);
  if (assignmentError) throw assignmentError;
  if (reportError) throw reportError;
  if (!assignment || assignment.assignment_status !== 'active' || assignment.barangay_id !== event.barangay_id ||
      !report || !verifiedIds.includes(event.barangay_id)) {
    await markProcessed(event.id);
    return;
  }

  const { data: dispatchers, error: dispatcherError } = await supabaseAdmin
    .from('barangay_users')
    .select('id')
    .eq('barangay_id', event.barangay_id)
    .in('role', ['dispatcher', 'captain'])
    .eq('is_active', true);
  if (dispatcherError) throw dispatcherError;
  const dispatcherIds = (dispatchers || []).map((row: any) => row.id).filter(Boolean);
  if (!dispatcherIds.length) {
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
  const tokens = [...new Set((devices || []).map((row: any) => row.fcm_token).filter(Boolean))]
    .filter((token) => !delivered.has(token));
  if (!tokens.length) {
    await markProcessed(event.id);
    return;
  }

  const title = typeof report.title === 'string' ? report.title : 'Incident report';
  for (let start = 0; start < tokens.length; start += 500) {
    const tokenBatch = tokens.slice(start, start + 500);
    const response = await client.sendEachForMulticast({
      tokens: tokenBatch,
      notification: {
        title: 'New report assigned to your barangay',
        body: 'MDRRMO assigned an incident report to your barangay. Open NorzAgapay to review it.',
      },
      data: { type: 'incident_report', report_id: report.id, report_title: title },
      android: {
        priority: 'high',
        notification: { channelId: 'resident_incidents', sound: 'resident_incident', tag: report.id },
      },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    const staleTokens = response.responses.flatMap((result, index) => {
      if (result.success) return [];
      const code = result.error?.code || '';
      return code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')
        ? [tokenBatch[index]] : [];
    });
    if (staleTokens.length) {
      const { error } = await supabaseAdmin.from('dispatcher_push_tokens').delete().in('fcm_token', staleTokens);
      if (error) throw error;
    }

    for (let index = 0; index < response.responses.length; index++) {
      if (response.responses[index].success || staleTokens.includes(tokenBatch[index])) delivered.add(tokenBatch[index]);
    }
    await saveDeliveredTokens(event.id, [...delivered]);
    if (response.failureCount - staleTokens.length > 0) {
      throw new Error(`FCM failed for ${response.failureCount - staleTokens.length} barangay dispatcher device(s).`);
    }
  }

  await markProcessed(event.id);
  console.info('Barangay assignment push processed', { report_id: event.report_id, barangay_id: event.barangay_id, device_count: delivered.size });
}

async function processBatch(): Promise<void> {
  const client = getFirebaseMessagingClient();
  if (!client || relayRunning || Date.now() < retryAfter) return;
  relayRunning = true;
  try {
    const { data, error } = await supabaseAdmin.rpc('claim_mdrrmo_report_barangay_push_outbox', { p_batch_size: 25 });
    if (error) throw error;
    retryAfter = 0;
    for (const event of (data || []) as AssignmentPushEvent[]) {
      try {
        await sendAssignmentAlert(client, event);
      } catch (error) {
        try { await scheduleRetry(event, error); }
        catch (retryError) { console.error('Could not reschedule barangay assignment push:', retryError); }
        console.error(`Barangay assignment push failed for outbox item ${event.id}:`, error);
      }
    }
  } catch (error) {
    retryAfter = Date.now() + 5000;
    console.error('Barangay assignment push relay failed:', error);
  } finally {
    relayRunning = false;
  }
}

export function startMdrrmoBarangayAssignmentPushRelay(): void {
  if (relayTimer) return;
  if (!getFirebaseMessagingClient()) {
    console.info('Barangay assignment push relay idle: configure Firebase credentials to enable delivery.');
    return;
  }
  void processBatch();
  supabaseAdmin.channel('mdrrmo-barangay-assignment-push-relay')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'mdrrmo_report_barangay_push_outbox',
    }, () => void processBatch())
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Barangay assignment push outbox subscription status:', status, error);
      }
    });
  relayTimer = setInterval(() => void processBatch(), 10000);
  relayTimer.unref?.();
}
