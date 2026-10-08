import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

const ANALYTICS_PAGE_SIZE = 1000;

async function fetchAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const rows: T[] = [];

  for (let offset = 0; ; offset += ANALYTICS_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + ANALYTICS_PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < ANALYTICS_PAGE_SIZE) return rows;
  }
}

// GET /api/reports/overview — dashboard stats
router.get('/overview', authenticate, authorize('admin', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [
      { count: totalUsers },
      { count: activeResponders },
      { count: openIncidents },
      { count: totalTasks },
      { count: completedTasks },
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'active').eq('role', 'responder'),
      supabaseAdmin.from('incidents').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
      supabaseAdmin.from('tasks').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
    ]);

    res.json({
      stats: {
        totalUsers: totalUsers || 0,
        activeResponders: activeResponders || 0,
        openIncidents: openIncidents || 0,
        totalTasks: totalTasks || 0,
        completedTasks: completedTasks || 0,
      }
    });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/reports/incidents — incident analytics
router.get('/incidents', authenticate, authorize('admin', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const since = new Date();
    since.setMonth(since.getMonth() - 5, 1);

    const { data: rows, error } = await supabaseAdmin
      .from('mdrrmo_reports')
      .select('id, title, type, incident_type, severity, reporter_type, specifics, description, response_status, coordination_notes, barangay_id, barangay_name, created_at')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw error;

    const incidents = (rows || []).map((r: any) => ({
      ...r,
      status: r.response_status,
      mdrrmo_response_status: r.response_status,
      mdrrmo_coordination_notes: r.coordination_notes,
      barangays: r.barangay_name ? { name: r.barangay_name } : null,
    }));

    res.json({ incidents });
  } catch (err) {
    console.error('Incident reports error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/reports/responders — current MDRRMO responder deployment history
router.get('/responders', authenticate, authorize('admin', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: responders, error: respondersError } = await supabaseAdmin
      .from('users')
      .select('id, full_name, role, status, verified, created_at')
      .eq('role', 'responder')
      .order('created_at', { ascending: false });
    if (respondersError) throw respondersError;

    const responderIds = (responders || []).map((responder) => responder.id);
    if (responderIds.length === 0) {
      res.json({ responders: [] });
      return;
    }

    // The current MDRRMO dispatch flow assigns reports through this table.
    // Removed assignments are dispatcher changes, not responder deployments.
    const assignments = await fetchAllRows<{ responder_id: string; status: string }>(() =>
      supabaseAdmin
        .from('mdrrmo_report_assignments')
        .select('id, responder_id, status')
        .in('responder_id', responderIds)
        .neq('status', 'removed')
        .order('id')
    );

    const deploymentCounts = new Map<string, { total: number; resolved: number }>();
    for (const assignment of assignments) {
      const counts = deploymentCounts.get(assignment.responder_id) || { total: 0, resolved: 0 };
      counts.total += 1;
      if (assignment.status === 'resolved') counts.resolved += 1;
      deploymentCounts.set(assignment.responder_id, counts);
    }

    const respondersWithStats = (responders || []).map((responder) => ({
      ...responder,
      totalDeployments: deploymentCounts.get(responder.id)?.total || 0,
      resolvedDeployments: deploymentCounts.get(responder.id)?.resolved || 0,
    }));

    res.json({ responders: respondersWithStats });
  } catch (err) {
    console.error('Responder reports error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
