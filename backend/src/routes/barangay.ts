import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { z } from 'zod';
import { randomInt } from 'crypto';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { setOtp, getOtp, deleteOtp } from '../config/redis';
import { authenticate, AuthRequest } from '../middleware/auth';
import { io } from '../server';
import { DispatcherVerificationService, normalizePositionDesignation } from '../services/dispatcherVerificationService';
import { emailService } from '../services/emailService';
import {
  ARRIVAL_RADIUS_METERS,
  distanceMeters,
  validateArrivalFix,
  validateRecentGpsFix,
} from '../services/arrivalValidation';
import { getVerifiedBarangayIds, isBarangayVerified } from '../services/verifiedBarangayService';
import { IncidentResolutionPdfService, IncompleteResolutionReportError } from '../services/incidentResolutionPdfService';
import { formatIncidentReport } from './incidentReports';
import { isReportResolved, reportStageDurations, summarizeReportTimings } from '../services/reportTiming';
import { isDirectMdrrmoReport } from '../services/mdrrmoReportVisibility';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

async function getAccountPositionDesignation(userId: string, fallback?: string | null): Promise<string> {
  const { data: account } = await supabaseAdmin
    .from('barangay_users')
    .select('position_designation')
    .eq('id', userId)
    .maybeSingle();

  return normalizePositionDesignation(account?.position_designation)
    || normalizePositionDesignation(fallback)
    || '';
}

function normalizeBarangayRole(role: string): string {
  const legacyRoleMap: Record<string, string> = {
    captain: 'dispatcher',
    team_leader: 'responder',
    volunteer: 'staff',
  };
  return legacyRoleMap[role] || role;
}

// ─── Middleware: Barangay Auth ───────────────────────────────────────────────

interface BarangayPayload {
  userId: string;
  barangayId: string;
  role: 'admin' | 'dispatcher' | 'responder' | 'staff';
}

const authenticateBarangay = async (req: AuthRequest, res: Response, next: any) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : ((req.query?.token as string) || (req.body?.token as string));

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (!decoded.barangayId) {
      res.status(403).json({ error: 'Not a barangay user token' });
      return;
    }
    const role = normalizeBarangayRole(decoded.role);
    (req as any).barangayUser = {
      ...decoded,
      role,
    };
    const requestStatusRead =
      req.method === 'GET' && (req.path === '/account-request/status' || req.path === '/dispatcher/verification-status');
    const accountRequestPaths = new Set([
      'GET /me',
      'GET /account-request',
      'PUT /account-request',
      'POST /account-request/activation',
      'GET /account-request/certificate',
      'GET /account-request/certificate-data',
      'POST /account-request/certificate',
      'POST /account-request/resubmit',
      'GET /account-request/status',
      // Keep the old URLs working for already-installed app builds.
      'GET /dispatcher/coordination-request',
      'PUT /dispatcher/coordination-request',
      'GET /dispatcher/authorization-pdf',
      'GET /dispatcher/certification-data',
      'POST /dispatcher/submit-certification',
      'POST /dispatcher/resubmit',
      'GET /dispatcher/verification-status',
    ]);

    // Old pending dispatcher registrations may inspect their status/document,
    // but cannot use operational routes. New requests belong to the admin.
    if (role === 'dispatcher' && decoded.isPendingDispatcher) {
      const legacyReadPaths = new Set([
        'GET /me',
        'GET /account-request/certificate',
        'GET /account-request/certificate-data',
        'GET /account-request/status',
        'GET /dispatcher/authorization-pdf',
        'GET /dispatcher/certification-data',
        'GET /dispatcher/verification-status',
      ]);
      if (!legacyReadPaths.has(`${req.method} ${req.path}`)) {
        res.status(403).json({ error: 'Barangay access requires an approved and active Barangay Account Request.' });
        return;
      }
      next();
      return;
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from('barangay_users')
      .select('role, is_active, barangay_id')
      .eq('id', decoded.userId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.barangay_id !== decoded.barangayId || normalizeBarangayRole(account.role) !== role || account.is_active !== true) {
      res.status(403).json({ error: 'This barangay account is inactive.' });
      return;
    }

    const accountRequestActive = await DispatcherVerificationService.isBarangayActive(decoded.barangayId);
    if (!accountRequestActive && requestStatusRead) {
      next();
      return;
    }
    if (!accountRequestActive && role !== 'admin') {
      res.status(403).json({ error: 'Barangay access requires an approved and active Barangay Account Request.' });
      return;
    }
    if (!accountRequestActive && role === 'admin' && !accountRequestPaths.has(`${req.method} ${req.path}`)) {
      res.status(403).json({ error: 'This Barangay Account Request is not active. Complete the request to restore barangay access.' });
      return;
    }

    // Even when active, a status read is permitted for every role so a
    // connected app can refresh its local access state after MDRRMO changes.
    if (requestStatusRead) {
      next();
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (roles: string[]) => (req: any, res: Response, next: any) => {
  if (!roles.includes(req.barangayUser?.role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }
  next();
};

// ─── Dispatcher push-token registration ──────────────────────────────────────

router.put(
  '/push-token',
  authenticateBarangay,
  requireRole(['dispatcher']),
  async (req: any, res: Response) => {
    const input = z.object({
      fcm_token: z.string().trim().min(1).max(4096),
      platform: z.literal('android'),
    }).safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: 'A valid FCM token and mobile platform are required.' });
      return;
    }

    try {
      const { error } = await supabaseAdmin
        .from('dispatcher_push_tokens')
        .upsert({
          fcm_token: input.data.fcm_token,
          user_id: req.barangayUser.userId,
          barangay_id: req.barangayUser.barangayId,
          platform: input.data.platform,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'fcm_token' });
      if (error) throw error;
      res.status(200).json({ registered: true });
    } catch (error) {
      console.error('Dispatcher push-token registration failed:', error);
      res.status(503).json({ error: 'Push notifications could not be registered.' });
    }
  },
);

router.delete(
  '/push-token',
  authenticateBarangay,
  requireRole(['dispatcher']),
  async (req: any, res: Response) => {
    const input = z.object({ fcm_token: z.string().trim().min(1).max(4096) }).safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: 'A valid FCM token is required.' });
      return;
    }

    try {
      const { error } = await supabaseAdmin
        .from('dispatcher_push_tokens')
        .delete()
        .eq('fcm_token', input.data.fcm_token)
        .eq('user_id', req.barangayUser.userId);
      if (error) throw error;
      res.status(200).json({ removed: true });
    } catch (error) {
      console.error('Dispatcher push-token removal failed:', error);
      res.status(503).json({ error: 'Push notifications could not be unregistered.' });
    }
  },
);

// ─── GET /api/barangay/list ──────────────────────────────────────────────────
// Public: get all barangays (for dropdowns in resident app)

router.get('/list', async (req: Request, res: Response) => {
  try {
    const verifiedOnly = req.query.verified_only === 'true' || req.query.verified_only === '1';
    const verifiedIds = verifiedOnly ? await getVerifiedBarangayIds() : null;
    const { data, error } = await supabaseAdmin
      .from('barangays')
      .select('id, name, municipality, latitude, longitude')
      .order('name', { ascending: true });

    if (error) throw error;
    const barangays = (data || [])
      .filter((barangay: any) => !verifiedIds || verifiedIds.includes(barangay.id))
      .map((barangay: any) => ({ ...barangay, is_verified: verifiedIds ? true : undefined }));
    res.json(barangays);
  } catch (err) {
    console.error('Fetch barangays error:', err);
    res.status(500).json({ error: 'Failed to fetch barangays' });
  }
});

// Public: residents can look up the published hotline list for a barangay.
router.get('/hotlines/:barangayId', async (req: Request, res: Response) => {
  try {
    if (!await isBarangayVerified(req.params.barangayId)) {
      res.json({ entries: [] });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('barangay_hotline_settings')
      .select('hotlines')
      .eq('barangay_id', req.params.barangayId)
      .maybeSingle();

    if (error) throw error;
    res.json({ entries: Array.isArray(data?.hotlines) ? data.hotlines : [] });
  } catch (err) {
    console.error('Fetch barangay hotlines error:', err);
    res.status(500).json({ error: 'Failed to fetch barangay hotlines.' });
  }
});

// Public: download all published hotline entries for resident offline use.
router.get('/hotlines', async (_req: Request, res: Response) => {
  try {
    const verifiedIds = await getVerifiedBarangayIds();
    const { data, error } = await supabaseAdmin
      .from('barangay_hotline_settings')
      .select('barangay_id, hotlines');

    if (error) throw error;
    res.json((data ?? []).filter((row: any) => verifiedIds.includes(row.barangay_id)));
  } catch (err) {
    console.error('Fetch all barangay hotlines error:', err);
    res.status(500).json({ error: 'Failed to fetch barangay hotlines.' });
  }
});

const barangayHotlinesSchema = z.object({
  entries: z.array(z.object({
    purpose: z.string().trim().min(1).max(120),
    numbers: z.array(z.string().trim().min(7).max(32)).min(1),
  })).max(100),
});

// Administrators and staff can replace the current shared hotline list.
router.put('/hotlines', authenticateBarangay, requireRole(['admin', 'staff']), async (req: any, res: Response) => {
  const parsed = barangayHotlinesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid hotline entries.', details: parsed.error.flatten() });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('barangay_hotline_settings')
      .upsert({
        barangay_id: req.barangayUser.barangayId,
        hotlines: parsed.data.entries,
        updated_by: req.barangayUser.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'barangay_id' })
      .select('hotlines')
      .single();

    if (error) throw error;
    res.json({ entries: Array.isArray(data.hotlines) ? data.hotlines : [] });
  } catch (err) {
    console.error('Save barangay hotlines error:', err);
    res.status(500).json({ error: 'Failed to save barangay hotlines.' });
  }
});

// ─── POST /api/barangay/register ────────────────────────────────────────────
// Create a barangay administrator account before the Barangay Account Request.
// Saves ONLY to barangay_dispatcher_verifications (pending).
// barangay_users entry is created only after MDRRMO approval.

const barangayRegistrationOtpSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(30).optional().nullable(),
  barangay_id: z.string().uuid(),
  position_designation: z.string().trim().min(2).max(120),
});

router.post('/register-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = barangayRegistrationOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter your name, barangay, position, and a valid email.' });
      return;
    }
    const body = parsed.data;
    const email = body.email;
    const { data: barangayUser, error: barangayLookupError } = await supabaseAdmin
      .from('barangay_users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (barangayLookupError) throw barangayLookupError;
    const pending = await DispatcherVerificationService.findByEmail(email);
    if (barangayUser || (pending && pending.status !== 'rejected')) {
      res.status(409).json({ error: 'This email already has a Barangay App account. Sign in or use another email.' });
      return;
    }
    const otp = randomInt(100000, 1000000).toString();
    await setOtp(email, {
      otp,
      fullName: body.full_name,
      contactNumber: body.phone?.trim() || '',
      barangayId: body.barangay_id,
      positionDesignation: body.position_designation,
      purpose: 'barangay_registration',
    });
    const sent = await emailService.sendOtpEmail(email, otp, 'barangay_registration');
    if (!sent) {
      await deleteOtp(email);
      res.status(503).json({ error: 'We could not send the verification email. Please try again later.' });
      return;
    }
    res.json({ success: true, message: `Verification code sent to ${email}.`, expiresInMinutes: 10 });
  } catch (err: any) {
    console.error('Barangay registration OTP error:', err);
    res.status(500).json({ error: 'Could not start registration.' });
  }
});

router.post('/verify-register-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const otp = typeof req.body.otp === 'string' || typeof req.body.otp === 'number' ? String(req.body.otp).trim() : '';
    if (!email || !otp) {
      res.status(400).json({ error: 'Email and verification code are required.' });
      return;
    }
    const record = await getOtp(email);
    if (!record || record.purpose !== 'barangay_registration') {
      res.status(400).json({ error: 'No pending registration found or the code expired. Request a new code.' });
      return;
    }
    if (record.otp !== otp) {
      res.status(400).json({ error: 'Invalid verification code.' });
      return;
    }
    if (!record.fullName || !record.barangayId || !record.positionDesignation) {
      res.status(400).json({ error: 'Registration details are incomplete. Please register again.' });
      return;
    }
    const { data: existing } = await supabaseAdmin.from('barangay_users').select('id').eq('email', email).maybeSingle();
    if (existing) {
      res.status(409).json({ error: 'This email is already registered. Sign in instead.' });
      return;
    }
    const { data: barangay, error: barangayError } = await supabaseAdmin
      .from('barangays').select('name, municipality').eq('id', record.barangayId).maybeSingle();
    if (barangayError || !barangay) {
      res.status(400).json({ error: 'Selected barangay was not found.' });
      return;
    }

    const temporaryPassword = `Norz#${randomInt(1000, 10000)}`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const { data: user, error: insertError } = await supabaseAdmin.from('barangay_users').insert({
      full_name: record.fullName,
      email,
      phone: record.contactNumber || null,
      password_hash: passwordHash,
      barangay_id: record.barangayId,
      role: 'admin',
      position_designation: record.positionDesignation,
      is_active: true,
    }).select('id, full_name, email, phone, role, barangay_id, position_designation, is_active').single();
    if (insertError || !user) {
      console.error('Barangay account creation failed:', insertError?.message);
      res.status(500).json({ error: 'Could not create the account. Please try again.' });
      return;
    }

    const passwordSent = await emailService.sendTemporaryPasswordEmail(email, temporaryPassword, record.fullName, 'barangay');
    if (!passwordSent) {
      await supabaseAdmin.from('barangay_users').delete().eq('id', user.id);
      res.status(503).json({ error: 'The temporary password email could not be sent. Please verify again or request a new code.' });
      return;
    }
    await deleteOtp(email);
    const token = jwt.sign(
      { userId: user.id, barangayId: user.barangay_id, role: 'admin', email: user.email },
      config.jwtSecret,
      { expiresIn: '30d' },
    );
    res.status(201).json({
      success: true,
      message: 'Email verified. Your temporary password was sent to your email.',
      temporaryPassword,
      user: { ...user, barangay_name: barangay.name, municipality: barangay.municipality, coordination_verified: false, verification_status: 'pending_document', coordination_prompt_pending: false },
      token,
    });
  } catch (err: any) {
    console.error('Barangay OTP verification error:', err);
    res.status(500).json({ error: 'Could not finish registration.' });
  }
});

