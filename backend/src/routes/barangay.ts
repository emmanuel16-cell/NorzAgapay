import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, AuthRequest } from '../middleware/auth';
import { io } from '../server';
import { DispatcherVerificationService } from '../services/dispatcherVerificationService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ─── Middleware: Barangay Auth ───────────────────────────────────────────────

interface BarangayPayload {
  userId: string;
  barangayId: string;
  role: 'captain' | 'team_leader' | 'volunteer';
}

const authenticateBarangay = async (req: AuthRequest, res: Response, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (!decoded.barangayId) {
      res.status(403).json({ error: 'Not a barangay user token' });
      return;
    }
    (req as any).barangayUser = decoded;
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

// ─── GET /api/barangay/list ──────────────────────────────────────────────────
// Public: get all barangays (for dropdowns in resident app)

router.get('/list', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('barangays')
      .select('id, name, municipality, latitude, longitude')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Fetch barangays error:', err);
    res.status(500).json({ error: 'Failed to fetch barangays' });
  }
});

// ─── POST /api/barangay/register ────────────────────────────────────────────
// Register a new barangay dispatcher/captain

const registerSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  barangay_id: z.string().uuid(),
  position_designation: z.string().optional(),
  punong_barangay_name: z.string().optional(),
  punong_barangay_position: z.string().optional(),
});

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = registerSchema.parse(req.body);

    // Check if active captain already exists for this barangay
    const { data: existing } = await supabaseAdmin
      .from('barangay_users')
      .select('id, is_active')
      .eq('barangay_id', body.barangay_id)
      .eq('role', 'captain')
      .maybeSingle();

    if (existing && existing.is_active) {
      res.status(409).json({ error: 'An active captain already exists for this barangay. Contact them to add you as a member.' });
      return;
    }

    const password_hash = await bcrypt.hash(body.password, 12);
    // User is created with is_active: false (pending verification)
    const { data: user, error } = await supabaseAdmin
      .from('barangay_users')
      .insert({
        full_name: body.full_name,
        email: body.email,
        phone: body.phone || null,
        password_hash,
        barangay_id: body.barangay_id,
        role: 'captain',
        is_active: false,
      })
      .select('id, full_name, email, phone, role, barangay_id, is_active')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      throw error;
    }

    // Fetch barangay name
    const { data: barangay } = await supabaseAdmin
      .from('barangays')
      .select('name, municipality')
      .eq('id', user.barangay_id)
      .maybeSingle();

    const barangayName = barangay?.name || 'Barangay';

    // Create verification tracking record
    const verification = await DispatcherVerificationService.createVerification({
      userId: user.id,
      barangayId: user.barangay_id,
      barangayName,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      positionDesignation: body.position_designation || 'Barangay Dispatcher',
      punongBarangayName: body.punong_barangay_name || 'Punong Barangay / Authorized Barangay Official',
      punongBarangayPosition: body.punong_barangay_position || 'Punong Barangay',
    });

    const token = jwt.sign(
      { userId: user.id, barangayId: user.barangay_id, role: user.role, email: user.email },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    // Notify MDRRMO commanders of new pending dispatcher verification
    try {
      io.to('commanders').emit('verification:dispatcher_new', {
        id: verification.id,
        applicant: user.full_name,
        barangay: barangayName,
        reference_no: verification.reference_no,
      });
    } catch (_) {}

    res.status(201).json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        barangay_id: user.barangay_id,
        barangay_name: barangayName,
        municipality: barangay?.municipality || 'Norzagaray',
        is_active: false,
        verification_status: 'pending_document',
        verification,
      },
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error('Barangay register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/barangay/login ────────────────────────────────────────────────

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const { data: user, error } = await supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email, phone, role, barangay_id, password_hash, is_active')
      .eq('email', email)
      .single();

    if (error || !user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

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

    // Check if account has a verification record
    let verification = await DispatcherVerificationService.getByUserId(user.id);

    // If user is a dispatcher / captain but has no verification record yet, create one
    if (!verification && (user.role === 'captain' || user.role === 'dispatcher')) {
      verification = await DispatcherVerificationService.createVerification({
        userId: user.id,
        barangayId: user.barangay_id,
        barangayName: barangay?.name || 'Barangay',
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
      });
    }

    // If user is a dispatcher / undergoing verification:
    // Allow login so they can access the verification screen, download the authorization form, or upload certification
    if (verification) {
      const isVerified = verification.status === 'verified';
      const token = jwt.sign(
        { userId: user.id, barangayId: user.barangay_id, role: user.role, email: user.email },
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
          role: user.role,
          barangay_id: user.barangay_id,
          barangay_name: barangay?.name || '',
          municipality: barangay?.municipality || 'Norzagaray',
          is_active: isVerified,
          verification_status: verification.status,
          verification,
        },
      });
      return;
    }

    // If regular volunteer / team leader is deactivated by captain
    if (!user.is_active) {
      res.status(403).json({ error: 'Account has been deactivated. Contact your barangay captain.' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, barangayId: user.barangay_id, role: user.role, email: user.email },
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
        role: user.role,
        barangay_id: user.barangay_id,
        barangay_name: barangay?.name || '',
        municipality: barangay?.municipality || 'Norzagaray',
        is_active: true,
        verification_status: 'verified',
      },
    });
  } catch (err) {
    console.error('Barangay login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/barangay/me ────────────────────────────────────────────────────

router.get('/me', authenticateBarangay, async (req: any, res: Response) => {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('barangay_users')
      .select('id, full_name, email, phone, role, barangay_id, is_active, created_at')
      .eq('id', req.barangayUser.userId)
      .single();

    if (error || !user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { data: barangay } = await supabaseAdmin
      .from('barangays')
      .select('name, municipality')
      .eq('id', user.barangay_id)
      .maybeSingle();

    const verification = await DispatcherVerificationService.getByUserId(user.id);
    const verificationStatus = verification ? verification.status : (user.is_active ? 'verified' : 'pending_document');

    res.json({
      ...user,
      barangay_name: barangay?.name,
      municipality: barangay?.municipality,
      verification_status: verificationStatus,
      verification,
    });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/barangay/dispatcher/authorization-pdf ──────────────────────────
// Download / view prefilled Authorization & Certification PDF
// Supports inline preview and attachment download via ?download=true

router.get('/dispatcher/authorization-pdf', async (req: Request, res: Response): Promise<void> => {
  try {
    let userId: string | undefined;

    // 1. Check Authorization header or query param token
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : (req.query.token as string);

    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwtSecret) as any;
        userId = decoded.userId;
      } catch (_) {}
    }

    if (!userId && req.query.userId) {
      userId = req.query.userId as string;
    }

    // Support query by verification id or reference number if provided
    const lookupId = userId || (req.query.id as string) || (req.query.ref as string);

    if (!lookupId) {
      res.status(401).json({ error: 'Authentication or userId required to generate authorization PDF' });
      return;
    }

    // 2. Fetch or dynamically generate verification record from existing user registration data
    let verification = await DispatcherVerificationService.getByUserId(lookupId);
    if (!verification) {
      verification = await DispatcherVerificationService.getById(lookupId);
    }

    if (!verification) {
      // Look up existing user registration in barangay_users
      const { data: bUser } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name, email, phone, barangay_id, role, created_at, barangays(name, municipality)')
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
          positionDesignation: 'Barangay Dispatcher',
          punongBarangayName: '[NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL]',
          punongBarangayPosition: 'Punong Barangay',
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
      dispatcherName: verification.full_name,
      positionDesignation: verification.position_designation || 'Barangay Dispatcher',
      barangayName: verification.barangay_name || 'Barangay',
      officialName: verification.punong_barangay_name || '[NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL]',
      officialPosition: verification.punong_barangay_position || 'Punong Barangay',
      referenceNo: '', // Blank as specified in Step 5
      dateStr: currentDate,
    });

    const isDownload = req.query.download === 'true' || req.query.download === '1' || req.query.dl === '1';
    const dispositionType = isDownload ? 'attachment' : 'inline';
    const safeName = (verification.full_name || 'Dispatcher').replace(/[^a-zA-Z0-9_]/g, '_');
    const filename = `Barangay_Dispatcher_Authorization_${safeName}.pdf`;

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
});

// ─── GET /api/barangay/dispatcher/certification-data ────────────────────────
// Retrieve prefilled certification data for in-app viewing & printing

router.get('/dispatcher/certification-data', async (req: Request, res: Response): Promise<void> => {
  try {
    let userId: string | undefined;

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : (req.query.token as string);

    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwtSecret) as any;
        userId = decoded.userId;
      } catch (_) {}
    }

    if (!userId && req.query.userId) {
      userId = req.query.userId as string;
    }

    const lookupId = userId || (req.query.id as string);
    if (!lookupId) {
      res.status(401).json({ error: 'Authentication or userId required' });
      return;
    }

    let verification = await DispatcherVerificationService.getByUserId(lookupId);
    if (!verification) {
      verification = await DispatcherVerificationService.getById(lookupId);
    }

    if (!verification) {
      const { data: bUser } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name, email, phone, barangay_id, role, created_at, barangays(name, municipality)')
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
          positionDesignation: 'Barangay Dispatcher',
          punongBarangayName: '[NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL]',
          punongBarangayPosition: 'Punong Barangay',
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

    res.json({
      title: 'BARANGAY DISPATCHER AUTHORIZATION AND CERTIFICATION',
      date: currentDate,
      full_name: verification.full_name,
      position_designation: verification.position_designation || 'Barangay Dispatcher',
      barangay: barangayName,
      municipality: 'Municipality of Norzagaray, Bulacan',
      contact_info: verification.phone || '',
      official_name: verification.punong_barangay_name || '[NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL]',
      official_position: 'Punong Barangay / Authorized Barangay Official',
      reference_no: '', // Blank as requested
      paragraphs: [
        `This is to certify that ${verification.full_name}, a ${verification.position_designation || 'Barangay Dispatcher'} at Barangay ${barangayName}, is an authorized representative of Barangay ${barangayName}, Municipality of Norzagaray, Bulacan, and is hereby authorized to act as a Barangay Dispatcher for the purpose of coordinating and communicating disaster, emergency, and incident-related information through the NorzAgapay Real-Time Crisis Management and Volunteer Logistics Application.`,
        `This authorization is issued for official barangay disaster risk reduction and management coordination purposes. The dispatcher is expected to use the account responsibly and only for legitimate activities related to emergency preparedness, response, and coordination.`,
        `This certification is issued upon the request of the above-named individual for the purpose of account verification and activation as a Barangay Dispatcher in the NorzAgapay Application.`,
      ],
    });
  } catch (err) {
    console.error('Fetch certification data error:', err);
    res.status(500).json({ error: 'Failed to fetch certification data' });
  }
});

