import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { smsService } from '../services/smsService';
import { setOtp, getOtp, deleteOtp, getOtpResendCooldownSeconds } from '../config/redis';
import type { ResidentOtpRecord } from '../config/redis';
import { randomInt } from 'crypto';
import { isMobileNumberRegistryConflict, normalizeMobileNumber } from '../services/mobileNumberService';
import { countPasswordMatchesForPhone, hasPasswordReuseForPhone, hasPhoneInAccountType, withPhoneAccountLock } from '../services/accountAuthService';
import { decryptPendingPassword, encryptPendingPassword } from '../services/pendingPasswordService';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const mobileNumberSchema = z.string().trim().transform((value, ctx) => {
  const normalized = normalizeMobileNumber(value);
  if (!normalized) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Philippine mobile number.' });
    return z.NEVER;
  }
  return normalized;
});

const registerSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  phone: mobileNumberSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['responder']),
  unit_type: z.string().nullable().optional(),
});

const loginSchema = z.object({
  phone: mobileNumberSchema,
  password: z.string().min(1, 'Password is required'),
});

const masterAdminSetupSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: mobileNumberSchema,
  password: z.string().min(12).max(128),
});

const passwordResetOtpSchema = z.object({
  phone: mobileNumberSchema,
});

const passwordResetSchema = z.object({
  phone: mobileNumberSchema,
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit verification code.'),
  new_password: z.string().min(6, 'New password must be at least 6 characters long.').max(128),
});

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
    const { full_name, phone, password } = parsed.data;
    const { data, error } = await withPhoneAccountLock(phone, async () => {
      if (await hasPhoneInAccountType(phone, 'users')) return { data: null, error: { code: 'ACCOUNT_PHONE_CONFLICT' } as any };
      if (await hasPasswordReuseForPhone(phone, password, 'users')) return { data: null, error: { code: 'PASSWORD_REUSE' } as any };
      const password_hash = await bcrypt.hash(password, 12);
      return supabaseAdmin
        .from('users')
        .insert({ full_name, phone, password_hash, role: 'master_admin', status: 'active', verified: true })
        .select('id, full_name, phone, role, status, verified')
        .single();
    });
    if (error?.code === 'PASSWORD_REUSE') {
      res.status(409).json({ error: 'Choose a password different from the password used by your other account with this mobile number.' });
      return;
    }
    if (error?.code === 'ACCOUNT_PHONE_CONFLICT') {
      res.status(409).json({ error: 'That mobile number already has an MDRRMO account.' });
      return;
    }
    if (isMobileNumberRegistryConflict(error)) {
      res.status(409).json({ error: 'That mobile number is already linked to an account.' });
      return;
    }
    if (error?.code === '23505') {
      res.status(409).json({ error: 'Setup was completed already.' });
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

    const { full_name, phone, password, role, unit_type } = parsed.data;

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

    const { data: newUser, error: insertError } = await withPhoneAccountLock(phone, async () => {
      if (await hasPhoneInAccountType(phone, 'users')) return { data: null, error: { code: '23505' } as any };
      if (await hasPasswordReuseForPhone(phone, password, 'users')) return { data: null, error: { code: 'PASSWORD_REUSE' } as any };
      const password_hash = await bcrypt.hash(password, 12);
      return supabaseAdmin
        .from('users')
        .insert({ full_name, phone, password_hash, role, unit_type: primaryUnitType, status: initialStatus, verified: isAutoActive })
        .select('id, full_name, phone, role, unit_type, status, verified')
        .single();
    });

    if (insertError?.code === 'PASSWORD_REUSE') {
      res.status(409).json({ error: 'Choose a password different from the password used by your other account with this mobile number.' });
      return;
    }

    if (insertError) {
      if (isMobileNumberRegistryConflict(insertError)) {
        res.status(409).json({ error: 'That mobile number is already linked to an account.' });
        return;
      }
      if (insertError.code === '23505') { res.status(409).json({ error: 'That mobile number is already linked to an account.' }); return; }
      console.error('Registration error:', insertError);
      res.status(500).json({ error: 'Failed to create user account.' });
      return;
    }
    if (!newUser) {
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

    const { phone, password } = parsed.data;
    if (await countPasswordMatchesForPhone(phone, password) > 1) {
      res.status(409).json({ code: 'AMBIGUOUS_ACCOUNT_CREDENTIALS', error: 'This password matches more than one account using this mobile number. Reset the password for one account type by SMS, then sign in again.' });
      return;
    }
    const { data: user, error } = await supabaseAdmin.from('users').select('*').eq('phone', phone).maybeSingle();
    if (error) {
      console.error('Login lookup error:', error);
      res.status(500).json({ error: 'Unable to look up account.' });
      return;
    }

    if (!user) {
      res.status(401).json({ error: 'Invalid mobile number or password.' });
      return;
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid mobile number or password.' });
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
      } else if (user.phone) {
        const { data: off } = await supabaseAdmin
          .from('officers')
          .select('specialization')
          .eq('phone', user.phone)
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

// POST /api/auth/resident/login — resident-only mobile/password authentication
router.post('/resident/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const phone = normalizeMobileNumber(req.body?.phone);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!phone || !password) {
      res.status(400).json({ error: 'Enter a valid mobile number and password.' });
      return;
    }

    if (await countPasswordMatchesForPhone(phone, password) > 1) {
      res.status(409).json({ code: 'AMBIGUOUS_ACCOUNT_CREDENTIALS', error: 'This password matches more than one account using this mobile number. Reset the password for one account type by SMS, then sign in again.' });
      return;
    }

    const { data: user, error } = await supabaseAdmin.from('resident_user').select('*').eq('phone', phone).maybeSingle();
    if (error) {
      console.error('Resident login lookup error:', error);
      res.status(500).json({ error: 'Unable to look up resident account.' });
      return;
    }
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid mobile number or password.' });
      return;
    }
    if (user.status === 'inactive' || user.status === 'rejected' || user.status === 'pending_verification') {
      res.status(403).json({ error: 'This resident account is not active.' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, role: 'resident', unitType: user.unit_type || null },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );
    await supabaseAdmin.from('resident_user').update({ last_seen: new Date().toISOString() }).eq('id', user.id);

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        full_name: user.full_name,
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
        .select('id, full_name, phone, barangay_name, status, verified, last_seen, created_at')
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
      .select('id, full_name, phone, role, unit_type, status, verified, latitude, longitude, last_seen, created_at')
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
      } else if (user.phone) {
        const { data: off } = await supabaseAdmin
          .from('officers')
          .select('specialization')
          .eq('phone', user.phone)
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

// PATCH /api/auth/profile — update the signed-in MDRRMO account's own contact profile.
// Account roles remain administrator-managed and are intentionally not accepted here.
router.patch('/profile', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.role === 'resident') {
      res.status(403).json({ error: 'Use the resident profile endpoint for this account.' });
      return;
    }
    if (req.body?.phone !== undefined) {
      res.status(400).json({ error: 'Sign-in mobile number changes require SMS verification.' });
      return;
    }
    const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
    if (fullName.length < 2 || fullName.length > 100) {
      res.status(400).json({ error: 'Enter a name between 2 and 100 characters.' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ full_name: fullName, updated_at: new Date().toISOString() })
      .eq('id', req.user!.userId)
      .select('id, full_name, phone, role')
      .maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'Account not found.' }); return; }
    const token = jwt.sign(
      { userId: data.id, role: data.role, unitType: req.user?.unitType || null },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any },
    );
    res.json({ success: true, ...data, token });
  } catch (err) {
    console.error('Update MDRRMO profile error:', err);
    res.status(500).json({ error: 'Failed to update your profile.' });
  }
});

