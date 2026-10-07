import type { Server as SocketIOServer } from 'socket.io';
import { supabaseAdmin } from '../config/supabase';
import { isEscalatedForMdrrmo, isVisibleToMdrrmo } from './mdrrmoReportVisibility';

type OutboxEvent = {
  id: number;
  event_id: string;
  report_id: string;
  revision: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  attempts: number;
};

let relayTimer: ReturnType<typeof setInterval> | null = null;
let relayRunning = false;
let relayBackoffUntil = 0;

function addUserRoom(roomIds: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.length > 0) roomIds.add(`user:${value}`);
}

async function publishEvent(io: SocketIOServer, event: OutboxEvent): Promise<void> {
  let { data: report, error } = await supabaseAdmin
    .from('incident_reports')
    .select('*')
    .eq('id', event.report_id)
    .maybeSingle();
  if (error) throw error;
  if (!report) {
    const { data: bReport } = await supabaseAdmin.from('barangay_reports').select('*').eq('id', event.report_id).maybeSingle();
    const { data: mReport } = await supabaseAdmin.from('mdrrmo_reports').select('*').eq('id', event.report_id).maybeSingle();
    report = (bReport || mReport) as any;
  }
  if (!report) {
    // The report was deleted after its event was queued; there is no audience
    // left to notify, so acknowledge this outbox row.
    return;
  }

  const rooms = new Set<string>();
  if (report.reporter_type === 'resident') addUserRoom(rooms, report.reporter_id);

  const routedToMdrrmo = isVisibleToMdrrmo(report);
  const routedToBarangay = report.send_to !== 'mdrrmo' || isEscalatedForMdrrmo(report);
  if (report.barangay_id && routedToBarangay) {
    rooms.add(`barangay:${report.barangay_id}`);
  }
  if (routedToMdrrmo) rooms.add('dashboard_staff');

  // Older barangay workflows keep the selected responder on the report row.
  for (const key of ['assigned_responder_id', 'barangay_responder_id', 'responder_id', 'assigned_to', 'barangay_responded_by']) {
    addUserRoom(rooms, report[key]);
  }
  const encodedBarangayAssignments = String(report.barangay_response_notes || '').match(/^\[ASSIGNED:([^\]]+)\]/);
  if (encodedBarangayAssignments?.[1]) {
    for (const responderId of encodedBarangayAssignments[1].split(',').map((id: string) => id.trim())) {
      addUserRoom(rooms, responderId);
    }
  }

  const { data: assignments, error: assignmentError } = await supabaseAdmin
    .from('mdrrmo_report_assignments')
    .select('responder_id')
    .eq('report_id', report.id)
    .neq('status', 'removed');
  if (assignmentError && !/does not exist|schema cache/i.test(assignmentError.message)) throw assignmentError;
  for (const assignment of assignments || []) addUserRoom(rooms, assignment.responder_id);

  const { data: tasks, error: taskError } = report.dispatch_incident_id
    ? await supabaseAdmin
      .from('tasks')
      .select('id, assigned_to')
      .eq('incident_id', report.dispatch_incident_id)
    : { data: [], error: null };
  if (taskError) throw taskError;
  const taskIds = (tasks || []).map((task: any) => task.id).filter(Boolean);
  for (const task of tasks || []) addUserRoom(rooms, task.assigned_to);
  if (taskIds.length > 0) {
    const { data: taskResponders, error: respondersError } = await supabaseAdmin
      .from('task_volunteers')
      .select('volunteer_id')
      .in('task_id', taskIds)
      .neq('status', 'left');
    if (respondersError) throw respondersError;
    for (const responder of taskResponders || []) addUserRoom(rooms, responder.volunteer_id);
  }

  if (rooms.size === 0) return;
  const envelope = {
    schema_version: 1,
    event_id: event.event_id,
    event_type: event.event_type,
    report_id: event.report_id,
    revision: Number(event.revision),
    occurred_at: event.created_at,
    state: event.payload || {},
  };
  io.to([...rooms]).emit('incident:lifecycle', envelope);
  console.info('Incident lifecycle event published', {
    event_id: event.event_id,
    report_id: event.report_id,
    revision: Number(event.revision),
    commit_to_publish_ms: Math.max(0, Date.now() - new Date(event.created_at).getTime()),
    audience_room_count: rooms.size,
  });
}

async function relayBatch(io: SocketIOServer): Promise<void> {
  if (relayRunning || Date.now() < relayBackoffUntil) return;
  relayRunning = true;
  try {
    const { data, error } = await supabaseAdmin.rpc('claim_incident_event_outbox', {
      p_batch_size: 50,
    });
    if (error) throw error;
    relayBackoffUntil = 0;

    for (const event of (data || []) as OutboxEvent[]) {
      try {
        await publishEvent(io, event);
        const { error: markError } = await supabaseAdmin
          .from('incident_event_outbox')
          .update({ published_at: new Date().toISOString(), locked_until: null, last_error: null })
          .eq('id', event.id);
        if (markError) throw markError;
      } catch (error) {
        const attempts = Math.max(1, Number(event.attempts) || 1);
        const retrySeconds = Math.min(30, Math.pow(2, Math.min(attempts, 5)));
        const message = error instanceof Error ? error.message : String(error);
        await supabaseAdmin
          .from('incident_event_outbox')
          .update({
            locked_until: null,
            available_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
            last_error: message.slice(0, 1000),
          })
          .eq('id', event.id);
        console.error(`Incident lifecycle publish failed for ${event.event_id}:`, message);
      }
    }
  } catch (error) {
    relayBackoffUntil = Date.now() + 5000;
    console.error('Incident lifecycle outbox relay failed:', error);
  } finally {
    relayRunning = false;
  }
}

export function startIncidentEventRelay(io: SocketIOServer): void {
  if (relayTimer) return;
  void relayBatch(io);
  supabaseAdmin
    .channel('incident-event-outbox-relay')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'incident_event_outbox',
    }, () => void relayBatch(io))
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Incident lifecycle realtime subscription status:', status, error);
      }
    });
  // Recovery sweep only: connected event delivery is driven by the database
  // subscription above, not by this timer.
  relayTimer = setInterval(() => void relayBatch(io), 30000);
  relayTimer.unref?.();
}
