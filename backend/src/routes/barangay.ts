import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, AuthRequest } from '../middleware/auth';
import { io } from '../server';

const router = Router();

// ─── Middleware: Barangay Auth ───────────────────────────────────────────────

interface BarangayPayload {
  userId: string;
  barangayId: string;
  role: 'captain' | 'team_leader' | 'volunteer';
}

const authenticateBarangay = async (req: AuthRequest, res: Response, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (!decoded.barangayId) {
      res.status(403).json({ error: 'Not a barangay user token' });
      return;
    }
    (req as any).barangayUser = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (roles: string[]) => (req: any, res: Response, next: any) => {
  if (!roles.includes(req.barangayUser?.role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }
  next();
};

// ─── GET /api/barangay/list ──────────────────────────────────────────────────
// Public: get all barangays (for dropdowns in resident app)

router.get('/list', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('barangays')
      .select('id, name, municipality, latitude, longitude')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Fetch barangays error:', err);
    res.status(500).json({ error: 'Failed to fetch barangays' });
  }
});

// ─── POST /api/barangay/register ────────────────────────────────────────────
// Register a new barangay captain (first user for a barangay = captain)

const registerSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  barangay_id: z.string().uuid(),
});

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = registerSchema.parse(req.body);

    // Check if captain already exists for this barangay
    const { data: existing } = await supabaseAdmin
      .from('barangay_users')
      .select('id')
      .eq('barangay_id', body.barangay_id)
      .eq('role', 'captain')
      .single();

    if (existing) {
      res.status(409).json({ error: 'A captain already exists for this barangay. Contact them to add you as a member.' });
      return;
    }

    const password_hash = await bcrypt.hash(body.password, 12);
    const { data: user, error } = await supabaseAdmin
      .from('barangay_users')
      .insert({
        full_name: body.full_name,
        email: body.email,
        phone: body.phone || null,
        password_hash,
        barangay_id: body.barangay_id,
        role: 'captain',
      })
      .select('id, full_name, email, phone, role, barangay_id')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      throw error;
    }

    const token = jwt.sign(
      { userId: user.id, barangayId: user.barangay_id, role: user.role },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    // Join the socket room for this barangay
    io.to(`barangay:${user.barangay_id}`).emit('team:member_added', { user });

    res.status(201).json({ token, user });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error('Barangay register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/barangay/login ────────────────────────────────────────────────

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const { data: user, error } = await supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email, phone, role, barangay_id, password_hash, is_active')
      .eq('email', email)
      .single();

    if (error || !user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ error: 'Account has been deactivated. Contact your barangay captain.' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Fetch barangay name
    const { data: barangay } = await supabaseAdmin
      .from('barangays')
      .select('name, municipality')
      .eq('id', user.barangay_id)
      .single();

    const token = jwt.sign(
      { userId: user.id, barangayId: user.barangay_id, role: user.role },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        barangay_id: user.barangay_id,
        barangay_name: barangay?.name || '',
        municipality: barangay?.municipality || 'Norzagaray',
      },
    });
  } catch (err) {
    console.error('Barangay login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/barangay/me ────────────────────────────────────────────────────

router.get('/me', authenticateBarangay, async (req: any, res: Response) => {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email, phone, role, barangay_id, is_active, created_at')
      .eq('id', req.barangayUser.userId)
      .single();

    if (error || !user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { data: barangay } = await supabaseAdmin
      .from('barangays')
      .select('name, municipality')
      .eq('id', user.barangay_id)
      .single();

    res.json({ ...user, barangay_name: barangay?.name, municipality: barangay?.municipality });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/barangay/team ──────────────────────────────────────────────────
// List team members for this barangay

router.get('/team', authenticateBarangay, async (req: any, res: Response) => {
  try {
    let query = supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email, phone, role, is_active, created_at, added_by')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('role', { ascending: true });

    // Volunteers can only see their team leader and other volunteers they're linked to
    // Team leaders see their own volunteers; captain sees all
    if (req.barangayUser.role === 'volunteer') {
      query = query.or(`id.eq.${req.barangayUser.userId},added_by.eq.${req.barangayUser.userId}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const responderIds = [...new Set((data || [])
      .map((report: any) => report.barangay_responded_by)
      .filter(Boolean))];
    const responderNames = new Map<string, string>();
    if (responderIds.length > 0) {
      const { data: responders, error: responderError } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name')
        .in('id', responderIds);
      if (responderError) throw responderError;
      for (const responder of responders || []) responderNames.set(responder.id, responder.full_name);
    }

    res.json((data || []).map((report: any) => ({
      ...report,
      barangay_responder_name: responderNames.get(report.barangay_responded_by) || null,
    })));
  } catch (err) {
    console.error('Fetch team error:', err);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

// ─── POST /api/barangay/team ─────────────────────────────────────────────────
// Captain adds team leader; team leader adds volunteer

const addMemberSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  role: z.enum(['team_leader', 'volunteer']),
});

router.post('/team', authenticateBarangay, requireRole(['captain', 'team_leader']), async (req: any, res: Response): Promise<void> => {
  try {
    const body = addMemberSchema.parse(req.body);

    // Captains can add team leaders or volunteers
    // Team leaders can only add volunteers
    if (req.barangayUser.role === 'team_leader' && body.role !== 'volunteer') {
      res.status(403).json({ error: 'Team leaders can only add volunteers' });
      return;
    }

    const password_hash = await bcrypt.hash(body.password, 12);
    const { data: member, error } = await supabaseAdmin
      .from('barangay_users')
      .insert({
        full_name: body.full_name,
        email: body.email,
        phone: body.phone || null,
        password_hash,
        barangay_id: req.barangayUser.barangayId,
        role: body.role,
        added_by: req.barangayUser.userId,
      })
      .select('id, full_name, email, phone, role, barangay_id, is_active, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      throw error;
    }

    io.to(`barangay:${req.barangayUser.barangayId}`).emit('team:member_added', { member });

    res.status(201).json(member);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error('Add team member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/barangay/team/:id ──────────────────────────────────────────

router.delete('/team/:id', authenticateBarangay, requireRole(['captain']), async (req: any, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('barangay_users')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId);

    if (error) throw error;

    res.json({ message: 'Member deactivated' });
  } catch (err) {
    console.error('Remove team member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/barangay/reports ───────────────────────────────────────────────
// Get incident reports assigned to this barangay

router.get('/reports', authenticateBarangay, async (req: any, res: Response) => {
  try {
    const { status } = req.query;
    let query = supabaseAdmin
      .from('incident_reports')
      .select('*')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('barangay_response_status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    const responderIds = [...new Set((data || [])
      .map((report: any) => report.barangay_responded_by)
      .filter(Boolean))];
    const responderNames = new Map<string, string>();
    if (responderIds.length > 0) {
      const { data: responders, error: responderError } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name')
        .in('id', responderIds);
      if (responderError) throw responderError;
      for (const responder of responders || []) {
        responderNames.set(responder.id, responder.full_name);
      }
    }

    res.json((data || []).map((report: any) => ({
      ...report,
      barangay_responder_name: responderNames.get(report.barangay_responded_by) || null,
    })));
  } catch (err) {
    console.error('Fetch barangay reports error:', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// ─── PATCH /api/barangay/reports/:id/respond ────────────────────────────────
// Mark initial response dispatched

router.patch('/reports/:id/respond', authenticateBarangay, requireRole(['captain', 'team_leader']), async (req: any, res: Response) => {
  try {
    const { notes, mdrrmo_notes } = req.body;
    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update({
        barangay_response_status: 'responding',
        barangay_response_notes: notes || null,
        mdrrmo_coordination_notes: mdrrmo_notes || null,
        barangay_responded_by: req.barangayUser.userId,
        barangay_responded_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .single();

    if (error) throw error;

    const { data: responder, error: responderError } = await supabaseAdmin
      .from('barangay_users')
      .select('full_name')
      .eq('id', req.barangayUser.userId)
      .single();
    if (responderError) throw responderError;

    // Notify MDRRMO dashboard
    io.to('commanders').emit('barangay:responding', { reportId: req.params.id, barangayId: req.barangayUser.barangayId, notes });

    res.json({ ...data, barangay_responder_name: responder.full_name });
  } catch (err) {
    console.error('Respond to report error:', err);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// ─── POST /api/barangay/reports/:id/close ───────────────────────────────────
// Close and record the incident

router.post('/reports/:id/close', authenticateBarangay, requireRole(['captain', 'team_leader']), async (req: any, res: Response) => {
  try {
    const { resolved_notes } = req.body;
    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update({
        barangay_response_status: 'resolved',
        resolved_notes: resolved_notes || null,
        resolved_at: new Date().toISOString(),
        status: 'resolved',
      })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .single();

    if (error) throw error;

    io.to('commanders').emit('barangay:incident_closed', { reportId: req.params.id });

    res.json(data);
  } catch (err) {
    console.error('Close report error:', err);
    res.status(500).json({ error: 'Failed to close report' });
  }
});

// ─── POST /api/barangay/assistance-requests ──────────────────────────────────
// Team Leader submits an assistance request to the Captain

const assistanceRequestSchema = z.object({
  incident_report_id: z.string().uuid().nullable().optional(),
  incident_title: z.string().optional(),
  needs_more_manpower: z.boolean().optional(),
  needs_resources: z.boolean().optional(),
  needs_equipment: z.boolean().optional(),
  beyond_barangay_capability: z.boolean().optional(),
  explanation: z.string().min(10),
});

router.post('/assistance-requests', authenticateBarangay, requireRole(['team_leader']), async (req: any, res: Response) => {
  try {
    const parsed = assistanceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .insert({
        barangay_id: req.barangayUser.barangayId,
        requested_by: req.barangayUser.userId,
        incident_report_id: parsed.data.incident_report_id || null,
        incident_title: parsed.data.incident_title || null,
        needs_more_manpower: parsed.data.needs_more_manpower || false,
        needs_resources: parsed.data.needs_resources || false,
        needs_equipment: parsed.data.needs_equipment || false,
        beyond_barangay_capability: parsed.data.beyond_barangay_capability || false,
        explanation: parsed.data.explanation,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Create assistance request error:', error);
      res.status(500).json({ error: 'Failed to submit assistance request.' });
      return;
    }

    // Notify captain via socket
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:new_request', { request: data });

    res.status(201).json({ message: 'Assistance request submitted successfully.', request: data });
  } catch (err) {
    console.error('Create assistance request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /api/barangay/assistance-requests ───────────────────────────────────
// Captain views all assistance requests for their barangay

router.get('/assistance-requests', authenticateBarangay, requireRole(['captain']), async (req: any, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .select('*, requested_by_user:barangay_users!requested_by(full_name, role)')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch assistance requests error:', error);
      res.status(500).json({ error: 'Failed to fetch assistance requests.' });
      return;
    }

    res.json({ requests: data || [] });
  } catch (err) {
    console.error('Fetch assistance requests error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /api/barangay/my-assistance-requests ────────────────────────────────
// Team Leader views their own submitted requests

router.get('/my-assistance-requests', authenticateBarangay, requireRole(['team_leader']), async (req: any, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .select('*')
      .eq('requested_by', req.barangayUser.userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch my assistance requests error:', error);
      res.status(500).json({ error: 'Failed to fetch your assistance requests.' });
      return;
    }

    res.json({ requests: data || [] });
  } catch (err) {
    console.error('Fetch my assistance requests error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── PATCH /api/barangay/assistance-requests/:id/decide ──────────────────────
// Captain decides: provide_barangay_assistance or coordinate_mdrrmo

router.patch('/assistance-requests/:id/decide', authenticateBarangay, requireRole(['captain']), async (req: any, res: Response) => {
  try {
    const { decision, captain_notes } = req.body;
    const validDecisions = ['provide_barangay_assistance', 'coordinate_mdrrmo'];
    if (!validDecisions.includes(decision)) {
      res.status(400).json({ error: 'Invalid decision. Must be: provide_barangay_assistance or coordinate_mdrrmo.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .update({
        status: 'actioned',
        decision,
        captain_notes: captain_notes || null,
        decided_at: new Date().toISOString(),
        decided_by: req.barangayUser.userId,
      })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .single();

    if (error) {
      console.error('Decide assistance request error:', error);
      res.status(500).json({ error: 'Failed to update assistance request.' });
      return;
    }

    // Notify team leader via socket
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:decision', { request: data, decision });

    res.json({ message: `Request actioned: ${decision}.`, request: data });
  } catch (err) {
    console.error('Decide assistance request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── PATCH /api/barangay/assistance-requests/:id/team-action ─────────────────
// Team Leader acknowledges or cancels their own request

router.patch('/assistance-requests/:id/team-action', authenticateBarangay, requireRole(['team_leader']), async (req: any, res: Response) => {
  try {
    const { action } = req.body;
    if (!['acknowledge', 'cancel'].includes(action)) {
      res.status(400).json({ error: 'Invalid action. Must be: acknowledge or cancel.' });
      return;
    }

    const updatePayload: Record<string, any> =
      action === 'cancel'
        ? { status: 'cancelled' }
        : { team_acknowledged: true };

    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .update(updatePayload)
      .eq('id', req.params.id)
      .eq('requested_by', req.barangayUser.userId)
      .select()
      .single();

    if (error || !data) {
      console.error('Team action error:', error);
      res.status(500).json({ error: 'Failed to update assistance request.' });
      return;
    }

    // Notify barangay room
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:team_action', { request: data, action });

    res.json({ message: `Request ${action}d.`, request: data });
  } catch (err) {
    console.error('Team action error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
export { authenticateBarangay };