router.patch('/resident/profile', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'resident') {
      res.status(403).json({ error: 'This endpoint is only for resident accounts.' });
      return;
    }
    if (req.body?.phone !== undefined) {
      res.status(400).json({ error: 'Sign-in mobile number changes require SMS verification.' });
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
    if (req.body?.barangay_name !== undefined) {
      const barangayName = typeof req.body.barangay_name === 'string' ? req.body.barangay_name.trim() : '';
      if (!barangayName || barangayName.length > 100) {
        res.status(400).json({ error: 'A valid barangay name is required.' });
        return;
      }
      updates.barangay_name = barangayName;
    }
    if (Object.keys(updates).length === 1) {
      res.status(400).json({ error: 'Provide at least one profile field or barangay to update.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('resident_user')
      .update(updates)
      .eq('id', req.user.userId)
      .select('id, full_name, phone, barangay_name, role')
      .single();
    if (error || !data) throw error || new Error('Resident account not found.');
    const token = jwt.sign(
      { userId: data.id, role: 'resident', unitType: req.user?.unitType || null },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any },
    );
    res.json({ success: true, ...data, token });
  } catch (err) {
    console.error('Resident profile update error:', err);
    res.status(500).json({ error: 'Failed to update resident profile.' });
  }
});

router.post('/profile/phone-otp', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const phone = normalizeMobileNumber(req.body?.phone);
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    if (!phone || !currentPassword) {
      res.status(400).json({ error: 'Enter a valid new mobile number and your current password.' });
      return;
    }
    const accountTable = req.user?.role === 'resident' ? 'resident_user' : 'users';
    const { data: account, error } = await supabaseAdmin
      .from(accountTable).select('id, phone, password_hash').eq('id', req.user!.userId).maybeSingle();
    if (error) throw error;
    if (!account) { res.status(404).json({ error: 'Account not found.' }); return; }
    if (!(await bcrypt.compare(currentPassword, account.password_hash))) {
      res.status(400).json({ error: 'The current password is incorrect.' });
      return;
    }
    if (normalizeMobileNumber(account.phone) === phone) {
      res.status(400).json({ error: 'That mobile number is already linked to your account.' });
      return;
    }
    if (await hasPasswordReuseForPhone(phone, currentPassword, accountTable, { table: accountTable, id: account.id })) {
      res.status(409).json({ error: 'Your current password is used by another account at that mobile number. Change this account password before changing its number.' });
      return;
    }
    const { data: reservation, error: reservationError } = await supabaseAdmin
      .from('account_mobile_numbers').select('account_table, account_id')
      .eq('account_table', accountTable).eq('phone_normalized', phone).maybeSingle();
    if (reservationError) throw reservationError;
    if (reservation && !(reservation.account_table === accountTable && reservation.account_id === account.id)) {
      res.status(409).json({ error: 'That mobile number is already linked to another account.' });
      return;
    }
    if (!config.textBeeApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured. Contact an administrator.' });
      return;
    }
    const otp = randomInt(100000, 1000000).toString();
    const otpKey = 'account-phone-change:' + accountTable + ':' + account.id;
    const cooldown = await getOtpResendCooldownSeconds(otpKey);
    if (cooldown > 0) { res.status(429).json({ error: 'A code was sent recently. Try again in ' + cooldown + ' seconds.' }); return; }
    await setOtp(otpKey, { otp, phone, purpose: 'account_phone_change' });
    if (!(await smsService.sendRegistrationOtp(phone, otp))) {
      await deleteOtp(otpKey);
      res.status(503).json({ error: 'We could not send the verification SMS. Check the mobile number and try again.' });
      return;
    }
    res.json({ success: true, message: 'Verification code sent to ' + maskMobileNumber(phone) + '.', expiresInMinutes: 10 });
  } catch (err) {
    console.error('Account phone change OTP error:', err);
    res.status(500).json({ error: 'Could not send the mobile number verification code.' });
  }
});

