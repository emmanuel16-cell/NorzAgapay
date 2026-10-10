import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { io } from '../server';
import { distanceMeters, validateArrivalFix, validateRecentGpsFix } from '../services/arrivalValidation';
import { IncidentResolutionPdfService, IncompleteResolutionReportError } from '../services/incidentResolutionPdfService';
import { isEscalatedForMdrrmo, isVisibleToMdrrmo } from '../services/mdrrmoReportVisibility';
import { getDispatchableRespondUnits } from '../services/respondUnitAvailability';
import { getVerifiedBarangayIds } from '../services/verifiedBarangayService';
import { getBarangayResponderGpsLocation, getResponderGpsLocation, RESPONDER_GPS_TTL_SECONDS } from '../config/redis';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const isMdrrmoReport = isVisibleToMdrrmo;

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [value];
  } catch {
    return value.includes('|||') ? value.split('|||').map((item) => item.trim()).filter(Boolean) : [value];
  }
}

function isResolved(report: any, barangayAssignments: any[] = []): boolean {
  if (barangayAssignments.some((assignment) =>
    assignment.assignment_status === 'completed' && assignment.response_status === 'resolved')) return true;
  const responseStatus = String(report.response_status || report.mdrrmo_response_status || '').toLowerCase();
  return responseStatus === 'resolved' ||
    (!responseStatus && !isEscalatedForMdrrmo(report) && ['resolved', 'closed'].includes(String(report.status).toLowerCase()));
}

function formatReport(report: any): any {
  const proofUrls = parseList(report.proof_urls).length ? parseList(report.proof_urls) : parseList(report.proof_url);
  let proofTypes = parseList(report.proof_types);
  if (proofTypes.length < proofUrls.length) {
    proofTypes = proofUrls.map((url, index) => proofTypes[index] || (/\.(mp4|mov|webm|3gp|mkv|avi)(\?.*)?$/i.test(url) ? 'video' : report.proof_type || 'image'));
  }
  let responderMedia = report.responder_media;
  if (typeof responderMedia === 'string') {
    try { responderMedia = JSON.parse(responderMedia); } catch { responderMedia = []; }
  }

  let sendTo = String(report.send_to || '').trim().toLowerCase();
  let cleanSpecifics = report.specifics || '';
  if (cleanSpecifics.includes('[SEND_TO:')) {
    const match = cleanSpecifics.match(/\[SEND_TO:([^\]]+)\]/i);
    if (match && match[1]) {
      const explicitSendTo = match[1].trim().toLowerCase();
      if (!sendTo || sendTo === 'all') {
        sendTo = explicitSendTo;
      }
      cleanSpecifics = cleanSpecifics.replace(/\[SEND_TO:[^\]]+\]/i, '').trim();
    }
  }
  if ((!sendTo || sendTo === 'all') && report.description && /\[SEND_TO:[^\]]+\]/i.test(report.description)) {
    const match = report.description.match(/\[SEND_TO:([^\]]+)\]/i);
    if (match && match[1]) {
      sendTo = match[1].trim().toLowerCase();
    }
  }

  const rawStatus = String(report.response_status || report.mdrrmo_response_status || 'pending').toLowerCase();
  const normalizedStatus = rawStatus === 'responding' ? 'responding'
    : (rawStatus === 'resolved' || isResolved(report)) ? 'resolved'
    : 'pending';

  const isEscalated = report.source_type === 'escalated' || isEscalatedForMdrrmo(report);
  const barangayName = report.barangays?.name || report.barangay_name || null;

  return {
    ...report,
    barangay_name: barangayName,
    send_to: sendTo || 'mdrrmo',
    is_escalated: isEscalated,
    response_status: normalizedStatus,
    mdrrmo_response_status: normalizedStatus,
    // The responder app writes MDRRMO assessments to the canonical
    // mdrrmo_reports.response_notes column. Expose the legacy API alias too
    // so dashboard consumers reading mdrrmo_response_notes see the same data.
    mdrrmo_response_notes: report.response_notes || report.mdrrmo_response_notes || null,
    mdrrmo_responded_by: report.responded_by || report.mdrrmo_responded_by || null,
    mdrrmo_responder_name: report.responder_name || report.mdrrmo_responder_name || null,
    mdrrmo_dispatched_at: report.dispatched_at || report.mdrrmo_dispatched_at || null,
    mdrrmo_dispatch_notes: report.dispatch_notes || report.mdrrmo_dispatch_notes || null,
    mdrrmo_accepted_at: report.accepted_at || report.mdrrmo_accepted_at || null,
    mdrrmo_arrived_at: report.arrived_at || report.mdrrmo_arrived_at || null,
    mdrrmo_resolved_at: report.resolved_at || report.mdrrmo_resolved_at || null,
    mdrrmo_resolved_notes: report.resolved_notes || report.mdrrmo_resolved_notes || null,
    mdrrmo_coordination_notes: report.coordination_notes || report.mdrrmo_coordination_notes || null,
    specifics: cleanSpecifics,
    proof_urls: proofUrls,
    proof_types: proofTypes,
    proof_url: proofUrls[0] || null,
    proof_type: proofTypes[0] || report.proof_type || 'image',
    responder_media: Array.isArray(responderMedia) ? responderMedia : [],
  };
}

