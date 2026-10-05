import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { io } from '../server';
import { distanceMeters, validateArrivalFix, validateRecentGpsFix } from '../services/arrivalValidation';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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

function isMdrrmoReport(report: any): boolean {
  const routedTo = report.send_to || report.specifics?.match(/\[SEND_TO:([^\]]+)\]/i)?.[1]?.toLowerCase();
  const escalated = report.status === 'escalated' ||
    Boolean(report.barangay_response_notes?.toLowerCase().includes('escalated'));
  return report.type === 'emergency' || routedTo === 'mdrrmo' || escalated;
}

function isResolved(report: any): boolean {
  return report.mdrrmo_response_status === 'resolved' || report.status === 'resolved' || report.status === 'closed';
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
  return {
    ...report,
    barangay_name: report.barangays?.name || report.barangay_name || null,
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
    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .select('*, barangays(name)')
      .order('created_at', { ascending: false });
    if (error) throw error;

    let reports = (data || []).filter((report: any) => !report.review_outcome && isMdrrmoReport(report));
    const allAssignments = await getAssignments(reports.map((report: any) => report.id));

    if (req.user!.role === 'responder') {
      reports = reports.filter((report: any) => allAssignments.some((assignment: any) =>
        assignment.report_id === report.id && assignment.responder_id === req.user!.userId && assignment.status !== 'removed'));
    }

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status === 'pending') reports = reports.filter((report: any) => !isResolved(report) && report.mdrrmo_response_status !== 'responding');
    else if (status === 'responding') reports = reports.filter((report: any) => !isResolved(report) && report.mdrrmo_response_status === 'responding');
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
        mdrrmo_responder_name: assignments.map((assignment: any) => assignment.responder?.full_name).filter(Boolean).join(', ') || report.mdrrmo_responder_name || null,
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
    const { data: report, error: reportError } = await supabaseAdmin
      .from('incident_reports')
      .select('*, barangays(name)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (reportError) throw reportError;
    if (!report) { res.status(404).json({ error: 'Report not found.' }); return; }
    if (!isMdrrmoReport(report)) { res.status(403).json({ error: 'This report has not been routed to MDRRMO.' }); return; }
    if (report.review_outcome) { res.status(409).json({ error: 'This report has already received an invalid-report decision.' }); return; }
    if (isResolved(report)) { res.status(409).json({ error: 'Resolved reports cannot be dispatched.' }); return; }
    if (report.mdrrmo_response_status === 'responding') { res.status(409).json({ error: 'A responder has already accepted this report.' }); return; }

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

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('incident_reports')
      .update({
        incident_type: parsed.data.incident_type,
        severity: parsed.data.severity,
        status: 'verified',
        mdrrmo_response_status: 'pending',
        mdrrmo_dispatch_notes: parsed.data.notes || null,
        mdrrmo_responded_by: null,
        mdrrmo_responder_name: responders.map((responder: any) => responder.full_name).join(', '),
        mdrrmo_responded_at: now,
        dispatcher_reviewed_at: now,
        dispatched_at: now,
      })
      .eq('id', req.params.id)
      .is('review_outcome', null)
      .select('*, barangays(name)')
      .single();
    if (updateError) throw updateError;

    const { error: removeError } = await supabaseAdmin
      .from('mdrrmo_report_assignments')
      .update({ status: 'removed' })
      .eq('report_id', report.id)
      .in('status', ['assigned', 'responding']);
    if (removeError) throw removeError;

    const { error: assignmentError } = await supabaseAdmin
      .from('mdrrmo_report_assignments')
      .upsert(responderIds.map((responderId) => ({
        report_id: report.id,
        responder_id: responderId,
        assigned_by: req.user!.userId,
        status: 'assigned',
        assigned_at: now,
        accepted_at: null,
        arrived_at: null,
        resolved_at: null,
      })), { onConflict: 'report_id,responder_id' });
    if (assignmentError) throw assignmentError;

    const payload = formatReport({
      ...updated,
      mdrrmo_assignments: responders.map((responder: any) => ({
        report_id: report.id,
        responder_id: responder.id,
        status: 'assigned',
        assigned_at: now,
        responder,
      })),
      assigned_responder_ids: responderIds,
      mdrrmo_responder_name: responders.map((responder: any) => responder.full_name).join(', '),
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
  const { data, error } = await supabaseAdmin
    .from('incident_reports')
    .select('*, barangays(name)')
    .eq('id', reportId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

router.patch('/:id/respond', authenticate, authorize('responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const report = await reportForAction(req.params.id);
    if (!report || !isMdrrmoReport(report)) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    if (isResolved(report)) { res.status(409).json({ error: 'This report is already resolved.' }); return; }
    const assignment = await findAssignment(report.id, req.user!.userId);
    if (!assignment) { res.status(403).json({ error: 'This report is not assigned to your responder account.' }); return; }
    const { data: responder, error: responderError } = await supabaseAdmin
      .from('users').select('full_name').eq('id', req.user!.userId).maybeSingle();
    if (responderError) throw responderError;
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update({ status: 'responding', mdrrmo_response_status: 'responding', mdrrmo_responded_by: report.mdrrmo_responded_by || req.user!.userId, mdrrmo_responder_name: report.mdrrmo_responder_name || responder?.full_name, accepted_at: report.accepted_at || now })
      .eq('id', report.id)
      .select('*, barangays(name)')
      .single();
    if (error) throw error;
    const { error: assignmentError } = await supabaseAdmin
      .from('mdrrmo_report_assignments')
      .update({ status: 'responding', accepted_at: assignment.accepted_at || now })
      .eq('report_id', report.id)
      .eq('responder_id', req.user!.userId);
    if (assignmentError) throw assignmentError;
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

router.patch('/:id/arrive', authenticate, authorize('responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = arrivalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid arrival details.', details: parsed.error.flatten() }); return; }
  try {
    const report = await reportForAction(req.params.id);
    if (!report || !isMdrrmoReport(report)) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    if (report.mdrrmo_response_status !== 'responding') { res.status(409).json({ error: 'Accept the report before recording arrival.' }); return; }
    const assignment = await findAssignment(report.id, req.user!.userId);
    if (!assignment || assignment.status !== 'responding') { res.status(403).json({ error: 'This report is not assigned to your responder account.' }); return; }
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
    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update({ arrived_at: arrivalAt.toISOString(), arrival_recorded_at: now.toISOString(), arrival_method: method, arrival_latitude: latitude ?? null, arrival_longitude: longitude ?? null, arrival_accuracy_m: accuracy_m ?? null, arrival_distance_m: distance === null ? null : Math.round(distance * 10) / 10 })
      .eq('id', report.id)
      .select('*, barangays(name)')
      .single();
    if (error) throw error;
    const { error: assignmentError } = await supabaseAdmin
      .from('mdrrmo_report_assignments')
      .update({ arrived_at: arrivalAt.toISOString() })
      .eq('report_id', report.id)
      .eq('responder_id', req.user!.userId);
    if (assignmentError) throw assignmentError;
    const assignments = await getAssignments([report.id]);
    res.json(await emitReportUpdate(data, assignments));
  } catch (err) {
    console.error('MDRRMO report arrival error:', err);
    res.status(500).json({ error: 'Could not record arrival.' });
  }
});

router.post('/:id/field-media', authenticate, authorize('responder', 'dispatcher'), upload.single('media'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const report = await reportForAction(req.params.id);
    if (!report || !isMdrrmoReport(report)) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    if (req.user!.role === 'responder' && !await findAssignment(report.id, req.user!.userId)) {
      res.status(403).json({ error: 'This report is not assigned to your responder account.' }); return;
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
    const existing = Array.isArray(report.responder_media) ? report.responder_media : [];
    const { data, error } = await supabaseAdmin.from('incident_reports').update({ responder_media: [...existing, mediaItem] }).eq('id', report.id).select('*, barangays(name)').single();
    if (error) throw error;
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
    if (!report || !isMdrrmoReport(report)) { res.status(404).json({ error: 'MDRRMO report not found.' }); return; }
    if (req.user!.role === 'responder') {
      const assignment = await findAssignment(report.id, req.user!.userId);
      if (!assignment) { res.status(403).json({ error: 'This report is not assigned to your responder account.' }); return; }
      if (!assignment.arrived_at) { res.status(409).json({ error: 'Record your arrival before closing the report.' }); return; }
    } else if (report.mdrrmo_response_status !== 'responding' || !report.arrived_at) {
      res.status(409).json({ error: 'A responder must accept the report and record arrival before it can be closed.' }); return;
    }
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update({ status: 'resolved', mdrrmo_response_status: 'resolved', resolved_notes: parsed.data.resolved_notes, resolved_at: now })
      .eq('id', report.id)
      .select('*, barangays(name)')
      .single();
    if (error) throw error;
    const { error: assignmentError } = await supabaseAdmin
      .from('mdrrmo_report_assignments')
      .update({ status: 'resolved', resolved_at: now })
      .eq('report_id', report.id)
      .neq('status', 'removed');
    if (assignmentError) throw assignmentError;
    const assignments = await getAssignments([report.id]);
    res.json(await emitReportUpdate(data, assignments));
  } catch (err) {
    console.error('MDRRMO report close error:', err);
    res.status(500).json({ error: 'Could not close this MDRRMO report.' });
  }
});

export default router;