router.post('/profile/change-phone', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const phone = normalizeMobileNumber(req.body?.phone);
    const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    if (!phone || !/^\d{6}$/.test(otp) || !currentPassword) {
      res.status(400).json({ error: 'Enter the new mobile number, 6-digit SMS code, and current password.' });
      return;
    }
    const accountTable = req.user?.role === 'resident' ? 'resident_user' : 'users';
    const { data: account, error } = await supabaseAdmin
      .from(accountTable).select('id, full_name, phone, password_hash, role').eq('id', req.user!.userId).maybeSingle();
    if (error) throw error;
    if (!account) { res.status(404).json({ error: 'Account not found.' }); return; }
    if (!(await bcrypt.compare(currentPassword, account.password_hash))) {
      res.status(400).json({ error: 'The current password is incorrect.' });
      return;
    }
    const otpKey = 'account-phone-change:' + accountTable + ':' + account.id;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== 'account_phone_change' || record.phone !== phone) {
      res.status(400).json({ error: 'No matching mobile number verification was found or the code expired. Request a new code.' });
      return;
    }
    if (record.otp !== otp) {
      const failedAttempts = (record.failedAttempts || 0) + 1;
      if (failedAttempts >= 5) await deleteOtp(otpKey);
      else await setOtp(otpKey, { ...record, failedAttempts });
      res.status(400).json({ error: failedAttempts >= 5 ? 'Too many incorrect codes. Request a new verification code.' : 'That verification code is incorrect.' });
      return;
    }
    const phoneUpdate = await withPhoneAccountLock(phone, async () => {
      if (await hasPhoneInAccountType(phone, accountTable, account.id)) return { kind: 'phone_conflict' as const };
      if (await hasPasswordReuseForPhone(phone, currentPassword, accountTable, { table: accountTable, id: account.id })) {
        return { kind: 'password_reuse' as const };
      }
      const { error } = await supabaseAdmin.from(accountTable)
        .update({ phone, updated_at: new Date().toISOString() }).eq('id', account.id);
      return { kind: 'updated' as const, error };
    });
    if (phoneUpdate.kind === 'phone_conflict') {
      res.status(409).json({ error: 'That mobile number already has an account of this type.' });
      return;
    }
    if (phoneUpdate.kind === 'password_reuse') {
      res.status(409).json({ error: 'Your current password is used by another account at that mobile number. Change this account password before changing its number.' });
      return;
    }
    const updateError = phoneUpdate.error;
    if (isMobileNumberRegistryConflict(updateError)) {
      res.status(409).json({ error: 'That mobile number is already linked to another account.' });
      return;
    }
    if (updateError) throw updateError;
    if (accountTable === 'users' && account.phone) {
      await supabaseAdmin.from('officers').update({ phone }).eq('phone', account.phone);
    }
    await deleteOtp(otpKey);
    res.json({ success: true, phone, message: 'Mobile number updated successfully.' });
  } catch (err) {
    console.error('Account phone change error:', err);
    res.status(500).json({ error: 'Could not update your mobile number.' });
  }
});