async function getAssignments(reportIds: string[]) {
  if (!reportIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from('mdrrmo_report_assignments')
    .select('id, report_id, responder_id, status, assigned_at, accepted_at, arrived_at, resolved_at')
    .in('report_id', reportIds)
    .neq('status', 'removed');
  if (error) throw error;
  const rows = data || [];
  const responderIds = [...new Set(rows.map((row: any) => row.responder_id))];
  const assignmentIds = rows.map((row: any) => row.id);
  const names = new Map<string, any>();
  const crewByAssignment = new Map<string, any[]>();
  if (responderIds.length) {
    const { data: responders, error: responderError } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, unit_type, status')
      .in('id', responderIds);
    if (responderError) throw responderError;
    for (const responder of responders || []) names.set(responder.id, responder);
  }
  if (assignmentIds.length) {
    const { data: crew, error: crewError } = await supabaseAdmin
      .from('mdrrmo_assignment_crew_members')
      .select('assignment_id, unit_member_id, member_name_snapshot, member_role_snapshot, selected_at')
      .in('assignment_id', assignmentIds)
      .order('selected_at', { ascending: true });
    if (crewError) throw crewError;
    for (const member of crew || []) {
      const members = crewByAssignment.get(member.assignment_id) || [];
      members.push({
        unit_member_id: member.unit_member_id,
        name: member.member_name_snapshot,
        member_role: member.member_role_snapshot,
        selected_at: member.selected_at,
      });
      crewByAssignment.set(member.assignment_id, members);
    }
  }
  return rows.map((row: any) => ({
    ...row,
    responder: names.get(row.responder_id) || null,
    crew: crewByAssignment.get(row.id) || [],
  }));
}

async function emitReportUpdate(report: any, assignments: any[]) {
  const payload = {
    ...formatReport(report),
    mdrrmo_assignments: assignments,
    assigned_responder_ids: assignments.map((assignment) => assignment.responder_id),
    mdrrmo_responder_name: assignments
      .map((assignment) => assignment.responder?.full_name)
      .filter(Boolean)
      .join(', ') || report.responder_name || report.mdrrmo_responder_name || null,
  };
  io.to('dashboard_staff').emit('incident_report:updated', payload);
  io.to('dashboard_staff').emit('mdrrmo:report_updated', payload);
  for (const assignment of assignments) {
    io.to(`user:${assignment.responder_id}`).emit('mdrrmo:report_updated', payload);
    io.to(`user:${assignment.responder_id}`).emit('incident_report:updated', payload);
  }
  if (report.reporter_id) io.to(`user:${report.reporter_id}`).emit('incident_report:updated', payload);
  return payload;
}

// Dispatcher sees all reports routed to MDRRMO; responders only see reports
// explicitly assigned to their account. `status` accepts pending/responding/resolved.
router.get('/queue', authenticate, authorize('dispatcher', 'admin', 'responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Primary: read from dedicated mdrrmo_reports table
    const { data: newData, error: newError } = await supabaseAdmin
      .from('mdrrmo_reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (newError) throw newError;

    // Use mdrrmo_reports exclusively
    const combined: any[] = (newData || []).map((r: any) => ({ ...r, _source: 'mdrrmo_reports' }));

    let reports = combined;
    const allAssignments = await getAssignments(reports.map((report: any) => report.id));
    const reportIds = reports.map((report: any) => report.id);
    const { data: barangayAssignments, error: barangayAssignmentsError } = reportIds.length
      ? await supabaseAdmin.from('mdrrmo_report_barangay_assignments')
        .select('*').in('report_id', reportIds).order('assigned_at', { ascending: false })
      : { data: [], error: null } as any;
    if (barangayAssignmentsError) throw barangayAssignmentsError;
    const destinationIds = [...new Set((barangayAssignments || []).map((row: any) => row.barangay_id).filter(Boolean))];
    const { data: destinationRows, error: destinationError } = destinationIds.length
      ? await supabaseAdmin.from('barangays').select('id, name').in('id', destinationIds)
      : { data: [], error: null } as any;
    if (destinationError) throw destinationError;
    const destinationNames = new Map((destinationRows || []).map((row: any) => [row.id, row.name]));

    if (req.user!.role === 'responder') {
      reports = reports.filter((report: any) => allAssignments.some((assignment: any) =>
        assignment.report_id === report.id && assignment.responder_id === req.user!.userId && assignment.status !== 'removed'));
    }

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status === 'pending') reports = reports.filter((report: any) => {
      const assignments = (barangayAssignments || []).filter((item: any) => item.report_id === report.id);
      const activeBarangay = assignments.find((item: any) => item.assignment_status === 'active');
      const mdrrmoStatus = String(report.response_status || report.mdrrmo_response_status || '').toLowerCase();
      return !isResolved(report, assignments) && mdrrmoStatus !== 'responding' && activeBarangay?.response_status !== 'responding';
    });
    else if (status === 'responding') reports = reports.filter((report: any) => {
      const assignments = (barangayAssignments || []).filter((item: any) => item.report_id === report.id);
      const activeBarangay = assignments.find((item: any) => item.assignment_status === 'active');
      const mdrrmoStatus = String(report.response_status || report.mdrrmo_response_status || '').toLowerCase();
      return !isResolved(report, assignments) && (mdrrmoStatus === 'responding' || activeBarangay?.response_status === 'responding');
    });
    else if (status === 'resolved') reports = reports.filter((report: any) =>
      isResolved(report, (barangayAssignments || []).filter((item: any) => item.report_id === report.id)));

    const residentIds = [...new Set(reports.map((report: any) => report.reporter_id).filter(Boolean))];
    const residentsById = new Map<string, any>();
    if (residentIds.length) {
      const { data: residents, error: residentsError } = await supabaseAdmin
        .from('resident_user')
        .select('id, full_name, phone, email')
        .in('id', residentIds);
      if (residentsError) throw residentsError;
      for (const resident of residents || []) residentsById.set(resident.id, resident);
    }

    res.json(reports.map((report: any) => {
      const assignments = allAssignments.filter((assignment: any) => assignment.report_id === report.id);
      const reportBarangayAssignments = (barangayAssignments || [])
        .filter((assignment: any) => assignment.report_id === report.id)
        .map((assignment: any) => ({ ...assignment, barangay_name: destinationNames.get(assignment.barangay_id) || null }));
      const resident = residentsById.get(report.reporter_id);
      return formatReport({
        ...report,
        reporter_name: report.reporter_name || resident?.full_name || null,
        reporter_phone: report.reporter_phone || resident?.phone || null,
        reporter_email: report.reporter_email || resident?.email || null,
        mdrrmo_assignments: assignments,
        barangay_assignments: reportBarangayAssignments,
        active_barangay_assignment: reportBarangayAssignments.find((assignment: any) => assignment.assignment_status === 'active') || null,
        assigned_responder_ids: assignments.map((assignment: any) => assignment.responder_id),
        mdrrmo_responder_name: assignments.map((assignment: any) => assignment.responder?.full_name).filter(Boolean).join(', ') || report.responder_name || report.mdrrmo_responder_name || null,
      });
    }));
  } catch (err) {
    console.error('Fetch MDRRMO report queue error:', err);
    res.status(500).json({ error: 'Could not load the MDRRMO report queue.' });
  }
});

router.get('/barangay-destinations', authenticate, authorize('dispatcher', 'admin'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const verifiedIds = await getVerifiedBarangayIds();
    if (!verifiedIds.length) { res.json({ barangays: [] }); return; }
    const { data, error } = await supabaseAdmin.from('barangays')
      .select('id, name, municipality, location_latitude, location_longitude')
      .in('id', verifiedIds).order('name', { ascending: true });
    if (error) throw error;
    res.json({ barangays: data || [] });
  } catch (error) {
    console.error('Load MDRRMO barangay destinations failed:', error);
    res.status(500).json({ error: 'Could not load active barangay destinations.' });
  }
});

