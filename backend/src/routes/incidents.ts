import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { matchRespondersToIncident } from '../services/matchingEngine';

const router = Router();

// ============================================
// GET /api/incidents — list all incidents
// ============================================

router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, type, severity } = req.query;

    let query = supabaseAdmin
      .from('incidents')
      .select('*, reported_by_user:users!reported_by(full_name, role)')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status as string);
    if (type) query = query.eq('type', type as string);
    if (severity) query = query.eq('severity', severity as string);

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: 'Failed to fetch incidents.' });
      return;
    }

    res.json({ incidents: data });
  } catch (err) {
    console.error('Fetch incidents error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// GET /api/incidents/:id — get incident detail
// ============================================

router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { data: incident, error } = await supabaseAdmin
      .from('incidents')
      .select('*, reported_by_user:users!reported_by(full_name, role)')
      .eq('id', id)
      .single();

    if (error || !incident) {
      res.status(404).json({ error: 'Incident not found.' });
      return;
    }

    // Fetch associated tasks
    const { data: tasks } = await supabaseAdmin
      .from('tasks')
      .select('*, assigned_user:users!assigned_to(full_name, role)')
      .eq('incident_id', id)
      .order('created_at', { ascending: false });

    // Fetch associated inventory
    const { data: inventory } = await supabaseAdmin
      .from('inventory')
      .select('*')
      .eq('incident_id', id);

    res.json({ incident, tasks: tasks || [], inventory: inventory || [] });
  } catch (err) {
    console.error('Fetch incident detail error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/incidents — create new incident
// ============================================

const createIncidentSchema = z.object({
  title: z.string().min(3),
  type: z.enum(['flash_flood', 'fire', 'earthquake', 'medical_emergency', 'typhoon', 'other']),
  severity: z.enum(['low', 'moderate', 'high', 'critical']),
  latitude: z.number(),
  longitude: z.number(),
  address: z.string().optional(),
});

router.post(
  '/',
  authenticate,
  authorize('admin', 'commander'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = createIncidentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const { data: incident, error } = await supabaseAdmin
        .from('incidents')
        .insert({
          ...parsed.data,
          reported_by: req.user!.userId,
          status: 'open',
        })
        .select()
        .single();

      if (error) {
        console.error('Create incident error:', error);
        res.status(500).json({ error: 'Failed to create incident.' });
        return;
      }

      // Trigger matching engine asynchronously
      matchRespondersToIncident(incident.id).catch((err) => {
        console.error(`Matching Engine Error for Incident ${incident.id}:`, err);
      });

      res.status(201).json({ message: 'Incident created. Matching engine triggered.', incident });
    } catch (err) {
      console.error('Create incident error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// PATCH /api/incidents/:id — update incident
// ============================================

const updateIncidentSchema = z.object({
  title: z.string().optional(),
  type: z.enum(['flash_flood', 'fire', 'earthquake', 'medical_emergency', 'typhoon', 'other']).optional(),
  severity: z.enum(['low', 'moderate', 'high', 'critical']).optional(),
  status: z.enum(['open', 'in_progress', 'resolved']).optional(),
  address: z.string().optional(),
});

router.patch(
  '/:id',
  authenticate,
  authorize('admin', 'commander'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = updateIncidentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const updateData: Record<string, unknown> = { ...parsed.data };

      // If resolving, set resolved_at timestamp
      if (parsed.data.status === 'resolved') {
        updateData.resolved_at = new Date().toISOString();
      }

      const { data: incident, error } = await supabaseAdmin
        .from('incidents')
        .update(updateData)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) {
        res.status(500).json({ error: 'Failed to update incident.' });
        return;
      }

      res.json({ message: 'Incident updated.', incident });
    } catch (err) {
      console.error('Update incident error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

export default router;