router.post('/profile/password-otp', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    if (!currentPassword) {
      res.status(400).json({ error: 'Enter your current password.' });
      return;
    }
    const accountTable = req.user?.role === 'resident' ? 'resident_user' : 'users';
    const { data: account, error } = await supabaseAdmin
      .from(accountTable).select('id, full_name, phone, password_hash').eq('id', req.user!.userId).maybeSingle();
    if (error) throw error;
    if (!account) { res.status(404).json({ error: 'Account not found.' }); return; }
    if (!(await bcrypt.compare(currentPassword, account.password_hash))) {
      res.status(400).json({ error: 'The current password is incorrect.' });
      return;
    }
    const phone = normalizeMobileNumber(account.phone);
    if (!phone) {
      res.status(400).json({ error: 'Add a valid mobile number to your profile before changing your password.' });
      return;
    }
    if (!config.textBeeApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured. Contact an administrator.' });
      return;
    }
    const otp = randomInt(100000, 1000000).toString();
    const otpKey = 'web-profile-password-change:' + accountTable + ':' + account.id;
    const cooldown = await getOtpResendCooldownSeconds(otpKey);
    if (cooldown > 0) { res.status(429).json({ error: 'A code was sent recently. Try again in ' + cooldown + ' seconds.' }); return; }
    await setOtp(otpKey, { otp, fullName: account.full_name, purpose: 'web_profile_password_change' });
    if (!(await smsService.sendPasswordChangeOtp(phone, otp, req.user?.role === 'resident' ? 'resident' : 'MDRRMO'))) {
      await deleteOtp(otpKey);
      res.status(503).json({ error: 'We could not send the verification SMS. Check the saved mobile number and try again.' });
      return;
    }
    res.json({ success: true, message: 'Verification code sent to ' + maskMobileNumber(phone) + '.', expiresInMinutes: 10 });
  } catch (err) {
    console.error('Web profile password OTP error:', err);
    res.status(500).json({ error: 'Could not send the password verification code.' });
  }
});

