import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

// GET /api/reports/overview — dashboard stats
router.get('/overview', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [
      { count: totalUsers },
      { count: activeVolunteers },
      { count: openIncidents },
      { count: totalTasks },
      { count: completedTasks },
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'active').in('role', ['volunteer_specialist', 'volunteer_general']),
      supabaseAdmin.from('incidents').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
      supabaseAdmin.from('tasks').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
    ]);

    const { count: shipmentsInTransit } = await supabaseAdmin
      .from('relief_shipments').select('*', { count: 'exact', head: true }).eq('status', 'in_transit');

    res.json({
      stats: {
        totalUsers: totalUsers || 0,
        activeVolunteers: activeVolunteers || 0,
        openIncidents: openIncidents || 0,
        totalTasks: totalTasks || 0,
        completedTasks: completedTasks || 0,
        shipmentsInTransit: shipmentsInTransit || 0,
      }
    });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/reports/incidents — incident analytics
router.get('/incidents', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: incidents } = await supabaseAdmin
      .from('incidents')
      .select('id, title, type, severity, status, created_at, resolved_at')
      .order('created_at', { ascending: false })
      .limit(100);

    res.json({ incidents: incidents || [] });
  } catch (err) {
    console.error('Incident reports error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/reports/volunteers — volunteer deployment history
router.get('/volunteers', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: volunteers } = await supabaseAdmin
      .from('users')
      .select('id, full_name, role, status, verified, created_at')
      .in('role', ['volunteer_specialist', 'volunteer_general'])
      .order('created_at', { ascending: false });

    const volunteersWithStats = await Promise.all(
      (volunteers || []).map(async (vol) => {
        const { count: totalTasks } = await supabaseAdmin.from('tasks').select('*', { count: 'exact', head: true }).eq('assigned_to', vol.id);
        const { count: completedTasks } = await supabaseAdmin.from('tasks').select('*', { count: 'exact', head: true }).eq('assigned_to', vol.id).eq('status', 'completed');
        return { ...vol, totalTasks: totalTasks || 0, completedTasks: completedTasks || 0 };
      })
    );

    res.json({ volunteers: volunteersWithStats });
  } catch (err) {
    console.error('Volunteer reports error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