// ─── POST /api/barangay/dispatcher/submit-certification ──────────────────────
// Upload signed and sealed certification document

router.post(
  '/dispatcher/submit-certification',
  authenticateBarangay,
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

router.get(
  '/dispatcher/verification-status',
  authenticateBarangay,
  async (req: any, res: Response): Promise<void> => {
    try {
      const verification = await DispatcherVerificationService.getByUserId(req.barangayUser.userId);
      if (!verification) {
        res.status(404).json({ error: 'Verification record not found' });
        return;
      }
      res.json({ verification });
    } catch (err) {
      console.error('Get verification status error:', err);
      res.status(500).json({ error: 'Failed to retrieve verification status' });
    }
  }
);

// ─── POST /api/barangay/dispatcher/resubmit ──────────────────────────────────

router.post(
  '/dispatcher/resubmit',
  authenticateBarangay,
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

    // Volunteers can only see their team leader and other volunteers they're linked to
    // Team leaders see their own volunteers; captain sees all
    if (req.barangayUser.role === 'volunteer') {
      query = query.or(`id.eq.${req.barangayUser.userId},added_by.eq.${req.barangayUser.userId}`);
    }

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
// Captain adds team leader; team leader adds volunteer

const addMemberSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  role: z.enum(['team_leader', 'volunteer']),
});