router.post('/profile/change-password', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const otp = typeof req.body?.otp === 'string' || typeof req.body?.otp === 'number' ? String(req.body.otp).trim() : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (!currentPassword || !/^\d{6}$/.test(otp) || newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: 'Enter your current password, the 6-digit SMS code, and a new password with at least 8 characters.' });
      return;
    }
    const accountTable = req.user?.role === 'resident' ? 'resident_user' : 'users';
    const { data: account, error } = await supabaseAdmin
      .from(accountTable).select('id, phone, password_hash').eq('id', req.user!.userId).maybeSingle();
    if (error) throw error;
    if (!account) { res.status(404).json({ error: 'Account not found.' }); return; }
    if (!(await bcrypt.compare(currentPassword, account.password_hash))) {
      res.status(400).json({ error: 'The current password is incorrect.' });
      return;
    }
    if (await bcrypt.compare(newPassword, account.password_hash)) {
      res.status(400).json({ error: 'Choose a new password that differs from your current password.' });
      return;
    }
    const otpKey = 'web-profile-password-change:' + accountTable + ':' + account.id;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== 'web_profile_password_change') {
      res.status(400).json({ error: 'No password-change request was found or the code expired. Request a new code.' });
      return;
    }
    if (record.otp !== otp) {
      const failedAttempts = (record.failedAttempts || 0) + 1;
      if (failedAttempts >= 5) await deleteOtp(otpKey);
      else await setOtp(otpKey, { ...record, failedAttempts });
      res.status(400).json({ error: failedAttempts >= 5 ? 'Too many incorrect codes. Request a new verification code.' : 'That verification code is incorrect.' });
      return;
    }
    const phone = normalizeMobileNumber(account.phone);
    if (!phone) { res.status(400).json({ error: 'Add a valid mobile number before changing your password.' }); return; }
    const passwordUpdate = await withPhoneAccountLock(phone, async () => {
      if (await hasPasswordReuseForPhone(phone, newPassword, accountTable, { table: accountTable, id: account.id })) return { reused: true as const };
      const passwordHash = await bcrypt.hash(newPassword, 12);
      const { error } = await supabaseAdmin.from(accountTable)
        .update({ password_hash: passwordHash, updated_at: new Date().toISOString() }).eq('id', account.id);
      return { reused: false as const, error };
    });
    if (passwordUpdate.reused) {
      res.status(409).json({ error: 'Choose a password different from the password used by your other account with this mobile number.' });
      return;
    }
    const updateError = passwordUpdate.error;
    if (updateError) throw updateError;
    await deleteOtp(otpKey);
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Web profile password change error:', err);
    res.status(500).json({ error: 'Could not update the password.' });
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
        phone: mobileNumberSchema,
        password: z.string().min(6),
        role: z.enum(['admin']),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const { full_name, phone, password, role } = parsed.data;
      const { data: newUser, error } = await withPhoneAccountLock(phone, async () => {
        if (await hasPhoneInAccountType(phone, 'users')) return { data: null, error: { code: 'ACCOUNT_PHONE_CONFLICT' } as any };
        if (await hasPasswordReuseForPhone(phone, password, 'users')) return { data: null, error: { code: 'PASSWORD_REUSE' } as any };
        const password_hash = await bcrypt.hash(password, 12);
        return supabaseAdmin
          .from('users')
          .insert({ full_name, phone, password_hash, role, status: 'active', verified: true })
          .select('id, full_name, phone, role, status')
          .single();
      });

      if (error?.code === 'PASSWORD_REUSE') {
        res.status(409).json({ error: 'Choose a password different from the password used by your other account with this mobile number.' });
        return;
      }
      if (error?.code === 'ACCOUNT_PHONE_CONFLICT') {
        res.status(409).json({ error: 'That mobile number already has an MDRRMO account.' });
        return;
      }

      if (error) {
        if (isMobileNumberRegistryConflict(error) || error.code === '23505') {
          res.status(409).json({ error: 'That mobile number is already linked to an account.' });
          return;
        }
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
// Resident registration uses an SMS verification code and the password chosen by the applicant.
async function sendResidentRegistrationOtp(req: Request, res: Response): Promise<void> {
  try {
    const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
    const phone = normalizeMobileNumber(req.body?.phone);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const barangayName = typeof req.body?.barangay_name === 'string' ? req.body.barangay_name.trim() : 'Poblacion';
    if (fullName.length < 2 || fullName.length > 100 || !phone || password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'Enter your name, a valid mobile number, and a password with at least 8 characters.' });
      return;
    }
    if (!config.textBeeApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured. Contact an administrator.' });
      return;
    }
    if (await hasPhoneInAccountType(phone, 'resident_user')) {
      res.status(409).json({ error: 'That mobile number already has a resident account. Sign in instead.' });
      return;
    }
    if (await hasPasswordReuseForPhone(phone, password, 'resident_user')) {
      res.status(409).json({ error: 'Choose a password different from the password used by your other account with this mobile number.' });
      return;
    }
    const otp = randomInt(100000, 1000000).toString();
    const otpKey = 'resident-registration:' + phone;
    const cooldown = await getOtpResendCooldownSeconds(otpKey);
    if (cooldown > 0) { res.status(429).json({ error: 'A code was sent recently. Try again in ' + cooldown + ' seconds.' }); return; }
    await setOtp(otpKey, {
      otp,
      fullName,
      phone,
      passwordCiphertext: encryptPendingPassword(password),
      barangayName: barangayName || 'Poblacion',
      purpose: 'resident_registration',
    });
    if (!(await smsService.sendRegistrationOtp(phone, otp))) {
      await deleteOtp(otpKey);
      res.status(503).json({ error: 'We could not send the verification SMS. Check the mobile number and try again.' });
      return;
    }
    res.json({ success: true, message: 'Verification code sent to ' + maskMobileNumber(phone) + '.', expiresInMinutes: 10 });
  } catch (err) {
    console.error('Resident registration OTP error:', err);
    res.status(500).json({ error: 'Could not start resident registration.' });
  }
}

