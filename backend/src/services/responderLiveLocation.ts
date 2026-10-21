import { supabaseAdmin } from '../config/supabase';
import { getBarangayResponderGpsLocation, getResponderGpsLocation, RESPONDER_GPS_TTL_SECONDS } from '../config/redis';
import { parseTransportDestination } from './fieldResponseNotes';

export type ResponderAccountKind = 'mdrrmo' | 'barangay';

export interface ResponderIncidentTarget {
  incidentId: string;
  title: string;
  latitude: number;
  longitude: number;
  crew: ResponderCrewMember[];
  transportStatus?: string;
  hospitalName?: string;
  hospitalAddress?: string;
  hospitalLatitude?: number | null;
  hospitalLongitude?: number | null;
}

export interface ResponderCrewMember {
  name: string;
  memberRole: string;
}

export interface ResponderLiveLocation {
  responderKey: string;
  responderId: string;
  accountKind: ResponderAccountKind;
  barangayId?: string | null;
  responderName: string;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  timestamp: string;
  assignments: ResponderIncidentTarget[];
}

function coordinate(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function validTargetCoordinates(latitudeValue: unknown, longitudeValue: unknown): { latitude: number; longitude: number } | null {
  const latitude = coordinate(latitudeValue);
  const longitude = coordinate(longitudeValue);
  if (latitude === null || latitude < -90 || latitude > 90 ||
      longitude === null || longitude < -180 || longitude > 180 || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

export async function getActiveResponderTargets(responderId?: string): Promise<Map<string, ResponderIncidentTarget[]>> {
  let assignmentQuery = supabaseAdmin
    .from('mdrrmo_report_assignments')
    .select('id, report_id, responder_id, arrived_at')
    .eq('status', 'responding');
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
    .select('id, title, latitude, longitude, response_status, response_notes')
    .in('id', reportIds);
  if (mdrrmoErr) throw mdrrmoErr;

  const reportById = new Map<string, ResponderIncidentTarget>();
  for (const r of mdrrmoRows || []) {
    if (String(r.response_status || '').toLowerCase() === 'resolved') continue;
    const latitude = coordinate(r.latitude);
    const longitude = coordinate(r.longitude);
    if (latitude === null || longitude === null || latitude === 0 || longitude === 0) continue;
    const transport = parseTransportDestination(r.response_notes, 'mdrrmo');
    reportById.set(r.id, {
      incidentId: r.id,
      title: r.title || 'Emergency Incident',
      latitude,
      longitude,
      crew: [],
      transportStatus: transport.transport_status,
      hospitalName: transport.hospital_name,
      hospitalAddress: transport.hospital_address,
      hospitalLatitude: transport.hospital_latitude,
      hospitalLongitude: transport.hospital_longitude,
    });
  }

  const targetsByResponder = new Map<string, ResponderIncidentTarget[]>();
  for (const assignment of assignmentRows) {
    const target = reportById.get(assignment.report_id);
    if (!target) continue;
    if (assignment.arrived_at && target.transportStatus !== 'in_transit') continue;
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

/** Active barangay response assignments, including local reports and central MDRRMO assignments. */
export async function getActiveBarangayResponderTargets(
  barangayId?: string,
  responderId?: string,
): Promise<Map<string, ResponderIncidentTarget[]>> {
  let centralQuery = supabaseAdmin.from('mdrrmo_report_barangay_assignments')
    .select('id, report_id, barangay_id, responder_ids, arrived_at, response_notes')
    .eq('assignment_status', 'active')
    .eq('response_status', 'responding');
  if (barangayId) centralQuery = centralQuery.eq('barangay_id', barangayId);
  if (responderId) centralQuery = centralQuery.contains('responder_ids', [responderId]);

  let localQuery = supabaseAdmin.from('barangay_reports')
    .select('*')
    .eq('response_status', 'responding')
    .is('resolved_at', null);
  if (barangayId) localQuery = localQuery.eq('barangay_id', barangayId);

  const [{ data: centralAssignments, error: centralError }, { data: localReports, error: localError }] = await Promise.all([
    centralQuery,
    localQuery,
  ]);
  if (centralError) throw centralError;
  if (localError) throw localError;

  const reportIds = [...new Set((centralAssignments || []).map((row: any) => row.report_id))];
  const { data: centralReports, error: centralReportsError } = reportIds.length
    ? await supabaseAdmin.from('mdrrmo_reports').select('id, title, latitude, longitude, response_status').in('id', reportIds)
    : { data: [], error: null } as any;
  if (centralReportsError) throw centralReportsError;

  const targetsById = new Map<string, ResponderIncidentTarget>();
  for (const report of centralReports || []) {
    if (String(report.response_status || '').toLowerCase() === 'resolved') continue;
    const point = validTargetCoordinates(report.latitude, report.longitude);
    if (!point) continue;
    targetsById.set(report.id, { incidentId: report.id, title: report.title || 'Emergency Incident', ...point, crew: [] });
  }

  const responderTargets = new Map<string, ResponderIncidentTarget[]>();
  const addTarget = (id: string, target: ResponderIncidentTarget) => {
    const current = responderTargets.get(id) || [];
    if (!current.some((item) => item.incidentId === target.incidentId)) current.push(target);
    responderTargets.set(id, current);
  };

  for (const assignment of centralAssignments || []) {
    const target = targetsById.get(assignment.report_id);
    if (!target) continue;
    const transport = parseTransportDestination(assignment.response_notes, 'barangay');
    if (assignment.arrived_at && transport.transport_status !== 'in_transit') continue;
    const transportTarget: ResponderIncidentTarget = {
      ...target,
      transportStatus: transport.transport_status,
      hospitalName: transport.hospital_name,
      hospitalAddress: transport.hospital_address,
      hospitalLatitude: transport.hospital_latitude,
      hospitalLongitude: transport.hospital_longitude,
    };
    for (const id of (assignment.responder_ids || []) as string[]) {
      if (!responderId || responderId === id) addTarget(id, transportTarget);
    }
  }

  for (const report of localReports || []) {
    if (report.resolved_at || String(report.response_status || '').toLowerCase() !== 'responding') continue;
    const point = validTargetCoordinates(report.latitude, report.longitude);
    if (!point) continue;
    const notes = String(report.barangay_response_notes || report.response_notes || '');
    const transport = parseTransportDestination(notes, 'barangay');
    if (report.arrived_at && transport.transport_status !== 'in_transit') continue;
    const assigned = notes.match(/^\[ASSIGNED:([^\]]+)\]/)?.[1]
      ?.split(',').map((id: string) => id.trim()).filter(Boolean) || [];
    const primary = report.barangay_responded_by || report.responded_by;
    if (primary && !assigned.includes(primary)) assigned.unshift(primary);
    const target: ResponderIncidentTarget = {
      incidentId: report.id,
      title: report.title || report.type || 'Emergency Incident',
      ...point,
      crew: [],
      transportStatus: transport.transport_status,
      hospitalName: transport.hospital_name,
      hospitalAddress: transport.hospital_address,
      hospitalLatitude: transport.hospital_latitude,
      hospitalLongitude: transport.hospital_longitude,
    };
    for (const id of assigned) {
      if (!responderId || responderId === id) addTarget(id, target);
    }
  }

  const ids = [...responderTargets.keys()];
  if (!ids.length) return responderTargets;
  let responderQuery = supabaseAdmin.from('barangay_users')
    .select('id, full_name, barangay_id')
    .in('id', ids)
    .eq('role', 'responder')
    .eq('is_active', true);
  if (barangayId) responderQuery = responderQuery.eq('barangay_id', barangayId);
  const { data: responders, error: respondersError } = await responderQuery;
  if (respondersError) throw respondersError;
  const eligibleIds = new Set((responders || []).map((responder: any) => responder.id));
  for (const id of ids) if (!eligibleIds.has(id)) responderTargets.delete(id);
  return responderTargets;
}

async function readFreshGpsLocation<T extends { responderId: string; responderName: string; assignments: ResponderIncidentTarget[] }>(
  accountKind: ResponderAccountKind,
  responder: T,
): Promise<ResponderLiveLocation | null> {
  const location = accountKind === 'barangay'
    ? await getBarangayResponderGpsLocation(responder.responderId)
    : await getResponderGpsLocation(responder.responderId);
  const timestamp = location ? Date.parse(location.timestamp) : Number.NaN;
  if (!location || !Number.isFinite(timestamp) || timestamp < Date.now() - RESPONDER_GPS_TTL_SECONDS * 1000 || !responder.assignments.length) return null;
  return {
    responderKey: `${accountKind}:${responder.responderId}`,
    responderId: responder.responderId,
    accountKind,
    ...('barangayId' in responder ? { barangayId: (responder as any).barangayId } : {}),
    responderName: responder.responderName,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyM: location.accuracyM ?? null,
    timestamp: location.timestamp,
    assignments: responder.assignments,
  };
}

async function getCurrentMdrrmoResponderLiveLocations(): Promise<ResponderLiveLocation[]> {
  const targetsByResponder = await getActiveResponderTargets();
  const responderIds = [...targetsByResponder.keys()];
  if (!responderIds.length) return [];

  const { data: responders, error: responderError } = await supabaseAdmin
    .from('users')
    .select('id, full_name')
    .in('id', responderIds)
    .eq('role', 'responder')
    .eq('status', 'active');
  if (responderError) throw responderError;

  const liveLocations = await Promise.all((responders || []).flatMap((responder: any) => {
    const assignments = targetsByResponder.get(responder.id) || [];
    return assignments.length ? [readFreshGpsLocation('mdrrmo', {
      responderId: responder.id,
      responderName: responder.full_name || 'Responder',
      assignments,
    })] : [];
  }));
  return liveLocations.filter((location): location is ResponderLiveLocation => Boolean(location));
}

export async function getCurrentBarangayResponderLiveLocations(barangayId?: string): Promise<ResponderLiveLocation[]> {
  const targetsByResponder = await getActiveBarangayResponderTargets(barangayId);
  const responderIds = [...targetsByResponder.keys()];
  if (!responderIds.length) return [];

  let responderQuery = supabaseAdmin
    .from('barangay_users')
    .select('id, full_name, barangay_id')
    .in('id', responderIds)
    .eq('role', 'responder')
    .eq('is_active', true);
  if (barangayId) responderQuery = responderQuery.eq('barangay_id', barangayId);
  const { data: responders, error: responderError } = await responderQuery;
  if (responderError) throw responderError;

  const liveLocations = await Promise.all((responders || []).flatMap((responder: any) => {
    const assignments = targetsByResponder.get(responder.id) || [];
    return assignments.length ? [readFreshGpsLocation('barangay', {
      responderId: responder.id,
      responderName: responder.full_name || 'Responder',
      barangayId: responder.barangay_id,
      assignments,
    })] : [];
  }));
  return liveLocations.filter((location): location is ResponderLiveLocation => Boolean(location));
}

export async function getCurrentResponderLiveLocations(): Promise<ResponderLiveLocation[]> {
  const [mdrrmoLocations, barangayLocations] = await Promise.all([
    getCurrentMdrrmoResponderLiveLocations(),
    getCurrentBarangayResponderLiveLocations(),
  ]);
  return [...mdrrmoLocations, ...barangayLocations];
}