async function changeBarangayAssignment(req: AuthRequest, res: Response, action: 'assign' | 'reassign' | 'recall'): Promise<void> {
  try {
    const barangayId = action === 'recall' ? null : String(req.body?.barangay_id || '').trim();
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    if (action !== 'recall' && !barangayId) {
      res.status(400).json({ error: 'Choose a destination barangay.' });
      return;
    }
    if ((action === 'reassign' || action === 'recall') && notes.length < 3) {
      res.status(400).json({ error: 'Enter a reason of at least 3 characters.' });
      return;
    }
    if (action === 'assign' && notes.length < 3) {
      res.status(400).json({ error: 'Add assignment notes so the barangay has response context.' });
      return;
    }
    if (barangayId && !await getVerifiedBarangayIds().then((ids) => ids.includes(barangayId))) {
      res.status(403).json({ error: 'This barangay is not active and eligible for assignment.' });
      return;
    }
    let previousBarangayId: string | null = null;
    if (action !== 'assign') {
      const { data: previous, error: previousError } = await supabaseAdmin
        .from('mdrrmo_report_barangay_assignments')
        .select('barangay_id')
        .eq('report_id', req.params.id)
        .eq('assignment_status', 'active')
        .maybeSingle();
      if (previousError) throw previousError;
      previousBarangayId = previous?.barangay_id || null;
    }
    const { data: assignmentId, error } = await supabaseAdmin.rpc('set_mdrrmo_report_barangay_assignment_v1', {
      p_report_id: req.params.id,
      p_barangay_id: barangayId,
      p_actor_id: req.user!.userId,
      p_action: action,
      p_notes: notes || null,
    });
    if (error) throw error;

    const [{ data: report, error: reportError }, { data: assignment, error: assignmentError }] = await Promise.all([
      supabaseAdmin.from('mdrrmo_reports').select('*').eq('id', req.params.id).single(),
      supabaseAdmin.from('mdrrmo_report_barangay_assignments').select('*').eq('id', assignmentId).maybeSingle(),
    ]);
    if (reportError) throw reportError;
    if (assignmentError) throw assignmentError;
    let barangayName: string | null = null;
    if (assignment?.barangay_id) {
      const { data: barangay, error: barangayError } = await supabaseAdmin.from('barangays').select('name').eq('id', assignment.barangay_id).maybeSingle();
      if (barangayError) throw barangayError;
      barangayName = barangay?.name || null;
    }
    const payload = formatReport({
      ...report,
      active_barangay_assignment: assignment?.assignment_status === 'active' ? { ...assignment, barangay_name: barangayName } : null,
    });
    io.to('dashboard_staff').emit('mdrrmo:report_updated', payload);
    io.to('dashboard_staff').emit('incident_report:updated', payload);
    if (assignment?.barangay_id) {
      io.to(`barangay:${assignment.barangay_id}`).emit('barangay:report_assigned', payload);
      io.to(`barangay:${assignment.barangay_id}`).emit('barangay:report_updated', payload);
    }
    if (previousBarangayId && (action === 'recall' || previousBarangayId !== assignment?.barangay_id)) {
      io.to(`barangay:${previousBarangayId}`).emit('barangay:report_assignment_removed', {
        reportId: req.params.id,
      });
    }
    if (report.reporter_id) io.to(`user:${report.reporter_id}`).emit('incident_report:updated', payload);
    res.json({ message: action === 'recall' ? 'Barangay assignment recalled.' : 'Report assigned to barangay.', report: payload, assignment });
  } catch (error: any) {
    console.error(`MDRRMO barangay ${action} failed:`, error);
    const code = String(error?.code || '');
    const status = code === 'P0002' ? 404 : code === '42501' ? 403 : code === 'P0001' || code === '23505' ? 409 : code === '22023' ? 400 : 500;
    res.status(status).json({ error: error?.message || 'Could not change the barangay assignment.' });
  }
}

router.post('/:id/assign-barangay', authenticate, authorize('dispatcher', 'admin'), (req: AuthRequest, res: Response) => {
  void changeBarangayAssignment(req, res, 'assign');
});
router.post('/:id/reassign-barangay', authenticate, authorize('dispatcher', 'admin'), (req: AuthRequest, res: Response) => {
  void changeBarangayAssignment(req, res, 'reassign');
});
router.post('/:id/recall-barangay', authenticate, authorize('dispatcher', 'admin'), (req: AuthRequest, res: Response) => {
  void changeBarangayAssignment(req, res, 'recall');
});

router.get('/command-locations', authenticate, authorize('dispatcher', 'admin'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [{ data: office, error: officeError }, { data: barangays, error: barangaysError }] = await Promise.all([
      supabaseAdmin.from('mdrrmo_command_locations').select('*').eq('location_key', 'office').maybeSingle(),
      supabaseAdmin.from('barangays').select('id, name, location_latitude, location_longitude, location_address').order('name', { ascending: true }),
    ]);
    if (officeError) throw officeError;
    if (barangaysError) throw barangaysError;
    const eligibleIds = new Set(await getVerifiedBarangayIds());
    res.json({
      office: office || null,
      barangays: (barangays || []).filter((row: any) => eligibleIds.has(row.id)),
    });
  } catch (error) {
    console.error('Load command locations failed:', error);
    res.status(500).json({ error: 'Could not load command locations.' });
  }
});

router.put('/command-locations/office', authenticate, authorize('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().trim().max(240).nullable().optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter valid MDRRMO office coordinates.', details: parsed.error.flatten() });
    return;
  }
  try {
    const { data, error } = await supabaseAdmin.from('mdrrmo_command_locations').upsert({
      location_key: 'office', ...parsed.data, updated_by: req.user!.userId, updated_at: new Date().toISOString(),
    }, { onConflict: 'location_key' }).select('*').single();
    if (error) throw error;
    io.emit('command:locations_updated', { type: 'office' });
    res.json({ office: data });
  } catch (error) {
    console.error('Save MDRRMO office location failed:', error);
    res.status(500).json({ error: 'Could not save the MDRRMO office location.' });
  }
});

