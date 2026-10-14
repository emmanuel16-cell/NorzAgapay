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
import { randomBytes, randomInt } from 'crypto';

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

const passwordResetOtpSchema = z.object({
  email: z.string().trim().email('A valid account email address is required.').transform((value) => value.toLowerCase()),
  delivery_method: z.enum(['email', 'sms']).default('email'),
});

const passwordResetSchema = z.object({
  email: z.string().trim().email('A valid account email address is required.').transform((value) => value.toLowerCase()),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit verification code.'),
  new_password: z.string().min(6, 'New password must be at least 6 characters long.').max(128),
});

function maskEmailAddress(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return 'your registered email';
  return `${localPart.slice(0, 1)}***@${domain}`;
}

function maskMobileNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : 'your registered mobile';
}

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
          .ilike('email', user.email)
          .limit(1)
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
    const identifier = typeof req.body?.identifier === 'string'
      ? req.body.identifier.trim()
      : typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!identifier || identifier.length > 254 || !password) {
      res.status(400).json({ error: 'Enter your username, mobile number, or email and password.' });
      return;
    }

    const digits = identifier.replace(/\D/g, '');
    const phone = /^09\d{9}$/.test(digits) ? digits : /^639\d{9}$/.test(digits) ? `0${digits.slice(2)}` : null;
    let lookup = supabaseAdmin.from('resident_user').select('*');
    if (identifier.includes('@')) lookup = lookup.eq('email', identifier.toLowerCase());
    else if (phone) lookup = lookup.eq('phone', phone);
    else lookup = lookup.eq('username', identifier.toLowerCase());
    const { data: user, error } = await lookup.maybeSingle();
    if (error) {
      console.error('Resident login lookup error:', error);
      res.status(500).json({ error: 'Unable to look up resident account.' });
      return;
    }
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid username, mobile number, or password.' });
      return;
    }
    if (user.status === 'inactive' || user.status === 'rejected' || user.status === 'pending_verification') {
      res.status(403).json({ error: 'This resident account is not active.' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email || '', role: 'resident', unitType: user.unit_type || null },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );
    await supabaseAdmin.from('resident_user').update({ last_seen: new Date().toISOString() }).eq('id', user.id);

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        full_name: user.full_name,
        username: user.username || null,
        email: user.email || null,
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
    if (req.user!.role === 'resident') {
      const { data: resident, error: residentError } = await supabaseAdmin
        .from('resident_user')
        .select('id, full_name, username, email, phone, barangay_name, status, verified, last_seen, created_at')
        .eq('id', req.user!.userId)
        .maybeSingle();
      if (residentError) throw residentError;
      if (!resident) {
        res.status(404).json({ error: 'Resident account not found.' });
        return;
      }
      res.json({ user: { ...resident, role: 'resident' } });
      return;
    }

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
          .ilike('email', user.email)
          .limit(1)
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

    const updates: Record<string, string> = { updated_at: new Date().toISOString() };
    if (req.body?.full_name !== undefined) {
      const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
      if (fullName.length < 2 || fullName.length > 100) {
        res.status(400).json({ error: 'Enter a name between 2 and 100 characters.' });
        return;
      }
      updates.full_name = fullName;
    }
    if (req.body?.phone !== undefined) {
      const phone = typeof req.body.phone === 'string' ? req.body.phone.replace(/\D/g, '') : '';
      if (!/^09\d{9}$/.test(phone)) {
        res.status(400).json({ error: 'Enter a valid 11-digit Philippine mobile number starting with 09.' });
        return;
      }
      const { data: existingPhone, error: phoneLookupError } = await supabaseAdmin
        .from('resident_user').select('id').eq('phone', phone).neq('id', req.user.userId).limit(1).maybeSingle();
      if (phoneLookupError) throw phoneLookupError;
      if (existingPhone) {
        res.status(409).json({ error: 'That mobile number is already linked to another resident account.' });
        return;
      }
      updates.phone = phone;
    }
    if (req.body?.barangay_name !== undefined) {
      const barangayName = typeof req.body.barangay_name === 'string' ? req.body.barangay_name.trim() : '';
      if (!barangayName || barangayName.length > 100) {
        res.status(400).json({ error: 'A valid barangay name is required.' });
        return;
      }
      updates.barangay_name = barangayName;
    }
    if (Object.keys(updates).length === 1) {
      res.status(400).json({ error: 'Provide a name, mobile number, or barangay to update.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('resident_user')
      .update(updates)
      .eq('id', req.user.userId)
      .select('id, full_name, username, email, phone, barangay_name')
      .single();

    if (error || !data) {
      console.error('Resident profile update error:', error);
      res.status(500).json({ error: 'Failed to update resident profile.' });
      return;
    }

    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Resident profile update error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

const residentPushTokenSchema = z.object({
  fcm_token: z.string().trim().min(20).max(4096),
  platform: z.literal('android').optional().default('android'),
});

// Register the signed-in resident's Android device for report-status pushes.
router.put('/resident/push-token', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'resident') {
    res.status(403).json({ error: 'This endpoint is only for resident accounts.' });
    return;
  }
  const parsed = residentPushTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid Android push token is required.' });
    return;
  }
  try {
    const { error } = await supabaseAdmin
      .from('resident_push_tokens')
      .upsert({
        fcm_token: parsed.data.fcm_token,
        resident_id: req.user.userId,
        platform: parsed.data.platform,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'fcm_token' });
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Resident push token registration error:', err);
    res.status(500).json({ error: 'Could not register this device for notifications.' });
  }
});

// Remove this device association when a resident signs out.
router.delete('/resident/push-token', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'resident') {
    res.status(403).json({ error: 'This endpoint is only for resident accounts.' });
    return;
  }
  const parsed = z.object({ fcm_token: z.string().trim().min(20).max(4096) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid push token is required.' });
    return;
  }
  try {
    const { error } = await supabaseAdmin
      .from('resident_push_tokens')
      .delete()
      .eq('fcm_token', parsed.data.fcm_token)
      .eq('resident_id', req.user.userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Resident push token removal error:', err);
    res.status(500).json({ error: 'Could not unregister this device.' });
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

// Web self-registration is phone-first: keep it separate from the email-based
// registration contract used by the resident mobile app.
router.post('/resident/web-register-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.replace(/\D/g, '') : '';
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      res.status(400).json({ error: 'Username must be 3–32 characters and use only letters, numbers, dots, underscores, or hyphens.' });
      return;
    }
    if (!/^09\d{9}$/.test(phone)) {
      res.status(400).json({ error: 'Enter a valid 11-digit Philippine mobile number starting with 09.' });
      return;
    }
    if (!config.textBeeApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured yet. Please contact the administrator.' });
      return;
    }

    const normalizedUsername = username.toLowerCase();
    const [{ data: existingUsername, error: usernameError }, { data: existingPhone, error: phoneError }] = await Promise.all([
      supabaseAdmin.from('resident_user').select('id').eq('username', normalizedUsername).limit(1).maybeSingle(),
      supabaseAdmin.from('resident_user').select('id').eq('phone', phone).limit(1).maybeSingle(),
    ]);
    if (usernameError) throw usernameError;
    if (phoneError) throw phoneError;
    if (existingUsername) {
      res.status(409).json({ error: 'That username is already taken. Choose another one.' });
      return;
    }
    if (existingPhone) {
      res.status(409).json({ error: 'That mobile number is already linked to a resident account. Sign in instead.' });
      return;
    }

    const otp = randomInt(100000, 1000000).toString();
    const otpKey = `resident-web-registration:${phone}`;
    await setOtp(otpKey, {
      otp,
      username: normalizedUsername,
      fullName: username,
      contactNumber: phone,
      barangayName: 'Poblacion',
      deliveryMethod: 'sms',
      purpose: 'resident_web_registration',
    });

    const sent = await smsService.sendRegistrationOtp(phone, otp);
    if (!sent) {
      await deleteOtp(otpKey);
      res.status(503).json({ error: 'We could not send the verification SMS. Check the mobile number and try again.' });
      return;
    }
    res.json({ success: true, message: `Verification code sent to ${maskMobileNumber(phone)}.`, expiresInMinutes: 10 });
  } catch (err: any) {
    console.error('Resident web registration OTP error:', err);
    res.status(500).json({ error: 'Could not start resident registration.' });
  }
});

router.post('/resident/web-verify-register-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.replace(/\D/g, '') : '';
    const otp = typeof req.body?.otp === 'string' || typeof req.body?.otp === 'number' ? String(req.body.otp).trim() : '';
    if (!/^09\d{9}$/.test(phone) || !/^\d{6}$/.test(otp)) {
      res.status(400).json({ error: 'Enter your mobile number and the 6-digit verification code.' });
      return;
    }

    const otpKey = `resident-web-registration:${phone}`;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== 'resident_web_registration' || !record.username) {
      res.status(400).json({ error: 'No pending registration was found or the code expired. Request a new code.' });
      return;
    }
    if (record.otp !== otp) {
      const failedAttempts = (record.failedAttempts || 0) + 1;
      if (failedAttempts >= 5) await deleteOtp(otpKey);
      else await setOtp(otpKey, { ...record, failedAttempts });
      res.status(400).json({ error: failedAttempts >= 5 ? 'Too many incorrect codes. Request a new verification code.' : 'That verification code is incorrect.' });
      return;
    }

    const [{ data: existingUsername, error: usernameError }, { data: existingPhone, error: phoneError }] = await Promise.all([
      supabaseAdmin.from('resident_user').select('id').eq('username', record.username).limit(1).maybeSingle(),
      supabaseAdmin.from('resident_user').select('id').eq('phone', phone).limit(1).maybeSingle(),
    ]);
    if (usernameError) throw usernameError;
    if (phoneError) throw phoneError;
    if (existingUsername || existingPhone) {
      await deleteOtp(otpKey);
      res.status(409).json({ error: existingUsername ? 'That username was just claimed. Request a new code with another username.' : 'That mobile number already has a resident account.' });
      return;
    }

    const temporaryPassword = randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const { data: resident, error: insertError } = await supabaseAdmin
      .from('resident_user')
      .insert({
        username: record.username,
        full_name: record.fullName || record.username,
        email: null,
        phone,
        password_hash: passwordHash,
        barangay_name: record.barangayName || 'Poblacion',
        status: 'active',
        verified: true,
      })
      .select('id, username, full_name, email, phone, barangay_name, role, status, verified')
      .single();

    if (insertError || !resident) {
      if (insertError?.code === '23505') {
        res.status(409).json({ error: 'That username is already in use. Please start again with another username.' });
        return;
      }
      console.error('Resident web account insert error:', insertError);
      res.status(500).json({ error: 'The resident account could not be created.' });
      return;
    }

    await deleteOtp(otpKey);
    const token = jwt.sign(
      { userId: resident.id, email: '', role: 'resident' },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any },
    );
    res.status(201).json({
      success: true,
      temporaryPassword,
      user: { ...resident, role: 'resident' },
      token,
    });
  } catch (err: any) {
    console.error('Resident web registration verification error:', err);
    res.status(500).json({ error: 'Could not verify the code and create the resident account.' });
  }
});

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

    if (deliveryMethod === 'sms' && !config.textBeeApiKey) {
      res.status(503).json({ error: 'TextBee SMS is not configured yet. Please choose email or contact the administrator.' });
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

// Signed-in web residents must prove their current password before an SMS OTP
// is sent, then prove it again when submitting a new password.
router.post('/resident/web-password-change-otp', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'resident') {
      res.status(403).json({ error: 'This endpoint is only for resident accounts.' });
      return;
    }
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    if (!currentPassword) {
      res.status(400).json({ error: 'Enter your current password before requesting a verification code.' });
      return;
    }

    const { data: resident, error } = await supabaseAdmin
      .from('resident_user').select('id, full_name, phone, password_hash').eq('id', req.user.userId).maybeSingle();
    if (error) throw error;
    if (!resident) {
      res.status(404).json({ error: 'Resident account not found.' });
      return;
    }
    if (!(await bcrypt.compare(currentPassword, resident.password_hash))) {
      res.status(400).json({ error: 'The current password is incorrect.' });
      return;
    }
    if (!resident.phone || !/^09\d{9}$/.test(String(resident.phone).replace(/\D/g, ''))) {
      res.status(400).json({ error: 'Add a valid mobile number to your profile before changing your password.' });
      return;
    }
    if (!config.textBeeApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured yet. Please contact the administrator.' });
      return;
    }

    const phone = String(resident.phone).replace(/\D/g, '');
    const otp = randomInt(100000, 1000000).toString();
    const otpKey = `resident-web-password-change:${resident.id}`;
    await setOtp(otpKey, { otp, fullName: resident.full_name, contactNumber: phone, purpose: 'resident_web_password_change' });
    const sent = await smsService.sendPasswordChangeOtp(phone, otp, 'resident');
    if (!sent) {
      await deleteOtp(otpKey);
      res.status(503).json({ error: 'We could not send the verification SMS. Check your saved mobile number and try again.' });
      return;
    }
    res.json({ success: true, message: `Verification code sent to ${maskMobileNumber(phone)}.`, expiresInMinutes: 10 });
  } catch (err: any) {
    console.error('Resident web password change OTP error:', err);
    res.status(500).json({ error: 'Could not send the password verification code.' });
  }
});

