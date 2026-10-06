import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
const responderSpecializations = [
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
  'Damage Assessment Officer',
] as const;

// ============================================
// GET /api/users — list dashboard users or responder profiles
// ============================================

router.get(
  '/',
  authenticate,
  authorize('admin', 'master_admin', 'responder'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      let { role, status, verified } = req.query;

      // Responders may use this directory to find other responder profiles.
      if (user.role === 'responder') {
        role = 'responder';
      }

      let query = supabaseAdmin
        .from('users')
        .select('id, full_name, email, phone, role, unit_type, status, verified, latitude, longitude, last_seen, created_at')
        .order('created_at', { ascending: false });

      if (user.role === 'admin') query = query.in('role', ['logistics', 'dispatcher', 'responder']);
      if (role) query = query.eq('role', role as string);
      if (status) query = query.eq('status', status as string);
      if (verified !== undefined) query = query.eq('verified', verified === 'true');

      const { data, error } = await query;

      if (error) {
        res.status(500).json({ error: 'Failed to fetch users.' });
        return;
      }

      // Enrich responders with multi-specializations from certifications or officers.
      const userList = data || [];
      const proUserIds = userList.filter((u: any) => u.role === 'responder').map((u: any) => u.id);
      if (proUserIds.length > 0) {
        const { data: specCerts } = await supabaseAdmin
          .from('certifications')
          .select('user_id, cert_type')
          .in('user_id', proUserIds)
          .eq('cert_number', 'SPECIALIZATION');

        const specMap = new Map<string, string[]>();
        if (specCerts && specCerts.length > 0) {
          for (const cert of specCerts) {
            if (!specMap.has(cert.user_id)) specMap.set(cert.user_id, []);
            specMap.get(cert.user_id)!.push(cert.cert_type);
          }
        }

        const { data: officersList } = await supabaseAdmin
          .from('officers')
          .select('email, specialization');
        const officerSpecMap = new Map<string, string>();
        for (const off of officersList || []) {
          if (off.email && off.specialization) {
            officerSpecMap.set(off.email, off.specialization);
          }
        }

        for (const u of userList) {
          if (specMap.has(u.id)) {
            u.unit_type = specMap.get(u.id)!.join(', ');
          } else if (u.email && officerSpecMap.has(u.email)) {
            u.unit_type = officerSpecMap.get(u.email);
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

// Create dashboard accounts. Responder accounts are provisioned by administrators;
// contact details and starting specialization are intentionally optional.
router.post('/', authenticate, authorize('admin', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(128),
    phone: z.string().trim().max(30).nullable().optional(),
    unit_type: z.union([
      z.string().trim().max(800),
      z.array(z.enum(responderSpecializations)).max(responderSpecializations.length),
    ]).nullable().optional(),
    role: z.enum(['admin', 'logistics', 'dispatcher', 'responder']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const { role, full_name, email, password, phone } = parsed.data;
  if (req.user!.role !== 'master_admin' && role === 'admin') {
    res.status(403).json({ error: 'Only a master admin can create admin accounts.' });
    return;
  }
  const specializationValues = Array.isArray(parsed.data.unit_type)
    ? parsed.data.unit_type
    : (parsed.data.unit_type || '').split(',').map((value) => value.trim()).filter(Boolean);
  const specializations = [...new Set(specializationValues)];
  if (role === 'responder' && specializations.some((value) => !responderSpecializations.includes(value as typeof responderSpecializations[number]))) {
    res.status(400).json({ error: 'Choose valid responder specializations.' });
    return;
  }
  const unitType = specializations.length ? specializations.join(', ') : null;
  try {
    const password_hash = await bcrypt.hash(password, 12);
    const { data, error } = await supabaseAdmin
      .from('users')
      .insert({
        full_name,
        email,
        phone: phone?.trim() || null,
        password_hash,
        role,
        unit_type: role === 'responder' ? unitType : null,
        status: 'active',
        verified: true,
      })
      .select('id, full_name, email, role, phone, unit_type, status, verified, created_at')
      .single();
    if (error?.code === '23505') {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    if (error || !data) {
      console.error('Create dashboard user error:', error);
      res.status(500).json({ error: 'Failed to create account.' });
      return;
    }
    if (role === 'responder') {
      const { data: existingOfficer, error: officerLookupError } = await supabaseAdmin
        .from('officers')
        .select('id')
        .eq('email', email)
        .limit(1)
        .maybeSingle();
      if (officerLookupError) throw officerLookupError;
      const officerValues = {
        name: full_name,
        email,
        phone: phone?.trim() || null,
        specialization: unitType || '',
        status: 'active',
      };
      const { error: officerError } = existingOfficer
        ? await supabaseAdmin.from('officers').update(officerValues).eq('id', existingOfficer.id)
        : await supabaseAdmin.from('officers').insert(officerValues);
      if (officerError) {
        await supabaseAdmin.from('users').delete().eq('id', data.id);
        throw officerError;
      }
      if (specializations.length) {
        const { error: certificationError } = await supabaseAdmin.from('certifications').insert(
          specializations.map((certType) => ({
            user_id: data.id,
            cert_type: certType,
            cert_number: 'SPECIALIZATION',
            verified: true,
          })),
        );
        if (certificationError) {
          await supabaseAdmin.from('users').delete().eq('id', data.id);
          throw certificationError;
        }
      }
    }
    res.status(201).json({ user: data });
  } catch (err) {
    console.error('Create dashboard user error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// PATCH /api/users/me/profile — responder self-service details
// ============================================

const responderProfileSchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  specializations: z.array(z.enum(responderSpecializations)).max(responderSpecializations.length).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one profile field to update.');

router.patch('/me/profile', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role !== 'responder') {
    res.status(403).json({ error: 'This endpoint is only for MDRRMO responders.' });
    return;
  }
  const parsed = responderProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const updates: Record<string, unknown> = {};
    if (parsed.data.full_name !== undefined) updates.full_name = parsed.data.full_name;
    if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone?.trim() || null;
    if (parsed.data.specializations !== undefined) {
      updates.unit_type = [...new Set(parsed.data.specializations)].join(', ') || null;
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', req.user!.userId)
      .select('id, full_name, email, phone, role, unit_type, status, verified, latitude, longitude')
      .single();
    if (error || !user) throw error || new Error('User not found.');

    if (parsed.data.specializations !== undefined) {
      const { error: deleteError } = await supabaseAdmin
        .from('certifications')
        .delete()
        .eq('user_id', user.id)
        .eq('cert_number', 'SPECIALIZATION');
      if (deleteError) throw deleteError;
      if (parsed.data.specializations.length) {
        const { error: insertError } = await supabaseAdmin.from('certifications').insert(
          [...new Set(parsed.data.specializations)].map((certType) => ({
            user_id: user.id,
            cert_type: certType,
            cert_number: 'SPECIALIZATION',
            verified: true,
          })),
        );
        if (insertError) throw insertError;
      }
      await supabaseAdmin
        .from('officers')
        .update({
          ...(parsed.data.full_name !== undefined ? { name: user.full_name } : {}),
          ...(parsed.data.phone !== undefined ? { phone: user.phone } : {}),
          specialization: user.unit_type || '',
        })
        .eq('email', user.email);
    } else if (parsed.data.full_name !== undefined || parsed.data.phone !== undefined) {
      await supabaseAdmin
        .from('officers')
        .update({
          ...(parsed.data.full_name !== undefined ? { name: user.full_name } : {}),
          ...(parsed.data.phone !== undefined ? { phone: user.phone } : {}),
        })
        .eq('email', user.email);
    }

    res.json({ user });
  } catch (err) {
    console.error('Update responder profile error:', err);
    res.status(500).json({ error: 'Could not update your responder profile.' });
  }
});

router.post('/me/change-password', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role !== 'responder') {
    res.status(403).json({ error: 'This endpoint is only for MDRRMO responders.' });
    return;
  }
  const parsed = z.object({
    current_password: z.string().min(1).max(128),
    new_password: z.string().min(8).max(128),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your current password and a new password with at least 8 characters.' });
    return;
  }
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('password_hash')
      .eq('id', req.user!.userId)
      .single();
    if (error || !user) throw error || new Error('User not found.');
    if (!(await bcrypt.compare(parsed.data.current_password, user.password_hash))) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    const password_hash = await bcrypt.hash(parsed.data.new_password, 12);
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ password_hash })
      .eq('id', req.user!.userId);
    if (updateError) throw updateError;
    res.json({ message: 'Password updated.' });
  } catch (err) {
    console.error('Change responder password error:', err);
    res.status(500).json({ error: 'Could not change your password.' });
  }
});

// ============================================
// GET /api/users/:id — get user detail
// ============================================

router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    // Non-admin can only view their own profile
    if (!['admin', 'master_admin'].includes(user.role) && user.userId !== req.params.id) {
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

    if (user.role === 'admin' && !['logistics', 'dispatcher', 'responder'].includes(data.role)) {
      res.status(403).json({ error: 'Admins may only view logistics, dispatcher, and responder accounts.' });
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

    if (data.role === 'responder') {
      if (specCerts.length > 0) {
        data.unit_type = specCerts.map((c: any) => c.cert_type).join(', ');
      } else {
        const { data: off } = await supabaseAdmin
          .from('officers')
          .select('specialization')
          .eq('email', data.email)
          .maybeSingle();
        if (off?.specialization) {
          data.unit_type = off.specialization;
        }
      }
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
  role: z.enum(['master_admin', 'admin', 'logistics', 'dispatcher', 'responder']).optional(),
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
  authorize('admin', 'master_admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      if (parsed.data.role && req.user!.role !== 'master_admin') {
        res.status(403).json({ error: 'Only a master admin can change account roles.' });
        return;
      }

      const { data: target, error: targetError } = await supabaseAdmin
        .from('users')
        .select('role, status, verified')
        .eq('id', req.params.id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }
      if (req.user!.role !== 'master_admin') {
        if (!['logistics', 'dispatcher', 'responder'].includes(target.role)) {
          res.status(403).json({ error: 'Admins may only manage logistics, dispatcher, and responder accounts.' });
          return;
        }
      }
      const resultingRole = parsed.data.role ?? target.role;
      if (resultingRole === 'responder' && (parsed.data.status === 'pending_verification' || parsed.data.verified === false)) {
        res.status(400).json({ error: 'MDRRMO responder accounts are provisioned by administrators and do not use officer verification.' });
        return;
      }

      const updateData = { ...parsed.data };
      if (resultingRole === 'responder') {
        if (target.status === 'pending_verification' && parsed.data.status === undefined) updateData.status = 'active';
        if (target.verified === false && parsed.data.verified === undefined) updateData.verified = true;
      }
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .update(updateData)
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

export default router;
