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

function isResolved(report: any): boolean {
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
    .select('report_id, responder_id, status, assigned_at, accepted_at, arrived_at, resolved_at')
    .in('report_id', reportIds)
    .neq('status', 'removed');
  if (error) throw error;
  const rows = data || [];
  const responderIds = [...new Set(rows.map((row: any) => row.responder_id))];
  const names = new Map<string, any>();
  if (responderIds.length) {
    const { data: responders, error: responderError } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, unit_type, status')
      .in('id', responderIds);
    if (responderError) throw responderError;
    for (const responder of responders || []) names.set(responder.id, responder);
  }
  return rows.map((row: any) => ({ ...row, responder: names.get(row.responder_id) || null }));
}

async function emitReportUpdate(report: any, assignments: any[]) {
  const payload = formatReport(report);
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

    if (req.user!.role === 'responder') {
      reports = reports.filter((report: any) => allAssignments.some((assignment: any) =>
        assignment.report_id === report.id && assignment.responder_id === req.user!.userId && assignment.status !== 'removed'));
    }

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status === 'pending') reports = reports.filter((report: any) => !isResolved(report) && String(report.response_status || report.mdrrmo_response_status || '').toLowerCase() !== 'responding');
    else if (status === 'responding') reports = reports.filter((report: any) => !isResolved(report) && ['responding'].includes(String(report.response_status || report.mdrrmo_response_status || '').toLowerCase()));
    else if (status === 'resolved') reports = reports.filter((report: any) => isResolved(report));

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
      const resident = residentsById.get(report.reporter_id);
      return formatReport({
        ...report,
        reporter_name: report.reporter_name || resident?.full_name || null,
        reporter_phone: report.reporter_phone || resident?.phone || null,
        reporter_email: report.reporter_email || resident?.email || null,
        mdrrmo_assignments: assignments,
        assigned_responder_ids: assignments.map((assignment: any) => assignment.responder_id),
        mdrrmo_responder_name: assignments.map((assignment: any) => assignment.responder?.full_name).filter(Boolean).join(', ') || report.responder_name || report.mdrrmo_responder_name || null,
      });
    }));
  } catch (err) {
    console.error('Fetch MDRRMO report queue error:', err);
    res.status(500).json({ error: 'Could not load the MDRRMO report queue.' });
  }
});

router.get('/responders', authenticate, authorize('dispatcher', 'admin'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, unit_type, status, latitude, longitude, last_seen')
      .eq('role', 'responder')
      .eq('status', 'active')
      .order('full_name', { ascending: true });
    if (error) throw error;
    res.json({ responders: data || [] });
  } catch (err) {
    console.error('Fetch active MDRRMO responders error:', err);
    res.status(500).json({ error: 'Could not load active MDRRMO responders.' });
  }
});

const dispatchSchema = z.object({
  incident_type: z.enum(['flash_flood', 'fire', 'earthquake', 'medical_emergency', 'typhoon', 'other']),
  severity: z.enum(['low', 'moderate', 'high', 'critical']),
  responder_ids: z.array(z.string().uuid()).min(1).max(50),
  notes: z.string().trim().max(1000).optional().default(''),
});