router.post('/resident/web-change-password', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'resident') {
      res.status(403).json({ error: 'This endpoint is only for resident accounts.' });
      return;
    }
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const otp = typeof req.body?.otp === 'string' || typeof req.body?.otp === 'number' ? String(req.body.otp).trim() : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (!currentPassword || !/^\d{6}$/.test(otp) || newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: 'Enter your current password, the 6-digit SMS code, and a new password with at least 8 characters.' });
      return;
    }

    const { data: resident, error } = await supabaseAdmin
      .from('resident_user').select('id, password_hash').eq('id', req.user.userId).maybeSingle();
    if (error) throw error;
    if (!resident) {
      res.status(404).json({ error: 'Resident account not found.' });
      return;
    }
    if (!(await bcrypt.compare(currentPassword, resident.password_hash))) {
      res.status(400).json({ error: 'The current password is incorrect.' });
      return;
    }
    if (await bcrypt.compare(newPassword, resident.password_hash)) {
      res.status(400).json({ error: 'Choose a new password that differs from your current password.' });
      return;
    }

    const otpKey = `resident-web-password-change:${resident.id}`;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== 'resident_web_password_change') {
      res.status(400).json({ error: 'No password change request was found or the code expired. Request a new code.' });
      return;
    }
    if (record.otp !== otp) {
      const failedAttempts = (record.failedAttempts || 0) + 1;
      if (failedAttempts >= 5) await deleteOtp(otpKey);
      else await setOtp(otpKey, { ...record, failedAttempts });
      res.status(400).json({ error: failedAttempts >= 5 ? 'Too many incorrect codes. Request a new verification code.' : 'That verification code is incorrect.' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const { error: updateError } = await supabaseAdmin
      .from('resident_user')
      .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
      .eq('id', resident.id);
    if (updateError) throw updateError;

    await deleteOtp(otpKey);
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err: any) {
    console.error('Resident web password change error:', err);
    res.status(500).json({ error: 'Could not update the resident password.' });
  }
});

