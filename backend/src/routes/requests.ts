import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { io } from '../server';
import { isVisibleToMdrrmo } from '../services/mdrrmoReportVisibility';

const router = Router();

// ============================================
// GET /api/requests — list eligible responder assistance requests (Dispatcher and master admin)
// ============================================
router.get('/', authenticate, authorize('dispatcher'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const incidentId = typeof req.query.incident_id === 'string' ? req.query.incident_id : null;
    let reportQuery = supabaseAdmin
      .from('incident_reports')
      .select('id, type, title, description, specifics, status, send_to, reporter_type, reporter_name, reporter_phone, address, barangay_id, barangays(name), created_at, barangay_response_status, barangay_response_notes, mdrrmo_response_status, mdrrmo_coordination_notes, review_outcome')
      .order('created_at', { ascending: false });
    if (incidentId) reportQuery = reportQuery.eq('id', incidentId);

    const { data: reportRows, error: reportError } = await reportQuery;
    if (reportError) throw reportError;
    const eligibleReports = (reportRows || []).filter((report) =>
      !report.review_outcome && isVisibleToMdrrmo(report));
    const reportById = new Map(eligibleReports.map((report) => [report.id, {
      ...report,
      barangay_name: (report.barangays as { name?: string } | null)?.name || null,
    }]));
    const reportIds = [...reportById.keys()];
    if (reportIds.length === 0) {
      res.json({ requests: [] });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('resource_requests')
      .select('*, requested_by_user:users!requested_by(full_name, role, unit_type, phone)')
      .in('incident_id', reportIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const requests = (data || [])
      .filter((request) => request.requested_by_user?.role === 'responder')
      .map((request) => ({
        ...request,
        incident_report: reportById.get(request.incident_id) || null,
      }));
    res.json({ requests });
  } catch (err) {
    console.error('Fetch requests error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/requests — create new resource request
// ============================================
const createRequestSchema = z.object({
  request_type: z.enum(['responders', 'goods']),
  sub_type: z.string().trim().max(120).optional(),
  details: z.string().trim().min(1).max(2000),
  incident_id: z.string().uuid().nullable().optional(),
});

router.post('/', authenticate, authorize('responder', 'logistics'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    if (req.user!.role === 'responder') {
      if (!parsed.data.incident_id) {
        res.status(400).json({ error: 'Responder assistance requests must be attached to an assigned incident.' });
        return;
      }
      const { data: assignment, error: assignmentError } = await supabaseAdmin
        .from('mdrrmo_report_assignments')
        .select('status')
        .eq('report_id', parsed.data.incident_id)
        .eq('responder_id', req.user!.userId)
        .neq('status', 'removed')
        .maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!assignment || !['assigned', 'responding'].includes(assignment.status)) {
        res.status(403).json({ error: 'You can request assistance only for an incident assigned to you.' });
        return;
      }
      const { data: report, error: reportError } = await supabaseAdmin
        .from('incident_reports')
        .select('status, mdrrmo_response_status')
        .eq('id', parsed.data.incident_id)
        .maybeSingle();
      if (reportError) throw reportError;
      if (!report || report.mdrrmo_response_status === 'resolved' || ['resolved', 'closed'].includes(report.status)) {
        res.status(409).json({ error: 'Assistance cannot be requested for a resolved incident.' });
        return;
      }
    }

    const { data: request, error } = await supabaseAdmin
      .from('resource_requests')
      .insert({
        ...parsed.data,
        requested_by: req.user!.userId,
        status: 'pending',
      })
      .select('*, requested_by_user:users!requested_by(full_name, role)')
      .single();

    if (error) {
      console.error('Create request error:', error);
      res.status(500).json({ error: 'Failed to submit resource request.' });
      return;
    }

    io.to('role:dispatcher').to('role:master_admin').emit('resource:request', request);
    res.status(201).json({ message: 'Resource request submitted successfully.', request });
  } catch (err) {
    console.error('Create request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// PATCH /api/requests/:id/status — update request status
// ============================================
router.patch('/:id/status', authenticate, authorize('dispatcher'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected', 'fulfilled'].includes(status)) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }

    const { data: request, error } = await supabaseAdmin
      .from('resource_requests')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to update request status.' });
      return;
    }

    res.json({ message: `Request ${status}.`, request });
  } catch (err) {
    console.error('Update request status error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