router.patch('/:id/dispatch', authenticate, authorize('dispatcher', 'admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = dispatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose incident type, severity, and at least one active responder.', details: parsed.error.flatten() });
    return;
  }
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
    if (report.accepted_at || report.arrived_at || report.resolved_at ||
        report.mdrrmo_accepted_at || report.mdrrmo_arrived_at || report.mdrrmo_resolved_at) {
      res.status(409).json({ error: 'Dispatch can only be changed before a responder accepts the report.' });
      return;
    }
    const currentAssignments = await getAssignments([report.id]);
    if (currentAssignments.some((assignment: any) => assignment.status === 'responding')) {
      res.status(409).json({ error: 'Dispatch cannot be changed after a responder accepts the report.' });
      return;
    }

    const responderIds = [...new Set(parsed.data.responder_ids)];
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
    const now = new Date().toISOString();

    // --- Write to new mdrrmo_reports table (V2 RPC) ---
    const { error: dispatchV2Error } = await supabaseAdmin.rpc('dispatch_mdrrmo_report_v2', {
      p_report_id: report.id,
      p_actor_id: req.user!.userId,
      p_incident_type: parsed.data.incident_type,
      p_severity: parsed.data.severity,
      p_notes: parsed.data.notes || '',
      p_responder_ids: responderIds,
      p_responder_names: responderNames,
    });
    if (dispatchV2Error && dispatchV2Error.code !== 'P0002') throw dispatchV2Error;

    // (Legacy incident_reports dual-write removed)

    // --- Also update mdrrmo_report_assignments on the legacy table (for responder push) ---
    await supabaseAdmin
      .from('mdrrmo_report_assignments')
      .update({ status: 'removed', removed_by: req.user!.userId, removed_at: now })
      .eq('report_id', report.id)
      .eq('status', 'assigned');
    for (const responderId of responderIds) {
      await supabaseAdmin
        .from('mdrrmo_report_assignments')
        .upsert({
          report_id: report.id,
          responder_id: responderId,
          assigned_by: req.user!.userId,
          status: 'assigned',
          assigned_at: now,
          accepted_at: null, arrived_at: null, resolved_at: null,
          accepted_by: null, arrived_by: null, resolved_by: null,
          resolved_by_role: null, removed_by: null, removed_at: null,
        }, { onConflict: 'report_id,responder_id' });
    }

    const updatedReport = await reportForAction(report.id);
    const updatedAssignments = await getAssignments([report.id]);
    const activeAssignments = updatedAssignments.filter((a: any) => a.status !== 'removed');

    const payload = formatReport({
      ...(updatedReport || report),
      mdrrmo_assignments: activeAssignments,
      assigned_responder_ids: responderIds,
      mdrrmo_responder_name: activeAssignments.map((a: any) => a.responder?.full_name).filter(Boolean).join(', ') || responderNames,
    });
    io.to('dashboard_staff').emit('incident_report:updated', payload);
    io.to('dashboard_staff').emit('mdrrmo:report_updated', payload);
    for (const responderId of responderIds) {
      io.to(`user:${responderId}`).emit('mdrrmo:report_assigned', payload);
      io.to(`user:${responderId}`).emit('mdrrmo:report_updated', payload);
    }
    if (report.reporter_id) io.to(`user:${report.reporter_id}`).emit('incident_report:updated', payload);
    res.json(payload);
  } catch (err) {
    console.error('MDRRMO report dispatch error:', err);
    res.status(500).json({ error: 'Failed to dispatch this report to MDRRMO responders.' });
  }
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
    const { data: responder, error: responderError } = await supabaseAdmin
      .from('users').select('full_name').eq('id', req.user!.userId).maybeSingle();
    if (responderError) throw responderError;

    // Write to new mdrrmo_reports (V2 RPC)
    const { error: acceptV2Error } = await supabaseAdmin.rpc('accept_mdrrmo_report_v2', {
      p_report_id: report.id,
      p_responder_id: req.user!.userId,
    });
    if (acceptV2Error && acceptV2Error.code !== 'P0002') throw acceptV2Error;

    // (Legacy accept_mdrrmo_report dual-write removed)

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
    const responseStatusNow = String(report.response_status || report.mdrrmo_response_status || '').toLowerCase();
    if (report._source === 'mdrrmo_reports' || !report._source) {
      await supabaseAdmin
        .from('mdrrmo_reports')
        .update({
          response_notes: responseNotes,
          responded_at: report.responded_at || now,
          responded_by: report.responded_by || req.user!.userId,
          lifecycle_actor_id: req.user!.userId,
          lifecycle_actor_role: 'responder',
        })
        .eq('id', report.id)
        .eq('response_status', 'responding');
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
    if (arrivalV2Error && arrivalV2Error.code !== 'P0002') throw arrivalV2Error;

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
    if (mediaV2Error && mediaV2Error.code !== 'P0002') {
      await supabaseAdmin.storage.from(config.supabaseBucketName).remove([storagePath]);
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
    } else if (report.mdrrmo_response_status !== 'responding' || !mdrrmoArrivalAt) {
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
    if (closeV2Error && closeV2Error.code !== 'P0002') throw closeV2Error;

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
    res.setHeader('Content-Disposition', `attachment; filename="NorzAgapay_Incident_${report.id.slice(0, 8)}.pdf"`);
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
