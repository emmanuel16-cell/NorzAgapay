import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { emailService } from '../services/emailService';
import { smsService } from '../services/smsService';
import { setOtp, getOtp, deleteOtp } from '../config/redis';
import { randomInt } from 'crypto';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const registerSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  email: z.string().trim().email('Invalid email address').transform((value) => value.toLowerCase()),
  phone: z.string().max(30).optional().nullable(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['responder']),
  unit_type: z.string().nullable().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email('A valid email address is required').transform((value) => value.toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

const masterAdminSetupSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

async function hasMasterAdmin() {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('role', 'master_admin')
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// First-run status is public so the login page can offer account setup.
router.get('/master-admin-setup/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ setupRequired: !(await hasMasterAdmin()) });
  } catch (err) {
    console.error('Master admin setup status error:', err);
    res.status(500).json({ error: 'Unable to check initial setup status.' });
  }
});

// Public only until the first master admin exists. A database unique index
// makes concurrent requests safe: only one account can win the first setup.
router.post('/master-admin-setup', async (req: Request, res: Response): Promise<void> => {
  const parsed = masterAdminSetupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    if (await hasMasterAdmin()) {
      res.status(409).json({ error: 'Master admin setup is already complete.' });
      return;
    }
    const { full_name, email, password } = parsed.data;
    const password_hash = await bcrypt.hash(password, 12);
    const { data, error } = await supabaseAdmin
      .from('users')
      .insert({ full_name, email, password_hash, role: 'master_admin', status: 'active', verified: true })
      .select('id, full_name, email, role, status, verified')
      .single();
    if (error?.code === '23505') {
      res.status(409).json({ error: 'Setup was completed already, or this email is already registered.' });
      return;
    }
    if (error || !data) {
      console.error('Master admin setup create error:', error);
      res.status(500).json({ error: 'Could not create the master admin account.' });
      return;
    }
    res.status(201).json({ user: data });
  } catch (err) {
    console.error('Master admin setup create error:', err);
    res.status(500).json({ error: 'Could not create the master admin account.' });
  }
});

// ============================================
// POST /api/auth/register
// ============================================