// Forgot-password OTP flow, kept separate from the signed-in password-change flow.
router.post('/resident/forgot-password-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = passwordResetOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter a valid email and delivery method.' });
      return;
    }

    const { email, delivery_method: deliveryMethod } = parsed.data;
    if (deliveryMethod === 'sms' && !config.textBeeApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured. Choose email or contact the administrator.' });
      return;
    }

    const { data: user, error: lookupError } = await supabaseAdmin
      .from('resident_user')
      .select('id, full_name, email, phone')
      .eq('email', email)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!user) {
      res.status(404).json({ error: 'No resident account found with this email address.' });
      return;
    }

    const mobile = typeof user.phone === 'string' ? user.phone.trim() : '';
    if (deliveryMethod === 'sms' && !mobile) {
      res.status(400).json({ error: 'No mobile number is linked to this resident account. Choose email instead.' });
      return;
    }

    const otp = randomInt(100000, 1000000).toString();
    const otpKey = `resident-password-reset:${email}`;
    await setOtp(otpKey, {
      otp,
      fullName: user.full_name,
      deliveryMethod,
      purpose: 'resident_password_reset',
    });

    const sent = deliveryMethod === 'sms'
      ? await smsService.sendPasswordResetOtp(mobile, otp, 'resident')
      : await emailService.sendOtpEmail(email, otp, 'resident_password_reset');
    if (!sent) {
      await deleteOtp(otpKey);
      res.status(503).json({
        error: deliveryMethod === 'sms'
          ? 'We could not send the verification SMS. Check the saved mobile number or choose email.'
          : 'We could not send the verification email. Please try again later.',
      });
      return;
    }

    const destination = deliveryMethod === 'sms' ? maskMobileNumber(mobile) : maskEmailAddress(email);
    res.json({
      success: true,
      deliveryMethod,
      message: `Password reset code sent to ${destination}. The code expires in 10 minutes.`,
      expiresInMinutes: 10,
    });
  } catch (err: any) {
    console.error('Resident forgot-password OTP error:', err);
    res.status(500).json({ error: 'Could not start password recovery. Please try again later.' });
  }
});