async function verifyResidentRegistrationOtp(req: Request, res: Response): Promise<void> {
  try {
    const phone = normalizeMobileNumber(req.body?.phone);
    const otp = typeof req.body?.otp === 'string' || typeof req.body?.otp === 'number' ? String(req.body.otp).trim() : '';
    if (!phone || !/^\d{6}$/.test(otp)) {
      res.status(400).json({ error: 'Enter a valid mobile number and the 6-digit verification code.' });
      return;
    }
    const otpKey = 'resident-registration:' + phone;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== 'resident_registration' || record.phone !== phone || !record.passwordCiphertext) {
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
    const password = decryptPendingPassword(record.passwordCiphertext);
    const creation = await withPhoneAccountLock(phone, async () => {
      if (await hasPhoneInAccountType(phone, 'resident_user')) return { kind: 'phone_conflict' as const };
      if (await hasPasswordReuseForPhone(phone, password, 'resident_user')) return { kind: 'password_reuse' as const };
      const password_hash = await bcrypt.hash(password, 12);
      const { data, error } = await supabaseAdmin
        .from('resident_user')
        .insert({
          full_name: record.fullName,
          phone,
          password_hash,
          barangay_name: record.barangayName || 'Poblacion',
          status: 'active',
          verified: true,
        })
        .select('id, full_name, phone, barangay_name, role, status, verified')
        .single();
      return { kind: 'inserted' as const, data, error };
    });
    if (creation.kind === 'phone_conflict') {
      await deleteOtp(otpKey);
      res.status(409).json({ error: 'That mobile number already has a resident account. Sign in instead.' });
      return;
    }
    if (creation.kind === 'password_reuse') {
      await deleteOtp(otpKey);
      res.status(409).json({ error: 'Choose a password different from the password used by your other account with this mobile number.' });
      return;
    }
    const { data: resident, error: insertError } = creation;
    if (isMobileNumberRegistryConflict(insertError) || insertError?.code === '23505') {
      res.status(409).json({ error: 'That mobile number is already linked to an account. Sign in instead.' });
      return;
    }
    if (insertError || !resident) throw insertError || new Error('Resident account insert failed.');
    await deleteOtp(otpKey);
    const token = jwt.sign({ userId: resident.id, role: 'resident' }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any });
    res.status(201).json({ success: true, user: { ...resident, role: 'resident' }, token });
  } catch (err) {
    console.error('Resident registration verification error:', err);
    res.status(500).json({ error: 'Could not verify the code and create the resident account.' });
  }
}

router.post('/resident/web-register-otp', sendResidentRegistrationOtp);
router.post('/resident/web-verify-register-otp', verifyResidentRegistrationOtp);
router.get('/resident/register-otp', (_req: Request, res: Response): void => {
  res.json({ status: 'online', method: 'POST', description: 'Sends a 6-digit resident registration code by SMS.' });
});
router.post('/resident/register-otp', sendResidentRegistrationOtp);
router.get('/resident/verify-register-otp', (_req: Request, res: Response): void => {
  res.json({ status: 'online', method: 'POST', description: 'Verifies the resident mobile number and creates the account.' });
});
router.post('/resident/verify-register-otp', verifyResidentRegistrationOtp);

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
    const cooldown = await getOtpResendCooldownSeconds(otpKey);
    if (cooldown > 0) { res.status(429).json({ error: 'A code was sent recently. Try again in ' + cooldown + ' seconds.' }); return; }
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
      .from('resident_user').select('id, phone, password_hash').eq('id', req.user.userId).maybeSingle();
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

    const phone = normalizeMobileNumber(resident.phone);
    if (!phone) { res.status(400).json({ error: 'Add a valid mobile number before changing your password.' }); return; }
    const passwordUpdate = await withPhoneAccountLock(phone, async () => {
      if (await hasPasswordReuseForPhone(phone, newPassword, 'resident_user', { table: 'resident_user', id: resident.id })) return { reused: true as const };
      const passwordHash = await bcrypt.hash(newPassword, 12);
      const { error } = await supabaseAdmin
        .from('resident_user')
        .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
        .eq('id', resident.id);
      return { reused: false as const, error };
    });
    if (passwordUpdate.reused) {
      res.status(409).json({ error: 'Choose a password different from the password used by your other account with this mobile number.' });
      return;
    }
    const updateError = passwordUpdate.error;
    if (updateError) throw updateError;

    await deleteOtp(otpKey);
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err: any) {
    console.error('Resident web password change error:', err);
    res.status(500).json({ error: 'Could not update the resident password.' });
  }
});

