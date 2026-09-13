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
 * POST /api/incident-reports
 * Handles report submission from mobile and resident apps.
 * Supports multipart/form-data for proof file upload.
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

    const uploadedFiles: Express.Multer.File[] = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
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

    const proofUrl = proofUrls.length > 0 ? proofUrls[0] : null;
    const finalProofType = proofTypes.length > 0 ? proofTypes[0] : (proof_type || 'image');

    // Insert into database
    const insertPayload: any = {
      type,
      title,
      specifics,
      description,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      proof_url: proofUrl,
      proof_type: finalProofType,
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
      // Fallback without proof_urls / proof_types columns
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

    const formattedReport = {
      ...report,
      proof_urls: (report as any)?.proof_urls?.length ? (report as any).proof_urls : proofUrls,
      proof_types: (report as any)?.proof_types?.length ? (report as any).proof_types : proofTypes,
      barangay_name: (report as any)?.barangays?.name || null
    };

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
            .select('*')
            .eq('reporter_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Database error fetching user reports:', error);
            res.status(500).json({ error: 'Failed to fetch your reports' });
            return;
        }

        res.json(reports);
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
      .select('*')
      .eq('reporter_type', 'resident')
      .eq('reporter_phone', contact_number)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Database error fetching resident reports:', error);
      return res.status(500).json({ error: 'Failed to fetch reports' });
    }

    res.json(reports);
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

        const formatted = (reports || []).map((r: any) => ({
            ...r,
            barangay_name: r.barangays?.name || null
        }));

        res.json(formatted);
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
      updatePayload.proof_url = allUrls[0];
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

    const formatted = {
      ...updatedReport,
      proof_urls: allUrls,
      barangay_name: updatedReport?.barangays?.name || null
    };

    io.emit('incident_report:updated', formatted);
    res.json(formatted);
  } catch (err) {
    console.error('Update report error:', err);
    res.status(500).json({ error: 'Failed to update report' });
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
