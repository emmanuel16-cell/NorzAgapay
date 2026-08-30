import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

// ============================================
// GET /api/requests — list resource requests (Admin/Commander only)
// ============================================
router.get('/', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from('resource_requests')
      .select('*, requested_by_user:users!requested_by(full_name, role, unit_type)')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: 'Failed to fetch resource requests.' });
      return;
    }

    res.json({ requests: data });
  } catch (err) {
    console.error('Fetch requests error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/requests — create new resource request
// ============================================
const createRequestSchema = z.object({
  request_type: z.enum(['volunteers', 'goods']),
  sub_type: z.string().optional(),
  details: z.string(),
  incident_id: z.string().uuid().nullable().optional(),
});

router.post('/', authenticate, authorize('professional_unit', 'commander', 'admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { data: request, error } = await supabaseAdmin
      .from('resource_requests')
      .insert({
        ...parsed.data,
        requested_by: req.user!.userId,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Create request error:', error);
      res.status(500).json({ error: 'Failed to submit resource request.' });
      return;
    }

    res.status(201).json({ message: 'Resource request submitted successfully.', request });
  } catch (err) {
    console.error('Create request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// PATCH /api/requests/:id/status — update request status
// ============================================
router.patch('/:id/status', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response): Promise<void> => {
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