router.post('/team', authenticateBarangay, requireRole(['captain', 'team_leader']), async (req: any, res: Response): Promise<void> => {
  try {
    const body = addMemberSchema.parse(req.body);

    // Captains can add team leaders or volunteers
    // Team leaders can only add volunteers
    if (req.barangayUser.role === 'team_leader' && body.role !== 'volunteer') {
      res.status(403).json({ error: 'Team leaders can only add volunteers' });
      return;
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

router.delete('/team/:id', authenticateBarangay, requireRole(['captain']), async (req: any, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('barangay_users')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId);

    if (error) throw error;

    res.json({ message: 'Member deactivated' });
  } catch (err) {
    console.error('Remove team member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/barangay/reports ───────────────────────────────────────────────
// Get incident reports assigned to this barangay

router.get('/reports', authenticateBarangay, async (req: any, res: Response) => {
  try {
    const { status } = req.query;
    let query = supabaseAdmin
      .from('incident_reports')
      .select('*')
      .eq('barangay_id', req.barangayUser.barangayId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('barangay_response_status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    const responderIds = new Set<string>();
    for (const report of data || []) {
      if (report.barangay_responded_by) responderIds.add(report.barangay_responded_by);
      if (report.barangay_response_notes) {
        const match = report.barangay_response_notes.match(/\[ASSIGNED:([^\]]+)\]/);
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

    res.json((data || []).map((report: any) => {
      let assignedIds: string[] = [];
      if (report.barangay_response_notes) {
        const match = report.barangay_response_notes.match(/\[ASSIGNED:([^\]]+)\]/);
        if (match && match[1]) {
          assignedIds = match[1].split(',').map((id: string) => id.trim()).filter(Boolean);
        }
      }
      if (report.barangay_responded_by && !assignedIds.includes(report.barangay_responded_by)) {
        assignedIds.unshift(report.barangay_responded_by);
      }

      let responderName: string | null = null;
      if (assignedIds.length > 0) {
        const names = assignedIds.map(id => responderNames.get(id)).filter(Boolean);
        if (names.length > 0) {
          responderName = names.join(', ');
        }
      }

      return {
        ...report,
        assigned_team_leader_ids: assignedIds,
        barangay_responder_name: responderName || responderNames.get(report.barangay_responded_by) || null,
      };
    }));
  } catch (err) {
    console.error('Fetch barangay reports error:', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// ─── PATCH /api/barangay/reports/:id/dispatch ───────────────────────────────
// Dispatch report to one or multiple available team leaders (only Dispatcher / Captain)

router.patch('/reports/:id/dispatch', authenticateBarangay, requireRole(['captain', 'dispatcher']), async (req: any, res: Response) => {
  try {
    const { team_leader_id, team_leader_ids, notes } = req.body;
    const ids: string[] = Array.isArray(team_leader_ids) && team_leader_ids.length > 0
      ? team_leader_ids
      : (team_leader_id ? [team_leader_id] : []);

    if (ids.length === 0) {
      res.status(400).json({ error: 'At least one team leader ID is required' });
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
    const responderNames = teamLeaders.map((tl: any) => tl.full_name).join(', ');
    const cleanUserNotes = (notes || '').replace(/^\[ASSIGNED:[^\]]+\]\s*/, '').trim();
    const encodedNotes = ids.length > 1
      ? `[ASSIGNED:${ids.join(',')}] ${cleanUserNotes}`.trim()
      : (cleanUserNotes || null);

    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update({
        barangay_response_status: 'pending',
        barangay_response_notes: encodedNotes,
        barangay_responded_by: primaryLeaderId,
        barangay_responded_at: new Date().toISOString(),
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
      barangay_responded_by: primaryLeaderId,
      assigned_team_leader_ids: ids,
      barangay_responder_name: responderNames,
    };

    io.emit('incident_report:updated', payload);

    res.json(payload);
  } catch (err) {
    console.error('Dispatch report error:', err);
    res.status(500).json({ error: 'Failed to dispatch report' });
  }
});

// ─── PATCH /api/barangay/reports/:id/escalate ───────────────────────────────
// Escalate report to MDRRMO with reason notes (only Dispatcher / Captain)

router.patch('/reports/:id/escalate', authenticateBarangay, requireRole(['captain', 'dispatcher']), async (req: any, res: Response) => {
  try {
    const { notes } = req.body;
    if (!notes || !notes.trim()) {
      res.status(400).json({ error: 'Escalation notes are required' });
      return;
    }

    const escalationNotes = notes.trim();
    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update({
        mdrrmo_coordination_notes: escalationNotes,
        mdrrmo_response_notes: escalationNotes,
        status: 'verified',
        mdrrmo_response_status: 'responding',
        barangay_response_notes: `Escalated to MDRRMO: ${escalationNotes}`,
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

    io.to('commanders').emit('barangay:escalated', {
      reportId: req.params.id,
      barangayId: req.barangayUser.barangayId,
      barangayName: barangayName,
      notes: escalationNotes,
    });

    io.emit('incident_report:updated', {
      ...data,
      barangay_name: barangayName,
      mdrrmo_coordination_notes: escalationNotes,
      mdrrmo_response_status: 'responding',
    });

    res.json({
      ...data,
      barangay_name: barangayName,
      mdrrmo_coordination_notes: escalationNotes,
      mdrrmo_response_status: 'responding',
    });
  } catch (err) {
    console.error('Escalate report error:', err);
    res.status(500).json({ error: 'Failed to escalate report' });
  }
});

// ─── PATCH /api/barangay/reports/:id/respond ────────────────────────────────
// Mark initial response dispatched or accepted by team leader

router.patch('/reports/:id/respond', authenticateBarangay, requireRole(['captain', 'dispatcher', 'team_leader']), async (req: any, res: Response) => {
  try {
    const { notes, mdrrmo_notes } = req.body;
    const updatePayload: any = {
      barangay_response_status: 'responding',
      barangay_responded_by: req.barangayUser.userId,
      barangay_responded_at: new Date().toISOString(),
    };
    if (notes !== undefined && notes !== null) {
      updatePayload.barangay_response_notes = notes;
    }
    if (mdrrmo_notes !== undefined && mdrrmo_notes !== null) {
      updatePayload.mdrrmo_coordination_notes = mdrrmo_notes;
    }

    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update(updatePayload)
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
    io.to('commanders').emit('barangay:responding', {
      reportId: req.params.id,
      barangayId: req.barangayUser.barangayId,
      barangayName: barangayName,
      responderName: responderName,
      notes: updatePayload.barangay_response_notes,
    });

    io.emit('incident_report:updated', {
      ...data,
      barangay_name: barangayName,
      barangay_response_status: 'responding',
      barangay_responder_name: responderName,
    });

    res.json({
      ...data,
      barangay_name: barangayName,
      barangay_responder_name: responderName,
    });
  } catch (err) {
    console.error('Respond to report error:', err);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// ─── POST /api/barangay/reports/:id/close ───────────────────────────────────
// Close and record the incident

router.post('/reports/:id/close', authenticateBarangay, requireRole(['captain', 'team_leader']), async (req: any, res: Response) => {
  try {
    const { resolved_notes } = req.body;
    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update({
        barangay_response_status: 'resolved',
        resolved_notes: resolved_notes || null,
        resolved_at: new Date().toISOString(),
        status: 'resolved',
      })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .single();

    if (error) throw error;

    io.to('commanders').emit('barangay:incident_closed', { reportId: req.params.id });

    res.json(data);
  } catch (err) {
    console.error('Close report error:', err);
    res.status(500).json({ error: 'Failed to close report' });
  }
});

// ─── POST /api/barangay/assistance-requests ──────────────────────────────────
// Team Leader submits an assistance request to the Captain

const assistanceRequestSchema = z.object({
  incident_report_id: z.string().uuid().nullable().optional(),
  incident_title: z.string().optional(),
  needs_more_manpower: z.boolean().optional(),
  needs_resources: z.boolean().optional(),
  needs_equipment: z.boolean().optional(),
  beyond_barangay_capability: z.boolean().optional(),
  explanation: z.string().min(10),
});

router.post('/assistance-requests', authenticateBarangay, requireRole(['team_leader']), async (req: any, res: Response) => {
  try {
    const parsed = assistanceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .insert({
        barangay_id: req.barangayUser.barangayId,
        requested_by: req.barangayUser.userId,
        incident_report_id: parsed.data.incident_report_id || null,
        incident_title: parsed.data.incident_title || null,
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

    // Notify captain via socket
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:new_request', { request: data });

    res.status(201).json({ message: 'Assistance request submitted successfully.', request: data });
  } catch (err) {
    console.error('Create assistance request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /api/barangay/assistance-requests ───────────────────────────────────
// Captain views all assistance requests for their barangay

router.get('/assistance-requests', authenticateBarangay, requireRole(['captain']), async (req: any, res: Response) => {
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
// Team Leader views their own submitted requests

router.get('/my-assistance-requests', authenticateBarangay, requireRole(['team_leader']), async (req: any, res: Response) => {
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
// Team Leader edits their own assistance request

router.patch('/assistance-requests/:id/edit', authenticateBarangay, requireRole(['team_leader']), async (req: any, res: Response) => {
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

    // Notify captain via socket
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:new_request', { request: data });

    res.json({ message: 'Assistance request updated successfully.', request: data });
  } catch (err) {
    console.error('Edit assistance request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── PATCH /api/barangay/assistance-requests/:id/decide ──────────────────────
// Captain decides: provide_barangay_assistance or coordinate_mdrrmo

router.patch('/assistance-requests/:id/decide', authenticateBarangay, requireRole(['captain']), async (req: any, res: Response) => {
  try {
    const { decision, captain_notes } = req.body;
    const validDecisions = ['provide_barangay_assistance', 'coordinate_mdrrmo'];
    if (!validDecisions.includes(decision)) {
      res.status(400).json({ error: 'Invalid decision. Must be: provide_barangay_assistance or coordinate_mdrrmo.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('barangay_assistance_requests')
      .update({
        status: 'actioned',
        decision,
        captain_notes: captain_notes || null,
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

    // Notify team leader via socket
    io.to(`barangay:${req.barangayUser.barangayId}`).emit('assistance:decision', { request: data, decision });

    res.json({ message: `Request actioned: ${decision}.`, request: data });
  } catch (err) {
    console.error('Decide assistance request error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── PATCH /api/barangay/assistance-requests/:id/team-action ─────────────────
// Team Leader acknowledges or cancels their own request

router.patch('/assistance-requests/:id/team-action', authenticateBarangay, requireRole(['team_leader']), async (req: any, res: Response) => {
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

export default router;
export { authenticateBarangay };
