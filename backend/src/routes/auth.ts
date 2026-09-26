import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { emailService } from '../services/emailService';
import { setOtp, getOtp, deleteOtp } from '../config/redis';

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
  email: z.string().min(1, 'Email or phone number is required'),
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

    const { email: identifier, password } = parsed.data;

    // Fetch user by email or phone
    let query = supabaseAdmin.from('users').select('*');
    if (identifier.includes('@')) {
      query = query.eq('email', identifier.toLowerCase().trim());
    } else {
      query = query.or(`phone.eq.${identifier.trim()},email.eq.${identifier.trim()}`);
    }
    const { data: user, error } = await query.maybeSingle();

    if (error || !user) {
      res.status(401).json({ error: 'Invalid email/phone or password.' });
      return;
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid email/phone or password.' });
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

    // If professional unit, fetch all specializations from certifications table or officers table
    let unitType = user.unit_type;
    if (user.role === 'professional_unit') {
      const { data: specCerts } = await supabaseAdmin
        .from('certifications')
        .select('cert_type')
        .eq('user_id', user.id)
        .eq('cert_number', 'SPECIALIZATION');

      if (specCerts && specCerts.length > 0) {
        unitType = specCerts.map((c: any) => c.cert_type).join(', ');
      } else {
        const { data: off } = await supabaseAdmin
          .from('officers')
          .select('specialization')
          .eq('email', user.email)
          .maybeSingle();
        if (off?.specialization) {
          unitType = off.specialization;
        }
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
      } else {
        const { data: off } = await supabaseAdmin
          .from('officers')
          .select('specialization')
          .eq('email', user.email)
          .maybeSingle();
        if (off?.specialization) {
          user.unit_type = off.specialization;
        }
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

// ============================================
// RESIDENT OTP & REGISTRATION / PASSWORD FLOW
// OTPs stored in Upstash Redis (survive restarts, auto-expire after 10 min)
// ============================================

// Friendly GET handler for browser checks
router.get('/resident/register-otp', (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'online',
    endpoint: '/api/auth/resident/register-otp',
    method: 'POST',
    description: 'Generates and emails a 6-digit verification OTP code to the resident.',
    expectedBody: {
      full_name: 'Juan Dela Cruz',
      email: 'user@example.com',
      contact_number: '09123456789',
      barangay_name: 'Poblacion',
    },
  });
});

// 1. Request OTP for Citizen Account Registration
router.post('/resident/register-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const { full_name, email, contact_number, barangay_name, barangay_id } = req.body;

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email address is required.' });
      return;
    }

    if (!full_name || full_name.trim().length < 2) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const key = email.toLowerCase().trim();

    // Store in Redis with 10-minute TTL (survives restarts)
    await setOtp(key, {
      otp,
      fullName: full_name.trim(),
      contactNumber: contact_number?.trim() || '',
      barangayName: barangay_name?.trim() || 'Poblacion',
      barangayId: barangay_id || undefined,
      purpose: 'registration',
    });

    console.log(`[ResidentAuth] Generated registration OTP for ${key}: ${otp}`);
    const sent = await emailService.sendOtpEmail(key, otp, 'registration');
    if (!sent) {
      console.warn(`[ResidentAuth] Email transport failed, but OTP is stored in Redis for dev/testing: ${otp}`);
    }

    res.json({
      success: true,
      message: `Verification code sent to ${key}.`,
      expiresInMinutes: 10,
    });
  } catch (err: any) {
    console.error('Resident register-otp error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Friendly GET handler for browser checks
router.get('/resident/verify-register-otp', (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'online',
    endpoint: '/api/auth/resident/verify-register-otp',
    method: 'POST',
    description: 'Verifies the 6-digit OTP and generates an account with a temporary password sent to email.',
    expectedBody: {
      email: 'user@example.com',
      otp: '123456',
    },
  });
});