router.post('/resident/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = passwordResetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter the email, code, and a valid new password.' });
      return;
    }

    const { email, otp, new_password: newPassword } = parsed.data;
    const otpKey = `resident-password-reset:${email}`;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== 'resident_password_reset') {
      res.status(400).json({ error: 'No password reset request was found or the code has expired. Request a new code.' });
      return;
    }
    if (record.otp !== otp) {
      res.status(400).json({ error: 'Invalid verification code.' });
      return;
    }

    const { data: user, error: lookupError } = await supabaseAdmin
      .from('resident_user')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!user) {
      await deleteOtp(otpKey);
      res.status(400).json({ error: 'The account for this reset request is no longer available.' });
      return;
    }

    const password_hash = await bcrypt.hash(newPassword, 12);
    const { error: updateError } = await supabaseAdmin
      .from('resident_user')
      .update({ password_hash, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (updateError) throw updateError;

    await deleteOtp(otpKey);
    res.json({ success: true, message: 'Password reset successfully. Sign in with your new password.' });
  } catch (err: any) {
    console.error('Resident forgot-password completion error:', err);
    res.status(500).json({ error: 'Could not reset the password. Please try again later.' });
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

// Barangay login forgot-password flow. Existing signed-in password changes above
// continue to require the current password as an additional check.
router.post('/barangay/forgot-password-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = passwordResetOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter a valid email and delivery method.' });
      return;
    }

    const { email, delivery_method: deliveryMethod } = parsed.data;
    if (deliveryMethod === 'sms' && !config.textBeeApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured. Choose email or contact the administrator.' });
      return;
    }

    const { data: user, error: lookupError } = await supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email, phone')
      .eq('email', email)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!user) {
      res.status(404).json({ error: 'No Barangay account found with this email address.' });
      return;
    }

    const mobile = typeof user.phone === 'string' ? user.phone.trim() : '';
    if (deliveryMethod === 'sms' && !mobile) {
      res.status(400).json({ error: 'No mobile number is linked to this Barangay account. Choose email instead.' });
      return;
    }

    const otp = randomInt(100000, 1000000).toString();
    const otpKey = `barangay-password-reset:${email}`;
    await setOtp(otpKey, {
      otp,
      fullName: user.full_name,
      deliveryMethod,
      purpose: 'barangay_password_reset',
    });

    const sent = deliveryMethod === 'sms'
      ? await smsService.sendPasswordResetOtp(mobile, otp, 'barangay')
      : await emailService.sendOtpEmail(email, otp, 'barangay_password_reset');
    if (!sent) {
      await deleteOtp(otpKey);
      res.status(503).json({
        error: deliveryMethod === 'sms'
          ? 'We could not send the verification SMS. Check the saved mobile number or choose email.'
          : 'We could not send the verification email. Please try again later.',
      });
      return;
    }

    const destination = deliveryMethod === 'sms' ? maskMobileNumber(mobile) : maskEmailAddress(email);
    res.json({
      success: true,
      deliveryMethod,
      message: `Password reset code sent to ${destination}. The code expires in 10 minutes.`,
      expiresInMinutes: 10,
    });
  } catch (err: any) {
    console.error('Barangay forgot-password OTP error:', err);
    res.status(500).json({ error: 'Could not start password recovery. Please try again later.' });
  }
});

