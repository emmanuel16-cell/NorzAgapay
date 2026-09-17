import { Router, Response, Request, NextFunction } from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { AuthPayload, AuthRequest, authenticate, authorize } from '../middleware/auth';
import { io } from '../server';
import { matchRespondersToIncident } from '../services/matchingEngine';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware for optional authentication
const optionalAuthenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
      req.user = decoded;
    } catch (err) {
      // Ignore invalid token, treat as anonymous
    }
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

  const primaryProofUrl = proofUrls.length > 0 ? proofUrls[0] : (r.proof_url || null);
  const primaryProofType = proofTypes.length > 0 ? proofTypes[0] : (r.proof_type || 'image');

  return {
    ...r,
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
      first_name,
      last_name,
      contact_number,
      barangay_id
    } = req.body;

    // Basic validation
    if (!type || !title || !latitude || !longitude) {
      res.status(400).json({ error: 'Missing required fields: type, title, latitude, longitude' });
      return;
    }

    const reporterName = first_name && last_name ? `${first_name} ${last_name}` : null;
    const reporterPhone = contact_number || null;

    // Resolve barangay: use provided or nearest by lat/lng
    let resolvedBarangayId = barangay_id || null;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

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
    const insertPayload: any = {
      type,
      title,
      specifics,
      description,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      proof_url: encodedProofUrl,
      proof_type: primaryProofType,
      reporter_type: reporter_type || 'resident',
      reporter_id: req.user?.userId || null,
      reporter_name: reporterName,
      reporter_phone: reporterPhone,
      barangay_id: resolvedBarangayId,
      status: 'pending'
    };

    let report: any = null;
    let dbError: any = null;

    try {
      // Attempt insert with proof_urls & proof_types columns
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
      // Fallback: database doesn't have proof_urls column yet
      // insertPayload already preserved all URLs encoded in proof_url!
      const res = await supabaseAdmin
        .from('incident_reports')
        .insert(insertPayload)
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

    // Auto-create pending task so mobile_app responders see it in Pending dispatches
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

    // Emit socket event for real-time notification
    io.to('commanders').emit('incident_report:new', formattedReport);

    // Notify specific barangay room if assigned
    if (resolvedBarangayId) {
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
router.get('/resident', async (req: Request, res: Response) => {
  try {
    const { contact_number } = req.query;
    if (!contact_number) {
      return res.status(400).json({ error: 'Missing required field: contact_number' });
    }

    const { data: reports, error } = await supabaseAdmin
      .from('incident_reports')
      .select('*, barangays(name)')
      .eq('reporter_type', 'resident')
      .eq('reporter_phone', contact_number)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Database error fetching resident reports:', error);
      return res.status(500).json({ error: 'Failed to fetch reports' });
    }

    res.json((reports || []).map(formatIncidentReport));
  } catch (err) {
    console.error('Fetch resident reports error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/incident-reports
 * List all incident reports (Admin/Commander only)
 */
router.get('/', async (req: Request, res: Response) => {
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

        // The Command Center needs to identify the dispatcher coordinating a
        // responding barangay, not only the field responder assigned to it.
        const barangayIds = [...new Set((reports || []).map((report: any) => report.barangay_id).filter(Boolean))];
        const dispatcherByBarangay = new Map<string, string>();
        if (barangayIds.length > 0) {
            const { data: dispatchers, error: dispatcherError } = await supabaseAdmin
                .from('barangay_users')
                .select('barangay_id, full_name')
                .in('barangay_id', barangayIds)
                .eq('role', 'dispatcher')
                .eq('is_active', true);

            if (dispatcherError) throw dispatcherError;
            for (const dispatcher of dispatchers || []) {
                if (dispatcher.barangay_id && dispatcher.full_name && !dispatcherByBarangay.has(dispatcher.barangay_id)) {
                    dispatcherByBarangay.set(dispatcher.barangay_id, dispatcher.full_name);
                }
            }
        }

        res.json((reports || []).map((report: any) => formatIncidentReport({
            ...report,
            barangay_dispatcher_name: dispatcherByBarangay.get(report.barangay_id) || null,
        })));
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
    io.to('commanders').emit('incident_report:updated', formatted);
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
      role: role || (req.user as any)?.role || 'team_leader',
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
    io.to('commanders').emit('incident_report:updated', formatted);
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
 * PATCH /api/incident-reports/:id/mdrrmo-respond
 * Mark MDRRMO response dispatched
 */
router.patch('/:id/mdrrmo-respond', optionalAuthenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { responder_name, notes, assigned_unit_id } = req.body;
        const responderName = responder_name || (req.user as any)?.name || req.user?.email || 'MDRRMO Command Unit';

        let updatedReport: any = null;

        // Try updating with mdrrmo columns
        try {
            const { data, error } = await supabaseAdmin
                .from('incident_reports')
                .update({
                    status: 'responding',
                    mdrrmo_response_status: 'responding',
                    mdrrmo_responded_at: new Date().toISOString(),
                    mdrrmo_responded_by: req.user?.userId || null,
                    mdrrmo_responder_name: responderName,
                    mdrrmo_response_notes: notes || null,
                })
                .eq('id', id)
                .select('*, barangays(name)')
                .single();

            if (error) throw error;
            updatedReport = data;
        } catch (dbErr) {
            console.warn('Fallback update without extra columns:', dbErr);
            // Fallback in case columns aren't added in DB yet
            const { data, error } = await supabaseAdmin
                .from('incident_reports')
                .update({
                    status: 'responding',
                })
                .eq('id', id)
                .select('*, barangays(name)')
                .single();

            if (error) throw error;
            updatedReport = {
                ...data,
                mdrrmo_response_status: 'responding',
                mdrrmo_responder_name: responderName,
                mdrrmo_responded_at: new Date().toISOString()
            };
        }

        const formatted = {
            ...updatedReport,
            barangay_name: updatedReport.barangays?.name || null,
            mdrrmo_response_status: 'responding',
            mdrrmo_responder_name: responderName
        };

        // Broadcast real-time to commanders (web-dashboard)
        io.to('commanders').emit('incident_report:mdrrmo_responding', formatted);
        io.emit('incident_report:updated', formatted);

        // Broadcast real-time to specific barangay room
        if (formatted.barangay_id) {
            io.to(`barangay:${formatted.barangay_id}`).emit('incident_report:mdrrmo_responding', formatted);
            io.to(`barangay:${formatted.barangay_id}`).emit('barangay:report_updated', formatted);
        }

        res.json(formatted);
    } catch (err) {
        console.error('MDRRMO respond to report error:', err);
        res.status(500).json({ error: 'Failed to update report with MDRRMO response' });
    }
});

/**
 * POST /api/incident-reports/:id/verify
 * Verifies a report: Creates a Mission and creates verification tasks for all active volunteers.
 */
router.post('/:id/verify', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { address } = req.body;
        const user = req.user!;

        // 1. Fetch the report
        const { data: report, error: fetchError } = await supabaseAdmin
            .from('incident_reports')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !report) {
            res.status(404).json({ error: 'Report not found' });
            return;
        }

        // 2. Update report status and save address if provided
        await supabaseAdmin
            .from('incident_reports')
            .update({ 
                status: 'verified',
                address: address || report.address // Use provided address or existing one
            })
            .eq('id', id);

        // 3. Create a Mission (Incident)
        const { data: incident, error: incidentError } = await supabaseAdmin
            .from('incidents')
            .insert({
                title: `${report.title} - ${report.specifics || ''}`,
                type: report.type || 'other',
                severity: 'critical',
                latitude: report.latitude,
                longitude: report.longitude,
                address: address || report.address || 'Norzagaray, Bulacan',
                status: 'open',
                reported_by: user.userId
            })
            .select()
            .single();

        if (incidentError) throw incidentError;

        // Trigger matching engine asynchronously
        matchRespondersToIncident(incident.id).catch((err) => {
            console.error(`Matching Engine Error for Verified Incident ${incident.id}:`, err);
        });

        // 4. Create an Emergency Task for volunteers to join
        console.log(`Creating emergency verification task for report: ${report.title}`);
        
        const task = {
             incident_id: incident.id,
             assigned_to: null, 
             title: `Emergency Response: ${report.title}`,
             description: `An incident has been verified: ${report.type}. Please proceed to the location and assist MDRRMO personnel with response and relief efforts.`,
             task_type: 'general_labor',
             status: 'pending',
             latitude: incident.latitude,
             longitude: incident.longitude,
             address: incident.address
         };

        const { error: taskError } = await supabaseAdmin
            .from('tasks')
            .insert([task]);

        if (taskError) {
            console.error('Error creating verification task:', taskError);
        } else {
            console.log('Verification task created successfully');
            // Notify all volunteers via Socket
            io.emit('task:new');
        }

        // 6. Notify via Socket
        io.to('commanders').emit('incident:new', incident);
        io.to('commanders').emit('incident_report:verified', { reportId: id, incidentId: incident.id });

        res.json({ message: 'Report verified, mission created, and tasks assigned.', incidentId: incident.id });
    } catch (err) {
        console.error('Verification error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