// 2. Verify OTP & Issue Temporary Password
router.post('/resident/verify-register-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      res.status(400).json({ error: 'Email and verification code are required.' });
      return;
    }

    const key = email.toLowerCase().trim();
    const record = await getOtp(key);

    if (!record || record.purpose !== 'registration') {
      res.status(400).json({ error: 'No pending registration found for this email, or code has expired. Please request a new code.' });
      return;
    }

    // Expiry is enforced by Redis TTL — no manual Date.now() check needed
    if (record.otp !== otp.toString().trim()) {
      res.status(400).json({ error: 'Invalid verification code. Please check your email and enter the correct 6-digit code.' });
      return;
    }

    // Generate readable temporary password: e.g. Norz#7392
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const tempPassword = `Norz#${randomSuffix}`;
    const password_hash = await bcrypt.hash(tempPassword, 10);

    const fullName = record.fullName || 'Resident Citizen';
    const contactNumber = record.contactNumber || null;
    const barangayName = record.barangayName || 'Poblacion';

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', key)
      .maybeSingle();

    let userId: string;
    let finalUser: any;

    if (existingUser) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('users')
        .update({
          full_name: fullName,
          phone: contactNumber,
          password_hash,
          unit_type: barangayName,
          status: 'active',
          verified: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingUser.id)
        .select('*')
        .single();

      if (updateError) {
        console.error('Failed to update resident:', updateError);
        res.status(500).json({ error: 'Failed to complete registration.' });
        return;
      }
      userId = updated.id;
      finalUser = updated;
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          full_name: fullName,
          email: key,
          phone: contactNumber,
          password_hash,
          role: 'volunteer_general',
          unit_type: barangayName,
          status: 'active',
          verified: true,
        })
        .select('*')
        .single();

      if (insertError) {
        console.error('Failed to insert resident:', insertError);
        res.status(500).json({ error: 'Failed to create resident account.' });
        return;
      }
      userId = inserted.id;
      finalUser = inserted;
    }

    // Clean up OTP from Redis
    await deleteOtp(key);

    // Send temporary password email
    await emailService.sendTemporaryPasswordEmail(key, tempPassword, fullName);

    // Generate JWT token for immediate access
    const token = jwt.sign(
      {
        userId: finalUser.id,
        email: finalUser.email,
        role: finalUser.role,
        unitType: finalUser.unit_type,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    res.status(201).json({
      success: true,
      message: 'Account verified! NorzAgapay sent a temporary password to your email.',
      temporaryPasswordSent: true,
      user: {
        id: finalUser.id,
        full_name: finalUser.full_name,
        email: finalUser.email,
        contact_number: finalUser.phone,
        barangay_name: finalUser.unit_type || barangayName,
        role: finalUser.role,
      },
      token,
    });
  } catch (err: any) {
    console.error('Resident verify-register-otp error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Friendly GET handler for browser checks
router.get('/resident/password-otp', (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'online',
    endpoint: '/api/auth/resident/password-otp',
    method: 'POST',
    description: 'Generates and emails a 6-digit verification code to reset or change password.',
    expectedBody: {
      email: 'user@example.com',
    },
  });
});

// 3. Request OTP for Password Change
router.post('/resident/password-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email address is required.' });
      return;
    }

    const key = email.toLowerCase().trim();

    // Check if user exists
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email')
      .eq('email', key)
      .maybeSingle();

    if (!user) {
      res.status(404).json({ error: 'No account found with this email address.' });
      return;
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in Redis with 10-minute TTL
    await setOtp(key, {
      otp,
      fullName: user.full_name,
      purpose: 'password_change',
    });

    console.log(`[ResidentAuth] Generated password-change OTP for ${key}: ${otp}`);
    await emailService.sendOtpEmail(key, otp, 'password_change');

    res.json({
      success: true,
      message: `Password change verification code sent to ${email}.`,
      expiresInMinutes: 10,
    });
  } catch (err: any) {
    console.error('Resident password-otp error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Friendly GET handler for browser checks
router.get('/resident/change-password', (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'online',
    endpoint: '/api/auth/resident/change-password',
    method: 'POST',
    description: 'Verifies the OTP and updates the resident password in the database.',
    expectedBody: {
      email: 'user@example.com',
      otp: '123456',
      new_password: 'newSecretPassword123',
    },
  });
});

// 4. Update Password with OTP
router.post('/resident/change-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, new_password, current_password } = req.body;

    if (!email || !otp || !new_password) {
      res.status(400).json({ error: 'Email, verification code, and new password are required.' });
      return;
    }

    if (new_password.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters long.' });
      return;
    }

    const key = email.toLowerCase().trim();
    const record = await getOtp(key);

    if (!record || record.purpose !== 'password_change') {
      res.status(400).json({ error: 'No password change request found or code has expired. Please request a new code.' });
      return;
    }

    // Expiry enforced by Redis TTL — no manual Date.now() check needed
    if (record.otp !== otp.toString().trim()) {
      res.status(400).json({ error: 'Invalid verification code.' });
      return;
    }

    // Verify current password if provided
    const { data: user, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('id, password_hash')
      .eq('email', key)
      .maybeSingle();

    if (fetchErr || !user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (current_password) {
      const match = await bcrypt.compare(current_password, user.password_hash);
      if (!match) {
        res.status(400).json({ error: 'Current / temporary password is incorrect.' });
        return;
      }
    }

    // Hash new password and update
    const password_hash = await bcrypt.hash(new_password, 12);
    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ password_hash, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (updateErr) {
      res.status(500).json({ error: 'Failed to update password.' });
      return;
    }

    // Clean up OTP from Redis
    await deleteOtp(key);

    res.json({
      success: true,
      message: 'Password updated successfully! You can now use your new password.',
    });
  } catch (err: any) {
    console.error('Resident change-password error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
