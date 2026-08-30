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
router.post('/', optionalAuthenticate, upload.single('proof'), async (req: AuthRequest, res: Response): Promise<void> => {
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

    let proofUrl = null;
    const file = req.file;

    // Handle incident proof upload
    if (file) {
      const ext = file.originalname.split('.').pop() || 'jpg';
      const timestamp = Date.now();
      const filename = `reports/${reporter_type || 'anonymous'}/${timestamp}.${ext}`;

      const { error: uploadError } = await supabaseAdmin
        .storage
        .from(config.supabaseBucketName)
        .upload(filename, file.buffer, {
          contentType: file.mimetype,
          upsert: true
        });

      if (!uploadError) {
        const { data: { publicUrl } } = supabaseAdmin
          .storage
          .from(config.supabaseBucketName)
          .getPublicUrl(filename);
        proofUrl = publicUrl;
      }
    }

    // Insert into database
    const { data: report, error: dbError } = await supabaseAdmin
      .from('incident_reports')
      .insert({
        type,
        title,
        specifics,
        description,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        proof_url: proofUrl,
        proof_type: proof_type || 'image',
        reporter_type: reporter_type || 'resident',
        reporter_id: req.user?.userId || null,
        reporter_name: reporterName,
        reporter_phone: reporterPhone,
        barangay_id: resolvedBarangayId,
        status: 'pending'
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      res.status(500).json({ error: 'Failed to save report to database.' });
      return;
    }

    // Emit socket event for real-time notification
    io.to('commanders').emit('incident_report:new', report);

    // Notify specific barangay room if assigned
    if (resolvedBarangayId) {
      io.to(`barangay:${resolvedBarangayId}`).emit('barangay:report_received', report);
    }

    res.status(201).json({
      message: 'Report submitted successfully.',
      report
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
            .select('*')
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

        res.json(reports);
    } catch (err) {
        console.error('Fetch reports error:', err);
        res.status(500).json({ error: 'Internal server error' });
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
