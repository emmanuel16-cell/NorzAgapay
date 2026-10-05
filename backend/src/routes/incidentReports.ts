import { Router, Response, Request, NextFunction } from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { AuthPayload, AuthRequest, authenticate, authorize } from '../middleware/auth';
import { io } from '../server';
import { isBarangayVerified } from '../services/verifiedBarangayService';
import { estimateReportTimings } from '../services/reportTiming';
import {
  getMunicipalityBoundaryConfiguration,
  isPointInBoundary,
} from '../utils/norzagarayBoundary';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware for optional authentication
const optionalAuthenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    let decoded: AuthPayload;
    try {
      decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
    } catch (err) {
      // Ignore invalid token, treat as anonymous
      next();
      return;
    }

    if (decoded.role === 'resident') {
      try {
        const { data: resident, error } = await supabaseAdmin
          .from('resident_user')
          .select('status')
          .eq('id', decoded.userId)
          .maybeSingle();
        if (error) {
          res.status(503).json({ error: 'Unable to verify resident account status.' });
          return;
        }
        if (!resident || resident.status !== 'active') {
          res.status(403).json({ error: 'This resident account is not active.' });
          return;
        }
      } catch (err) {
        console.error('Optional resident account check failed:', err);
        res.status(503).json({ error: 'Unable to verify resident account status.' });
        return;
      }
    }

    req.user = decoded;
  }
  next();
};

/**
 * Universal Formatter for Incident Reports
 * Ensures proof_url, proof_urls, proof_types, and responder_media are always present and normalized.
 */
export function formatIncidentReport(r: any): any {
  if (!r) return r;

  let proofUrls: string[] = [];
  let proofTypes: string[] = [];
  let responderMedia: any[] = [];

  // Parse proof_urls
  if (Array.isArray(r.proof_urls) && r.proof_urls.length > 0) {
    proofUrls = r.proof_urls.filter(Boolean);
  } else if (typeof r.proof_urls === 'string') {
    try {
      const parsed = JSON.parse(r.proof_urls);
      if (Array.isArray(parsed)) proofUrls = parsed.filter(Boolean);
    } catch (_) {}
  }

  // Fallback to parsing proof_url if proofUrls is empty
  if (proofUrls.length === 0 && r.proof_url) {
    if (typeof r.proof_url === 'string') {
      const trimmed = r.proof_url.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) proofUrls = parsed.filter(Boolean);
        } catch (_) {}
      } else if (trimmed.includes('|||')) {
        proofUrls = trimmed.split('|||').map((s: string) => s.trim()).filter(Boolean);
      }
      if (proofUrls.length === 0 && trimmed) {
        proofUrls = [trimmed];
      }
    }
  }

  // Parse proof_types
  if (Array.isArray(r.proof_types) && r.proof_types.length > 0) {
    proofTypes = r.proof_types;
  } else if (typeof r.proof_types === 'string') {
    try {
      const parsed = JSON.parse(r.proof_types);
      if (Array.isArray(parsed)) proofTypes = parsed;
    } catch (_) {}
  }

  // Ensure proofTypes length matches proofUrls
  if (proofTypes.length < proofUrls.length) {
    proofTypes = proofUrls.map((url, idx) => {
      if (proofTypes[idx]) return proofTypes[idx];
      const lower = (url || '').toLowerCase().split('?')[0];
      const isVideo = ['.mp4', '.mov', '.webm', '.3gp', '.mkv', '.avi'].some(ext => lower.endsWith(ext));
      return isVideo ? 'video' : (r.proof_type || 'image');
    });
  }

  // Parse responder_media
  if (Array.isArray(r.responder_media)) {
    responderMedia = r.responder_media;
  } else if (typeof r.responder_media === 'string') {
    try {
      const parsed = JSON.parse(r.responder_media);
      if (Array.isArray(parsed)) responderMedia = parsed;
    } catch (_) {}
  }

  // Check if responder media is embedded in notes fallback
  if (responderMedia.length === 0 && r.barangay_response_notes) {
    const match = r.barangay_response_notes.match(/\[RESPONDER_MEDIA:([\s\S]*?)\]/);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) responderMedia = parsed;
      } catch (_) {}
    }
  }

  let sendTo = r.send_to;
  let cleanSpecifics = r.specifics || '';
  if (cleanSpecifics.includes('[SEND_TO:')) {
    const match = cleanSpecifics.match(/\[SEND_TO:([^\]]+)\]/);
    if (match && match[1]) {
      if (!sendTo) sendTo = match[1].trim();
      cleanSpecifics = cleanSpecifics.replace(/\[SEND_TO:[^\]]+\]/, '').trim();
    }
  }
  if (!sendTo && r.description && r.description.includes('[SEND_TO:')) {
    const match = r.description.match(/\[SEND_TO:([^\]]+)\]/);
    if (match && match[1]) {
      sendTo = match[1].trim();
    }
  }

  const primaryProofUrl = proofUrls.length > 0 ? proofUrls[0] : (r.proof_url || null);
  const primaryProofType = proofTypes.length > 0 ? proofTypes[0] : (r.proof_type || 'image');

  return {
    ...r,
    send_to: sendTo || (r.barangay_id ? 'barangay' : 'all'),
    specifics: cleanSpecifics,
    proof_url: primaryProofUrl,
    proof_type: primaryProofType,
    proof_urls: proofUrls,
    proof_types: proofTypes,
    responder_media: responderMedia,
    barangay_name: r.barangays?.name || r.barangay_name || null,
  };
}