router.get('/available-responders', authenticate, authorize('dispatcher', 'admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const locationType = String(req.query.location_type || '');
    const barangayId = String(req.query.barangay_id || '');
    let target: { latitude: number; longitude: number; label: string } | null = null;
    if (locationType === 'office') {
      const { data, error } = await supabaseAdmin.from('mdrrmo_command_locations')
        .select('latitude, longitude').eq('location_key', 'office').maybeSingle();
      if (error) throw error;
      if (data) target = { latitude: Number(data.latitude), longitude: Number(data.longitude), label: 'MDRRMO office' };
    } else if (locationType === 'barangay') {
      if (!barangayId || !(await getVerifiedBarangayIds()).includes(barangayId)) {
        res.status(403).json({ error: 'This barangay location is unavailable.' });
        return;
      }
      const { data, error } = await supabaseAdmin.from('barangays')
        .select('name, location_latitude, location_longitude').eq('id', barangayId).maybeSingle();
      if (error) throw error;
      if (data?.location_latitude != null && data.location_longitude != null) {
        target = { latitude: Number(data.location_latitude), longitude: Number(data.location_longitude), label: `Barangay ${data.name}` };
      }
    } else {
      res.status(400).json({ error: 'Choose an office or barangay location.' });
      return;
    }
    if (!target) { res.json({ responders: [], location: null }); return; }

    const isBarangayPin = locationType === 'barangay';
    const { data: responders, error: respondersError } = isBarangayPin
      ? await supabaseAdmin.from('barangay_users')
        .select('id, full_name, phone').eq('barangay_id', barangayId).eq('role', 'responder').eq('is_active', true)
      : await supabaseAdmin.from('users')
        .select('id, full_name, phone, unit_type').eq('role', 'responder').eq('status', 'active');
    if (respondersError) throw respondersError;
    const responderRows = responders || [];
    if (!responderRows.length) { res.json({ responders: [], location: target.label }); return; }
    const ids = responderRows.map((row: any) => row.id);
    const busy = new Set<string>();
    if (isBarangayPin) {
      const [central, local] = await Promise.all([
        supabaseAdmin.from('mdrrmo_report_barangay_assignments').select('responder_ids')
          .eq('barangay_id', barangayId).eq('assignment_status', 'active'),
        supabaseAdmin.from('barangay_reports').select('response_notes, barangay_response_notes, responded_by, barangay_responded_by')
          .eq('barangay_id', barangayId).in('response_status', ['pending', 'responding']),
      ]);
      if (central.error) throw central.error;
      if (local.error) throw local.error;
      for (const assignment of central.data || []) {
        for (const responderId of assignment.responder_ids || []) busy.add(responderId);
      }
      for (const report of local.data || []) {
        const primary = report.barangay_responded_by || report.responded_by;
        if (primary) busy.add(primary);
        const notes = report.barangay_response_notes || report.response_notes || '';
        const match = String(notes).match(/^\[ASSIGNED:([^\]]+)\]/);
        if (match) match[1].split(',').map((id) => id.trim()).filter(Boolean).forEach((id) => busy.add(id));
      }
    } else {
      const { data: activeRows, error: activeError } = await supabaseAdmin.from('mdrrmo_report_assignments')
        .select('responder_id').in('responder_id', ids).in('status', ['assigned','responding']);
      if (activeError) throw activeError;
      for (const row of activeRows || []) busy.add(row.responder_id);
    }
    const nowMs = Date.now();
    const locations = await Promise.all(responderRows.map(async (responder: any) => ({
      responder,
      location: isBarangayPin
        ? await getBarangayResponderGpsLocation(responder.id)
        : await getResponderGpsLocation(responder.id),
    })));
    const available = locations.flatMap(({ responder, location }) => {
      if (busy.has(responder.id) || !location || !Number.isFinite(location.accuracyM) || Number(location.accuracyM) > 50) return [];
      const ageMs = nowMs - Date.parse(location.timestamp);
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > RESPONDER_GPS_TTL_SECONDS * 1000) return [];
      const distanceM = distanceMeters(target!.latitude, target!.longitude, location.latitude, location.longitude);
      if (distanceM > 100) return [];
      return [{ id: responder.id, full_name: responder.full_name, phone: responder.phone, unit_type: responder.unit_type || null, distance_m: Math.round(distanceM), last_seen: location.timestamp }];
    }).sort((a: any, b: any) => a.distance_m - b.distance_m);
    res.json({ responders: available, location: target.label });
  } catch (error) {
    console.error('Load available MDRRMO responders failed:', error);
    res.status(500).json({ error: 'Could not load available responders.' });
  }
});

router.get('/responders', authenticate, authorize('dispatcher', 'admin'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const availableUnits = await getDispatchableRespondUnits();
    const leaderIds = [...new Set(availableUnits.map((unit) => unit.responder_user_id))];
    if (!leaderIds.length) { res.json({ responders: [] }); return; }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, unit_type, status, latitude, longitude, last_seen')
      .in('id', leaderIds)
      .eq('role', 'responder')
      .eq('status', 'active')
      .order('full_name', { ascending: true });
    if (error) throw error;
    const leaderUnits = new Map(availableUnits.map((unit) => [unit.responder_user_id, unit]));
    res.json({ responders: (data || []).map((responder: any) => ({
      ...responder,
      unit_id: leaderUnits.get(responder.id)?.unit_id,
      unit_name: leaderUnits.get(responder.id)?.unit_name || null,
      officer_name: leaderUnits.get(responder.id)?.officer_name || null,
    })) });
  } catch (err: any) {
    console.error('Fetch active MDRRMO responders error:', err);
    if (['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST200'].includes(err?.code)) {
      res.status(503).json({
        error: 'The Respond Units roster database objects are missing. Apply database/migrations/20261008_respond_units_roster.sql, then retry.',
        code: 'RESPOND_UNITS_SCHEMA_MISSING',
      });
      return;
    }
    res.status(500).json({ error: 'Could not load active MDRRMO responders.' });
  }
});

const dispatchSchema = z.object({
  incident_type: z.enum(['flash_flood', 'fire', 'earthquake', 'medical_emergency', 'typhoon', 'other']),
  severity: z.enum(['low', 'moderate', 'high', 'critical']),
  responder_ids: z.array(z.string().uuid()).min(1).max(50),
  notes: z.string().trim().max(1000).optional().default(''),
});

const responderPushTokenSchema = z.object({
  fcm_token: z.string().trim().min(1).max(4096),
  platform: z.literal('android'),
});

router.put('/push-token', authenticate, authorize('responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = responderPushTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid Android FCM token is required.' });
    return;
  }
  try {
    const { error } = await supabaseAdmin
      .from('mdrrmo_responder_push_tokens')
      .upsert({
        fcm_token: parsed.data.fcm_token,
        responder_id: req.user!.userId,
        platform: parsed.data.platform,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'fcm_token' });
    if (error) throw error;
    res.status(200).json({ registered: true });
  } catch (error) {
    console.error('MDRRMO responder push-token registration failed:', error);
    res.status(503).json({ error: 'Push notifications could not be registered.' });
  }
});

router.delete('/push-token', authenticate, authorize('responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({ fcm_token: z.string().trim().min(1).max(4096) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid FCM token is required.' });
    return;
  }
  try {
    const { error } = await supabaseAdmin
      .from('mdrrmo_responder_push_tokens')
      .delete()
      .eq('fcm_token', parsed.data.fcm_token)
      .eq('responder_id', req.user!.userId);
    if (error) throw error;
    res.status(200).json({ removed: true });
  } catch (error) {
    console.error('MDRRMO responder push-token removal failed:', error);
    res.status(503).json({ error: 'Push notifications could not be unregistered.' });
  }
});

const dispatchMdrrmoReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = dispatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose incident type, severity, and at least one active responder.', details: parsed.error.flatten() });
    return;
  }
  let dispatchStage = 'load_report';
  let dispatchCommitted = false;
  let committedPayload: any = null;
  try {
    const report = await reportForAction(req.params.id);
    if (!report) { res.status(404).json({ error: 'Report not found.' }); return; }
    if (report._source !== 'mdrrmo_reports' && !isMdrrmoReport(report)) { res.status(403).json({ error: 'This report has not been routed to MDRRMO.' }); return; }
    if (report.review_outcome) { res.status(409).json({ error: 'This report has already received an invalid-report decision.' }); return; }
    if (isResolved(report)) { res.status(409).json({ error: 'Resolved reports cannot be dispatched.' }); return; }
    const currentResponseStatus = String(report.response_status || report.mdrrmo_response_status || 'pending').toLowerCase();
    if (currentResponseStatus !== 'pending') {
      res.status(409).json({ error: 'Only a pending MDRRMO report can be dispatched.' });
      return;
    }
    const { data: barangayAssignments, error: barangayAssignmentError } = await supabaseAdmin
      .from('mdrrmo_report_barangay_assignments')
      .select('id, barangay_id, assignment_status, response_status')
      .eq('report_id', report.id)
      .in('assignment_status', ['active', 'completed']);
    if (barangayAssignmentError) throw barangayAssignmentError;
    if ((barangayAssignments || []).some((assignment: any) => assignment.assignment_status === 'active')) {
      res.status(409).json({ error: 'Recall the active barangay assignment before dispatching MDRRMO responders.' });
      return;
    }
    if ((barangayAssignments || []).some((assignment: any) => assignment.assignment_status === 'completed' && assignment.response_status === 'resolved')) {
      res.status(409).json({ error: 'A report resolved by its assigned barangay cannot be dispatched to MDRRMO responders.' });
      return;
    }
    if (report.accepted_at || report.arrived_at || report.resolved_at ||
        report.mdrrmo_accepted_at || report.mdrrmo_arrived_at || report.mdrrmo_resolved_at) {
      res.status(409).json({ error: 'Dispatch can only be changed before a responder accepts the report.' });
      return;
    }
    dispatchStage = 'load_current_assignments';
    const currentAssignments = await getAssignments([report.id]);
    if (currentAssignments.some((assignment: any) => assignment.status === 'responding')) {
      res.status(409).json({ error: 'Dispatch cannot be changed after a responder accepts the report.' });
      return;
    }

    const responderIds = [...new Set(parsed.data.responder_ids)];
    dispatchStage = 'validate_active_unit_roster';
    const dispatchableUnits = await getDispatchableRespondUnits();
    const dispatchableResponderIds = new Set(dispatchableUnits.map((unit) => unit.responder_user_id));
    if (responderIds.some((id) => !dispatchableResponderIds.has(id))) {
      res.status(400).json({ error: 'One or more selected responders do not belong to an available unit activated today with a complete roster.' });
      return;
    }

    dispatchStage = 'load_active_responders';
    const { data: responders, error: respondersError } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, unit_type')
      .in('id', responderIds)
      .eq('role', 'responder')
      .eq('status', 'active');
    if (respondersError) throw respondersError;
    if (!responders || responders.length !== responderIds.length) {
      res.status(400).json({ error: 'One or more selected MDRRMO responders are no longer active.' });
      return;
    }

    const responderNames = responders.map((r: any) => r.full_name).join(', ');
    // --- Write to new mdrrmo_reports table (V2 RPC) ---
    dispatchStage = 'persist_dispatch';
    const { data: dispatchResult, error: dispatchV2Error } = await supabaseAdmin.rpc('dispatch_mdrrmo_report_v2', {
      p_report_id: report.id,
      p_actor_id: req.user!.userId,
      p_incident_type: parsed.data.incident_type,
      p_severity: parsed.data.severity,
      p_notes: parsed.data.notes || '',
      p_responder_ids: responderIds,
      p_responder_names: responderNames,
    });
    // The RPC updates the canonical MDRRMO report and inserts its responder
    // assignments atomically. Do not ignore a missing report/RPC error or
    // attempt a second legacy-table write: responders read these same
    // assignments from the canonical queue.
    if (dispatchV2Error) throw dispatchV2Error;

    // The RPC commits the dispatch and assignments as one transaction. Build a
    // fallback response immediately so a later readback/realtime error cannot
    // make the client report a failed dispatch that was actually committed.
    dispatchCommitted = true;
    const dispatchTimestamp = dispatchResult?.dispatched_at || new Date().toISOString();
    const fallbackAssignments = responders.map((responder: any) => ({
      id: null,
      report_id: report.id,
      responder_id: responder.id,
      status: 'assigned',
      assigned_at: dispatchTimestamp,
      accepted_at: null,
      arrived_at: null,
      resolved_at: null,
      responder: { ...responder, status: 'active' },
      crew: [],
    }));
    const fallbackReport = {
      ...report,
      incident_type: parsed.data.incident_type,
      severity: parsed.data.severity,
      dispatched_at: dispatchTimestamp,
      dispatch_notes: parsed.data.notes || null,
      responder_name: responderNames,
      dispatched_by: req.user!.userId,
      lifecycle_actor_id: req.user!.userId,
      lifecycle_actor_role: 'dispatcher',
    };
    committedPayload = formatReport({
      ...fallbackReport,
      mdrrmo_assignments: fallbackAssignments,
      assigned_responder_ids: responderIds,
      mdrrmo_responder_name: responderNames,
    });

    let payload = committedPayload;
    let activeAssignments = fallbackAssignments;
    try {
      dispatchStage = 'readback_report';
      const updatedReport = await reportForAction(report.id);
      dispatchStage = 'readback_assignments';
      const updatedAssignments = await getAssignments([report.id]);
      activeAssignments = updatedAssignments.filter((a: any) => a.status !== 'removed');
      payload = formatReport({
        ...(updatedReport || fallbackReport),
        mdrrmo_assignments: activeAssignments,
        assigned_responder_ids: responderIds,
        mdrrmo_responder_name: activeAssignments.map((a: any) => a.responder?.full_name).filter(Boolean).join(', ') || responderNames,
      });
      committedPayload = payload;
    } catch (readbackError) {
      console.error('MDRRMO dispatch committed but readback failed:', {
        reportId: report.id,
        stage: dispatchStage,
        error: readbackError,
      });
    }

    // Database state is authoritative. A realtime transport error must not
    // turn a committed dispatch into an HTTP 500 and invite a duplicate retry.
    try {
      dispatchStage = 'emit_dispatch_updates';
      io.to('dashboard_staff').emit('incident_report:updated', payload);
      io.to('dashboard_staff').emit('mdrrmo:report_updated', payload);
      for (const responderId of responderIds) {
        const assignment = activeAssignments.find((item: any) => item.responder_id === responderId);
        const responderPayload = {
          ...payload,
          assignment_id: assignment?.id || null,
          responder_id: responderId,
        };
        io.to(`user:${responderId}`).emit('mdrrmo:report_assigned', responderPayload);
        io.to(`user:${responderId}`).emit('mdrrmo:report_updated', responderPayload);
      }
      if (report.reporter_id) io.to(`user:${report.reporter_id}`).emit('incident_report:updated', payload);
    } catch (emitError) {
      console.error('MDRRMO dispatch committed but realtime notification failed:', {
        reportId: report.id,
        error: emitError,
      });
    }
    res.json(payload);
  } catch (err: any) {
    if (dispatchCommitted) {
      console.error('MDRRMO report dispatch committed; returning fallback response after follow-up failure:', {
        reportId: req.params.id,
        stage: dispatchStage,
        error: err,
      });
      res.json(committedPayload);
      return;
    }
    console.error('MDRRMO report dispatch error:', {
      reportId: req.params.id,
      actorId: req.user?.userId,
      stage: dispatchStage,
      error: err,
    });
    if (['PGRST202', '42883', '42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST200'].includes(err?.code)) {
      res.status(503).json({
        error: 'MDRRMO dispatch database objects are missing or out of date. Apply database/migrations/20261008_respond_units_roster.sql, then retry.',
        code: 'MDRRMO_DISPATCH_SCHEMA_MISSING',
        stage: dispatchStage,
      });
      return;
    }
    if (err?.code === 'P0002') {
      res.status(404).json({ error: 'MDRRMO report or dispatch assignment was not found.' });
      return;
    }
    if (err?.code === '23503' && dispatchStage === 'persist_dispatch') {
      res.status(503).json({
        error: 'The dispatch assignment foreign key is out of date. Apply database/migrations/mdrrmo_report_assignment_canonical_fk_migration.sql, then retry.',
        code: 'MDRRMO_ASSIGNMENT_REPORT_FK_OUTDATED',
        stage: dispatchStage,
        cause_code: err.code,
      });
      return;
    }
    if (err?.code === '23514' || err?.code === '22023') {
      res.status(409).json({ error: err.message || 'The report or response unit is no longer eligible for dispatch.' });
      return;
    }
    res.status(500).json({
      error: 'Failed to dispatch this report to MDRRMO responders.',
      code: 'MDRRMO_DISPATCH_FAILED',
      stage: dispatchStage,
      cause_code: typeof err?.code === 'string' ? err.code : undefined,
    });
  }
};

