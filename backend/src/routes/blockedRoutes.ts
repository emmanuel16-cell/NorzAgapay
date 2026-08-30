import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

// ============================================
// GET /api/blocked-routes — list active blocked routes
// ============================================

router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { active } = req.query;

    let query = supabaseAdmin
      .from('blocked_routes')
      .select('*, reporter:users!reported_by(full_name)')
      .order('created_at', { ascending: false });

    if (active !== undefined) {
      query = query.eq('active', active === 'true');
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: 'Failed to fetch blocked routes.' });
      return;
    }

    res.json({ blocked_routes: data });
  } catch (err) {
    console.error('Fetch blocked routes error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/blocked-routes — report blocked route
// ============================================

const createBlockedRouteSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  description: z.string().min(3),
});

router.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = createBlockedRouteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { data: blocked, error } = await supabaseAdmin
      .from('blocked_routes')
      .insert({
        ...parsed.data,
        reported_by: req.user!.userId,
        active: true,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to report blocked route.' });
      return;
    }

    res.status(201).json({ message: 'Blocked route reported.', blocked_route: blocked });
  } catch (err) {
    console.error('Report blocked route error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// PATCH /api/blocked-routes/:id — toggle active status
// ============================================

router.patch(
  '/:id',
  authenticate,
  authorize('admin', 'commander'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { active } = req.body;

      const { data, error } = await supabaseAdmin
        .from('blocked_routes')
        .update({ active: !!active })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) {
        res.status(500).json({ error: 'Failed to update blocked route.' });
        return;
      }

      res.json({ message: 'Blocked route updated.', blocked_route: data });
    } catch (err) {
      console.error('Update blocked route error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

export default router;
