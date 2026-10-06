import { supabaseAdmin } from '../config/supabase';
import { getResponderGpsLocation, RESPONDER_GPS_TTL_SECONDS } from '../config/redis';
import { isVisibleToMdrrmo } from './mdrrmoReportVisibility';

export interface ResponderIncidentTarget {
  incidentId: string;
  title: string;
  latitude: number;
  longitude: number;
}

export interface ResponderLiveLocation {
  responderId: string;
  responderName: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  assignments: ResponderIncidentTarget[];
}

function coordinate(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function getActiveResponderTargets(responderId?: string): Promise<Map<string, ResponderIncidentTarget[]>> {
  let assignmentQuery = supabaseAdmin
    .from('mdrrmo_report_assignments')
    .select('report_id, responder_id')
    .in('status', ['assigned', 'responding'])
    .is('arrived_at', null);
  if (responderId) assignmentQuery = assignmentQuery.eq('responder_id', responderId);

  const { data: assignments, error: assignmentError } = await assignmentQuery;
  if (assignmentError) throw assignmentError;
  const assignmentRows = assignments || [];
  if (!assignmentRows.length) return new Map();

  const reportIds = [...new Set(assignmentRows.map((row: any) => row.report_id))];
  const { data: reports, error: reportError } = await supabaseAdmin
    .from('incident_reports')
    .select('id, title, latitude, longitude, reporter_type, send_to, specifics, description, status, mdrrmo_response_status, is_escalated, beyond_barangay_capability, barangay_response_notes, review_outcome')
    .in('id', reportIds);
  if (reportError) throw reportError;

  const reportById = new Map<string, ResponderIncidentTarget>();
  for (const report of reports || []) {
    if (!isVisibleToMdrrmo(report)) continue;
    if (['resolved', 'closed'].includes(String(report.status || '').toLowerCase()) ||
        String(report.mdrrmo_response_status || '').toLowerCase() === 'resolved') continue;
    const latitude = coordinate(report.latitude);
    const longitude = coordinate(report.longitude);
    if (latitude === null || longitude === null || latitude === 0 || longitude === 0) continue;
    reportById.set(report.id, {
      incidentId: report.id,
      title: report.title || 'Emergency Incident',
      latitude,
      longitude,
    });
  }

  const targetsByResponder = new Map<string, ResponderIncidentTarget[]>();
  for (const assignment of assignmentRows) {
    const target = reportById.get(assignment.report_id);
    if (!target) continue;
    const current = targetsByResponder.get(assignment.responder_id) || [];
    if (!current.some((item) => item.incidentId === target.incidentId)) current.push(target);
    targetsByResponder.set(assignment.responder_id, current);
  }
  return targetsByResponder;
}

export async function getCurrentResponderLiveLocations(): Promise<ResponderLiveLocation[]> {
  const targetsByResponder = await getActiveResponderTargets();
  const responderIds = [...targetsByResponder.keys()];
  if (!responderIds.length) return [];

  const [{ data: responders, error: responderError }, gpsLocations] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('id, full_name')
      .in('id', responderIds)
      .eq('role', 'responder')
      .eq('status', 'active'),
    Promise.all(responderIds.map(async (id) => [id, await getResponderGpsLocation(id)] as const)),
  ]);
  if (responderError) throw responderError;

  const responderById = new Map<string, any>();
  for (const responder of responders || []) responderById.set(responder.id, responder);
  const locationById = new Map<string, Awaited<ReturnType<typeof getResponderGpsLocation>>>(gpsLocations);
  const freshAfter = Date.now() - RESPONDER_GPS_TTL_SECONDS * 1000;

  return responderIds.flatMap((responderId) => {
    const responder = responderById.get(responderId);
    const location = locationById.get(responderId);
    const timestamp = location ? Date.parse(location.timestamp) : Number.NaN;
    if (!responder || !location || !Number.isFinite(timestamp) || timestamp < freshAfter) return [];
    return [{
      responderId,
      responderName: responder.full_name || 'Responder',
      latitude: location.latitude,
      longitude: location.longitude,
      timestamp: location.timestamp,
      assignments: targetsByResponder.get(responderId) || [],
    }];
  });
}