// Forgot-password OTP flow, kept separate from the signed-in password-change flow.
type PasswordAccountTable = 'users' | 'resident_user' | 'barangay_users';

async function findPasswordAccount(table: PasswordAccountTable, phone: string, role?: string): Promise<any> {
  let query = supabaseAdmin.from(table).select('id, full_name, phone, password_hash, role').eq('phone', phone);
  if (role) query = query.eq('role', role);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function startPasswordReset(
  req: Request,
  res: Response,
  table: PasswordAccountTable,
  audience: 'resident' | 'barangay' | 'responder' | 'MDRRMO',
  purpose: ResidentOtpRecord['purpose'],
  role?: string,
): Promise<void> {
  try {
    const parsed = passwordResetOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter a valid mobile number.' });
      return;
    }
    if (!config.textBeeApiKey) {
      res.status(503).json({ error: 'SMS verification is not configured. Contact an administrator.' });
      return;
    }
    const phone = parsed.data.phone;
    const user = await findPasswordAccount(table, phone, role);
    if (!user) {
      res.json({ success: true, message: 'If an active account uses this mobile number, a verification code will be sent.' });
      return;
    }
    const otp = randomInt(100000, 1000000).toString();
    const otpKey = audience + '-password-reset:' + phone;
    const cooldown = await getOtpResendCooldownSeconds(otpKey);
    if (cooldown > 0) {
      res.json({ success: true, message: 'If an active account uses this mobile number, a verification code will be sent.' });
      return;
    }
    await setOtp(otpKey, { otp, accountId: user.id, purpose });
    if (!(await smsService.sendPasswordResetOtp(phone, otp, audience))) {
      await deleteOtp(otpKey);
      res.status(503).json({ error: 'We could not send the verification SMS. Check the mobile number and try again.' });
      return;
    }
    res.json({
      success: true,
      message: 'Password reset code sent to ' + maskMobileNumber(phone) + '. The code expires in 10 minutes.',
      expiresInMinutes: 10,
    });
  } catch (err) {
    console.error(audience + ' password reset OTP error:', err);
    res.status(500).json({ error: 'Could not start password recovery. Please try again later.' });
  }
}

async function finishPasswordReset(
  req: Request,
  res: Response,
  table: PasswordAccountTable,
  audience: 'resident' | 'barangay' | 'responder' | 'MDRRMO',
  purpose: ResidentOtpRecord['purpose'],
  role?: string,
): Promise<void> {
  try {
    const parsed = passwordResetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter your mobile number, code, and a valid new password.' });
      return;
    }
    const { phone, otp, new_password: newPassword } = parsed.data;
    const otpKey = audience + '-password-reset:' + phone;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== purpose) {
      res.status(400).json({ error: 'No password reset request was found or the code expired. Request a new code.' });
      return;
    }
    if (record.otp !== otp) {
      const failedAttempts = (record.failedAttempts || 0) + 1;
      if (failedAttempts >= 5) await deleteOtp(otpKey);
      else await setOtp(otpKey, { ...record, failedAttempts });
      res.status(400).json({ error: failedAttempts >= 5 ? 'Too many incorrect codes. Request a new verification code.' : 'That verification code is incorrect.' });
      return;
    }
    const user = await findPasswordAccount(table, phone, role);
    if (!user || user.id !== record.accountId) {
      await deleteOtp(otpKey);
      res.status(400).json({ error: 'The account for this reset request is no longer available.' });
      return;
    }
    const passwordUpdate = await withPhoneAccountLock(phone, async () => {
      if (await hasPasswordReuseForPhone(phone, newPassword, table, { table, id: user.id })) return { reused: true as const };
      const passwordHash = await bcrypt.hash(newPassword, 12);
      const { error } = await supabaseAdmin.from(table).update({ password_hash: passwordHash }).eq('id', user.id);
      return { reused: false as const, error };
    });
    if (passwordUpdate.reused) {
      res.status(409).json({ error: 'Choose a password different from the password used by your other account with this mobile number.' });
      return;
    }
    if (passwordUpdate.error) throw passwordUpdate.error;
    await deleteOtp(otpKey);
    res.json({ success: true, message: 'Password reset successfully. Sign in with your new password.' });
  } catch (err) {
    console.error(audience + ' password reset completion error:', err);
    res.status(500).json({ error: 'Could not reset the password. Please try again later.' });
  }
}