// Dispatch is a write action. POST is the canonical method; keep PATCH for
// already-open dashboard bundles and older clients during deployment rollout.
router.post('/:id/dispatch', authenticate, authorize('dispatcher', 'admin'), dispatchMdrrmoReport);
router.patch('/:id/dispatch', authenticate, authorize('dispatcher', 'admin'), dispatchMdrrmoReport);
router.get('/:id/dispatch', (_req, res) => {
  res.setHeader('Allow', 'POST, PATCH');
  res.setHeader('Cache-Control', 'no-store');
  res.status(405).json({
    error: 'This dashboard version sent GET for a dispatch action. Update or hard-refresh the dashboard; dispatch requires POST.',
    code: 'MDRRMO_DISPATCH_CLIENT_OUTDATED',
  });
});

async function findAssignment(reportId: string, responderId: string) {
  const { data, error } = await supabaseAdmin
    .from('mdrrmo_report_assignments')
    .select('*')
    .eq('report_id', reportId)
    .eq('responder_id', responderId)
    .neq('status', 'removed')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function reportForAction(reportId: string) {
  // Prefer the new dedicated table
  const { data: newRow, error: newErr } = await supabaseAdmin
    .from('mdrrmo_reports')
    .select('*')
    .eq('id', reportId)
    .maybeSingle();
  if (newErr) throw newErr;
  if (newRow) return newRow;

  return null;
}

router.patch('/:id/respond', authenticate, authorize('responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({
    member_ids: z.array(z.string().uuid()).min(2).max(7)
      .refine((ids) => new Set(ids).size === ids.length, 'Choose each crew member once.'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }).refine((body) => (body.latitude === undefined) === (body.longitude === undefined), 'Send both responder coordinates or neither.')
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose at least one Driver Responder and one First Aider Responder before accepting.' });
    return;
  }
  try {
    const report = await reportForAction(req.params.id);
    if (!report) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    if (isResolved(report)) { res.status(409).json({ error: 'This report is already resolved.' }); return; }
    const dispatchedAt = report.dispatched_at || report.mdrrmo_dispatched_at;
    const responseStatus = String(report.response_status || report.mdrrmo_response_status || 'pending').toLowerCase();
    if (!['pending', 'responding'].includes(responseStatus) || !dispatchedAt) {
      res.status(409).json({ error: 'A dispatcher must review and assign this report before a responder can accept it.' });
      return;
    }
    const assignment = await findAssignment(report.id, req.user!.userId);
    if (!assignment) { res.status(403).json({ error: 'This report is not assigned to your responder account.' }); return; }
    if (assignment.status !== 'assigned') {
      res.status(409).json({ error: 'Only an assigned report can be accepted.' });
      return;
    }

    if (parsed.data.latitude !== undefined && parsed.data.longitude !== undefined) {
      const incidentLatitude = Number(report.latitude);
      const incidentLongitude = Number(report.longitude);
      if (Number.isFinite(incidentLatitude) && Number.isFinite(incidentLongitude) &&
          incidentLatitude !== 0 && incidentLongitude !== 0) {
        const travelDistanceM = Math.round(distanceMeters(
          incidentLatitude,
          incidentLongitude,
          parsed.data.latitude,
          parsed.data.longitude,
        ) * 10) / 10;
        const { error: distanceError } = await supabaseAdmin
          .from('mdrrmo_reports')
          .update({ travel_distance_m: travelDistanceM })
          .eq('id', report.id);
        if (distanceError) throw distanceError;
      }
    }

    const { error: acceptError } = await supabaseAdmin.rpc('accept_mdrrmo_report_with_crew_v1', {
      p_report_id: report.id,
      p_responder_id: req.user!.userId,
      p_member_ids: parsed.data.member_ids,
    });
    if (acceptError?.code === 'P0002') {
      res.status(409).json({ error: 'This assignment was accepted or changed by another responder. Refresh the report.' });
      return;
    }
    if (acceptError?.code === '42501') {
      res.status(403).json({ error: 'Only the Team Leader assigned to this unit can accept the dispatch.' });
      return;
    }
    if (acceptError?.code === '22023' || acceptError?.code === '23514') {
      res.status(400).json({ error: acceptError.message || 'Choose a valid crew from your assigned unit.' });
      return;
    }
    if (acceptError) throw acceptError;

    const data = await reportForAction(report.id);
    if (!data) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    const assignments = await getAssignments([report.id]);
    res.json(await emitReportUpdate(data, assignments));
  } catch (err) {
    console.error('MDRRMO report acceptance error:', err);
    res.status(500).json({ error: 'Could not accept this MDRRMO report.' });
  }
});