router.post('/barangay/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = passwordResetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter the email, code, and a valid new password.' });
      return;
    }

    const { email, otp, new_password: newPassword } = parsed.data;
    const otpKey = `barangay-password-reset:${email}`;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== 'barangay_password_reset') {
      res.status(400).json({ error: 'No password reset request was found or the code has expired. Request a new code.' });
      return;
    }
    if (record.otp !== otp) {
      res.status(400).json({ error: 'Invalid verification code.' });
      return;
    }

    const { data: user, error: lookupError } = await supabaseAdmin
      .from('barangay_users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!user) {
      await deleteOtp(otpKey);
      res.status(400).json({ error: 'The account for this reset request is no longer available.' });
      return;
    }

    const password_hash = await bcrypt.hash(newPassword, 12);
    const { error: updateError } = await supabaseAdmin
      .from('barangay_users')
      .update({ password_hash })
      .eq('id', user.id);
    if (updateError) throw updateError;

    await deleteOtp(otpKey);
    res.json({ success: true, message: 'Password reset successfully. Sign in with your new password.' });
  } catch (err: any) {
    console.error('Barangay forgot-password completion error:', err);
    res.status(500).json({ error: 'Could not reset the password. Please try again later.' });
  }
});

router.post('/responder/forgot-password-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = passwordResetOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter a valid email and delivery method.' });
      return;
    }

    const { email, delivery_method: deliveryMethod } = parsed.data;
    if (deliveryMethod === 'sms' && !config.textBeeApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured. Choose email or contact the administrator.' });
      return;
    }

    const { data: user, error: lookupError } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, phone, role')
      .eq('email', email)
      .eq('role', 'responder')
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!user) {
      res.status(404).json({ error: 'No MDRRMO responder account found with this email address.' });
      return;
    }

    const mobile = typeof user.phone === 'string' ? user.phone.trim() : '';
    if (deliveryMethod === 'sms' && !mobile) {
      res.status(400).json({ error: 'No mobile number is linked to this responder account. Choose email instead.' });
      return;
    }

    const otp = randomInt(100000, 1000000).toString();
    const otpKey = `responder-password-reset:${email}`;
    await setOtp(otpKey, {
      otp,
      fullName: user.full_name,
      deliveryMethod,
      purpose: 'responder_password_reset',
    });

    const sent = deliveryMethod === 'sms'
      ? await smsService.sendPasswordResetOtp(mobile, otp, 'responder')
      : await emailService.sendOtpEmail(email, otp, 'responder_password_reset');
    if (!sent) {
      await deleteOtp(otpKey);
      res.status(503).json({
        error: deliveryMethod === 'sms'
          ? 'We could not send the verification SMS. Check the saved mobile number or choose email.'
          : 'We could not send the verification email. Please try again later.',
      });
      return;
    }

    const destination = deliveryMethod === 'sms' ? maskMobileNumber(mobile) : maskEmailAddress(email);
    res.json({
      success: true,
      deliveryMethod,
      message: `Password reset code sent to ${destination}. The code expires in 10 minutes.`,
      expiresInMinutes: 10,
    });
  } catch (err: any) {
    console.error('Responder forgot-password OTP error:', err);
    res.status(500).json({ error: 'Could not start password recovery. Please try again later.' });
  }
});

router.post('/responder/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = passwordResetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter the email, code, and a valid new password.' });
      return;
    }

    const { email, otp, new_password: newPassword } = parsed.data;
    const otpKey = `responder-password-reset:${email}`;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== 'responder_password_reset') {
      res.status(400).json({ error: 'No password reset request was found or the code has expired. Request a new code.' });
      return;
    }
    if (record.otp !== otp) {
      res.status(400).json({ error: 'Invalid verification code.' });
      return;
    }

    const { data: user, error: lookupError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .eq('role', 'responder')
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!user) {
      await deleteOtp(otpKey);
      res.status(400).json({ error: 'The responder account for this reset request is no longer available.' });
      return;
    }

    const password_hash = await bcrypt.hash(newPassword, 12);
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ password_hash, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (updateError) throw updateError;

    await deleteOtp(otpKey);
    res.json({ success: true, message: 'Password reset successfully. Sign in with your new password.' });
  } catch (err: any) {
    console.error('Responder forgot-password completion error:', err);
    res.status(500).json({ error: 'Could not reset the password. Please try again later.' });
  }
});

export default router;