router.post('/register', (_req: Request, res: Response): void => {
  res.status(410).json({ error: 'Passwordless OTP registration is required. Use the registration form in the current Barangay App.' });
});

// ─── POST /api/barangay/login ────────────────────────────────────────────────

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;
    if (!z.string().email().safeParse(email).success || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    // ── Path A: Check active barangay accounts ──
    const { data: user } = await supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email, phone, role, barangay_id, password_hash, is_active, position_designation')
      .eq('email', email)
      .maybeSingle();

    if (user) {
      const role = normalizeBarangayRole(user.role);
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      // Fetch barangay details
      const { data: barangay } = await supabaseAdmin
        .from('barangays')
        .select('name, municipality')
        .eq('id', user.barangay_id)
        .maybeSingle();

      if (!user.is_active) {
        res.status(403).json({ error: 'This barangay account is inactive. Contact your barangay administrator.' });
        return;
      }

      const coordinationVerified = await DispatcherVerificationService.isBarangayActive(user.barangay_id);
      // Keep the barangay administrator able to sign in while access is
      // pending or deactivated so they can submit or request activation.
      // All other barangay roles are refused until MDRRMO activates the request.
      if (role !== 'admin' && !coordinationVerified) {
        res.status(403).json({ error: 'This barangay is not active. Ask the barangay administrator to submit a Barangay Account Request.' });
        return;
      }

      const verification = role === 'admin'
        ? await DispatcherVerificationService.getPersistedByUserId(user.id)
        : null;

      const token = jwt.sign(
        { userId: user.id, barangayId: user.barangay_id, role, email: user.email },
        config.jwtSecret,
        { expiresIn: '30d' }
      );
      res.json({
        token,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          role,
          barangay_id: user.barangay_id,
          position_designation: user.position_designation,
          barangay_name: barangay?.name || '',
          municipality: barangay?.municipality || 'Norzagaray',
            is_active: user.is_active,
            coordination_verified: coordinationVerified,
            verification_status: verification?.status || (coordinationVerified ? 'verified' : 'pending_document'),
            verification,
        },
      });
      return;
    }

    // ── Path B: Legacy pending dispatcher accounts ──
    const pendingRecord = await DispatcherVerificationService.findByEmail(email);

    if (pendingRecord && pendingRecord._password_hash) {
      const valid = await bcrypt.compare(password, pendingRecord._password_hash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      // Fetch barangay details
      const { data: barangay } = await supabaseAdmin
        .from('barangays')
        .select('name, municipality')
        .eq('id', pendingRecord.barangay_id)
        .maybeSingle();

      // Issue a limited token — userId maps to verification's user_id
      const token = jwt.sign(
        {
          userId: pendingRecord.user_id,
          barangayId: pendingRecord.barangay_id,
          role: 'dispatcher',
          email: pendingRecord.email,
          isPendingDispatcher: true,
        },
        config.jwtSecret,
        { expiresIn: '30d' }
      );

      res.json({
        token,
        user: {
          id: pendingRecord.user_id,
          full_name: pendingRecord.full_name,
          email: pendingRecord.email,
          phone: pendingRecord.phone,
          role: 'dispatcher',
          barangay_id: pendingRecord.barangay_id,
          barangay_name: barangay?.name || pendingRecord.barangay_name || '',
          municipality: barangay?.municipality || 'Norzagaray',
          is_active: false,
          coordination_verified: false,
          verification_status: pendingRecord.status,
          verification: pendingRecord,
        },
      });
      return;
    }

    res.status(401).json({ error: 'Invalid email or password' });
  } catch (err) {
    console.error('Barangay login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/barangay/me ────────────────────────────────────────────────────

router.get('/me', authenticateBarangay, async (req: any, res: Response) => {
  try {
    const userId = req.barangayUser.userId;

    // First try barangay_users (approved barangay accounts)
    const { data: user } = await supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email, phone, role, barangay_id, position_designation, is_active, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (user) {
      const { data: barangay } = await supabaseAdmin
        .from('barangays')
        .select('name, municipality')
        .eq('id', user.barangay_id)
        .maybeSingle();

      const role = normalizeBarangayRole(user.role);
      const verification = role === 'admin'
        ? await DispatcherVerificationService.getPersistedByUserId(user.id)
        : null;
      const verificationStatus = verification?.status || (role === 'admin'
        ? 'pending_document'
        : (user.is_active ? 'verified' : 'pending_document'));
      const coordinationVerified = await DispatcherVerificationService.isBarangayActive(user.barangay_id);

      res.json({
        ...user,
        role,
        barangay_name: barangay?.name,
        municipality: barangay?.municipality,
        verification_status: verificationStatus,
        coordination_verified: coordinationVerified,
        verification,
      });
      return;
    }

    // Fallback: pending dispatcher (not yet in barangay_users)
    const verification = req.barangayUser.isPendingDispatcher
      ? await DispatcherVerificationService.getByUserId(userId)
      : await DispatcherVerificationService.getPersistedByUserId(userId);
    if (verification) {
      const { data: barangay } = await supabaseAdmin
        .from('barangays')
        .select('name, municipality')
        .eq('id', verification.barangay_id)
        .maybeSingle();

      res.json({
        id: verification.user_id,
        full_name: verification.full_name,
        email: verification.email,
        phone: verification.phone,
        role: 'dispatcher',
        barangay_id: verification.barangay_id,
        barangay_name: barangay?.name || verification.barangay_name,
        municipality: barangay?.municipality || 'Norzagaray',
        is_active: false,
        coordination_verified: await DispatcherVerificationService.isBarangayActive(verification.barangay_id),
        verification_status: verification.status,
        verification,
      });
      return;
    }

    res.status(404).json({ error: 'User not found' });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /api/barangay/profile ────────────────────────────────────────────
// Allow a signed-in barangay account to update only its own name and phone.
router.patch('/profile', authenticateBarangay, async (req: any, res: Response) => {
  try {
    const schema = z.object({
      full_name: z.string().trim().min(2).max(100),
      phone: z.string().trim().min(1).max(11),
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide a valid name and phone number.' });
      return;
    }

    const phone = parsed.data.phone;
    if (phone && !/^09\d{9}$/.test(phone)) {
      res.status(400).json({ error: 'Enter an 11-digit mobile number starting with 09.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('barangay_users')
      .update({ full_name: parsed.data.full_name, phone })
      .eq('id', req.barangayUser.userId)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select('full_name, phone')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Barangay account not found.' });
      return;
    }

    res.json({ success: true, full_name: data.full_name, phone: data.phone });
  } catch (err) {
    console.error('Update barangay profile error:', err);
    res.status(500).json({ error: 'Failed to update your information.' });
  }
});

// ─── GET /api/barangay/dispatcher/authorization-pdf ──────────────────────────
// Download / view prefilled Authorization & Certification PDF
// Supports inline preview and attachment download via ?download=true

router.get(
  ['/account-request/certificate', '/dispatcher/authorization-pdf'],
  authenticateBarangay,
  requireRole(['admin', 'dispatcher']),
  async (req: Request, res: Response): Promise<void> => {
  try {
    let userId: string | undefined;

    // 1. Check Authorization header or query param token
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : (req.query.token as string);
    let decodedToken: any;

    if (token) {
      try {
        decodedToken = jwt.verify(token, config.jwtSecret) as any;
        userId = decodedToken.userId;
      } catch (_) {}
    }

    if (!userId || !decodedToken) {
      res.status(401).json({ error: 'Authentication is required to generate the authorization PDF.' });
      return;
    }

    const role = normalizeBarangayRole(decodedToken.role);
    if (role !== 'admin' && !(role === 'dispatcher' && decodedToken.isPendingDispatcher === true)) {
      res.status(403).json({ error: 'Only a barangay administrator or pending dispatcher can view this document.' });
      return;
    }

    const lookupId = userId;

    // 2. Fetch or dynamically generate verification record from existing user registration data
    let verification = decodedToken.isPendingDispatcher
      ? await DispatcherVerificationService.getByUserId(lookupId)
      : await DispatcherVerificationService.getPersistedByUserId(lookupId);
    if (!verification) {
      verification = await DispatcherVerificationService.getById(lookupId);
    }

    if (!verification) {
      // Look up existing user registration in barangay_users
      const { data: bUser } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name, email, phone, barangay_id, role, position_designation, created_at, barangays(name, municipality)')
        .eq('id', lookupId)
        .maybeSingle();

      if (bUser) {
        const barangayName = (bUser as any).barangays?.name || 'Barangay';
        verification = await DispatcherVerificationService.createVerification({
          userId: bUser.id,
          barangayId: bUser.barangay_id,
          barangayName,
          fullName: bUser.full_name,
          email: bUser.email,
          phone: bUser.phone,
          positionDesignation: normalizePositionDesignation(bUser.position_designation) || '',
          punongBarangayName: '[AUTHORIZED BARANGAY OFFICIAL]',
          punongBarangayPosition: 'Authorized Barangay Official',
        });
      }
    }

    if (!verification) {
      res.status(404).json({ error: 'Dispatcher registration record not found' });
      return;
    }

    const currentDate = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const pdfBuffer = await DispatcherVerificationService.generateAuthorizationPDF({
      adminName: verification.full_name,
      positionDesignation: await getAccountPositionDesignation(
        lookupId,
        verification.position_designation,
      ),
      barangayName: verification.barangay_name || 'Barangay',
      officialName: verification.punong_barangay_name || '[NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL]',
      officialPosition: verification.punong_barangay_position || 'Punong Barangay',
      referenceNo: verification.reference_no,
      dateStr: currentDate,
    });

    const isDownload = req.query.download === 'true' || req.query.download === '1' || req.query.dl === '1';
    const dispositionType = isDownload ? 'attachment' : 'inline';
    const safeName = (verification.full_name || 'Administrator').replace(/[^a-zA-Z0-9_]/g, '_');
    const filename = `Barangay_Account_Request_${safeName}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${dispositionType}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Generate authorization PDF error:', err);
    res.status(500).json({ error: 'Failed to generate authorization PDF' });
  }
  },
);

// ─── GET /api/barangay/dispatcher/certification-data ────────────────────────
// Retrieve prefilled certification data for in-app viewing & printing

router.get(
  ['/account-request/certificate-data', '/dispatcher/certification-data'],
  authenticateBarangay,
  requireRole(['admin', 'dispatcher']),
  async (req: Request, res: Response): Promise<void> => {
  try {
    let userId: string | undefined;

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : (req.query.token as string);
    let decodedToken: any;

    if (token) {
      try {
        decodedToken = jwt.verify(token, config.jwtSecret) as any;
        userId = decodedToken.userId;
      } catch (_) {}
    }

    if (!userId || !decodedToken) {
      res.status(401).json({ error: 'Authentication is required to fetch certification data.' });
      return;
    }

    const role = normalizeBarangayRole(decodedToken.role);
    if (role !== 'admin' && !(role === 'dispatcher' && decodedToken.isPendingDispatcher === true)) {
      res.status(403).json({ error: 'Only a barangay administrator or pending dispatcher can view this document.' });
      return;
    }

    const lookupId = userId;

    let verification = decodedToken.isPendingDispatcher
      ? await DispatcherVerificationService.getByUserId(lookupId)
      : await DispatcherVerificationService.getPersistedByUserId(lookupId);
    if (!verification) {
      verification = await DispatcherVerificationService.getById(lookupId);
    }

    if (!verification) {
      const { data: bUser } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name, email, phone, barangay_id, role, position_designation, created_at, barangays(name, municipality)')
        .eq('id', lookupId)
        .maybeSingle();

      if (bUser) {
        const barangayName = (bUser as any).barangays?.name || 'Barangay';
        verification = await DispatcherVerificationService.createVerification({
          userId: bUser.id,
          barangayId: bUser.barangay_id,
          barangayName,
          fullName: bUser.full_name,
          email: bUser.email,
          phone: bUser.phone,
          positionDesignation: normalizePositionDesignation(bUser.position_designation) || '',
          punongBarangayName: '[AUTHORIZED BARANGAY OFFICIAL]',
          punongBarangayPosition: 'Authorized Barangay Official',
        });
      }
    }

    if (!verification) {
      res.status(404).json({ error: 'Dispatcher registration record not found' });
      return;
    }

    const currentDate = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const barangayName = (verification.barangay_name || 'Barangay').replace(/^Brgy\.?\s*/i, '').trim();

    const positionDesignation = await getAccountPositionDesignation(
      lookupId,
      verification.position_designation,
    );

    res.json({
      title: 'BARANGAY ACCOUNT REQUEST',
      date: currentDate,
      full_name: verification.full_name,
      position_designation: positionDesignation || 'Not provided',
      barangay: barangayName,
      municipality: 'Municipality of Norzagaray, Bulacan',
      contact_info: verification.phone || '',
      official_name: verification.punong_barangay_name || '[NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL]',
      official_position: verification.punong_barangay_position || 'Authorized Barangay Official',
      reference_no: verification.reference_no,
      paragraphs: [
        positionDesignation
          ? `This is to certify that ${verification.full_name}, serving as ${positionDesignation} at Barangay ${barangayName}, Municipality of Norzagaray, Bulacan, is the barangay administrator and authorized representative submitting a Barangay Account Request to the NorzAgapay Emergency Response and Crisis Management Coordination Application. The request seeks MDRRMO verification and activation of access for authorized accounts belonging to Barangay ${barangayName}.`
          : `This is to certify that ${verification.full_name} is the barangay administrator and an authorized representative of Barangay ${barangayName}, Municipality of Norzagaray, Bulacan, submitting a Barangay Account Request to the NorzAgapay Emergency Response and Crisis Management Coordination Application. The request seeks MDRRMO verification and activation of access for authorized accounts belonging to Barangay ${barangayName}.`,
        `The barangay administrator is responsible for managing authorized team accounts and ensuring they are used only for official emergency preparedness, incident reporting, and response coordination.`,
        `All accounts belonging to the barangay will remain restricted until the MDRRMO verifies and activates this request. MDRRMO may deactivate barangay access at any time; the administrator may then submit a request to restore access.`,
      ],
    });
  } catch (err) {
    console.error('Fetch certification data error:', err);
    res.status(500).json({ error: 'Failed to fetch certification data' });
  }
  },
);

// ─── POST /api/barangay/dispatcher/submit-certification ──────────────────────
// Upload signed and sealed certification document

router.post(
  ['/account-request/certificate', '/dispatcher/submit-certification'],
  authenticateBarangay,
  requireRole(['admin']),
  upload.single('file'),
  async (req: any, res: Response): Promise<void> => {
    try {
      const userId = req.barangayUser.userId;
      let documentUrl: string | undefined;

      // 1. Check if multipart file was uploaded
      if (req.file) {
        const file = req.file;
        const ext = file.originalname.split('.').pop() || 'jpg';
        const objectPath = `certifications/${userId}/${Date.now()}.${ext}`;

        // Attempt upload to Supabase Storage
        let uploadedToSupabase = false;
        try {
          const { data: storageData, error: storageErr } = await supabaseAdmin.storage
            .from(config.supabaseBucketName)
            .upload(objectPath, file.buffer, {
              contentType: file.mimetype,
              upsert: true,
            });

          if (!storageErr && storageData) {
            const { data: publicUrlData } = supabaseAdmin.storage
              .from(config.supabaseBucketName)
              .getPublicUrl(objectPath);
            documentUrl = publicUrlData.publicUrl;
            uploadedToSupabase = true;
          }
        } catch (_) {}

        // Fallback: save to local uploads directory
        if (!uploadedToSupabase) {
          const uploadsDir = path.join(__dirname, '../../data/uploads/certifications');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          const fileName = `${userId}_${Date.now()}.${ext}`;
          const filePath = path.join(uploadsDir, fileName);
          fs.writeFileSync(filePath, file.buffer);
          documentUrl = `/uploads/certifications/${fileName}`;
        }
      } else if (req.body.document_url) {
        documentUrl = req.body.document_url;
      } else if (req.body.file_base64) {
        // Base64 upload support
        const base64Data = req.body.file_base64.replace(/^data:([A-Za-z-+\/]+);base64,/, '');
        const ext = req.body.file_name?.split('.').pop() || 'jpg';
        const uploadsDir = path.join(__dirname, '../../data/uploads/certifications');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const fileName = `${userId}_${Date.now()}.${ext}`;
        const filePath = path.join(uploadsDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        documentUrl = `/uploads/certifications/${fileName}`;
      }

      if (!documentUrl) {
        res.status(400).json({ error: 'Certification file is required.' });
        return;
      }

      const updatedVerification = await DispatcherVerificationService.submitCertification(
        userId,
        documentUrl
      );

      res.json({
        message: 'Certification document submitted successfully.',
        verification: updatedVerification,
      });
    } catch (err: any) {
      console.error('Submit certification error:', err);
      res.status(500).json({ error: err.message || 'Failed to submit certification.' });
    }
  }
);

// ─── GET /api/barangay/dispatcher/verification-status ────────────────────────

router.get(['/account-request', '/dispatcher/coordination-request'], authenticateBarangay, requireRole(['admin']), async (req: any, res: Response): Promise<void> => {
  try {
      const verification = await DispatcherVerificationService.getPersistedByUserId(req.barangayUser.userId);
    const coordinationVerified = await DispatcherVerificationService.isBarangayActive(req.barangayUser.barangayId);
    res.json({ configured: Boolean(verification), verification, coordination_verified: coordinationVerified });
  } catch (err) {
    console.error('Load Barangay Account Request error:', err);
    res.status(500).json({ error: 'Failed to load Barangay Account Request.' });
  }
});

router.put(['/account-request', '/dispatcher/coordination-request'], authenticateBarangay, requireRole(['admin']), async (req: any, res: Response): Promise<void> => {
  const parsed = z.object({
    official_name: z.string().trim().min(2).max(120),
    official_position: z.string().trim().min(2).max(120),
    position_designation: z.string().trim().max(120).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter the authorizing official’s name and position.' });
    return;
  }
  try {
    const userId = req.barangayUser.userId;
    let verification = await DispatcherVerificationService.getPersistedByUserId(userId);
    if (!verification) {
      const { data: user, error: userError } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name, email, phone, barangay_id, position_designation, barangays(name)')
        .eq('id', userId)
        .single();
      if (userError || !user) {
        res.status(404).json({ error: 'Barangay administrator account was not found.' });
        return;
      }
      const accountPosition = parsed.data.position_designation !== undefined
        ? (normalizePositionDesignation(parsed.data.position_designation) || '')
        : (normalizePositionDesignation(user.position_designation) || '');
      verification = await DispatcherVerificationService.createVerification({
        userId,
        barangayId: user.barangay_id,
        barangayName: (user as any).barangays?.name || 'Barangay',
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        positionDesignation: accountPosition,
        punongBarangayName: parsed.data.official_name,
        punongBarangayPosition: parsed.data.official_position,
      });
      if (accountPosition !== (normalizePositionDesignation(user.position_designation) || '')) {
        const { error: positionUpdateError } = await supabaseAdmin
          .from('barangay_users')
          .update({ position_designation: accountPosition })
          .eq('id', userId)
          .eq('role', 'admin');
        if (positionUpdateError) throw positionUpdateError;
      }
      await DispatcherVerificationService.broadcastCoordinationAccessChanged(user.barangay_id);
    } else {
      verification = await DispatcherVerificationService.updateAuthorizationDetails(
        userId,
        parsed.data.official_name,
        parsed.data.official_position,
        parsed.data.position_designation,
      );
    }
    const coordinationVerified = await DispatcherVerificationService.isBarangayActive(req.barangayUser.barangayId);
    res.json({ verification, coordination_verified: coordinationVerified });
  } catch (err: any) {
    console.error('Save Barangay Account Request error:', err);
    res.status(500).json({ error: err.message || 'Failed to save Barangay Account Request.' });
  }
});

router.post('/account-request/activation', authenticateBarangay, requireRole(['admin']), async (req: any, res: Response): Promise<void> => {
  try {
    const verification = await DispatcherVerificationService.requestActivation(req.barangayUser.userId);
    res.json({ message: 'Activation request sent to MDRRMO.', verification, coordination_verified: false });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not request barangay activation.' });
  }
});

router.get(
  ['/account-request/status', '/dispatcher/verification-status'],
  authenticateBarangay,
  async (req: any, res: Response): Promise<void> => {
    try {
      const targetUserId = req.barangayUser?.userId;
      const coordinationVerified = await DispatcherVerificationService.isBarangayActive(req.barangayUser.barangayId);
      let verification = req.barangayUser.isPendingDispatcher
        ? await DispatcherVerificationService.getByUserId(targetUserId)
        : await DispatcherVerificationService.getPersistedByUserId(targetUserId);
      const { data: user } = await supabaseAdmin
        .from('barangay_users')
        .select('role, is_active')
        .eq('id', targetUserId)
        .maybeSingle();

      if (!verification) {
        const isAdmin = normalizeBarangayRole(user?.role || req.barangayUser.role) === 'admin';
        res.json({
          verification: null,
          verification_status: isAdmin ? 'pending_document' : 'verified',
          coordination_verified: coordinationVerified,
        });
        return;
      }
      res.json({ verification, coordination_verified: coordinationVerified });
    } catch (err) {
      console.error('Get verification status error:', err);
      res.status(500).json({ error: 'Failed to retrieve verification status' });
    }
  }
);

// ─── POST /api/barangay/dispatcher/resubmit ──────────────────────────────────

router.post(
  ['/account-request/resubmit', '/dispatcher/resubmit'],
  authenticateBarangay,
  requireRole(['admin']),
  async (req: any, res: Response): Promise<void> => {
    try {
      const updated = await DispatcherVerificationService.allowResubmission(req.barangayUser.userId);
      res.json({ message: 'Resubmission initiated.', verification: updated });
    } catch (err: any) {
      console.error('Resubmit error:', err);
      res.status(500).json({ error: err.message || 'Failed to initiate resubmission' });
    }
  }
);

// ─── GET /api/barangay/team ──────────────────────────────────────────────────
// List team members for this barangay

router.get('/team', authenticateBarangay, async (req: any, res: Response) => {
  try {
    let query = supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email, phone, role, is_active, created_at, added_by')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('role', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    const responderIds = [...new Set((data || [])
      .map((report: any) => report.barangay_responded_by)
      .filter(Boolean))];
    const responderNames = new Map<string, string>();
    if (responderIds.length > 0) {
      const { data: responders, error: responderError } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name')
        .in('id', responderIds);
      if (responderError) throw responderError;
      for (const responder of responders || []) responderNames.set(responder.id, responder.full_name);
    }

    res.json((data || []).map((report: any) => ({
      ...report,
      barangay_responder_name: responderNames.get(report.barangay_responded_by) || null,
    })));
  } catch (err) {
    console.error('Fetch team error:', err);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

// ─── POST /api/barangay/team ─────────────────────────────────────────────────
// Administrators manage all team roles; responders may add staff only.

const addMemberSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8),
  phone: z.string().optional(),
  role: z.enum(['dispatcher', 'responder', 'staff']),
});

router.post('/team', authenticateBarangay, requireRole(['admin', 'responder']), async (req: any, res: Response): Promise<void> => {
  try {
    // Only an active account in this barangay may create team accounts.
    const { data: creator, error: creatorError } = await supabaseAdmin
      .from('barangay_users')
      .select('role, is_active, barangay_id')
      .eq('id', req.barangayUser.userId)
      .maybeSingle();
    if (creatorError) throw creatorError;
    if (!creator?.is_active || creator.role !== req.barangayUser.role || creator.barangay_id !== req.barangayUser.barangayId) {
      res.status(403).json({ error: 'An active barangay team account is required to add team members.' });
      return;
    }

    const body = addMemberSchema.parse(req.body);

    // Responders can add staff accounts only.
    if (req.barangayUser.role === 'responder' && body.role !== 'staff') {
      res.status(403).json({ error: 'Responders can only add staff accounts.' });
      return;
    }

    if (req.barangayUser.role === 'admin' && body.role === 'dispatcher') {
      const coordination = await DispatcherVerificationService.getByUserId(req.barangayUser.userId);
      if (coordination?.status !== 'verified' || !(await DispatcherVerificationService.isBarangayActive(req.barangayUser.barangayId))) {
        res.status(403).json({ error: 'The Barangay Account Request must be active before adding a dispatcher.' });
        return;
      }
    }

    const password_hash = await bcrypt.hash(body.password, 12);
    const { data: member, error } = await supabaseAdmin
      .from('barangay_users')
      .insert({
        full_name: body.full_name,
        email: body.email,
        phone: body.phone || null,
        password_hash,
        barangay_id: req.barangayUser.barangayId,
        role: body.role,
        added_by: req.barangayUser.userId,
        is_active: true,
      })
      .select('id, full_name, email, phone, role, barangay_id, is_active, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      throw error;
    }

    io.to(`barangay:${req.barangayUser.barangayId}`).emit('team:member_added', { member });

    res.status(201).json(member);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error('Add team member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/barangay/team/:id ──────────────────────────────────────────

router.patch('/team/:id', authenticateBarangay, requireRole(['admin']), async (req: any, res: Response): Promise<void> => {
  try {
    const schema = z.object({
      full_name: z.string().trim().min(2).max(120),
      email: z.string().trim().email(),
      phone: z.string().trim().max(20).optional().nullable(),
      role: z.enum(['dispatcher', 'responder', 'staff']),
      password: z.string().min(8).optional().or(z.literal('')),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please check the member details and try again.' });
      return;
    }
    const { data: currentMember, error: currentMemberError } = await supabaseAdmin
      .from('barangay_users')
      .select('role')
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .neq('role', 'admin')
      .maybeSingle();
    if (currentMemberError) throw currentMemberError;
    if (!currentMember) { res.status(404).json({ error: 'Team member not found.' }); return; }

    if (parsed.data.role === 'dispatcher' && currentMember.role !== 'dispatcher') {
      const coordination = await DispatcherVerificationService.getByUserId(req.barangayUser.userId);
      if (coordination?.status !== 'verified' || !(await DispatcherVerificationService.isBarangayActive(req.barangayUser.barangayId))) {
        res.status(403).json({ error: 'The Barangay Account Request must be active before assigning the dispatcher role.' });
        return;
      }
    }
    const update: Record<string, unknown> = {
      full_name: parsed.data.full_name,
      email: parsed.data.email.toLowerCase(),
      phone: parsed.data.phone?.trim() || null,
      role: parsed.data.role,
    };
    if (parsed.data.password) update.password_hash = await bcrypt.hash(parsed.data.password, 12);
    const { data, error } = await supabaseAdmin
      .from('barangay_users')
      .update(update)
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .neq('role', 'admin')
      .select('id, full_name, email, phone, role, barangay_id, is_active, created_at, added_by')
      .maybeSingle();
    if (error?.code === '23505') { res.status(409).json({ error: 'Email already registered.' }); return; }
    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'Team member not found.' }); return; }
    if (currentMember.role === 'dispatcher' && parsed.data.role !== 'dispatcher') {
      await DispatcherVerificationService.removeDispatcherRoomAccess(req.barangayUser.barangayId, req.params.id);
    }
    res.json(data);
  } catch (err) {
    console.error('Update team member error:', err);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

router.delete('/team/:id', authenticateBarangay, requireRole(['admin']), async (req: any, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('barangay_users')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId);

    if (error) throw error;

    await DispatcherVerificationService.removeDispatcherRoomAccess(req.barangayUser.barangayId, req.params.id);

    res.json({ message: 'Member deactivated' });
  } catch (err) {
    console.error('Remove team member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/barangay/reports ───────────────────────────────────────────────
// Get incident reports assigned to this barangay

// Barangay analytics include only reports handled by the barangay. Direct
// MDRRMO routing and reports escalated to MDRRMO are excluded from its metrics.
router.get('/reports/statistics', authenticateBarangay, requireRole(['admin']), async (req: any, res: Response): Promise<void> => {
  try {
    const requestedType = typeof req.query.type === 'string' ? req.query.type : undefined;
    if (requestedType && !['community', 'emergency'].includes(requestedType)) {
      res.status(400).json({ error: 'Report type must be community or emergency.' });
      return;
    }

    // Primary: read from dedicated barangay_reports table
    const { data: allData, error: newError } = await supabaseAdmin
      .from('barangay_reports')
      .select('*')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (newError) throw newError;

    const mdrrmoHandled = (report: any) => {
      const routeText = `${report.specifics || ''}\n${report.description || ''}`;
      const mdrrmoStatus = String(report.mdrrmo_response_status || report.response_status || '').toLowerCase();
      return report.send_to === 'mdrrmo' ||
        /\[SEND_TO:mdrrmo\]/i.test(routeText) ||
        String(report.status || '').toLowerCase() === 'escalated' ||
        ['responding', 'resolved'].includes(mdrrmoStatus) ||
        String(report.barangay_response_status || report.response_notes || '').toLowerCase().includes('escalated');
    };
    const barangayHandledReports = allData.filter(
      (report: any) => !mdrrmoHandled(report),
    );
    const resolvedReports = barangayHandledReports.filter(isReportResolved);
    const selectedReports = requestedType
      ? resolvedReports.filter((report: any) => report.type === requestedType)
      : resolvedReports;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const sixMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const monthlyVolume = Array.from({ length: 6 }, (_, index) => {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
      const year = month.getUTCFullYear();
      const monthNumber = month.getUTCMonth() + 1;
      return {
        period: `${year}-${String(monthNumber).padStart(2, '0')}`,
        label: monthNames[month.getUTCMonth()],
        community: 0,
        emergency: 0,
      };
    });
    const recentReports = (barangayHandledReports as any[]).filter((report) => {
      const createdAt = new Date(report.created_at);
      return Number.isFinite(createdAt.getTime()) && createdAt >= sixMonthStart && createdAt <= now;
    });
    const categoryCounts = new Map<string, { label: string; count: number }>();
    for (const report of recentReports) {
      const label = String(report.specifics || report.title || 'Unspecified').trim() || 'Unspecified';
      const key = label.toLowerCase();
      const existing = categoryCounts.get(key);
      if (existing) existing.count += 1;
      else categoryCounts.set(key, { label, count: 1 });
    }
    const sortedCategories = [...categoryCounts.values()].sort((a, b) => b.count - a.count);
    const topCategories = sortedCategories.slice(0, 8);
    const otherCategoryCount = sortedCategories
      .slice(8)
      .reduce((total, category) => total + category.count, 0);
    if (otherCategoryCount > 0) topCategories.push({ label: 'Other', count: otherCategoryCount });

    const statusDistribution = { pending: 0, responding: 0, resolved: 0 };
    for (const report of recentReports) {
      if (isReportResolved(report)) {
        statusDistribution.resolved += 1;
        continue;
      }
      const status = String(report.barangay_response_status || report.response_status || report.status || '').toLowerCase();
      if (['responding', 'in_progress', 'in progress', 'dispatched'].includes(status)) {
        statusDistribution.responding += 1;
      } else {
        statusDistribution.pending += 1;
      }
    }

    const activityHeatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const heatmapStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const philippinesOffsetMs = 8 * 60 * 60 * 1000;
    for (const report of barangayHandledReports as any[]) {
      const createdAt = new Date(report.created_at);
      if (!Number.isFinite(createdAt.getTime()) || createdAt < heatmapStart || createdAt > now) continue;
      const philippinesTime = new Date(createdAt.getTime() + philippinesOffsetMs);
      activityHeatmap[philippinesTime.getUTCDay()][philippinesTime.getUTCHours()] += 1;
    }

    const monthIndexes = new Map<string, number>(
      monthlyVolume.map((month, index) => [month.period, index] as const),
    );
    for (const report of barangayHandledReports as any[]) {
      if (report.type !== 'community' && report.type !== 'emergency') continue;
      const createdAt = new Date(report.created_at);
      if (!Number.isFinite(createdAt.getTime())) continue;
      const period = `${createdAt.getUTCFullYear()}-${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
      const monthIndex = monthIndexes.get(period);
      if (monthIndex === undefined) continue;
      if (report.type === 'community') monthlyVolume[monthIndex].community += 1;
      else monthlyVolume[monthIndex].emergency += 1;
    }
    const reports = selectedReports.map((report: any) => ({
      ...formatIncidentReport(report),
      timing_durations: reportStageDurations(report),
    }));

    res.json({
      barangay_id: req.barangayUser.barangayId,
      type: requestedType || 'all',
      report_count: reports.length,
      averages: summarizeReportTimings(selectedReports),
      report_volume_by_month: monthlyVolume,
      category_distribution: topCategories,
      status_distribution: statusDistribution,
      activity_heatmap: {
        timezone: 'Asia/Manila',
        weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        counts: activityHeatmap,
      },
      reports,
    });
  } catch (err) {
    console.error('Barangay report statistics error:', err);
    res.status(500).json({ error: 'Failed to fetch report statistics.' });
  }
});

// Admin and staff can open the originating barangay's resolved-report history.
// Operational response permissions still follow the current report route.
router.get('/reports/resolved', authenticateBarangay, requireRole(['admin', 'staff', 'dispatcher', 'responder']), async (req: any, res: Response): Promise<void> => {
  try {
    // Primary: barangay_reports
    const { data: combined, error: newError } = await supabaseAdmin
      .from('barangay_reports')
      .select('*')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('resolved_at', { ascending: false, nullsFirst: false })
      .limit(5000);
    if (newError) throw newError;

    const resolvedReports = combined.filter((report: any) =>
      report.response_status === 'resolved' ||
      report.barangay_response_status === 'resolved' ||
      (!report.barangay_response_status && !report.response_status && ['resolved', 'closed'].includes(String(report.status).toLowerCase())),
    );
    const residentIds = [...new Set(resolvedReports.map((report: any) => report.reporter_id).filter(Boolean))];
    const residents = new Map<string, any>();
    if (residentIds.length) {
      const { data: residentRows, error: residentError } = await supabaseAdmin
        .from('resident_user').select('id, full_name, phone, email').in('id', residentIds);
      if (residentError) throw residentError;
      for (const resident of residentRows || []) residents.set(resident.id, resident);
    }
    res.json(resolvedReports.map((report: any) => {
      const resident = residents.get(report.reporter_id);
      return formatIncidentReport({
        ...report,
        reporter_name: report.reporter_name || resident?.full_name || null,
        reporter_phone: report.reporter_phone || resident?.phone || null,
        reporter_email: report.reporter_email || resident?.email || null,
      });
    }));
  } catch (err) {
    console.error('Barangay resolved reports error:', err);
    res.status(500).json({ error: 'Failed to fetch resolved reports.' });
  }
});

router.get('/reports', authenticateBarangay, requireRole(['admin', 'dispatcher', 'responder']), async (req: any, res: Response) => {
  try {
    const { status } = req.query;

    let query = supabaseAdmin
      .from('barangay_reports')
      .select('*')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('created_at', { ascending: false });
    if (status) query = (query as any).eq('response_status', status);
    const { data, error: newError } = await query;
    if (newError) throw newError;

    // Some older resident profiles used their login email as a fallback contact.
    // Prefer the resident profile's actual phone when formatting contact details.
    const residentIds = [...new Set(data
      .filter((report: any) => report.reporter_type === 'resident' && report.reporter_id)
      .map((report: any) => report.reporter_id))];
    const residentContacts = new Map<string, { full_name: string | null; phone: string | null; email: string | null }>();
    if (residentIds.length > 0) {
      const { data: residents, error: residentsError } = await supabaseAdmin
        .from('resident_user')
        .select('id, full_name, phone, email')
        .in('id', residentIds);
      if (residentsError) throw residentsError;
      for (const resident of residents || []) {
        residentContacts.set(resident.id, { full_name: resident.full_name, phone: resident.phone, email: resident.email });
      }
    }

    const responderIds = new Set<string>();
    for (const report of data) {
      if (report.barangay_responded_by || report.responded_by) responderIds.add(report.barangay_responded_by || report.responded_by);
      const notes = report.barangay_response_notes || report.response_notes || '';
      if (notes) {
        const match = notes.match(/\[ASSIGNED:([^\]]+)\]/);
        if (match && match[1]) {
          match[1].split(',').forEach((id: string) => {
            const cleanId = id.trim();
            if (cleanId) responderIds.add(cleanId);
          });
        }
      }
    }

    const responderNames = new Map<string, string>();
    const idList = Array.from(responderIds);
    if (idList.length > 0) {
      const { data: responders, error: responderError } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name')
        .in('id', idList);
      if (responderError) throw responderError;
      for (const responder of responders || []) {
        responderNames.set(responder.id, responder.full_name);
      }
    }

    res.json(data.map((report: any) => {
      let assignedIds: string[] = [];
      const notes = report.barangay_response_notes || report.response_notes || '';
      if (notes) {
        const match = notes.match(/\[ASSIGNED:([^\]]+)\]/);
        if (match && match[1]) {
          assignedIds = match[1].split(',').map((id: string) => id.trim()).filter(Boolean);
        }
      }
      const primaryResponder = report.barangay_responded_by || report.responded_by;
      if (primaryResponder && !assignedIds.includes(primaryResponder)) {
        assignedIds.unshift(primaryResponder);
      }

      let responderName: string | null = null;
      if (assignedIds.length > 0) {
        const names = assignedIds.map(id => responderNames.get(id)).filter(Boolean);
        if (names.length > 0) responderName = names.join(', ');
      }

      const resident = report.reporter_id ? residentContacts.get(report.reporter_id) : null;
      const reporterPhone = typeof report.reporter_phone === 'string' && !report.reporter_phone.includes('@')
        ? report.reporter_phone
        : (typeof resident?.phone === 'string' && !resident.phone.includes('@') ? resident.phone : null);
      const reporterEmail = report.reporter_email || resident?.email || (typeof report.reporter_phone === 'string' && report.reporter_phone.includes('@') ? report.reporter_phone : null);

      return formatIncidentReport({
        ...report,
        reporter_name: report.reporter_name || resident?.full_name || null,
        reporter_phone: reporterPhone,
        reporter_email: reporterEmail,
        assigned_team_leader_ids: assignedIds,
        barangay_responder_name: responderName || responderNames.get(report.barangay_responded_by) || null,
      });
    }));
  } catch (err) {
    console.error('Fetch barangay reports error:', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// ─── POST /api/barangay/reports/:id/field-media ──────────────────────────────
// Attach field photo / video from responder or responder

router.post('/reports/:id/field-media', authenticateBarangay, requireRole(['dispatcher', 'responder']), upload.single('media'), async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    if (!['responder', 'dispatcher'].includes(req.barangayUser.role)) {
      res.status(403).json({ error: 'Only response staff can upload field documentation.' });
      return;
    }
    const { data: reportAccess, error: accessError } = await supabaseAdmin
      .from('barangay_reports').select('response_notes, responded_by, response_status')
      .eq('id', id).eq('barangay_id', req.barangayUser.barangayId).maybeSingle();
    if (accessError) throw accessError;
    if (!reportAccess) { res.status(404).json({ error: 'Incident report not found.' }); return; }
    if (reportAccess.response_status === 'resolved') { res.status(409).json({ error: 'Resolved incidents cannot receive new field media.' }); return; }
    if (req.barangayUser.role === 'responder') {
      const assigned = (reportAccess.response_notes || '').match(/^\[ASSIGNED:([^\]]+)\]/)?.[1]
        ?.split(',').map((value: string) => value.trim()) || [];
      if (reportAccess.responded_by !== req.barangayUser.userId && !assigned.includes(req.barangayUser.userId)) {
        res.status(403).json({ error: 'This incident has not been assigned to your responder account.' });
        return;
      }
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No media file provided.' });
      return;
    }

    const { type } = req.body;
    const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const isVideo = type === 'video' || (file.mimetype && file.mimetype.startsWith('video/')) || ['mp4', 'mov', 'webm', '3gp', 'mkv', 'avi'].includes(ext);
    const mediaType = isVideo ? 'video' : 'image';
    const timestamp = Date.now();
    const filename = `reports/field-media/${id}_${timestamp}.${ext}`;

    const { error: uploadError } = await supabaseAdmin
      .storage
      .from(config.supabaseBucketName)
      .upload(filename, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (uploadError) {
      console.error('Field media upload error:', uploadError);
      res.status(500).json({ error: 'Failed to upload media file.' });
      return;
    }

    const { data: { publicUrl } } = supabaseAdmin
      .storage
      .from(config.supabaseBucketName)
      .getPublicUrl(filename);

    const { data: userRow } = await supabaseAdmin
      .from('barangay_users')
      .select('full_name, role')
      .eq('id', req.barangayUser.userId)
      .maybeSingle();

    const uploaderName = userRow?.full_name || 'Responder';
    const uploaderRole = userRow?.role || req.barangayUser.role || 'responder';

    const newMediaItem = {
      id: `media_${timestamp}`,
      url: publicUrl,
      type: mediaType,
      uploader_id: req.barangayUser.userId,
      uploader_name: uploaderName,
      role: uploaderRole,
      created_at: new Date().toISOString()
    };

    const { data: currentReport, error: fetchErr } = await supabaseAdmin
      .from('barangay_reports')
      .select('*')
      .eq('id', id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .single();

    if (fetchErr || !currentReport) {
      res.status(404).json({ error: 'Incident report not found.' });
      return;
    }

    const formattedCurrent = formatIncidentReport(currentReport);
    const existingMedia = formattedCurrent.responder_media || [];
    const updatedMedia = [...existingMedia, newMediaItem];

    const { data: updatedReport, error: updateErr } = await supabaseAdmin
      .from('barangay_reports')
      .update({
        responder_media: updatedMedia,
        lifecycle_actor_id: req.barangayUser.userId,
        lifecycle_actor_role: req.barangayUser.role === 'dispatcher' ? 'barangay_dispatcher' : 'barangay_responder',
      })
      .eq('id', id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select('*')
      .single();
    if (updateErr) throw updateErr;

    const formatted = formatIncidentReport(updatedReport);

    io.to('dashboard_staff').emit('incident_report:updated', formatted);
    if (formatted.barangay_id) {
      io.to(`barangay:${formatted.barangay_id}`).emit('incident_report:updated', formatted);
      io.to(`barangay:${formatted.barangay_id}`).emit('barangay:report_updated', formatted);
    }

    res.json(formatted);
  } catch (err) {
    console.error('Attach field media error in barangay route:', err);
    res.status(500).json({ error: 'Internal server error while attaching field media.' });
  }
});

// ─── PATCH /api/barangay/reports/:id/dispatch ───────────────────────────────
// Dispatcher assigns an incident to one or more responders.

router.patch('/reports/:id/dispatch', authenticateBarangay, requireRole(['dispatcher']), async (req: any, res: Response) => {
  try {
    const { team_leader_id, team_leader_ids, notes, incident_type, severity } = req.body;
    const validTypes = ['flash_flood', 'fire', 'earthquake', 'medical_emergency', 'typhoon', 'other'];
    const validSeverities = ['low', 'moderate', 'high', 'critical'];
    if (!validTypes.includes(incident_type) || !validSeverities.includes(severity)) {
      res.status(400).json({ error: 'Choose an incident type and severity before dispatching.' });
      return;
    }
    const ids: string[] = Array.isArray(team_leader_ids) && team_leader_ids.length > 0
      ? team_leader_ids
      : (team_leader_id ? [team_leader_id] : []);

    if (ids.length === 0) {
      res.status(400).json({ error: 'At least one responder ID is required' });
      return;
    }

    const { data: teamLeaders, error: tlErr } = await supabaseAdmin
      .from('barangay_users')
      .select('id, full_name')
      .in('id', ids)
      .eq('barangay_id', req.barangayUser.barangayId);

    if (tlErr || !teamLeaders || teamLeaders.length === 0) {
      res.status(404).json({ error: 'Team leader(s) not found' });
      return;
    }

    const primaryLeaderId = ids[0];
    const reviewedAndDispatchedAt = new Date().toISOString();
    const responderNames = teamLeaders.map((tl: any) => tl.full_name).join(', ');
    const cleanUserNotes = (notes || '').replace(/^\[ASSIGNED:[^\]]+\]\s*/, '').trim();
    const encodedNotes = ids.length > 1
      ? `[ASSIGNED:${ids.join(',')}] ${cleanUserNotes}`.trim()
      : (cleanUserNotes || null);

    // Update barangay_reports table
    const { data, error } = await supabaseAdmin
      .from('barangay_reports')
      .update({
        incident_type,
        severity,
        response_status: 'pending',
        response_notes: encodedNotes,
        responded_by: primaryLeaderId,
        responded_at: reviewedAndDispatchedAt,
        dispatched_at: reviewedAndDispatchedAt,
        lifecycle_actor_id: req.barangayUser.userId,
        lifecycle_actor_role: 'barangay_dispatcher',
      })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .single();

    if (error) throw error;

    const { data: bData } = await supabaseAdmin
      .from('barangays')
      .select('name')
      .eq('id', req.barangayUser.barangayId)
      .maybeSingle();

    const barangayName = bData?.name || 'Barangay';

    const payload = {
      ...data,
      barangay_name: barangayName,
      barangay_response_status: 'pending',
      incident_type,
      severity,
      barangay_responded_by: primaryLeaderId,
      assigned_team_leader_ids: ids,
      barangay_responder_name: responderNames,
    };

    io.to('dashboard_staff').emit('incident_report:updated', payload);
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('barangay:report_updated', payload);

    res.json(payload);
  } catch (err) {
    console.error('Dispatch report error:', err);
    res.status(500).json({ error: 'Failed to dispatch report' });
  }
});

// ─── PATCH /api/barangay/reports/:id/escalate ───────────────────────────────
// Dispatcher escalates a report to MDRRMO with reason notes.

router.patch('/reports/:id/escalate', authenticateBarangay, requireRole(['dispatcher']), async (req: any, res: Response) => {
  try {
    const { notes } = req.body;
    if (!notes || !notes.trim()) {
      res.status(400).json({ error: 'Escalation notes are required' });
      return;
    }

    // Fetch from barangay_reports
    let assignedReport: any = null;
    const { data: newRow, error: newRowErr } = await supabaseAdmin
      .from('barangay_reports')
      .select('id, status, response_status, incident_type, severity, resolved_at, responded_by, response_notes, coordination_notes, dispatched_at, accepted_at')
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .maybeSingle();
    if (newRowErr) throw newRowErr;
    if (newRow) {
      assignedReport = {
        ...newRow,
        barangay_response_status: newRow.response_status,
        barangay_resolved_at: newRow.resolved_at,
        barangay_responded_by: newRow.responded_by,
        barangay_response_notes: newRow.response_notes,
        mdrrmo_coordination_notes: newRow.coordination_notes,
        mdrrmo_dispatched_at: null, mdrrmo_accepted_at: null, mdrrmo_arrived_at: null, mdrrmo_resolved_at: null,
        mdrrmo_response_status: null,
      };
    }
    if (!assignedReport) {
      res.status(404).json({ error: 'Incident report not found in this barangay.' });
      return;
    }
    if (assignedReport.barangay_response_status === 'resolved' || assignedReport.barangay_resolved_at) {
      res.status(409).json({ error: 'A resolved Barangay response cannot be escalated.' });
      return;
    }
    if (assignedReport.review_outcome || ['resolved', 'closed', 'rejected'].includes(String(assignedReport.status || '').toLowerCase())) {
      res.status(409).json({ error: 'A reviewed or resolved incident cannot be escalated.' });
      return;
    }
    if (assignedReport.mdrrmo_dispatched_at || assignedReport.mdrrmo_accepted_at || assignedReport.mdrrmo_arrived_at ||
        assignedReport.mdrrmo_resolved_at || ['responding', 'resolved'].includes(String(assignedReport.mdrrmo_response_status || '').toLowerCase())) {
      res.status(409).json({ error: 'The MDRRMO response cycle has already started.' });
      return;
    }
    if (!assignedReport.incident_type || !assignedReport.severity) {
      res.status(409).json({ error: 'Classify the incident type and severity before escalating it to MDRRMO.' });
      return;
    }
    const hasAssignedResponder = Boolean(assignedReport.barangay_responded_by) ||
      Boolean(assignedReport.barangay_response_notes?.match(/^\[ASSIGNED:[^\]]+\]/));
    if (!hasAssignedResponder) {
      res.status(409).json({ error: 'Dispatch a responder before escalating this incident to MDRRMO.' });
      return;
    }

    const escalationNotes = notes.trim();
    const now = new Date().toISOString();

    const isReceivedByBarangayResponder = Boolean(assignedReport.barangay_accepted_at) ||
      Boolean(assignedReport.accepted_at) ||
      Boolean(assignedReport.barangay_responded_by);

    const barangayReportsUpdate: any = {
      status: 'escalated',
      coordination_notes: escalationNotes,
      escalated_to_mdrrmo: true,
      escalated_at: now,
      lifecycle_actor_id: req.barangayUser.userId,
      lifecycle_actor_role: 'barangay_dispatcher',
    };

    if (isReceivedByBarangayResponder) {
      barangayReportsUpdate.response_status = 'resolved';
      barangayReportsUpdate.resolved_at = assignedReport.barangay_resolved_at ||
        assignedReport.barangay_accepted_at ||
        assignedReport.accepted_at ||
        now;
      barangayReportsUpdate.resolved_notes = `Escalated to MDRRMO: ${escalationNotes}`;
    }

    // Write escalation status to barangay_reports
    const { data, error } = await supabaseAdmin
      .from('barangay_reports')
      .update(barangayReportsUpdate)
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) { res.status(409).json({ error: 'The report lifecycle changed. Refresh before escalating.' }); return; }

    // Upsert into mdrrmo_reports so MDRRMO can pick it up
    const { data: barangayRow } = await supabaseAdmin
      .from('barangay_reports')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (barangayRow) {
      await supabaseAdmin
        .from('mdrrmo_reports')
        .upsert({
          id: barangayRow.id,
          source_type: 'escalated',
          type: barangayRow.type,
          title: barangayRow.title,
          specifics: barangayRow.specifics,
          description: barangayRow.description,
          latitude: barangayRow.latitude,
          longitude: barangayRow.longitude,
          address: barangayRow.address,
          incident_occurred_at: barangayRow.incident_occurred_at,
          incident_type: barangayRow.incident_type,
          severity: barangayRow.severity,
          reporter_id: barangayRow.reporter_id,
          reporter_type: barangayRow.reporter_type,
          reporter_name: barangayRow.reporter_name,
          reporter_phone: barangayRow.reporter_phone,
          reporter_email: barangayRow.reporter_email,
          barangay_id: barangayRow.barangay_id,
          coordination_notes: escalationNotes,
          response_status: 'pending',
          lifecycle_actor_id: req.barangayUser.userId,
          lifecycle_actor_role: 'barangay_dispatcher',
          created_at: barangayRow.created_at,
        }, { onConflict: 'id', ignoreDuplicates: false });
    }

    const { data: bData } = await supabaseAdmin
      .from('barangays')
      .select('name')
      .eq('id', req.barangayUser.barangayId)
      .maybeSingle();

    const barangayName = bData?.name || 'Barangay';

    io.to('dashboard_staff').emit('barangay:escalated', {
      reportId: req.params.id,
      barangayId: req.barangayUser.barangayId,
      barangayName: barangayName,
      notes: escalationNotes,
      incidentType: assignedReport.incident_type,
      severity: assignedReport.severity,
    });

    const updatePayload = {
      ...data,
      is_escalated: true,
      barangay_name: barangayName,
      mdrrmo_coordination_notes: escalationNotes,
      mdrrmo_response_status: 'pending',
      incident_type: assignedReport.incident_type,
      severity: assignedReport.severity,
    };
    io.to('dashboard_staff').emit('incident_report:updated', updatePayload);
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('barangay:report_updated', updatePayload);

    res.json({
      ...data,
      barangay_name: barangayName,
      mdrrmo_coordination_notes: escalationNotes,
      mdrrmo_response_status: 'pending',
      incident_type: assignedReport.incident_type,
      severity: assignedReport.severity,
    });
  } catch (err) {
    console.error('Escalate report error:', err);
    res.status(500).json({ error: 'Failed to escalate report' });
  }
});

// ─── PATCH /api/barangay/reports/:id/respond ────────────────────────────────
// Mark initial response dispatched or accepted by responder

router.patch('/reports/:id/respond', authenticateBarangay, requireRole(['dispatcher', 'responder']), async (req: any, res: Response) => {
  try {
    const schema = z.object({
      notes: z.string().nullable().optional(),
      mdrrmo_notes: z.string().nullable().optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      accuracy_m: z.number().min(0).optional(),
      fix_at: z.string().optional(),
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid response details.', details: parsed.error.flatten() });
      return;
    }
    const { notes, mdrrmo_notes, latitude, longitude, accuracy_m, fix_at } = parsed.data;
    if ((latitude === undefined) !== (longitude === undefined)) {
      res.status(400).json({ error: 'Send both GPS coordinates or neither.' });
      return;
    }
    const { data: currentReport, error: currentError } = await supabaseAdmin
      .from('barangay_reports')
      .select('*')
      .eq('id', req.params.id).eq('barangay_id', req.barangayUser.barangayId).maybeSingle();
    if (currentError) throw currentError;
    if (!currentReport) { res.status(404).json({ error: 'Incident report not found' }); return; }
    const currentNotes = currentReport.response_notes || currentReport.barangay_response_notes || '';
    const assignedMatch = currentNotes.match(/^\[ASSIGNED:([^\]]+)\]/);
    const assignedIds = assignedMatch ? assignedMatch[1].split(',').map((id: string) => id.trim()) : [];
    if (req.barangayUser.role === 'responder') {
      const respondedBy = currentReport.responded_by || currentReport.barangay_responded_by;
      if (respondedBy !== req.barangayUser.userId && !assignedIds.includes(req.barangayUser.userId)) {
        res.status(403).json({ error: 'This incident has not been assigned to your responder account' }); return;
      }
    }
    const actionAt = new Date().toISOString();
    const updatePayload: any = {
      barangay_response_status: 'responding',
      barangay_responded_by: req.barangayUser.userId,
      barangay_responded_at: actionAt,
      lifecycle_actor_id: req.barangayUser.userId,
      lifecycle_actor_role: req.barangayUser.role === 'dispatcher' ? 'barangay_dispatcher' : 'barangay_responder',
    };
    if (req.barangayUser.role === 'responder') {
      updatePayload.accepted_at = currentReport.accepted_at || actionAt;
      updatePayload.barangay_accepted_at = currentReport.accepted_at || actionAt;
    }
    if (req.barangayUser.role === 'responder' && !currentReport.accepted_at &&
        latitude !== undefined && longitude !== undefined && accuracy_m !== undefined && fix_at) {
      const fixAt = new Date(fix_at);
      const fix = { latitude, longitude, accuracyM: accuracy_m, fixAt };
      const validFix = validateRecentGpsFix(fix);
      if (validFix.valid && currentReport.latitude != null && currentReport.longitude != null) {
        updatePayload.travel_distance_m = Math.round(
          distanceMeters(currentReport.latitude, currentReport.longitude, latitude, longitude) * 10,
        ) / 10;
        updatePayload.travel_distance_accuracy_m = Math.round(accuracy_m * 10) / 10;
        updatePayload.travel_distance_fix_at = new Date(Math.min(fixAt.getTime(), Date.now())).toISOString();
      }
    }
    if (notes !== undefined && notes !== null) {
      const assignmentMarker = currentNotes.match(/^\[ASSIGNED:[^\]]+\]/)?.[0];
      updatePayload.barangay_response_notes = [assignmentMarker, notes].filter(Boolean).join(' ');
    }
    if (mdrrmo_notes !== undefined && mdrrmo_notes !== null) {
      updatePayload.mdrrmo_coordination_notes = mdrrmo_notes;
    }

    // Update barangay_reports
    const isEscalatedReport = String(currentReport.status || '').toLowerCase() === 'escalated' ||
      Boolean((currentReport as any).is_escalated);

    const barangayReportsUpdate: any = {
      response_status: isEscalatedReport ? 'resolved' : 'responding',
      responded_by: req.barangayUser.userId,
      responded_at: updatePayload.barangay_responded_at,
      accepted_at: updatePayload.barangay_accepted_at || null,
      response_notes: updatePayload.barangay_response_notes || null,
      lifecycle_actor_id: req.barangayUser.userId,
      lifecycle_actor_role: updatePayload.lifecycle_actor_role,
    };

    if (isEscalatedReport) {
      barangayReportsUpdate.resolved_at = actionAt;
      barangayReportsUpdate.resolved_notes = 'Escalated to MDRRMO and received by barangay responder';
    }

    const { data, error } = await supabaseAdmin
      .from('barangay_reports')
      .update(barangayReportsUpdate)
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .single();

    if (error) throw error;

    const { data: responder } = await supabaseAdmin
      .from('barangay_users')
      .select('full_name')
      .eq('id', req.barangayUser.userId)
      .maybeSingle();

    const { data: bData } = await supabaseAdmin
      .from('barangays')
      .select('name')
      .eq('id', req.barangayUser.barangayId)
      .maybeSingle();

    const barangayName = bData?.name || 'Barangay';
    const responderName = responder?.full_name || 'Barangay Responder';

    // Notify MDRRMO dashboard
    io.to('dashboard_staff').emit('barangay:responding', {
      reportId: req.params.id,
      barangayId: req.barangayUser.barangayId,
      barangayName: barangayName,
      responderName: responderName,
      notes: updatePayload.barangay_response_notes,
    });

    const responseStatus = isEscalatedReport ? 'resolved' : 'responding';
    const payload = formatIncidentReport({
      ...data,
      barangay_name: barangayName,
      barangay_responder_name: responderName,
      barangay_response_status: responseStatus,
      response_status: responseStatus,
    });

    io.to('dashboard_staff').emit('incident_report:updated', payload);
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('barangay:report_updated', payload);
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('incident:lifecycle', payload);

    res.json(payload);
  } catch (err) {
    console.error('Respond to report error:', err);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// ─── PATCH /api/barangay/reports/:id/arrive ─────────────────────────────────
// Record a manual arrival or a server-validated GPS arrival.
router.patch('/reports/:id/arrive', authenticateBarangay, requireRole(['responder']), async (req: any, res: Response) => {
  try {
    const schema = z.object({
      method: z.enum(['gps', 'manual']),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      accuracy_m: z.number().min(0).optional(),
      fix_at: z.string().optional(),
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid arrival details.', details: parsed.error.flatten() });
      return;
    }
    if ((parsed.data.latitude === undefined) !== (parsed.data.longitude === undefined)) {
      res.status(400).json({ error: 'Send both GPS coordinates or neither.' });
      return;
    }

    const { data: currentReport, error: fetchError } = await supabaseAdmin
      .from('barangay_reports')
      .select('*')
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!currentReport) {
      res.status(404).json({ error: 'Incident report not found.' });
      return;
    }

    const currentNotes = currentReport.response_notes || currentReport.barangay_response_notes || '';
    const assignedMatch = currentNotes.match(/^\[ASSIGNED:([^\]]+)\]/);
    const assignedIds = assignedMatch ? assignedMatch[1].split(',').map((id: string) => id.trim()) : [];
    const respondedBy = currentReport.responded_by || currentReport.barangay_responded_by;
    if (respondedBy !== req.barangayUser.userId && !assignedIds.includes(req.barangayUser.userId)) {
      res.status(403).json({ error: 'This incident has not been assigned to your responder account.' });
      return;
    }
    const currentStatus = currentReport.response_status || currentReport.barangay_response_status;
    if (currentReport.resolved_at || currentStatus !== 'responding') {
      res.status(409).json({ error: 'Accept the dispatch before marking arrival.' });
      return;
    }
    if (currentReport.arrived_at) {
      res.json({ ...currentReport, arrived_at: currentReport.arrived_at });
      return;
    }

    const now = new Date();
    let fixAt = now;
    let distanceM: number | null = null;
    let latitude: number | null = parsed.data.latitude ?? null;
    let longitude: number | null = parsed.data.longitude ?? null;
    let accuracyM: number | null = parsed.data.accuracy_m ?? null;

    if (parsed.data.method === 'gps') {
      if (latitude === null || longitude === null || accuracyM === null || !parsed.data.fix_at) {
        res.status(400).json({ error: 'GPS arrival requires coordinates, accuracy, and fix time.' });
        return;
      }
      const parsedFixAt = new Date(parsed.data.fix_at);
      if (Number.isNaN(parsedFixAt.getTime())) {
        res.status(400).json({ error: 'GPS fix time is invalid.' });
        return;
      }
      const validation = validateArrivalFix(
        currentReport.latitude,
        currentReport.longitude,
        { latitude, longitude, accuracyM, fixAt: parsedFixAt },
        now,
      );
      if (!validation.valid) {
        res.status(422).json({
          error: validation.error,
          distance_m: Math.round(validation.distanceM),
          arrival_radius_m: ARRIVAL_RADIUS_METERS,
        });
        return;
      }
      fixAt = new Date(Math.min(parsedFixAt.getTime(), now.getTime()));
      distanceM = validation.distanceM;
    } else if (latitude !== null && longitude !== null) {
      distanceM = validateArrivalFix(
        currentReport.latitude,
        currentReport.longitude,
        { latitude, longitude, accuracyM: accuracyM ?? 0, fixAt: now },
        now,
      ).distanceM;
    }

    const updatePayload = {
      accepted_at: currentReport.accepted_at || now.toISOString(),
      arrived_at: fixAt.toISOString(),
      arrival_recorded_at: now.toISOString(),
      arrival_method: parsed.data.method,
      arrival_latitude: latitude,
      arrival_longitude: longitude,
      arrival_accuracy_m: accuracyM,
      arrival_distance_m: distanceM === null ? null : Math.round(distanceM * 10) / 10,
      lifecycle_actor_id: req.barangayUser.userId,
      lifecycle_actor_role: 'barangay_responder',
    };

    // Update barangay_reports
    const { data: updated, error } = await supabaseAdmin
      .from('barangay_reports')
      .update(updatePayload)
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .single();

    if (error) throw error;
    const formatted = formatIncidentReport(updated);
    io.to('dashboard_staff').emit('incident_report:updated', formatted);
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('barangay:report_updated', formatted);
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('incident:lifecycle', formatted);
    res.json(formatted);
  } catch (err) {
    console.error('Mark report arrival error:', err);
    res.status(500).json({ error: 'Failed to record arrival.' });
  }
});

// ─── POST /api/barangay/reports/:id/close ───────────────────────────────────
// Close and record the incident

router.post('/reports/:id/close', authenticateBarangay, requireRole(['dispatcher', 'responder']), async (req: any, res: Response) => {
  try {
    const { resolved_notes } = req.body;
    if (typeof resolved_notes !== 'string' || !resolved_notes.trim()) {
      res.status(400).json({ error: 'A resolution summary is required to close the incident' });
      return;
    }

    const { data: currentReport, error: accessError } = await supabaseAdmin
      .from('barangay_reports')
      .select('*')
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .maybeSingle();
    if (accessError) throw accessError;
    if (!currentReport) {
      res.status(404).json({ error: 'Incident report not found' });
      return;
    }

    const currentNotes = currentReport.response_notes || currentReport.barangay_response_notes || '';
    const assignedMatch = currentNotes.match(/^\[ASSIGNED:([^\]]+)\]/);
    const assignedIds = assignedMatch ? assignedMatch[1].split(',').map((id: string) => id.trim()) : [];
    const currentStatus = currentReport.response_status || currentReport.barangay_response_status;
    const respondedBy = currentReport.responded_by || currentReport.barangay_responded_by;
    const resolvedAtOld = currentReport.resolved_at || currentReport.barangay_resolved_at;
    const hasBarangayCycle = currentStatus === 'responding' ||
      currentStatus === 'resolved' ||
      Boolean(respondedBy) || assignedIds.length > 0 ||
      Boolean(resolvedAtOld);
    if (!hasBarangayCycle) {
      res.status(403).json({ error: 'This report is being handled by MDRRMO and must be resolved by its dispatcher or responder.' });
      return;
    }
    if (currentStatus === 'resolved' || resolvedAtOld) {
      res.status(409).json({ error: 'The Barangay response cycle is already resolved.' });
      return;
    }

    const barangayArrivalAt = currentReport.arrived_at || currentReport.barangay_arrived_at;
    if (!barangayArrivalAt) {
      res.status(409).json({ error: 'Mark the responder as arrived before resolving the incident.' });
      return;
    }

    if (req.barangayUser.role === 'responder') {
      if (respondedBy !== req.barangayUser.userId && !assignedIds.includes(req.barangayUser.userId)) {
        res.status(403).json({ error: 'Only an assigned responder can close this incident' }); return;
      }
    }
    const missingFields = IncidentResolutionPdfService.missingFields(
      currentReport,
      'barangay',
      resolved_notes.trim(),
    );
    if (currentReport.mdrrmo_response_status === 'resolved') {
      missingFields.push(...IncidentResolutionPdfService.missingFields(currentReport, 'mdrrmo'));
    }
    if (missingFields.length) {
      res.status(409).json({
        error: `Complete the required report and field assessment details before resolving: ${missingFields.join(', ')}. Enter “Not applicable” where a section does not apply.`,
        missing_fields: missingFields,
      });
      return;
    }
    const resolvedAt = currentReport.resolved_at || currentReport.barangay_resolved_at || new Date().toISOString();
    const mdrrmoChannelEngaged = isDirectMdrrmoReport(currentReport) ||
      currentReport.status === 'escalated' || currentReport.is_escalated === true ||
      currentReport.beyond_barangay_capability === true ||
      currentReport.mdrrmo_dispatched_at != null ||
      ['responding', 'resolved'].includes(String(currentReport.mdrrmo_response_status || '').toLowerCase());
    const mdrrmoChannelStillOpen = mdrrmoChannelEngaged && currentReport.mdrrmo_response_status !== 'resolved';
    const allChannelsResolved = !mdrrmoChannelStillOpen;
    const overallStatus = allChannelsResolved
      ? 'resolved'
      : currentReport.mdrrmo_response_status === 'responding'
        ? 'responding'
        : currentReport.status === 'escalated' || currentReport.is_escalated === true || currentReport.beyond_barangay_capability === true
          ? 'escalated'
          : ['resolved', 'closed'].includes(String(currentReport.status || '').toLowerCase())
            ? (currentReport.mdrrmo_dispatched_at ? 'verified' : 'pending')
            : currentReport.status;

    // Update barangay_reports
    const { data, error } = await supabaseAdmin
      .from('barangay_reports')
      .update({
        response_status: 'resolved',
        resolved_notes: resolved_notes.trim(),
        resolved_at: resolvedAt,
        status: overallStatus,
        lifecycle_actor_id: req.barangayUser.userId,
        lifecycle_actor_role: req.barangayUser.role === 'dispatcher' ? 'barangay_dispatcher' : 'barangay_responder',
      })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(409).json({ error: 'The report lifecycle changed. Refresh the report before closing it.' });
      return;
    }

    let pdfReady = false;
    try {
      await IncidentResolutionPdfService.generateAndStore(req.params.id);
      pdfReady = true;
    } catch (pdfError) {
      console.error('Could not create incident resolution PDF after Barangay close:', pdfError);
      await supabaseAdmin.from('barangay_reports').update({ resolution_pdf_status: 'failed' }).eq('id', req.params.id);
    }

    io.to('dashboard_staff').emit('barangay:incident_closed', {
      reportId: req.params.id,
      barangayId: req.barangayUser.barangayId,
      resolvedAt: data.resolved_at,
    });
    const formattedClose = formatIncidentReport(data);
    io.to('dashboard_staff').emit('incident_report:updated', formattedClose);
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('barangay:report_updated', formattedClose);
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('incident:lifecycle', formattedClose);

    res.json({ ...formattedClose, resolution_pdf_status: pdfReady ? 'ready' : 'failed' });
  } catch (err) {
    console.error('Close report error:', err);
    res.status(500).json({ error: 'Failed to close report' });
  }
});

router.get('/reports/:id/resolution-pdf', authenticateBarangay, requireRole(['admin', 'staff', 'dispatcher', 'responder']), async (req: any, res: Response) => {
  try {
    const { data: report, error } = await supabaseAdmin
      .from('barangay_reports')
      .select('id, barangay_id, response_status, status')
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .maybeSingle();
    if (error) throw error;
    if (!report) { res.status(404).json({ error: 'Incident report not found.' }); return; }
    if (report.response_status !== 'resolved' && !['resolved', 'closed'].includes(String(report.status).toLowerCase())) {
      res.status(409).json({ error: 'This report has not been resolved yet.' }); return;
    }
    const pdf = await IncidentResolutionPdfService.generateAndStore(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="NorzAgapay_Incident_${req.params.id.slice(0, 8)}.pdf"`);
    res.setHeader('Content-Length', pdf.buffer.length);
    res.send(pdf.buffer);
  } catch (error) {
    if (error instanceof IncompleteResolutionReportError) {
      res.status(409).json({ error: error.message, missing_fields: error.missingFields });
      return;
    }
    console.error('Barangay incident PDF download error:', error);
    res.status(500).json({ error: 'Could not create or download the incident PDF.' });
  }
});

// ─── POST /api/barangay/assistance-requests ──────────────────────────────────
// Responder submits an assistance request to the Dispatcher

const assistanceRequestSchema = z.object({
  incident_report_id: z.string().uuid().nullable().optional(),
  incident_title: z.string().optional(),
  needs_more_manpower: z.boolean().optional(),
  needs_resources: z.boolean().optional(),
  needs_equipment: z.boolean().optional(),
  beyond_barangay_capability: z.boolean().optional(),
  explanation: z.string().min(10),
});

router.post('/assistance-requests', authenticateBarangay, requireRole(['responder']), async (req: any, res: Response) => {
  try {
    const parsed = assistanceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const linkedReportId = parsed.data.incident_report_id;
    if (parsed.data.beyond_barangay_capability && !linkedReportId) {
      res.status(400).json({ error: 'Link the incident report that needs MDRRMO review.' });
      return;
    }
    let linkedReportTitle = parsed.data.incident_title || null;
    if (linkedReportId) {
      const { data: linkedReport, error: linkedReportError } = await supabaseAdmin
        .from('barangay_reports')
        .select('id, title, responded_by, response_notes')
        .eq('id', linkedReportId)
        .eq('barangay_id', req.barangayUser.barangayId)
        .maybeSingle();
      if (linkedReportError) throw linkedReportError;
      if (!linkedReport) {
        res.status(404).json({ error: 'Linked incident report was not found in this barangay.' });
        return;
      }
      const currentNotes = linkedReport.response_notes || '';
      const assignedMatch = currentNotes.match(/^\[ASSIGNED:([^\]]+)\]/);
      const assignedIds = assignedMatch ? assignedMatch[1].split(',').map((id: string) => id.trim()) : [];
      if (linkedReport.responded_by !== req.barangayUser.userId && !assignedIds.includes(req.barangayUser.userId)) {
        res.status(403).json({ error: 'You can only request escalation for an incident assigned to your responder account.' });
        return;
      }
      linkedReportTitle = linkedReport.title || linkedReportTitle;
    }

    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .insert({
        barangay_id: req.barangayUser.barangayId,
        requested_by: req.barangayUser.userId,
        incident_report_id: linkedReportId || null,
        incident_title: linkedReportTitle,
        needs_more_manpower: parsed.data.needs_more_manpower || false,
        needs_resources: parsed.data.needs_resources || false,
        needs_equipment: parsed.data.needs_equipment || false,
        beyond_barangay_capability: parsed.data.beyond_barangay_capability || false,
        explanation: parsed.data.explanation,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Create assistance request error:', error);
      res.status(500).json({ error: 'Failed to submit assistance request.' });
      return;
    }

// Notify dispatcher via socket
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:new_request', { request: data });

    res.status(201).json({ message: 'Assistance request submitted successfully.', request: data });
  } catch (err) {
    console.error('Create assistance request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /api/barangay/assistance-requests ───────────────────────────────────
// Dispatcher views all assistance requests for their barangay

router.get('/assistance-requests', authenticateBarangay, requireRole(['dispatcher']), async (req: any, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .select('*, requested_by_user:barangay_users!requested_by(full_name, role), decided_by_user:barangay_users!decided_by(full_name, role)')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch assistance requests error:', error);
      res.status(500).json({ error: 'Failed to fetch assistance requests.' });
      return;
    }

    res.json({ requests: data || [] });
  } catch (err) {
    console.error('Fetch assistance requests error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /api/barangay/my-assistance-requests ────────────────────────────────
// Responder views their own submitted requests

router.get('/my-assistance-requests', authenticateBarangay, requireRole(['responder']), async (req: any, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .select('*, requested_by_user:barangay_users!requested_by(full_name, role), decided_by_user:barangay_users!decided_by(full_name, role)')
      .eq('requested_by', req.barangayUser.userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch my assistance requests error:', error);
      res.status(500).json({ error: 'Failed to fetch your assistance requests.' });
      return;
    }

    res.json({ requests: data || [] });
  } catch (err) {
    console.error('Fetch my assistance requests error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── PATCH /api/barangay/assistance-requests/:id/edit ────────────────────────
// Responder edits their own assistance request

router.patch('/assistance-requests/:id/edit', authenticateBarangay, requireRole(['responder']), async (req: any, res: Response) => {
  try {
    const parsed = assistanceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .update({
        needs_more_manpower: parsed.data.needs_more_manpower || false,
        needs_resources: parsed.data.needs_resources || false,
        needs_equipment: parsed.data.needs_equipment || false,
        beyond_barangay_capability: parsed.data.beyond_barangay_capability || false,
        explanation: parsed.data.explanation,
        status: 'pending',
      })
      .eq('id', req.params.id)
      .eq('requested_by', req.barangayUser.userId)
      .select('*, requested_by_user:barangay_users!requested_by(full_name, role), decided_by_user:barangay_users!decided_by(full_name, role)')
      .single();

    if (error || !data) {
      console.error('Edit assistance request error:', error);
      res.status(500).json({ error: 'Failed to update assistance request.' });
      return;
    }

// Notify dispatcher via socket
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:new_request', { request: data });

    res.json({ message: 'Assistance request updated successfully.', request: data });
  } catch (err) {
    console.error('Edit assistance request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── PATCH /api/barangay/assistance-requests/:id/decide ──────────────────────
// Dispatcher decides: provide_barangay_assistance or coordinate_mdrrmo

router.patch('/assistance-requests/:id/decide', authenticateBarangay, requireRole(['dispatcher']), async (req: any, res: Response) => {
  try {
    const { decision, dispatcher_notes } = req.body;
    const validDecisions = ['provide_barangay_assistance', 'coordinate_mdrrmo'];
    if (!validDecisions.includes(decision)) {
      res.status(400).json({ error: 'Invalid decision. Must be: provide_barangay_assistance or coordinate_mdrrmo.' });
      return;
    }

    const { data: assistanceRequest, error: requestError } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .select('*')
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!assistanceRequest) {
      res.status(404).json({ error: 'Assistance request not found in this barangay.' });
      return;
    }

    let linkedReport: any = null;
    if (decision === 'coordinate_mdrrmo' && assistanceRequest.incident_report_id) {
      const { data, error } = await supabaseAdmin
        .from('barangay_reports')
        .select('id, title, incident_type, severity, responded_by, response_notes')
        .eq('id', assistanceRequest.incident_report_id)
        .eq('barangay_id', req.barangayUser.barangayId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        res.status(404).json({ error: 'The incident linked to this assistance request was not found.' });
        return;
      }
      const currentNotes = data.response_notes || '';
      const hasAssignedResponder = Boolean(data.responded_by) ||
        Boolean(currentNotes.match(/^\[ASSIGNED:[^\]]+\]/));
      if (!data.incident_type || !data.severity || !hasAssignedResponder) {
        res.status(409).json({ error: 'Classify and dispatch a responder to the linked incident before escalating it.' });
        return;
      }
      linkedReport = data;
    }

    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .update({
        status: 'actioned',
        decision,
        dispatcher_notes: dispatcher_notes || null,
        decided_at: new Date().toISOString(),
        decided_by: req.barangayUser.userId,
      })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select('*, requested_by_user:barangay_users!requested_by(full_name, role), decided_by_user:barangay_users!decided_by(full_name, role)')
      .single();

    if (error) {
      console.error('Decide assistance request error:', error);
      res.status(500).json({ error: 'Failed to update assistance request.' });
      return;
    }

    // Notify responder via socket
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:decision', { request: data, decision });

    let escalatedReport: any = null;
    if (linkedReport) {
      const escalationNotes = (dispatcher_notes || assistanceRequest.explanation || 'MDRRMO support requested by the barangay response team').trim();
      const now = new Date().toISOString();
      const { data: reportData, error: reportError } = await supabaseAdmin
        .from('barangay_reports')
        .update({
          coordination_notes: escalationNotes,
          status: 'escalated',
          escalated_to_mdrrmo: true,
          escalated_at: now,
          response_status: 'resolved',
          resolved_at: now,
          resolved_notes: `Escalated to MDRRMO: ${escalationNotes}`,
        })
        .eq('id', linkedReport.id)
        .eq('barangay_id', req.barangayUser.barangayId)
        .select('*')
        .single();
      if (reportError) throw reportError;

      // Upsert into mdrrmo_reports
      await supabaseAdmin
        .from('mdrrmo_reports')
        .upsert({
          id: reportData.id,
          source_type: 'escalated',
          type: reportData.type,
          title: reportData.title,
          specifics: reportData.specifics,
          description: reportData.description,
          latitude: reportData.latitude,
          longitude: reportData.longitude,
          address: reportData.address,
          incident_occurred_at: reportData.incident_occurred_at,
          incident_type: reportData.incident_type,
          severity: reportData.severity,
          reporter_id: reportData.reporter_id,
          reporter_type: reportData.reporter_type,
          reporter_name: reportData.reporter_name,
          reporter_phone: reportData.reporter_phone,
          reporter_email: reportData.reporter_email,
          barangay_id: reportData.barangay_id,
          coordination_notes: escalationNotes,
          response_status: 'pending',
          created_at: reportData.created_at,
        }, { onConflict: 'id', ignoreDuplicates: false });

      const barangayName = reportData.barangays?.name || null;
      escalatedReport = {
        ...reportData,
        is_escalated: true,
        barangay_name: barangayName,
        incident_type: linkedReport.incident_type,
        severity: linkedReport.severity,
        mdrrmo_coordination_notes: escalationNotes,
        mdrrmo_response_status: 'pending',
      };
      io.to('dashboard_staff').emit('barangay:escalated', {
        reportId: linkedReport.id,
        barangayId: req.barangayUser.barangayId,
        barangayName,
        notes: escalationNotes,
        incidentType: linkedReport.incident_type,
        severity: linkedReport.severity,
      });
      io.to('dashboard_staff').emit('incident_report:updated', escalatedReport);
      io.to(`barangay:${req.barangayUser.barangayId}`).emit('barangay:report_updated', escalatedReport);
    }

    res.json({ message: `Request actioned: ${decision}.`, request: data, escalated_report: escalatedReport });
  } catch (err) {
    console.error('Decide assistance request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── PATCH /api/barangay/assistance-requests/:id/team-action ─────────────────
// Responder acknowledges or cancels their own request

router.patch('/assistance-requests/:id/team-action', authenticateBarangay, requireRole(['responder']), async (req: any, res: Response) => {
  try {
    const { action } = req.body;
    if (!['acknowledge', 'cancel'].includes(action)) {
      res.status(400).json({ error: 'Invalid action. Must be: acknowledge or cancel.' });
      return;
    }

    const updatePayload: Record<string, any> =
      action === 'cancel'
        ? { status: 'cancelled' }
        : { team_acknowledged: true };

    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .update(updatePayload)
      .eq('id', req.params.id)
      .eq('requested_by', req.barangayUser.userId)
      .select('*, requested_by_user:barangay_users!requested_by(full_name, role), decided_by_user:barangay_users!decided_by(full_name, role)')
      .single();

    if (error || !data) {
      console.error('Team action error:', error);
      res.status(500).json({ error: error?.message || 'Failed to update assistance request.' });
      return;
    }

    // Notify barangay room
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:team_action', { request: data, action });

    res.json({ message: `Request ${action}d.`, request: data });
  } catch (err: any) {
    console.error('Team action error:', err);
    res.status(500).json({ error: err?.message || 'Internal server error.' });
  }
});

// ─── Public Alerts / Broadcasts Routes ───────────────────────────────────────

// GET /api/barangay/broadcasts/mdrrmo
// Returns persistent municipality-wide MDRRMO broadcasts.
router.get('/broadcasts/mdrrmo', async (req: any, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .select('*, author:barangay_users!author_id(full_name), dashboard_author:users!author_user_id(full_name), barangay:barangays!barangay_id(name)')
      .eq('is_mdrrmo', true)
      .is('barangay_id', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Get MDRRMO broadcasts query error:', error);
      res.status(500).json({ error: 'Failed to fetch MDRRMO broadcasts.' });
      return;
    }

    const formatted = (data || []).map((b: any) => ({
      id: b.id,
      barangay_id: null,
      barangay_name: 'MDRRMO Norzagaray',
      author_id: b.author_user_id || b.author_id,
      author_name: b.dashboard_author?.full_name || b.author?.full_name || 'MDRRMO Command Center',
      category: b.category,
      content: b.content,
      links: b.links || [],
      media: b.media || [],
      created_at: b.created_at,
      updated_at: b.updated_at,
      is_mdrrmo: true,
      is_from_mdrrmo: true,
      is_pinned: b.is_pinned === true,
      reposted_by: b.reposted_by || null,
    }));

    res.json(formatted);
  } catch (err: any) {
    console.error('Get MDRRMO broadcasts error:', err);
    res.status(500).json({ error: 'Failed to fetch MDRRMO broadcasts.' });
  }
});

// POST /api/barangay/broadcasts/:id/repost
// Reposts an MDRRMO broadcast to a barangay feed
router.post('/broadcasts/:id/repost', authenticateBarangay, requireRole(['admin', 'staff']), async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('public_broadcasts')
      .select('*')
      .eq('id', id)
      .eq('is_mdrrmo', true)
      .is('barangay_id', null)
      .single();

    if (fetchErr || !original) {
      res.status(404).json({ error: 'MDRRMO broadcast not found.' });
      return;
    }

    const { data: priorRepost, error: priorError } = await supabaseAdmin
      .from('public_broadcasts')
      .select('*, author:barangay_users!author_id(full_name), barangay:barangays!barangay_id(name)')
      .eq('reposted_from_id', original.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .maybeSingle();
    if (priorError) throw priorError;
    if (priorRepost) {
      res.json({
        id: priorRepost.id,
        barangay_id: priorRepost.barangay_id,
        barangay_name: priorRepost.barangay?.name || 'Barangay',
        author_id: priorRepost.author_id,
        author_name: priorRepost.author?.full_name || 'Barangay Officer',
        category: priorRepost.category,
        content: priorRepost.content,
        links: priorRepost.links || [],
        media: priorRepost.media || [],
        created_at: priorRepost.created_at,
        updated_at: priorRepost.updated_at,
        is_mdrrmo: false,
        is_from_mdrrmo: true,
        is_pinned: priorRepost.is_pinned === true,
        reposted_by: priorRepost.reposted_by || null,
      });
      return;
    }

    const { data: author } = await supabaseAdmin
      .from('barangay_users')
      .select('full_name')
      .eq('id', req.barangayUser.userId)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .insert({
        barangay_id: req.barangayUser.barangayId,
        author_id: req.barangayUser.userId,
        category: original.category,
        content: original.content,
        links: original.links,
        media: original.media,
        is_mdrrmo: false,
        is_from_mdrrmo: true,
        reposted_by: author?.full_name || 'Barangay Staff',
        reposted_from_id: original.id,
      })
      .select('*, author:barangay_users!author_id(full_name), barangay:barangays!barangay_id(name)')
      .single();

    if (error || !data) {
      throw error || new Error('Failed to save the repost.');
    }

    res.status(201).json({
      id: data.id,
      barangay_id: data.barangay_id,
      barangay_name: data.barangay?.name || 'Barangay',
      author_id: data.author_id,
      author_name: data.author?.full_name || 'Barangay Officer',
      category: data.category,
      content: data.content,
      links: data.links || [],
      media: data.media || [],
      created_at: data.created_at,
      updated_at: data.updated_at,
      is_mdrrmo: false,
      is_from_mdrrmo: true,
      is_pinned: data.is_pinned === true,
      reposted_by: data.reposted_by || null,
    });
  } catch (err: any) {
    console.error('Repost broadcast error:', err);
    res.status(500).json({ error: 'Failed to repost broadcast' });
  }
});

// GET /api/barangay/broadcasts
router.get('/broadcasts', authenticateBarangay, async (req: any, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .select('*, author:barangay_users!author_id(full_name), barangay:barangays!barangay_id(name)')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching broadcasts:', error.message);
      res.status(500).json({ error: 'Failed to fetch barangay broadcasts.' });
      return;
    }

    const formatted = (data || []).map((b: any) => ({
      id: b.id,
      barangay_id: b.barangay_id,
      barangay_name: b.barangay?.name || 'Barangay',
      author_id: b.author_id,
      author_name: b.author?.full_name || 'Barangay Officer',
      category: b.category,
      content: b.content,
      links: b.links || [],
      media: b.media || [],
      created_at: b.created_at,
      updated_at: b.updated_at,
      is_mdrrmo: false,
      is_from_mdrrmo: b.is_from_mdrrmo === true,
      is_pinned: b.is_pinned === true,
      reposted_by: b.reposted_by || null,
    }));

    res.json(formatted);
  } catch (err: any) {
    console.error('Get broadcasts error:', err);
    res.status(500).json({ error: 'Failed to fetch barangay broadcasts.' });
  }
});

// PATCH /api/barangay/broadcasts/:id/pin
router.patch('/broadcasts/:id/pin', authenticateBarangay, requireRole(['admin', 'staff']), async (req: any, res: Response) => {
  if (typeof req.body?.is_pinned !== 'boolean') {
    res.status(400).json({ error: 'is_pinned must be a boolean.' });
    return;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .update({ is_pinned: req.body.is_pinned, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select('*, author:barangay_users!author_id(full_name), barangay:barangays!barangay_id(name)')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Barangay broadcast not found.' });
      return;
    }
    res.json({
      id: data.id,
      barangay_id: data.barangay_id,
      barangay_name: data.barangay?.name || 'Barangay',
      author_id: data.author_id,
      author_name: data.author?.full_name || 'Barangay Officer',
      category: data.category,
      content: data.content,
      links: data.links || [],
      media: data.media || [],
      created_at: data.created_at,
      updated_at: data.updated_at,
      is_mdrrmo: false,
      is_from_mdrrmo: data.is_from_mdrrmo === true,
      is_pinned: data.is_pinned === true,
      reposted_by: data.reposted_by || null,
    });
  } catch (err: any) {
    console.error('Update barangay broadcast pinned status error:', err);
    res.status(500).json({ error: err?.message || 'Failed to update pinned status.' });
  }
});

// POST /api/barangay/broadcasts
router.post('/broadcasts', authenticateBarangay, requireRole(['admin', 'staff']), upload.array('media'), async (req: any, res: Response) => {
  try {
    const { category, content, links } = req.body;
    let parsedLinks: string[] = [];
    if (typeof links === 'string') {
      try {
        parsedLinks = JSON.parse(links);
      } catch {
        parsedLinks = links ? [links] : [];
      }
    } else if (Array.isArray(links)) {
      parsedLinks = links;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    const mediaItems: Array<{ url: string; type: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = (req.body[`media_type_${i}`] === 'video') ||
        file.mimetype.startsWith('video/') ||
        file.originalname.toLowerCase().endsWith('.mp4');

      const ext = path.extname(file.originalname) || (isVideo ? '.mp4' : '.jpg');
      const filename = `broadcasts/${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;

      const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
        .from('incident-media')
        .upload(filename, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (!uploadErr && uploadData) {
        const { data: publicUrlData } = supabaseAdmin.storage
          .from('incident-media')
          .getPublicUrl(filename);
        mediaItems.push({
          url: publicUrlData.publicUrl,
          type: isVideo ? 'video' : 'image',
        });
      } else {
        throw uploadErr || new Error('Could not upload broadcast media.');
      }
    }

    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .insert({
        barangay_id: req.barangayUser.barangayId,
        author_id: req.barangayUser.userId,
        category: category || 'safety_advisory',
        content: content || '',
        links: parsedLinks,
        media: mediaItems,
      })
      .select('*, author:barangay_users!author_id(full_name), barangay:barangays!barangay_id(name)')
      .single();

    if (error || !data) {
      console.warn('Broadcast insert error:', error?.message);
      res.status(500).json({ error: error?.message || 'Failed to save the broadcast.' });
      return;
    }

    // Broadcast through socket to all residents & barangay users
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('broadcast:new', data);

    res.status(201).json({
      id: data.id,
      barangay_id: data.barangay_id,
      barangay_name: data.barangay?.name || 'Barangay',
      author_id: data.author_id,
      author_name: data.author?.full_name || 'Barangay Officer',
      category: data.category,
      content: data.content,
      links: data.links || [],
      media: data.media || [],
      created_at: data.created_at,
      updated_at: data.updated_at,
      is_mdrrmo: false,
      is_from_mdrrmo: data.is_from_mdrrmo === true,
      is_pinned: data.is_pinned === true,
      reposted_by: data.reposted_by || null,
    });
  } catch (err: any) {
    console.error('Create broadcast error:', err);
    res.status(500).json({ error: err?.message || 'Failed to create broadcast' });
  }
});

// PATCH /api/barangay/broadcasts/:id
router.patch('/broadcasts/:id', authenticateBarangay, requireRole(['admin', 'staff']), upload.array('media'), async (req: any, res: Response) => {
  try {
    const { category, content, links } = req.body;
    let parsedLinks: string[] = [];
    if (typeof links === 'string') {
      try {
        parsedLinks = JSON.parse(links);
      } catch {
        parsedLinks = links ? [links] : [];
      }
    } else if (Array.isArray(links)) {
      parsedLinks = links;
    }

    // Existing media from body
    let finalMedia: Array<{ url: string; type: string }> = [];
    if (req.body.existing_media) {
      try {
        finalMedia = typeof req.body.existing_media === 'string'
          ? JSON.parse(req.body.existing_media)
          : req.body.existing_media;
      } catch {
        finalMedia = [];
      }
    } else if (req.body.media) {
      try {
        finalMedia = typeof req.body.media === 'string'
          ? JSON.parse(req.body.media)
          : req.body.media;
      } catch {
        finalMedia = [];
      }
    }

    // New uploaded files
    const files = (req.files as Express.Multer.File[]) || [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = (req.body[`media_type_${i}`] === 'video') ||
        file.mimetype.startsWith('video/') ||
        file.originalname.toLowerCase().endsWith('.mp4');

      const ext = path.extname(file.originalname) || (isVideo ? '.mp4' : '.jpg');
      const filename = `broadcasts/${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;

      const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
        .from('incident-media')
        .upload(filename, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (!uploadErr && uploadData) {
        const { data: publicUrlData } = supabaseAdmin.storage
          .from('incident-media')
          .getPublicUrl(filename);
        finalMedia.push({
          url: publicUrlData.publicUrl,
          type: isVideo ? 'video' : 'image',
        });
      } else {
        throw uploadErr || new Error('Could not upload broadcast media.');
      }
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (category) updatePayload.category = category;
    if (content !== undefined) updatePayload.content = content;
    if (links !== undefined) updatePayload.links = parsedLinks;
    if (req.body.existing_media || req.body.media || files.length > 0) {
      updatePayload.media = finalMedia;
    }

    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .update(updatePayload)
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select('*, author:barangay_users!author_id(full_name), barangay:barangays!barangay_id(name)')
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message || 'Failed to update broadcast.' });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Barangay broadcast not found.' });
      return;
    }

    res.json({
      id: data.id,
      barangay_id: data.barangay_id,
      barangay_name: data.barangay?.name || 'Barangay',
      author_id: data.author_id,
      author_name: data.author?.full_name || 'Barangay Officer',
      category: data.category,
      content: data.content,
      links: data.links || [],
      media: data.media || [],
      created_at: data.created_at,
      updated_at: data.updated_at,
      is_mdrrmo: false,
      is_from_mdrrmo: data.is_from_mdrrmo === true,
      is_pinned: data.is_pinned === true,
      reposted_by: data.reposted_by || null,
    });
  } catch (err: any) {
    console.error('Update broadcast error:', err);
    res.status(500).json({ error: err?.message || 'Failed to update broadcast' });
  }
});

// DELETE /api/barangay/broadcasts/:id
router.delete('/broadcasts/:id', authenticateBarangay, requireRole(['admin', 'staff']), async (req: any, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .delete()
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select('id')
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message || 'Failed to delete broadcast.' });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Barangay broadcast not found.' });
      return;
    }

    res.status(200).json({ success: true, id: data.id, message: 'Broadcast deleted' });
  } catch (err: any) {
    console.error('Delete broadcast error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete broadcast' });
  }
});

export default router;
export { authenticateBarangay };