const arrivalSchema = z.object({
  method: z.enum(['manual', 'gps']).default('manual'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy_m: z.number().min(0).optional(),
  fix_at: z.string().optional(),
}).refine((data) => (data.latitude === undefined) === (data.longitude === undefined), 'Send both coordinates or neither.');

router.patch('/:id/field-assessment', authenticate, authorize('responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({
    situation: z.string().trim().min(1).max(1500),
    affected_people: z.string().trim().min(1).max(1000),
    actions_taken: z.string().trim().min(1).max(1000),
    risks_resources: z.string().trim().min(1).max(1000),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Complete all four field assessment sections before saving. Enter “Not applicable” when a section does not apply.', details: parsed.error.flatten() });
    return;
  }
  try {
    const report = await reportForAction(req.params.id);
    if (!report) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    if (isResolved(report)) { res.status(409).json({ error: 'This report is already resolved.' }); return; }
    const assignment = await findAssignment(report.id, req.user!.userId);
    if (!assignment || assignment.status !== 'responding') { res.status(403).json({ error: 'Field assessment is available only during your active response.' }); return; }

    const now = new Date().toISOString();
    const previousResponseNotes = String(report.response_notes || report.mdrrmo_response_notes || '').trim();
    const taggedAssessmentStart = previousResponseNotes.toUpperCase().indexOf('[MDRRMO FIELD ASSESSMENT]');
    const legacyAssessmentStart = previousResponseNotes.toUpperCase().indexOf('FIELD ASSESSMENT');
    const assessmentStart = taggedAssessmentStart >= 0 ? taggedAssessmentStart : legacyAssessmentStart;
    const coordinationNotes = assessmentStart >= 0
      ? previousResponseNotes.slice(0, assessmentStart).trim()
      : previousResponseNotes;
    const responseNotes = [
      coordinationNotes,
      '[MDRRMO FIELD ASSESSMENT]',
      `Situation: ${parsed.data.situation}`,
      parsed.data.affected_people ? `People affected / urgency: ${parsed.data.affected_people}` : '',
      parsed.data.actions_taken ? `Actions taken: ${parsed.data.actions_taken}` : '',
      parsed.data.risks_resources ? `Risks / resources: ${parsed.data.risks_resources}` : '',
    ].filter(Boolean).join('\n\n');

    // Write to new mdrrmo_reports table
    if (report._source === 'mdrrmo_reports' || !report._source) {
      const { data: updatedRow, error: updateError } = await supabaseAdmin
        .from('mdrrmo_reports')
        .update({
          response_notes: responseNotes,
          responded_at: report.responded_at || now,
          responded_by: report.responded_by || req.user!.userId,
          lifecycle_actor_id: req.user!.userId,
          lifecycle_actor_role: 'responder',
        })
        .eq('id', report.id)
        .eq('response_status', 'responding')
        .select('id')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updatedRow) {
        res.status(409).json({ error: 'The response changed. Refresh the report before saving your assessment.' });
        return;
      }
    }

    // (Legacy incident_reports field assessment dual-write removed)

    const data = await reportForAction(report.id);
    if (!data) { res.status(409).json({ error: 'The response changed. Refresh the report before saving your assessment.' }); return; }
    const assignments = await getAssignments([report.id]);
    res.json(await emitReportUpdate(data, assignments));
  } catch (err) {
    console.error('MDRRMO field assessment error:', err);
    res.status(500).json({ error: 'Could not save the MDRRMO field assessment.' });
  }
});

router.patch('/:id/arrive', authenticate, authorize('responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = arrivalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid arrival details.', details: parsed.error.flatten() }); return; }
  try {
    const report = await reportForAction(req.params.id);
    if (!report) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    const responseStatus = String(report.response_status || report.mdrrmo_response_status || '').toLowerCase();
    if (responseStatus !== 'responding') { res.status(409).json({ error: 'Accept the report before recording arrival.' }); return; }
    const assignment = await findAssignment(report.id, req.user!.userId);
    if (!assignment || assignment.status !== 'responding') { res.status(403).json({ error: 'This report is not assigned to your responder account.' }); return; }
    if (assignment.arrived_at) {
      res.status(409).json({ error: 'Arrival has already been recorded for this response.' });
      return;
    }
    const { method, latitude, longitude, accuracy_m, fix_at } = parsed.data;
    const now = new Date();
    let arrivalAt = now;
    let distance: number | null = null;
    if (method === 'gps') {
      if (latitude === undefined || longitude === undefined || accuracy_m === undefined || !fix_at || report.latitude == null || report.longitude == null) {
        res.status(400).json({ error: 'GPS arrival requires incident and responder coordinates, accuracy, and fix time.' }); return;
      }
      const parsedFix = new Date(fix_at);
      if (Number.isNaN(parsedFix.getTime())) { res.status(400).json({ error: 'GPS fix time is invalid.' }); return; }
      const validation = validateArrivalFix(Number(report.latitude), Number(report.longitude), { latitude, longitude, accuracyM: accuracy_m, fixAt: parsedFix }, now);
      if (!validation.valid) { res.status(422).json({ error: validation.error, distance_m: Math.round(validation.distanceM) }); return; }
      arrivalAt = new Date(Math.min(parsedFix.getTime(), now.getTime()));
      distance = validation.distanceM;
    } else if (latitude !== undefined && longitude !== undefined && accuracy_m !== undefined && fix_at && report.latitude != null && report.longitude != null) {
      const fixAt = new Date(fix_at);
      const validation = validateRecentGpsFix({ latitude, longitude, accuracyM: accuracy_m, fixAt }, now);
      if (validation.valid) distance = distanceMeters(Number(report.latitude), Number(report.longitude), latitude, longitude);
    }
    const roundedDistance = distance === null ? null : Math.round(distance * 10) / 10;

    // Write to new mdrrmo_reports (V2 RPC)
    const { error: arrivalV2Error } = await supabaseAdmin.rpc('record_mdrrmo_arrival_v2', {
      p_report_id: report.id,
      p_responder_id: req.user!.userId,
      p_arrived_at: arrivalAt.toISOString(),
    });
    if (arrivalV2Error?.code === 'P0002') {
      res.status(409).json({ error: 'Arrival was already recorded or the assignment changed. Refresh the report.' });
      return;
    }
    if (arrivalV2Error) throw arrivalV2Error;

    // (Legacy record_mdrrmo_arrival dual-write removed)

    const updatedReport = await reportForAction(report.id);
    if (!updatedReport) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    const assignments = await getAssignments([report.id]);
    res.json(await emitReportUpdate(updatedReport, assignments));
  } catch (err) {
    console.error('MDRRMO report arrival error:', err);
    res.status(500).json({ error: 'Could not record arrival.' });
  }
});