router.post('/register', authenticate, authorize('admin', 'master_admin'), async (req: Request, res: Response): Promise<void> => {
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
    const isAutoActive = true;
    const initialStatus = 'active';

    // Preserve responder specializations for incident response matching.
    const rawUnitType = unit_type || '';
    const specs = rawUnitType
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    const primaryUnitType = specs[0] || null;

    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        full_name,
        email,
        phone: phone || null,
        password_hash,
        role,
        unit_type: primaryUnitType,
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

    // Store selected responder specializations for dispatch matching.
    if (specs.length > 0) {
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

    res.status(201).json({
      message: 'Responder account created by administrator.',
      user: returnUser,
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

    // Dashboard / MDRRMO accounts authenticate only against the dashboard users table.
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) {
      console.error('Login lookup error:', error);
      res.status(500).json({ error: 'Unable to look up account.' });
      return;
    }

    if (!user) {
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

    // Load all responder specializations from certifications or the officers directory.
    let unitType = user.unit_type || null;
    if (user.role === 'responder') {
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
        phone: user.phone || null,
        role: user.role,
        unit_type: unitType,
        barangay_name: user.barangay_name || null,
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

// POST /api/auth/resident/login — resident-only email/password authentication
router.post('/resident/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a valid email address and password.' });
      return;
    }

    const { email, password } = parsed.data;
    const { data: user, error } = await supabaseAdmin
      .from('resident_user')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) {
      console.error('Resident login lookup error:', error);
      res.status(500).json({ error: 'Unable to look up resident account.' });
      return;
    }
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    if (user.status === 'inactive' || user.status === 'rejected' || user.status === 'pending_verification') {
      res.status(403).json({ error: 'This resident account is not active.' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: 'resident', unitType: user.unit_type || null },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );
    await supabaseAdmin.from('resident_user').update({ last_seen: new Date().toISOString() }).eq('id', user.id);

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone || null,
        role: 'resident',
        barangay_name: user.barangay_name || null,
        status: user.status,
        verified: user.verified,
      },
      token,
    });
  } catch (err) {
    console.error('Resident login error:', err);
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

    if (user.role === 'responder') {
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

// PATCH /api/auth/resident/profile — update the signed-in resident's profile
router.patch('/resident/profile', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'resident') {
      res.status(403).json({ error: 'This endpoint is only for resident accounts.' });
      return;
    }

    const barangayName = typeof req.body?.barangay_name === 'string'
      ? req.body.barangay_name.trim()
      : '';
    if (!barangayName || barangayName.length > 100) {
      res.status(400).json({ error: 'A valid barangay name is required.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('resident_user')
      .update({ barangay_name: barangayName, updated_at: new Date().toISOString() })
      .eq('id', req.user.userId)
      .select('id, barangay_name')
      .single();

    if (error || !data) {
      console.error('Resident profile update error:', error);
      res.status(500).json({ error: 'Failed to update resident profile.' });
      return;
    }

    res.json({ success: true, barangay_name: data.barangay_name });
  } catch (err) {
    console.error('Resident profile update error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/auth/create-admin — master-admin-only admin account creation
// ============================================

router.post(
  '/create-admin',
  authenticate,
  authorize('master_admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const schema = z.object({
        full_name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(6),
        role: z.enum(['admin']),
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
    description: 'Generates and delivers a 6-digit resident registration OTP by email or SMS.',
    expectedBody: {
      full_name: 'Juan Dela Cruz',
      email: 'user@example.com',
      contact_number: '09123456789',
      barangay_name: 'Poblacion',
      delivery_method: 'email or sms (defaults to email)',
    },
  });
});

// 1. Request OTP for Citizen Account Registration
router.post('/resident/register-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const { full_name, email, contact_number, barangay_name, barangay_id } = req.body;
    const deliveryMethod = String(req.body.delivery_method || 'email').toLowerCase();

    if (deliveryMethod !== 'email' && deliveryMethod !== 'sms') {
      res.status(400).json({ error: 'Choose email or SMS for verification.' });
      return;
    }

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email address is required.' });
      return;
    }

    if (!full_name || full_name.trim().length < 2) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }

    if (deliveryMethod === 'sms' && !/^09\d{9}$/.test(String(contact_number || '').replace(/\D/g, ''))) {
      res.status(400).json({ error: 'Enter a valid 11-digit Philippine mobile number to receive an SMS code.' });
      return;
    }

    if (deliveryMethod === 'sms' && !config.smsApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured yet. Please choose email or contact the administrator.' });
      return;
    }

    const key = String(email).toLowerCase().trim();
    const { data: existingResident, error: residentLookupError } = await supabaseAdmin
      .from('resident_user')
      .select('id')
      .eq('email', key)
      .maybeSingle();
    if (residentLookupError) throw residentLookupError;
    if (existingResident) {
      res.status(409).json({ error: 'This email already has a resident account. Sign in instead.' });
      return;
    }

    // Generate 6-digit OTP
    const otp = randomInt(100000, 1000000).toString();

    // Store in Redis with 10-minute TTL (survives restarts)
    await setOtp(key, {
      otp,
      fullName: full_name.trim(),
      contactNumber: contact_number?.trim() || '',
      barangayName: barangay_name?.trim() || 'Poblacion',
      barangayId: barangay_id || undefined,
      deliveryMethod,
      purpose: 'registration',
    });

    const sent = deliveryMethod === 'sms'
      ? await smsService.sendRegistrationOtp(contact_number, otp)
      : await emailService.sendOtpEmail(key, otp, 'registration');
    if (!sent) {
      await deleteOtp(key);
      res.status(503).json({
        error: deliveryMethod === 'sms'
          ? 'We could not send the verification SMS. Check the mobile number or try email instead.'
          : 'We could not send the verification email. Please try again later.',
      });
      return;
    }

    res.json({
      success: true,
      message: deliveryMethod === 'sms'
        ? `Verification code sent to ${contact_number}.`
        : `Verification code sent to ${key}.`,
      deliveryMethod,
      expiresInMinutes: 10,
    });
  } catch (err: any) {
    console.error('Resident register-otp error:', err);
    res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
});

// Friendly GET handler for browser checks
router.get('/resident/verify-register-otp', (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'online',
    endpoint: '/api/auth/resident/verify-register-otp',
    method: 'POST',
    description: 'Verifies the 6-digit OTP and sends the temporary password through the selected email or SMS channel.',
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
      res.status(400).json({ error: 'Invalid verification code. Check the message you received and enter the correct 6-digit code.' });
      return;
    }

    // Generate readable temporary password: e.g. Norz#7392
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const tempPassword = `Norz#${randomSuffix}`;
    const password_hash = await bcrypt.hash(tempPassword, 10);

    const fullName = record.fullName || 'Resident Citizen';
    const contactNumber = record.contactNumber || null;
    const barangayName = record.barangayName || 'Poblacion';

    // Prevent duplicate resident accounts while allowing the same email in other apps.
    const { data: existingUser } = await supabaseAdmin
      .from('resident_user')
      .select('id, email')
      .eq('email', key)
      .maybeSingle();
    if (existingUser) {
      res.status(409).json({ error: 'This email already has a resident account. Sign in instead.' });
      return;
    }

    const { data: finalUser, error: insertError } = await supabaseAdmin
      .from('resident_user')
      .insert({
        full_name: fullName,
        email: key,
        phone: contactNumber,
        password_hash,
        barangay_name: barangayName,
        status: 'active',
        verified: true,
      })
      .select('*')
      .single();

    if (insertError || !finalUser) {
      if (insertError?.code === '23505') {
        res.status(409).json({ error: 'This email already has a resident account. Sign in instead.' });
        return;
      }
      console.error('Failed to insert resident:', insertError);
      res.status(500).json({ error: 'Failed to create resident account.' });
      return;
    }

    // Clean up OTP from Redis
    await deleteOtp(key);

    // Send the temporary password through the same channel used for the OTP.
    const deliveryMethod = record.deliveryMethod === 'sms' ? 'sms' : 'email';
    let temporaryPasswordSent = false;
    try {
      temporaryPasswordSent = deliveryMethod === 'sms'
        ? await smsService.sendTemporaryPasswordSms(contactNumber || '', tempPassword)
        : await emailService.sendTemporaryPasswordEmail(key, tempPassword, fullName);
    } catch (err: any) {
      console.warn(`[ResidentAuth] Failed to send temporary password by ${deliveryMethod}:`, err.message);
    }

    // Generate JWT token for immediate access
    const token = jwt.sign(
      {
        userId: finalUser.id,
        email: finalUser.email,
        role: 'resident',
        unitType: finalUser.unit_type,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    res.status(201).json({
      success: true,
      message: temporaryPasswordSent
        ? `Account verified. Temporary password sent by ${deliveryMethod}.`
        : `Account verified, but the temporary password could not be sent by ${deliveryMethod}. It is shown in the app.`,
      temporaryPassword: tempPassword,
      temporaryPasswordSent,
      temporaryPasswordDeliveryMethod: deliveryMethod,
      user: {
        id: finalUser.id,
        full_name: finalUser.full_name,
        email: finalUser.email,
        contact_number: finalUser.phone,
        barangay_name: finalUser.barangay_name || barangayName,
        role: 'resident',
      },
      token,
    });
  } catch (err: any) {
    console.error('Resident verify-register-otp error:', err);
    res.status(500).json({ error: 'Internal server error.', details: err.message });
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

    // Prefer the resident account table; keep password recovery working for legacy users.
    let { data: user } = await supabaseAdmin
      .from('resident_user')
      .select('id, full_name, email')
      .eq('email', key)
      .maybeSingle();
    if (!user) {
      const legacyResult = await supabaseAdmin
        .from('users')
        .select('id, full_name, email')
        .eq('email', key)
        .maybeSingle();
      user = legacyResult.data;
    }

    if (!user) {
      res.status(404).json({ error: 'No account found with this email address.' });
      return;
    }

    // Generate 6-digit OTP
    const otp = randomInt(100000, 1000000).toString();

    // Store in Redis with 10-minute TTL
    await setOtp(key, {
      otp,
      fullName: user.full_name,
      purpose: 'password_change',
    });

    const sent = await emailService.sendOtpEmail(key, otp, 'password_change');
    if (!sent) {
      await deleteOtp(key);
      res.status(503).json({ error: 'We could not send the verification email. Please try again later.' });
      return;
    }

    res.json({
      success: true,
      message: `Password change verification code sent to ${email}.`,
      expiresInMinutes: 10,
    });
  } catch (err: any) {
    console.error('Resident password-otp error:', err);
    res.status(500).json({ error: 'Internal server error.', details: err.message });
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
    let accountTable = 'resident_user';
    let { data: user, error: fetchErr } = await supabaseAdmin
      .from('resident_user')
      .select('id, password_hash')
      .eq('email', key)
      .maybeSingle();

    if (!user) {
      accountTable = 'users';
      const legacyResult = await supabaseAdmin
        .from('users')
        .select('id, password_hash')
        .eq('email', key)
        .maybeSingle();
      user = legacyResult.data;
      fetchErr = legacyResult.error;
    }

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
      .from(accountTable)
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
    res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
});

router.post('/barangay/password-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email address is required.' });
      return;
    }
    const { data: user, error } = await supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      res.status(404).json({ error: 'No Barangay account found with this email address.' });
      return;
    }
    const otp = randomInt(100000, 1000000).toString();
    await setOtp(email, { otp, fullName: user.full_name, purpose: 'barangay_password_change' });
    const sent = await emailService.sendOtpEmail(email, otp, 'barangay_password_change');
    if (!sent) {
      await deleteOtp(email);
      res.status(503).json({ error: 'We could not send the verification email. Please try again later.' });
      return;
    }
    res.json({ success: true, message: `Password change verification code sent to ${email}.`, expiresInMinutes: 10 });
  } catch (err: any) {
    console.error('Barangay password-otp error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/barangay/change-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { otp, current_password, new_password } = req.body;
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    if (!email || !otp || !current_password || !new_password) {
      res.status(400).json({ error: 'Email, verification code, current password, and new password are required.' });
      return;
    }
    if (typeof new_password !== 'string' || new_password.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters long.' });
      return;
    }
    const record = await getOtp(email);
    if (!record || record.purpose !== 'barangay_password_change') {
      res.status(400).json({ error: 'No password change request found or code has expired. Please request a new code.' });
      return;
    }
    if (record.otp !== otp.toString().trim()) {
      res.status(400).json({ error: 'Invalid verification code.' });
      return;
    }
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('barangay_users')
      .select('id, password_hash')
      .eq('email', email)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!user) {
      res.status(404).json({ error: 'Barangay account not found.' });
      return;
    }
    if (!await bcrypt.compare(current_password, user.password_hash)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    const password_hash = await bcrypt.hash(new_password, 12);
    const { error: updateError } = await supabaseAdmin
      .from('barangay_users')
      .update({ password_hash, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (updateError) throw updateError;
    await deleteOtp(email);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err: any) {
    console.error('Barangay change-password error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