/**
 * POST /api/incident-reports
 * Handles report submission from mobile and resident apps.
 * Supports multipart/form-data for multiple proof files.
 */
router.post('/', optionalAuthenticate, upload.any(), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { 
      type, 
      title, 
      specifics, 
      description, 
      latitude, 
      longitude, 
      proof_type,
      reporter_type,
      reporter_name: submittedReporterName,
      reporter_email: submittedReporterEmail,
      full_name,
      first_name,
      last_name,
      contact_number,
      barangay_id,
      send_to
    } = req.body;

    const targetSendTo = (send_to === 'barangay' || send_to === 'mdrrmo')
      ? send_to
      : (type === 'emergency' && !barangay_id ? 'mdrrmo' : 'barangay');

    // Basic validation
    if (!type || !title || !latitude || !longitude) {
      res.status(400).json({ error: 'Missing required fields: type, title, latitude, longitude' });
      return;
    }

    let residentProfile: { full_name?: string | null; email?: string | null; phone?: string | null } | null = null;
    if (reporter_type === 'resident' && req.user?.userId) {
      const { data, error } = await supabaseAdmin
        .from('resident_user')
        .select('full_name, email, phone')
        .eq('id', req.user.userId)
        .maybeSingle();
      if (error) throw error;
      residentProfile = data;
    }
    const reporterName = residentProfile?.full_name || submittedReporterName || full_name ||
      (first_name ? `${first_name} ${last_name || ''}`.trim() : null);
    const submittedEmail = typeof submittedReporterEmail === 'string' ? submittedReporterEmail.trim() : '';
    const submittedContact = typeof contact_number === 'string' ? contact_number.trim() : '';
    const reporterEmail = residentProfile?.email || submittedEmail || (submittedContact.includes('@') ? submittedContact : null);
    const profilePhone = typeof residentProfile?.phone === 'string' && !residentProfile.phone.includes('@')
      ? residentProfile.phone.trim()
      : '';
    const reporterPhone = profilePhone || (submittedContact.includes('@') ? null : submittedContact || null);

    // Resolve barangay: use provided or nearest by lat/lng
    let resolvedBarangayId = barangay_id || null;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    const boundaryConfig = await getMunicipalityBoundaryConfiguration();
    if (boundaryConfig.enabled && !isPointInBoundary(lat, lng, boundaryConfig.geometry)) {
      res.status(403).json({
        error: 'Incident reports can only be submitted for locations inside Norzagaray.',
      });
      return;
    }

    if (!resolvedBarangayId && lat && lng) {
      const { data: barangays } = await supabaseAdmin
        .from('barangays')
        .select('id, latitude, longitude')
        .not('latitude', 'is', null);

      if (barangays && barangays.length > 0) {
        let minDist = Infinity;
        for (const b of barangays) {
          if (!b.latitude || !b.longitude) continue;
          const dLat = (b.latitude - lat) * Math.PI / 180;
          const dLon = (b.longitude - lng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
          const dist = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (dist < minDist) { minDist = dist; resolvedBarangayId = b.id; }
        }
      }
    }

    if (targetSendTo === 'barangay') {
      if (!resolvedBarangayId || !await isBarangayVerified(resolvedBarangayId)) {
        res.status(403).json({ error: 'This barangay is not yet approved to receive reports through NorzAgapay. Please route the report to MDRRMO or choose an approved barangay.' });
        return;
      }
    }

    const rawFiles: Express.Multer.File[] = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
    // Deduplicate in case client sent both 'proofs' array and legacy 'proof' field
    const uploadedFiles: Express.Multer.File[] = [];
    const seenFiles = new Set<string>();
    for (const f of rawFiles) {
      const key = `${f.originalname}_${f.size}`;
      if (!seenFiles.has(key)) {
        seenFiles.add(key);
        uploadedFiles.push(f);
      }
    }

    const proofUrls: string[] = [];
    const proofTypes: string[] = [];

    let providedProofTypes: string[] = [];
    if (req.body.proof_types) {
      try {
        providedProofTypes = typeof req.body.proof_types === 'string'
          ? JSON.parse(req.body.proof_types)
          : req.body.proof_types;
      } catch (_) {}
    }

    // Handle incident proof uploads
    if (uploadedFiles.length > 0) {
      const timestamp = Date.now();
      for (let i = 0; i < uploadedFiles.length; i++) {
        const f = uploadedFiles[i];
        const ext = (f.originalname.split('.').pop() || 'jpg').toLowerCase();
        const isVideo = (f.mimetype && f.mimetype.startsWith('video/')) || ['mp4', 'mov', 'webm', '3gp', 'mkv', 'avi'].includes(ext);
        const pType = providedProofTypes[i] || (isVideo || proof_type === 'video' ? 'video' : 'image');
        const filename = `reports/${reporter_type || 'anonymous'}/${timestamp}_${i}.${ext}`;

        const { error: uploadError } = await supabaseAdmin
          .storage
          .from(config.supabaseBucketName)
          .upload(filename, f.buffer, {
            contentType: f.mimetype,
            upsert: true
          });

        if (!uploadError) {
          const { data: { publicUrl } } = supabaseAdmin
            .storage
            .from(config.supabaseBucketName)
            .getPublicUrl(filename);
          proofUrls.push(publicUrl);
          proofTypes.push(pType);
        } else {
          console.error('Upload proof error:', uploadError);
        }
      }
    }

    const primaryProofUrl = proofUrls.length > 0 ? proofUrls[0] : null;
    const primaryProofType = proofTypes.length > 0 ? proofTypes[0] : (proof_type || 'image');
    // If multiple proofs exist, encode all URLs in proof_url column as JSON fallback
    const encodedProofUrl = proofUrls.length > 1 ? JSON.stringify(proofUrls) : primaryProofUrl;

    // Insert payload
    const encodedSpecifics = specifics 
      ? `${specifics} [SEND_TO:${targetSendTo}]` 
      : `[SEND_TO:${targetSendTo}]`;

    const insertPayload: any = {
      type,
      title,
      specifics: encodedSpecifics,
      description,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      proof_url: encodedProofUrl,
      proof_type: primaryProofType,
      reporter_type: reporter_type || 'resident',
      reporter_id: req.user?.userId || null,
      reporter_name: reporterName,
      reporter_phone: reporterPhone,
      reporter_email: reporterEmail,
      barangay_id: resolvedBarangayId,
      status: 'pending',
      send_to: targetSendTo
    };

    let report: any = null;
    let dbError: any = null;

    try {
      // Attempt insert with proof_urls, proof_types, and send_to columns
      const res = await supabaseAdmin
        .from('incident_reports')
        .insert({
          ...insertPayload,
          proof_urls: proofUrls,
          proof_types: proofTypes
        })
        .select('*, barangays(name)')
        .single();

      if (res.error) throw res.error;
      report = res.data;
    } catch (colErr) {
      // Fallback for older schemas without proof_urls, send_to, or reporter_email.
      const safePayload = { ...insertPayload };
      delete safePayload.send_to;
      delete safePayload.reporter_email;
      const res = await supabaseAdmin
        .from('incident_reports')
        .insert(safePayload)
        .select('*, barangays(name)')
        .single();
      report = res.data;
      dbError = res.error;
    }

    if (dbError || !report) {
      console.error('Database error:', dbError);
      res.status(500).json({ error: 'Failed to save report to database.' });
      return;
    }

    const formattedReport = formatIncidentReport({
      ...report,
      proof_urls: proofUrls.length > 0 ? proofUrls : ((report as any)?.proof_urls || []),
      proof_types: proofTypes.length > 0 ? proofTypes : ((report as any)?.proof_types || []),
    });
    if (report.barangay_id) {
      const { data: timingHistory, error: timingError } = await supabaseAdmin
        .from('incident_reports')
        .select('barangay_id, type, severity, created_at, accepted_at, arrived_at, resolved_at, travel_distance_m')
        .eq('barangay_id', report.barangay_id)
        .not('accepted_at', 'is', null)
        .not('arrived_at', 'is', null)
        .not('resolved_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (timingError) {
        console.warn('Could not calculate initial resident timing estimates:', timingError);
      } else {
        formattedReport.expected_timings = estimateReportTimings(report, timingHistory || []);
      }
    }

    // If sent to MDRRMO (or all):
    if (targetSendTo !== 'barangay') {
      try {
        await supabaseAdmin
          .from('tasks')
          .insert({
            title: `🚨 Emergency: ${formattedReport.title}`,
            description: formattedReport.description || formattedReport.specifics || `Emergency reported at ${formattedReport.barangay_name || 'Norzagaray'}.`,
            task_type: 'general_labor',
            status: 'pending',
            latitude: formattedReport.latitude,
            longitude: formattedReport.longitude,
            address: formattedReport.address || formattedReport.barangay_name || 'Norzagaray, Bulacan'
          });
        io.emit('task:new', formattedReport);
      } catch (taskErr) {
        console.warn('Could not auto-create initial task:', taskErr);
      }

      // Emit socket event for real-time dashboard notification.
      io.to('dashboard_staff').emit('incident_report:new', formattedReport);
    }

    // If sent to Barangay: notify specific barangay room ONLY
    if (targetSendTo !== 'mdrrmo' && resolvedBarangayId) {
      io.to(`barangay:${resolvedBarangayId}`).emit('barangay:report_received', formattedReport);
    }

    res.status(201).json({
      message: 'Report submitted successfully.',
      report: formattedReport
    });
  } catch (err) {
    console.error('Incident report submission error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/incident-reports/me
 * Get reports submitted by the authenticated user
 */
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { data: reports, error } = await supabaseAdmin
            .from('incident_reports')
            .select('*, barangays(name)')
            .eq('reporter_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Database error fetching user reports:', error);
            res.status(500).json({ error: 'Failed to fetch your reports' });
            return;
        }

        res.json((reports || []).map(formatIncidentReport));
    } catch (err) {
        console.error('Fetch user reports error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/incident-reports/resident
 * Get reports submitted by a resident using first_name, last_name, contact_number
 */
router.get('/resident', optionalAuthenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { contact_number } = req.query;
    if (req.user?.role !== 'resident' && !contact_number) {
      return res.status(400).json({ error: 'Missing required field: contact_number' });
    }

    let query = supabaseAdmin
      .from('incident_reports')
      .select('*, barangays(name)')
      .eq('reporter_type', 'resident');
    query = req.user?.role === 'resident'
      ? query.eq('reporter_id', req.user.userId)
      : query.eq('reporter_phone', String(contact_number));
    const { data: reports, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Database error fetching resident reports:', error);
      return res.status(500).json({ error: 'Failed to fetch reports' });
    }

    const reportRows = reports || [];
    const barangayIds = [...new Set(reportRows.map((report: any) => report.barangay_id).filter(Boolean))];
    let timingHistory: any[] = [];
    if (barangayIds.length > 0) {
      const { data: history, error: historyError } = await supabaseAdmin
        .from('incident_reports')
        .select('barangay_id, type, severity, created_at, accepted_at, arrived_at, resolved_at, travel_distance_m')
        .in('barangay_id', barangayIds)
        .not('accepted_at', 'is', null)
        .not('arrived_at', 'is', null)
        .not('resolved_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (historyError) throw historyError;
      timingHistory = history || [];
    }

    const assignedResponderIds = new Set<string>();
    for (const report of reportRows) {
      if (report.barangay_responded_by) assignedResponderIds.add(report.barangay_responded_by);
      const match = report.barangay_response_notes?.match(/\[ASSIGNED:([^\]]+)\]/);
      if (match?.[1]) {
        for (const id of match[1].split(',').map((value: string) => value.trim()).filter(Boolean)) {
          assignedResponderIds.add(id);
        }
      }
    }

    const responderNames = new Map<string, string>();
    if (assignedResponderIds.size > 0) {
      const { data: responders, error: respondersError } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name')
        .in('id', [...assignedResponderIds]);
      if (respondersError) throw respondersError;
      for (const responder of responders || []) responderNames.set(responder.id, responder.full_name);
    }

    res.json(reportRows.map((report: any) => {
      const assigned = new Set<string>();
      const match = report.barangay_response_notes?.match(/\[ASSIGNED:([^\]]+)\]/);
      if (match?.[1]) {
        for (const id of match[1].split(',').map((value: string) => value.trim()).filter(Boolean)) assigned.add(id);
      }
      if (report.barangay_responded_by) assigned.add(report.barangay_responded_by);
      const names = [...assigned].map((id) => responderNames.get(id)).filter(Boolean);
      const relevantHistory = timingHistory.filter((sample: any) => sample.barangay_id === report.barangay_id);
      return formatIncidentReport({
        ...report,
        barangay_responder_name: names.join(', ') || null,
        expected_timings: estimateReportTimings(report, relevantHistory),
      });
    }));
  } catch (err) {
    console.error('Fetch resident reports error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/incident-reports
 * List all incident reports (Admin and master admin only)
 */
router.get('/', optionalAuthenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { type } = req.query;
        let query = supabaseAdmin
            .from('incident_reports')
            .select('*, barangays(name)')
            .order('created_at', { ascending: false });

        if (type === 'emergency' || type === 'community') {
            query = query.eq('type', type);
        }

        const { data: reports, error } = await query;

        if (error) {
            console.error('Database error fetching reports:', error);
            res.status(500).json({ error: 'Failed to fetch incident reports' });
            return;
        }

        let formatted = (reports || []).map(formatIncidentReport);
        if (req.user && ['dispatcher', 'admin', 'master_admin'].includes(req.user.role)) {
          const residentIds = [...new Set(formatted
            .filter((report) => report.reporter_type === 'resident' && report.reporter_id)
            .map((report) => report.reporter_id as string))];
          if (residentIds.length > 0) {
            const { data: residents, error: residentsError } = await supabaseAdmin
              .from('resident_user')
              .select('id, false_report_count, status')
              .in('id', residentIds);
            if (residentsError) {
              console.warn('Could not load resident review counts:', residentsError);
            } else {
              const residentById = new Map((residents || []).map((resident) => [resident.id, resident]));
              formatted = formatted.map((report) => {
                const resident = report.reporter_id ? residentById.get(report.reporter_id) : null;
                return resident ? {
                  ...report,
                  reporter_false_report_count: resident.false_report_count || 0,
                  reporter_account_status: resident.status,
                } : report;
              });
            }
          }
        }
        // MDRRMO sees Emergency reports and barangay reports escalated for
        // MDRRMO handling. Community reports stay with the barangay unless
        // explicitly escalated. A report remains one row and one statistics sample.
        const mdrrmoReports = formatted.filter(r => {
          if (r.review_outcome) return false;
          const isEscalated = r.status === 'escalated' ||
                              r.mdrrmo_response_status === 'responding' ||
                              r.mdrrmo_response_status === 'resolved' ||
                              (r.barangay_response_notes && r.barangay_response_notes.toLowerCase().includes('escalated'));
          if (r.type === 'community') return isEscalated;
          return r.type === 'emergency' || r.send_to === 'mdrrmo' || isEscalated;
        });

        res.json(mdrrmoReports);
    } catch (err) {
        console.error('Fetch reports error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PATCH /api/incident-reports/:id
 * Update incident report (description, specifics, proofs)
 */
router.patch('/:id', optionalAuthenticate, upload.any(), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { description, specifics } = req.body;

    // Handle kept proof URLs
    let keptUrls: string[] = [];
    if (req.body['kept_proof_urls[]']) {
      keptUrls = Array.isArray(req.body['kept_proof_urls[]']) 
        ? req.body['kept_proof_urls[]'] 
        : [req.body['kept_proof_urls[]']];
    } else if (req.body.kept_proof_urls) {
      try {
        keptUrls = typeof req.body.kept_proof_urls === 'string' 
          ? JSON.parse(req.body.kept_proof_urls) 
          : req.body.kept_proof_urls;
      } catch (_) {
        keptUrls = [req.body.kept_proof_urls];
      }
    }

    // Upload new files
    const newFiles = (req.files as Express.Multer.File[]) || [];
    const newUrls: string[] = [];
    const newTypes: string[] = [];

    if (newFiles.length > 0) {
      const timestamp = Date.now();
      for (let i = 0; i < newFiles.length; i++) {
        const f = newFiles[i];
        const ext = (f.originalname.split('.').pop() || 'jpg').toLowerCase();
        const isVideo = (f.mimetype && f.mimetype.startsWith('video/')) || ['mp4', 'mov', 'webm', '3gp', 'mkv', 'avi'].includes(ext);
        const filename = `reports/updates/${timestamp}_${i}.${ext}`;

        const { error: uploadError } = await supabaseAdmin
          .storage
          .from(config.supabaseBucketName)
          .upload(filename, f.buffer, {
            contentType: f.mimetype,
            upsert: true
          });

        if (!uploadError) {
          const { data: { publicUrl } } = supabaseAdmin
            .storage
            .from(config.supabaseBucketName)
            .getPublicUrl(filename);
          newUrls.push(publicUrl);
          newTypes.push(isVideo ? 'video' : 'image');
        }
      }
    }

    const allUrls = [...keptUrls, ...newUrls];
    const updatePayload: any = {};
    if (description !== undefined) updatePayload.description = description;
    if (specifics !== undefined) updatePayload.specifics = specifics;
    if (allUrls.length > 0) {
      updatePayload.proof_url = allUrls.length > 1 ? JSON.stringify(allUrls) : allUrls[0];
    }

    let updatedReport: any = null;
    try {
      const { data, error } = await supabaseAdmin
        .from('incident_reports')
        .update({
          ...updatePayload,
          proof_urls: allUrls,
        })
        .eq('id', id)
        .select('*, barangays(name)')
        .single();
      if (error) throw error;
      updatedReport = data;
    } catch (_) {
      const { data, error } = await supabaseAdmin
        .from('incident_reports')
        .update(updatePayload)
        .eq('id', id)
        .select('*, barangays(name)')
        .single();
      if (error) throw error;
      updatedReport = data;
    }

    const formatted = formatIncidentReport({
      ...updatedReport,
      proof_urls: allUrls,
    });

    io.emit('incident_report:updated', formatted);
    io.to('dashboard_staff').emit('incident_report:updated', formatted);
    if (formatted.barangay_id) {
      io.to(`barangay:${formatted.barangay_id}`).emit('incident_report:updated', formatted);
      io.to(`barangay:${formatted.barangay_id}`).emit('barangay:report_updated', formatted);
    }

    res.json(formatted);
  } catch (err) {
    console.error('Update report error:', err);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

/**
 * POST /api/incident-reports/:id/field-media
 * Attach field photo or video to an incident report
 */
router.post('/:id/field-media', optionalAuthenticate, upload.single('media'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No media file provided.' });
      return;
    }

    const { type, uploader_name, role } = req.body;
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

    const newMediaItem = {
      id: `media_${timestamp}`,
      url: publicUrl,
      type: mediaType,
      uploader_id: req.user?.userId || null,
      uploader_name: uploader_name || (req.user as any)?.name || 'Responder',
      role: role || (req.user as any)?.role || 'responder',
      created_at: new Date().toISOString()
    };

    const { data: currentReport, error: fetchErr } = await supabaseAdmin
      .from('incident_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !currentReport) {
      res.status(404).json({ error: 'Incident report not found.' });
      return;
    }

    const formattedCurrent = formatIncidentReport(currentReport);
    const existingMedia = formattedCurrent.responder_media || [];
    const updatedMedia = [...existingMedia, newMediaItem];

    let updatedReport: any = null;
    try {
      const { data, error } = await supabaseAdmin
        .from('incident_reports')
        .update({ responder_media: updatedMedia })
        .eq('id', id)
        .select('*, barangays(name)')
        .single();
      if (error) throw error;
      updatedReport = data;
    } catch (colErr) {
      // Fallback: embed in barangay_response_notes
      let notes = currentReport.barangay_response_notes || '';
      if (notes.includes('[RESPONDER_MEDIA:')) {
        notes = notes.replace(/\[RESPONDER_MEDIA:[\s\S]*?\]/, `[RESPONDER_MEDIA:${JSON.stringify(updatedMedia)}]`);
      } else {
        notes = notes ? `${notes} [RESPONDER_MEDIA:${JSON.stringify(updatedMedia)}]` : `[RESPONDER_MEDIA:${JSON.stringify(updatedMedia)}]`;
      }
      const { data, error } = await supabaseAdmin
        .from('incident_reports')
        .update({ barangay_response_notes: notes })
        .eq('id', id)
        .select('*, barangays(name)')
        .single();
      if (error) throw error;
      updatedReport = data;
    }

    const formatted = formatIncidentReport(updatedReport);

    io.emit('incident_report:updated', formatted);
    io.to('dashboard_staff').emit('incident_report:updated', formatted);
    if (formatted.barangay_id) {
      io.to(`barangay:${formatted.barangay_id}`).emit('incident_report:updated', formatted);
      io.to(`barangay:${formatted.barangay_id}`).emit('barangay:report_updated', formatted);
    }

    res.json(formatted);
  } catch (err) {
    console.error('Attach field media error:', err);
    res.status(500).json({ error: 'Internal server error while attaching field media.' });
  }
});

/**
 * PATCH /api/incident-reports/:id/review
 * Record an MDRRMO decision for a pending report that appears invalid.
 */
const invalidReportReviewSchema = z.object({
    outcome: z.enum(['inconclusive', 'false_report']),
    reason: z.string().trim().max(1000).optional().default(''),
});

router.patch('/:id/review', authenticate, authorize('admin', 'dispatcher'), async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = invalidReportReviewSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Choose a valid report review outcome.', details: parsed.error.flatten() });
        return;
    }
    const { outcome, reason } = parsed.data;
    if (outcome === 'inconclusive' && !reason.trim()) {
        res.status(400).json({ error: 'Enter a reason for marking the report inconclusive.' });
        return;
    }

    try {
        const { data, error } = await supabaseAdmin.rpc('review_incident_report', {
            p_report_id: req.params.id,
            p_review_outcome: outcome,
            p_review_reason: reason,
            p_reviewed_by: req.user!.userId,
        });
        if (error) {
            const status = error.code === 'P0002' ? 404
                : error.code === 'P0001' ? 409
                    : error.code === '22023' ? 400
                        : 500;
            res.status(status).json({ error: error.message || 'Could not save the report review.' });
            return;
        }

        const result = data as {
            report?: any;
            false_report_count?: number | null;
            resident_status?: string | null;
            already_reviewed?: boolean;
        };
        if (!result?.report) {
            res.status(500).json({ error: 'Report review returned no report.' });
            return;
        }

        const formatted = formatIncidentReport(result.report);
        io.to('dashboard_staff').emit('incident_report:reviewed', formatted);
        io.to('dashboard_staff').emit('incident_report:updated', formatted);
        io.emit('incident_report:updated', formatted);
        if (formatted.reporter_id) {
            io.to(`user:${formatted.reporter_id}`).emit('incident_report:reviewed', formatted);
        }

        res.json({
            report: formatted,
            false_report_count: result.false_report_count ?? null,
            resident_status: result.resident_status ?? null,
            already_reviewed: result.already_reviewed === true,
        });
    } catch (err) {
        console.error('Invalid report review error:', err);
        res.status(500).json({ error: 'Failed to save the report review.' });
    }
});

export default router;
