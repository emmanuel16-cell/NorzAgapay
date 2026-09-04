import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const registerSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().max(30).optional().nullable(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['volunteer_specialist', 'volunteer_general', 'professional_unit']),
  unit_type: z.string().nullable().optional(),
}).refine(data => {
  if (data.role === 'professional_unit' && !data.unit_type) {
    return false;
  }
  return true;
}, {
  message: 'unit_type is required for professional unit registration.',
  path: ['unit_type'],
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// ============================================
// POST /api/auth/register
// ============================================

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { full_name, email, phone, password, role, unit_type } = parsed.data;

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      res.status(409).json({ error: 'Email already registered.' });
      return;
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Insert user
    const isAutoActive = role === 'volunteer_general';
    const initialStatus = isAutoActive ? 'active' : 'pending_verification';

    // Parse specializations for professional unit
    const rawUnitType = unit_type || '';
    const specs = rawUnitType
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    const primaryUnitType = specs[0] || 'Rescue Officer';

    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        full_name,
        email,
        phone: phone || null,
        password_hash,
        role,
        unit_type: role === 'professional_unit' ? primaryUnitType : null,
        status: initialStatus,
        verified: isAutoActive,
      })
      .select('id, full_name, email, role, unit_type, status, verified')
      .single();

    if (insertError) {
      console.error('Registration error:', insertError);
      res.status(500).json({ error: 'Failed to create user account.' });
      return;
    }

    // If professional unit, store all specializations in certifications table
    if (role === 'professional_unit' && specs.length > 0) {
      const certRows = specs.map((spec: string) => ({
        user_id: newUser.id,
        cert_type: spec,
        cert_number: 'SPECIALIZATION',
        verified: isAutoActive,
      }));
      const { error: certError } = await supabaseAdmin.from('certifications').insert(certRows);
      if (certError) {
        console.error('Failed to store specialization certifications:', certError);
      }
    }

    const responseUnitType = specs.length > 0 ? specs.join(', ') : newUser.unit_type;
    const returnUser = { ...newUser, unit_type: responseUnitType };

    // If account requires verification, return pending response without auth token
    if (newUser.status === 'pending_verification') {
      res.status(201).json({
        message: 'Registration successful! Your MDRRMO officer account has been submitted and is pending verification by an administrator at the Web Dashboard.',
        user: returnUser,
        requiresVerification: true,
      });
      return;
    }

    // Generate JWT for auto-approved accounts
    const token = jwt.sign(
      {
        userId: newUser.id,
        email: newUser.email,
        role: newUser.role,
        unitType: responseUnitType,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    res.status(201).json({
      message: 'Registration successful.',
      user: returnUser,
      token,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/auth/login
// ============================================

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { email, password } = parsed.data;

    // Fetch user by email
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // Check if user is inactive or pending verification
    if (user.status === 'inactive') {
      res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
      return;
    }

    if (user.status === 'pending_verification') {
      res.status(403).json({ error: 'Your account is pending verification. Please wait for an administrator to review your application.' });
      return;
    }

    if (user.status === 'rejected') {
      res.status(403).json({ error: 'Your application has been rejected. Please contact an administrator for more information.' });
      return;
    }

    // If professional unit, fetch all specializations from certifications table
    let unitType = user.unit_type;
    if (user.role === 'professional_unit') {
      const { data: specCerts } = await supabaseAdmin
        .from('certifications')
        .select('cert_type')
        .eq('user_id', user.id)
        .eq('cert_number', 'SPECIALIZATION');

      if (specCerts && specCerts.length > 0) {
        unitType = specCerts.map((c: any) => c.cert_type).join(', ');
      }
    }

    // Generate JWT
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        unitType,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    // Update last_seen
    await supabaseAdmin
      .from('users')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', user.id);

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        unit_type: unitType,
        status: user.status,
        verified: user.verified,
      },
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/auth/upgrade — request specialist status
// ============================================
router.post('/upgrade', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    // Check if already specialist
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (user?.role === 'volunteer_specialist') {
      res.status(400).json({ error: 'You are already a specialist or have a pending request.' });
      return;
    }

    // Update role to specialist but set status to pending_verification
    const { error } = await supabaseAdmin
      .from('users')
      .update({
        role: 'volunteer_specialist',
        status: 'pending_verification',
        verified: false,
      })
      .eq('id', userId);

    if (error) {
      res.status(500).json({ error: 'Failed to request upgrade.' });
      return;
    }

    res.json({ message: 'Upgrade request submitted. Please upload your certifications.' });
  } catch (err) {
    console.error('Upgrade request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// PATCH /api/auth/status — update active/inactive status
// ============================================
router.patch('/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      res.status(400).json({ error: 'Invalid status. Use active or inactive.' });
      return;
    }

    const userId = req.user!.userId;

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update({ status })
      .eq('id', userId)
      .select('id, full_name, status')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to update status.' });
      return;
    }

    res.json({ message: `Status updated to ${status}.`, user });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// GET /api/auth/me — get current user profile
// ============================================

router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, phone, role, unit_type, status, verified, latitude, longitude, last_seen, created_at')
      .eq('id', req.user!.userId)
      .single();

    if (error || !user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (user.role === 'professional_unit') {
      const { data: specCerts } = await supabaseAdmin
        .from('certifications')
        .select('cert_type')
        .eq('user_id', user.id)
        .eq('cert_number', 'SPECIALIZATION');

      if (specCerts && specCerts.length > 0) {
        user.unit_type = specCerts.map((c: any) => c.cert_type).join(', ');
      }
    }

    res.json({ user });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/auth/create-admin — (admin-only) create admin/commander accounts
// ============================================

router.post(
  '/create-admin',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const schema = z.object({
        full_name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(6),
        role: z.enum(['admin', 'commander']),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const { full_name, email, password, role } = parsed.data;
      const password_hash = await bcrypt.hash(password, 12);

      const { data: newUser, error } = await supabaseAdmin
        .from('users')
        .insert({
          full_name,
          email,
          password_hash,
          role,
          status: 'active',
          verified: true,
        })
        .select('id, full_name, email, role, status')
        .single();

      if (error) {
        res.status(500).json({ error: 'Failed to create admin user.' });
        return;
      }

      res.status(201).json({ message: 'Admin account created.', user: newUser });
    } catch (err) {
      console.error('Create admin error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

export default router;
