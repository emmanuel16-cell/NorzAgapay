import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { io } from '../server';
import { formatIncidentReport } from './incidentReports';

const router = Router();

// ============================================
// GET /api/requests — list eligible responder assistance requests (Dispatcher and master admin)
// ============================================
router.get('/', authenticate, authorize('dispatcher'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const incidentId = typeof req.query.incident_id === 'string' ? req.query.incident_id : null;
    let newQuery = supabaseAdmin
      .from('mdrrmo_reports')
      .select('id, type, title, description, specifics, response_status, reporter_type, reporter_name, reporter_phone, address, barangay_id, barangay_name, created_at, coordination_notes')
      .order('created_at', { ascending: false });
    if (incidentId) newQuery = newQuery.eq('id', incidentId);

    const { data: newRows, error: newError } = await newQuery;
    if (newError) throw newError;

    const eligibleReports = (newRows || []).map((r: any) => ({
      ...formatIncidentReport(r),
      mdrrmo_response_status: r.response_status,
      mdrrmo_coordination_notes: r.coordination_notes,
      barangay_name: r.barangay_name || null,
    }));
    const reportById = new Map(eligibleReports.map((report) => [report.id, report]));
    const reportIds = [...reportById.keys()];

    // 1. Fetch MDRRMO responder assistance requests. Older requests used
    // incidents.id; new responder requests point directly to mdrrmo_reports.id.
    let responderRequests: any[] = [];
    if (incidentId ? true : reportIds.length > 0) {
      const selectRequest = () => supabaseAdmin
        .from('resource_requests')
        .select('*, requested_by_user:users!requested_by(full_name, role, unit_type, phone)')
        .order('created_at', { ascending: false });
      let legacyQuery = selectRequest();
      let reportQuery = selectRequest();

      if (incidentId) {
        legacyQuery = legacyQuery.eq('incident_id', incidentId);
        reportQuery = reportQuery.eq('mdrrmo_report_id', incidentId);
      } else {
        legacyQuery = legacyQuery.in('incident_id', reportIds);
        reportQuery = reportQuery.in('mdrrmo_report_id', reportIds);
      }

      const [legacyResult, reportResult] = await Promise.all([legacyQuery, reportQuery]);
      if (legacyResult.error) throw legacyResult.error;
      if (reportResult.error) throw reportResult.error;

      const requestsById = new Map(
        [...(legacyResult.data || []), ...(reportResult.data || [])].map((request) => [request.id, request]),
      );
      responderRequests = [...requestsById.values()]
        .map((request) => {
          const linkedReportId = request.mdrrmo_report_id || request.incident_id;
          return {
            ...request,
            // Keep the existing dashboard API contract while storing the
            // canonical MDRRMO foreign key separately in the database.
            incident_id: linkedReportId,
            incident_report: reportById.get(linkedReportId) || null,
            source: 'mdrrmo',
          };
        });
    }

    // 2. Fetch escalated Barangay assistance requests (beyond barangay capability or coordinated with MDRRMO)
    let bgQuery = supabaseAdmin
      .from('barangay_assistance_requests')
      .select('*, requested_by_user:barangay_users!requested_by(full_name, role), barangays(name)')
      .or('beyond_barangay_capability.eq.true,decision.eq.coordinate_mdrrmo')
      .order('created_at', { ascending: false });

    if (incidentId) {
      bgQuery = bgQuery.eq('incident_report_id', incidentId);
    }

    const { data: bgData, error: bgError } = await bgQuery;
    if (bgError) {
      console.warn('Could not fetch barangay assistance requests:', bgError);
    }

    const mappedBgRequests = (bgData || []).map((bgReq: any) => {
      const linkedReport = bgReq.incident_report_id ? reportById.get(bgReq.incident_report_id) : null;
      const synthReport = linkedReport || {
        id: bgReq.incident_report_id || bgReq.id,
        type: 'emergency',
        title: bgReq.incident_title || 'Emergency Incident',
        description: bgReq.explanation,
        status: 'escalated',
        barangay_name: (bgReq.barangays as { name?: string } | null)?.name || null,
        is_escalated: true,
        mdrrmo_coordination_notes: bgReq.dispatcher_notes || bgReq.explanation,
        created_at: bgReq.created_at,
      };

      const statusMap: Record<string, string> = {
        actioned: bgReq.decision === 'coordinate_mdrrmo' ? 'approved' : 'fulfilled',
        pending: 'pending',
        rejected: 'rejected',
        fulfilled: 'fulfilled',
        approved: 'approved',
      };

      return {
        id: bgReq.id,
        request_type: bgReq.needs_resources || bgReq.needs_equipment ? 'goods' : 'responders',
        sub_type: bgReq.needs_equipment ? 'equipment' : bgReq.needs_more_manpower ? 'manpower' : bgReq.needs_resources ? 'supplies' : 'escalation',
        details: [bgReq.explanation, bgReq.dispatcher_notes ? `Notes: ${bgReq.dispatcher_notes}` : null].filter(Boolean).join(' · '),
        status: statusMap[bgReq.status] || 'pending',
        incident_id: bgReq.incident_report_id || bgReq.id,
        created_at: bgReq.created_at,
        requested_by: bgReq.requested_by,
        requested_by_user: {
          full_name: (bgReq.requested_by_user as { full_name?: string } | null)?.full_name || 'Barangay Responder',
          role: 'responder',
          unit_type: 'Barangay',
          phone: null,
        },
        incident_report: synthReport,
        source: 'barangay',
      };
    });

    // 3. Ensure direct MDRRMO reports and escalated reports without explicit sub-requests are included
    const existingIncidentIds = new Set([
      ...responderRequests.map((r) => r.incident_id).filter(Boolean),
      ...mappedBgRequests.map((r) => r.incident_id).filter(Boolean),
    ]);

    const synthesizedRequests: any[] = [];
    for (const report of eligibleReports) {
      if (existingIncidentIds.has(report.id)) continue;
      const isEscalated = Boolean(report.is_escalated);
      const mdrrmoRespStatus = String(report.mdrrmo_response_status || '').toLowerCase();
      const reqStatus = ['resolved', 'closed'].includes(mdrrmoRespStatus)
        ? 'fulfilled'
        : mdrrmoRespStatus === 'responding'
          ? 'approved'
          : 'pending';

      if (isEscalated) {
        synthesizedRequests.push({
          id: `escalation-${report.id}`,
          request_type: 'responders',
          sub_type: 'escalation',
          details: report.mdrrmo_coordination_notes || report.description || 'Barangay escalated incident to MDRRMO for emergency assistance.',
          status: reqStatus,
          incident_id: report.id,
          created_at: report.created_at,
          requested_by: report.reporter_name || 'Barangay Dispatcher',
          requested_by_user: {
            full_name: `${report.barangay_name || 'Barangay'} Dispatcher`,
            role: 'responder',
            unit_type: 'Barangay Dispatcher',
            phone: report.reporter_phone || null,
          },
          incident_report: report,
          source: 'barangay',
        });
      } else {
        synthesizedRequests.push({
          id: `resident-request-${report.id}`,
          request_type: report.type === 'emergency' ? 'responders' : 'goods',
          sub_type: report.incident_type || report.specifics || 'emergency',
          details: report.description || report.specifics || report.title || 'Direct MDRRMO report submitted by resident.',
          status: reqStatus,
          incident_id: report.id,
          created_at: report.created_at,
          requested_by: report.reporter_name || 'Resident',
          requested_by_user: {
            full_name: report.reporter_name || 'Resident',
            role: 'responder',
            unit_type: 'Resident',
            phone: report.reporter_phone || null,
          },
          incident_report: report,
          source: 'resident',
        });
      }
    }

    const allRequests = [...responderRequests, ...mappedBgRequests, ...synthesizedRequests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    res.json({ requests: allRequests });
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
      const { data: newReport } = await supabaseAdmin
        .from('mdrrmo_reports')
        .select('response_status')
        .eq('id', parsed.data.incident_id)
        .maybeSingle();

      const report = newReport
        ? { status: newReport.response_status, mdrrmo_response_status: newReport.response_status }
        : null;
      if (!report || report.mdrrmo_response_status === 'resolved' || ['resolved', 'closed'].includes(report.status)) {
        res.status(409).json({ error: 'Assistance cannot be requested for a resolved incident.' });
        return;
      }
    }

    const isMdrrmoResponderRequest = req.user!.role === 'responder';
    const { data: request, error } = await supabaseAdmin
      .from('resource_requests')
      .insert({
        ...parsed.data,
        incident_id: isMdrrmoResponderRequest ? null : parsed.data.incident_id ?? null,
        mdrrmo_report_id: isMdrrmoResponderRequest ? parsed.data.incident_id : null,
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

    const responseRequest = {
      ...request,
      incident_id: request.mdrrmo_report_id || request.incident_id,
    };
    io.to('role:dispatcher').to('role:master_admin').emit('resource:request', responseRequest);
    res.status(201).json({ message: 'Resource request submitted successfully.', request: responseRequest });
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

    // Attempt update on resource_requests
    const { data: request } = await supabaseAdmin
      .from('resource_requests')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (request) {
      const responseRequest = {
        ...request,
        incident_id: request.mdrrmo_report_id || request.incident_id,
      };
      io.to('role:dispatcher').to('role:master_admin').emit('resource:request', responseRequest);
      res.json({ message: `Request ${status}.`, request: responseRequest });
      return;
    }

    // If not found in resource_requests, check barangay_assistance_requests
    const bgStatus = status === 'approved' ? 'actioned' : status === 'fulfilled' ? 'fulfilled' : status;
    const { data: bgRequest, error: bgError } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .update({ status: bgStatus })
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (bgError) throw bgError;
    if (bgRequest) {
      io.to('role:dispatcher').to('role:master_admin').emit('resource:request', bgRequest);
      res.json({ message: `Request ${status}.`, request: bgRequest });
      return;
    }

    // Check if updating synthesized request tied to an incident report
    const targetIncidentId = req.params.id.startsWith('escalation-')
      ? req.params.id.replace('escalation-', '')
      : req.params.id.startsWith('resident-request-')
        ? req.params.id.replace('resident-request-', '')
        : req.params.id;

    const mdrrmoStatus = status === 'approved' ? 'responding' : status === 'fulfilled' ? 'resolved' : 'pending';

    // Update mdrrmo_reports
    const { data: updatedReport } = await supabaseAdmin
      .from('mdrrmo_reports')
      .update({ response_status: mdrrmoStatus })
      .eq('id', targetIncidentId)
      .select('*')
      .maybeSingle();

    if (updatedReport) {
      io.to('dashboard_staff').emit('incident_report:updated', updatedReport);
      io.to('role:dispatcher').to('role:master_admin').emit('resource:request', { id: req.params.id, status });
      res.json({ message: `Request ${status}.`, request: { id: req.params.id, status } });
      return;
    }

    res.status(404).json({ error: 'Assistance request not found.' });
  } catch (err) {
    console.error('Update request status error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