router.post('/resident/forgot-password-otp', (req, res) =>
  startPasswordReset(req, res, 'resident_user', 'resident', 'resident_password_reset'));
router.post('/resident/forgot-password', (req, res) =>
  finishPasswordReset(req, res, 'resident_user', 'resident', 'resident_password_reset'));

router.post('/barangay/password-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const phone = normalizeMobileNumber(req.body?.phone);
    if (!phone) { res.status(400).json({ error: 'Enter a valid mobile number.' }); return; }
    if (!config.textBeeApiKey) { res.status(503).json({ error: 'SMS verification is not configured. Contact an administrator.' }); return; }
    const user = await findPasswordAccount('barangay_users', phone);
    if (!user) { res.status(400).json({ error: 'No Barangay account was found for that mobile number.' }); return; }
    const otp = randomInt(100000, 1000000).toString();
    const otpKey = 'barangay-password-change:' + user.id;
    const cooldown = await getOtpResendCooldownSeconds(otpKey);
    if (cooldown > 0) { res.status(429).json({ error: 'A code was sent recently. Try again in ' + cooldown + ' seconds.' }); return; }
    await setOtp(otpKey, { otp, accountId: user.id, purpose: 'barangay_password_change' });
    if (!(await smsService.sendPasswordChangeOtp(phone, otp, 'barangay'))) {
      await deleteOtp(otpKey);
      res.status(503).json({ error: 'We could not send the verification SMS. Check the saved mobile number and try again.' });
      return;
    }
    res.json({ success: true, message: 'Verification code sent to ' + maskMobileNumber(phone) + '.', expiresInMinutes: 10 });
  } catch (err) {
    console.error('Barangay password OTP error:', err);
    res.status(500).json({ error: 'Could not send the password verification code.' });
  }
});

router.post('/barangay/change-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const phone = normalizeMobileNumber(req.body?.phone);
    const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (!phone || !/^\d{6}$/.test(otp) || !currentPassword || newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: 'Enter your mobile number, current password, 6-digit SMS code, and a valid new password.' });
      return;
    }
    const user = await findPasswordAccount('barangay_users', phone);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      res.status(400).json({ error: 'Invalid mobile number or password.' });
      return;
    }
    const otpKey = 'barangay-password-change:' + user.id;
    const record = await getOtp(otpKey);
    if (!record || record.purpose !== 'barangay_password_change' || record.accountId !== user.id) {
      res.status(400).json({ error: 'No matching password change request was found or the code expired.' });
      return;
    }
    if (record.otp !== otp) {
      res.status(400).json({ error: 'That verification code is incorrect.' });
      return;
    }
    const passwordUpdate = await withPhoneAccountLock(phone, async () => {
      if (await hasPasswordReuseForPhone(phone, newPassword, 'barangay_users', { table: 'barangay_users', id: user.id })) return { reused: true as const };
      const passwordHash = await bcrypt.hash(newPassword, 12);
      const { error } = await supabaseAdmin.from('barangay_users').update({ password_hash: passwordHash }).eq('id', user.id);
      return { reused: false as const, error };
    });
    if (passwordUpdate.reused) {
      res.status(409).json({ error: 'Choose a password different from the password used by your other account with this mobile number.' });
      return;
    }
    if (passwordUpdate.error) throw passwordUpdate.error;
    await deleteOtp(otpKey);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Barangay password change error:', err);
    res.status(500).json({ error: 'Could not update the password.' });
  }
});

router.post('/barangay/forgot-password-otp', (req, res) =>
  startPasswordReset(req, res, 'barangay_users', 'barangay', 'barangay_password_reset'));
router.post('/barangay/forgot-password', (req, res) =>
  finishPasswordReset(req, res, 'barangay_users', 'barangay', 'barangay_password_reset'));

router.post('/responder/forgot-password-otp', (req, res) =>
  startPasswordReset(req, res, 'users', 'responder', 'responder_password_reset', 'responder'));
router.post('/responder/forgot-password', (req, res) =>
  finishPasswordReset(req, res, 'users', 'responder', 'responder_password_reset', 'responder'));

router.post('/mdrrmo/forgot-password-otp', (req, res) =>
  startPasswordReset(req, res, 'users', 'MDRRMO', 'mdrrmo_password_reset'));
router.post('/mdrrmo/forgot-password', (req, res) =>
  finishPasswordReset(req, res, 'users', 'MDRRMO', 'mdrrmo_password_reset'));

export default router;
