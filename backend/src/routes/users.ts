import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { setUserGPS } from '../config/redis';

const router = Router();

// ============================================
// GET /api/users — list all users (admin/commander)
// ============================================

router.get(
  '/',
  authenticate,
  authorize('admin', 'commander', 'professional_unit'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      let { role, status, verified } = req.query;

      // Non-admin/commander can only view professional units
      if (!['admin', 'commander'].includes(user.role)) {
        role = 'professional_unit';
      }

      let query = supabaseAdmin
        .from('users')
        .select('id, full_name, email, phone, role, unit_type, status, verified, latitude, longitude, last_seen, created_at')
        .order('created_at', { ascending: false });

      if (role) query = query.eq('role', role as string);
      if (status) query = query.eq('status', status as string);
      if (verified !== undefined) query = query.eq('verified', verified === 'true');

      const { data, error } = await query;

      if (error) {
        res.status(500).json({ error: 'Failed to fetch users.' });
        return;
      }

      // Enrich professional units with multi-specializations from certifications
      const userList = data || [];
      const proUserIds = userList.filter((u: any) => u.role === 'professional_unit').map((u: any) => u.id);
      if (proUserIds.length > 0) {
        const { data: specCerts } = await supabaseAdmin
          .from('certifications')
          .select('user_id, cert_type')
          .in('user_id', proUserIds)
          .eq('cert_number', 'SPECIALIZATION');

        if (specCerts && specCerts.length > 0) {
          const specMap = new Map<string, string[]>();
          for (const cert of specCerts) {
            if (!specMap.has(cert.user_id)) specMap.set(cert.user_id, []);
            specMap.get(cert.user_id)!.push(cert.cert_type);
          }
          for (const u of userList) {
            if (specMap.has(u.id)) {
              u.unit_type = specMap.get(u.id)!.join(', ');
            }
          }
        }
      }

      res.json({ users: userList });
    } catch (err) {
      console.error('Fetch users error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// GET /api/users/:id — get user detail
// ============================================

router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    // Non-admin can only view their own profile
    if (!['admin', 'commander'].includes(user.role) && user.userId !== req.params.id) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, phone, role, unit_type, status, verified, latitude, longitude, last_seen, created_at')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    // Get certifications
    const { data: certs } = await supabaseAdmin
      .from('certifications')
      .select('*')
      .eq('user_id', req.params.id);

    const allCerts = certs || [];
    const specCerts = allCerts.filter((c: any) => c.cert_number === 'SPECIALIZATION');
    const otherCerts = allCerts.filter((c: any) => c.cert_number !== 'SPECIALIZATION');

    if (data.role === 'professional_unit' && specCerts.length > 0) {
      data.unit_type = specCerts.map((c: any) => c.cert_type).join(', ');
    }

    // Get task history
    const { data: tasks } = await supabaseAdmin
      .from('tasks')
      .select('id, title, task_type, status, completed_at')
      .eq('assigned_to', req.params.id)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({ user: data, certifications: otherCerts, recent_tasks: tasks || [] });
  } catch (err) {
    console.error('Fetch user detail error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// PATCH /api/users/:id — update user (admin)
// ============================================

const updateUserSchema = z.object({
  full_name: z.string().optional(),
  phone: z.string().max(15).optional(),
  role: z.enum(['admin', 'commander', 'volunteer_specialist', 'volunteer_general', 'professional_unit']).optional(),
  unit_type: z.enum([
    'police', 
    'fire', 
    'medical',
    'Rescue Officer',
    'Swift Water Rescue Officer',
    'Mountain Rescue Officer',
    'Emergency Medical Responder (EMR)',
    'Ambulance Officer / EMS Personnel',
    'Fire Response Officer',
    'Evacuation Officer',
    'Safety & Security Officer',
    'Traffic & Road Clearing Officer',
    'Communications Officer',
    'Logistics Response Officer',
    'Damage Assessment Officer'
  ]).nullable().optional(),
  status: z.enum(['active', 'inactive', 'pending_verification', 'occupied', 'rejected']).optional(),
  verified: z.boolean().optional(),
});

router.patch(
  '/:id',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const { data: user, error } = await supabaseAdmin
        .from('users')
        .update(parsed.data)
        .eq('id', req.params.id)
        .select('id, full_name, email, role, status, verified')
        .single();

      if (error) {
        res.status(500).json({ error: 'Failed to update user.' });
        return;
      }

      res.json({ message: 'User updated.', user });
    } catch (err) {
      console.error('Update user error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// POST /api/users/:id/update-location — update GPS location
// ============================================

router.post('/:id/update-location', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    // Users can only update their own location
    if (user.userId !== req.params.id) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const { latitude, longitude } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      res.status(400).json({ error: 'Valid latitude and longitude are required.' });
      return;
    }

    // Update in Supabase
    await supabaseAdmin
      .from('users')
      .update({
        latitude,
        longitude,
        last_seen: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    // Also update in Redis for real-time tracking accuracy
    await setUserGPS(req.params.id, latitude, longitude);

    res.json({ message: 'Location updated.' });
  } catch (err) {
    console.error('Update location error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