router.post('/:id/field-media', authenticate, authorize('responder', 'dispatcher'), upload.single('media'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const report = await reportForAction(req.params.id);
    if (!report) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    const responseStatus = String(report.response_status || report.mdrrmo_response_status || '').toLowerCase();
    if (responseStatus !== 'responding' || isResolved(report)) {
      res.status(409).json({ error: 'Field media can only be added during an active MDRRMO response.' }); return;
    }
    if (req.user!.role === 'responder') {
      const assignment = await findAssignment(report.id, req.user!.userId);
      if (!assignment || assignment.status !== 'responding') {
        res.status(403).json({ error: 'Field media can only be added during your active response.' }); return;
      }
    }
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'Choose a photo or video to upload.' }); return; }
    const extension = (file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const isVideo = file.mimetype?.startsWith('video/') || ['mp4', 'mov', 'webm', '3gp', 'mkv', 'avi'].includes(extension);
    const timestamp = Date.now();
    const storagePath = `reports/mdrrmo-field-media/${report.id}_${timestamp}.${extension}`;
    const { error: uploadError } = await supabaseAdmin.storage.from(config.supabaseBucketName).upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });
    if (uploadError) throw uploadError;
    const { data: urlData } = supabaseAdmin.storage.from(config.supabaseBucketName).getPublicUrl(storagePath);
    const mediaItem = { id: `mdrrmo_${timestamp}`, url: urlData.publicUrl, type: isVideo ? 'video' : 'image', uploader_id: req.user!.userId, uploader_name: req.user!.email, role: req.user!.role, created_at: new Date().toISOString() };
    // Write to new mdrrmo_reports (V2 RPC)
    const { error: mediaV2Error } = await supabaseAdmin.rpc('append_mdrrmo_field_media_v2', {
      p_report_id: report.id,
      p_responder_id: req.user!.userId,
      p_media_items: JSON.stringify([mediaItem]),
    });
    if (mediaV2Error) {
      await supabaseAdmin.storage.from(config.supabaseBucketName).remove([storagePath]);
      if (mediaV2Error.code === 'P0002') {
        res.status(409).json({ error: 'The report changed before the media could be attached. Refresh and try again.' });
        return;
      }
      throw mediaV2Error;
    }

    // (Legacy append_mdrrmo_field_media dual-write removed)
    const data = await reportForAction(report.id);
    if (!data) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    const assignments = await getAssignments([report.id]);
    res.json(await emitReportUpdate(data, assignments));
  } catch (err) {
    console.error('MDRRMO field media error:', err);
    res.status(500).json({ error: 'Could not upload field media.' });
  }
});

const closeSchema = z.object({ resolved_notes: z.string().trim().min(1).max(2000) });
router.post('/:id/close', authenticate, authorize('responder', 'dispatcher'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Enter a resolution summary before closing the report.' }); return; }
  try {
    const report = await reportForAction(req.params.id);
    if (!report) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    const responseStatus = String(report.response_status || report.mdrrmo_response_status || '').toLowerCase();
    if (responseStatus === 'resolved') { res.status(409).json({ error: 'The MDRRMO response cycle is already resolved.' }); return; }
    if (responseStatus !== 'responding') { res.status(409).json({ error: 'The MDRRMO response must be accepted before it can be resolved.' }); return; }
    let mdrrmoArrivalAt = report.mdrrmo_arrived_at ||
      (!report.barangay_arrived_at ? report.arrived_at : null);
    if (req.user!.role === 'responder') {
      const assignment = await findAssignment(report.id, req.user!.userId);
      if (!assignment || assignment.status !== 'responding') { res.status(403).json({ error: 'This report is not an active response assigned to your responder account.' }); return; }
      if (!assignment.arrived_at) { res.status(409).json({ error: 'Record your arrival before closing the report.' }); return; }
      mdrrmoArrivalAt = assignment.arrived_at;
    } else if (responseStatus !== 'responding' || !mdrrmoArrivalAt) {
      res.status(409).json({ error: 'A responder must accept the report and record arrival before it can be closed.' }); return;
    }
    const missingFields = IncidentResolutionPdfService.missingFields(
      { ...report, mdrrmo_arrived_at: mdrrmoArrivalAt },
      'mdrrmo',
      parsed.data.resolved_notes,
    );
    if (report.barangay_response_status === 'resolved') {
      missingFields.push(...IncidentResolutionPdfService.missingFields(report, 'barangay'));
    }
    if (missingFields.length) {
      res.status(409).json({
        error: `Complete the required report and field assessment details before resolving: ${missingFields.join(', ')}. Enter “Not applicable” where a section does not apply.`,
        missing_fields: missingFields,
      });
      return;
    }
    const actorRole = req.user!.role === 'responder' ? 'responder' : 'dispatcher';
    const now = new Date().toISOString();

    // Write to new mdrrmo_reports (V2 RPC)
    const { error: closeV2Error } = await supabaseAdmin.rpc('close_mdrrmo_report_v2', {
      p_report_id: report.id,
      p_actor_id: req.user!.userId,
      p_actor_role: actorRole,
      p_resolution_notes: parsed.data.resolved_notes,
    });
    if (closeV2Error?.code === 'P0002') {
      res.status(409).json({ error: 'The report was resolved or changed by another user. Refresh its status.' });
      return;
    }
    if (closeV2Error) throw closeV2Error;

    // (Legacy close_mdrrmo_report dual-write removed)
    let pdfStatus: 'ready' | 'failed' = 'failed';
    try {
      await IncidentResolutionPdfService.generateAndStore(report.id);
      pdfStatus = 'ready';
    } catch (pdfError) {
      console.error('Could not create incident resolution PDF after MDRRMO close:', pdfError);
      await supabaseAdmin.from('mdrrmo_reports')
        .update({ resolution_pdf_status: 'failed' })
        .eq('id', report.id);
    }
    const assignments = await getAssignments([report.id]);
    const latest = await reportForAction(report.id);
    if (!latest) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    res.json({ ...(await emitReportUpdate(latest, assignments)), resolution_pdf_status: pdfStatus });
  } catch (err) {
    console.error('MDRRMO report close error:', err);
    res.status(500).json({ error: 'Could not close this MDRRMO report.' });
  }
});

router.get('/:id/resolution-pdf', authenticate, authorize('dispatcher', 'admin', 'responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const report = await reportForAction(req.params.id);
    if (!report) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    if (req.user!.role === 'responder' && !await findAssignment(report.id, req.user!.userId)) {
      res.status(403).json({ error: 'This report is not assigned to your responder account.' }); return;
    }
    const responseStatus = String(report.response_status || report.mdrrmo_response_status || '').toLowerCase();
    if (responseStatus !== 'resolved' && !['resolved', 'closed'].includes(String(report.status || '').toLowerCase())) {
      res.status(409).json({ error: 'The MDRRMO response cycle has not been resolved yet.' }); return;
    }
    const pdf = await IncidentResolutionPdfService.generateAndStore(report.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Norz-Agapay_Incident_${report.id.slice(0, 8)}.pdf"`);
    res.setHeader('Content-Length', pdf.buffer.length);
    res.send(pdf.buffer);
  } catch (error) {
    if (error instanceof IncompleteResolutionReportError) {
      res.status(409).json({ error: error.message, missing_fields: error.missingFields });
      return;
    }
    console.error('MDRRMO incident PDF download error:', error);
    res.status(500).json({ error: 'Could not create or download the incident PDF.' });
  }
});

export default router;
