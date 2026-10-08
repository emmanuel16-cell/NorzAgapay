import { supabaseAdmin } from '../config/supabase';
import { getResponderGpsLocation, RESPONDER_GPS_TTL_SECONDS } from '../config/redis';

export interface ResponderIncidentTarget {
  incidentId: string;
  title: string;
  latitude: number;
  longitude: number;
  crew: ResponderCrewMember[];
}

export interface ResponderCrewMember {
  name: string;
  memberRole: string;
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
    .select('id, report_id, responder_id')
    .eq('status', 'responding')
    .is('arrived_at', null);
  if (responderId) assignmentQuery = assignmentQuery.eq('responder_id', responderId);

  const { data: assignments, error: assignmentError } = await assignmentQuery;
  if (assignmentError) throw assignmentError;
  const assignmentRows = assignments || [];
  if (!assignmentRows.length) return new Map();

  const assignmentIds = [...new Set(assignmentRows.map((row: any) => row.id))];
  const { data: crewRows, error: crewError } = await supabaseAdmin
    .from('mdrrmo_assignment_crew_members')
    .select('assignment_id, member_name_snapshot, member_role_snapshot, selected_at')
    .in('assignment_id', assignmentIds)
    .order('selected_at', { ascending: true });
  if (crewError) throw crewError;

  const crewByAssignment = new Map<string, ResponderCrewMember[]>();
  for (const row of crewRows || []) {
    const crew = crewByAssignment.get(row.assignment_id) || [];
    crew.push({
      name: row.member_name_snapshot || 'Crew member',
      memberRole: row.member_role_snapshot || 'responder',
    });
    crewByAssignment.set(row.assignment_id, crew);
  }

  const reportIds = [...new Set(assignmentRows.map((row: any) => row.report_id))];
  const { data: mdrrmoRows, error: mdrrmoErr } = await supabaseAdmin
    .from('mdrrmo_reports')
    .select('id, title, latitude, longitude, response_status')
    .in('id', reportIds);
  if (mdrrmoErr) throw mdrrmoErr;

  const reportById = new Map<string, ResponderIncidentTarget>();
  for (const r of mdrrmoRows || []) {
    if (String(r.response_status || '').toLowerCase() === 'resolved') continue;
    const latitude = coordinate(r.latitude);
    const longitude = coordinate(r.longitude);
    if (latitude === null || longitude === null || latitude === 0 || longitude === 0) continue;
    reportById.set(r.id, {
      incidentId: r.id,
      title: r.title || 'Emergency Incident',
      latitude,
      longitude,
      crew: [],
    });
  }

  const targetsByResponder = new Map<string, ResponderIncidentTarget[]>();
  for (const assignment of assignmentRows) {
    const target = reportById.get(assignment.report_id);
    if (!target) continue;
    const current = targetsByResponder.get(assignment.responder_id) || [];
    if (!current.some((item) => item.incidentId === target.incidentId)) {
      current.push({
        ...target,
        crew: crewByAssignment.get(assignment.id) || [],
      });
    }
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
