import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticateBarangay } from './barangay';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Helper: calculate distance between two lat/lng points (km) ─────────────
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─── GET /api/evacuation-centers ─────────────────────────────────────────────
// Public: list all active evacuation centers with occupancy stats

router.get('/', async (req: Request, res: Response) => {
  try {
    const { barangay_id } = req.query;

    let query = supabaseAdmin
      .from('evacuation_centers')
      .select(`
        id,
        name,
        address,
        latitude,
        longitude,
        max_capacity,
        is_active,
        created_at,
        barangay_id,
        barangays ( id, name, municipality )
      `)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (barangay_id) {
      query = query.eq('barangay_id', barangay_id as string);
    }

    const { data: centers, error } = await query;
    if (error) throw error;

    // Attach occupancy counts
    const centersWithOccupancy = await Promise.all(
      (centers || []).map(async (center: any) => {
        const { data: registrations } = await supabaseAdmin
          .from('evacuee_registrations')
          .select('person_count, has_infants, has_elderly, has_pwd, has_pregnant')
          .eq('evac_center_id', center.id);

        const totalPersons = registrations?.reduce((sum, r) => sum + (r.person_count || 0), 0) || 0;
        const stats = {
          total_persons: totalPersons,
          with_infants: registrations?.filter((r) => r.has_infants).length || 0,
          with_elderly: registrations?.filter((r) => r.has_elderly).length || 0,
          with_pwd: registrations?.filter((r) => r.has_pwd).length || 0,
          with_pregnant: registrations?.filter((r) => r.has_pregnant).length || 0,
          registration_count: registrations?.length || 0,
          occupancy_percent: center.max_capacity > 0
            ? Math.min(100, Math.round((totalPersons / center.max_capacity) * 100))
            : 0,
        };

        return { ...center, ...stats };
      })
    );

    res.json(centersWithOccupancy);
  } catch (err) {
    console.error('Fetch evacuation centers error:', err);
    res.status(500).json({ error: 'Failed to fetch evacuation centers' });
  }
});

// ─── GET /api/evacuation-centers/nearest ─────────────────────────────────────
// Public: get nearest evacuation centers given lat/lng

router.get('/nearest', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, limit = '5' } = req.query;
    if (!latitude || !longitude) {
      res.status(400).json({ error: 'latitude and longitude are required' });
      return;
    }

    const lat = parseFloat(latitude as string);
    const lng = parseFloat(longitude as string);

    const { data: centers, error } = await supabaseAdmin
      .from('evacuation_centers')
      .select(`
        id, name, address, latitude, longitude, max_capacity, barangay_id,
        barangays ( id, name, municipality )
      `)
      .eq('is_active', true);

    if (error) throw error;

    const sorted = (centers || [])
      .map((c: any) => ({
        ...c,
        distance_km: haversineDistance(lat, lng, c.latitude, c.longitude),
      }))
      .sort((a: any, b: any) => a.distance_km - b.distance_km)
      .slice(0, parseInt(limit as string));

    res.json(sorted);
  } catch (err) {
    console.error('Nearest evac centers error:', err);
    res.status(500).json({ error: 'Failed to find nearest centers' });
  }
});

// ─── GET /api/evacuation-centers/:id ─────────────────────────────────────────
// Public: get single center with full registration details

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data: center, error } = await supabaseAdmin
      .from('evacuation_centers')
      .select(`
        id, name, address, latitude, longitude, max_capacity, is_active, created_at,
        barangay_id, barangays ( id, name, municipality )
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !center) {
      res.status(404).json({ error: 'Evacuation center not found' });
      return;
    }

    const { data: registrations } = await supabaseAdmin
      .from('evacuee_registrations')
      .select('*')
      .eq('evac_center_id', req.params.id)
      .order('registered_at', { ascending: false });

    const totalPersons = registrations?.reduce((sum, r) => sum + (r.person_count || 0), 0) || 0;

    res.json({
      ...center,
      registrations: registrations || [],
      total_persons: totalPersons,
      registration_count: registrations?.length || 0,
      occupancy_percent: (center as any).max_capacity > 0
        ? Math.min(100, Math.round((totalPersons / (center as any).max_capacity) * 100))
        : 0,
    });
  } catch (err) {
    console.error('Get evacuation center error:', err);
    res.status(500).json({ error: 'Failed to fetch evacuation center' });
  }
});

// ─── POST /api/evacuation-centers ─────────────────────────────────────────────
// Barangay captain/team leader: create new evac center

const createCenterSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  max_capacity: z.number().int().positive(),
});

router.post('/', authenticateBarangay, async (req: any, res: Response): Promise<void> => {
  try {
    if (!['captain', 'team_leader'].includes(req.barangayUser?.role)) {
      res.status(403).json({ error: 'Only captains and team leaders can add evacuation centers' });
      return;
    }

    const body = createCenterSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('evacuation_centers')
      .insert({
        ...body,
        barangay_id: req.barangayUser.barangayId,
        created_by: req.barangayUser.userId,
      })
      .select(`
        id, name, address, latitude, longitude, max_capacity, is_active, created_at, barangay_id,
        barangays ( id, name, municipality )
      `)
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error('Create evac center error:', err);
    res.status(500).json({ error: 'Failed to create evacuation center' });
  }
});

// ─── PATCH /api/evacuation-centers/:id ───────────────────────────────────────

router.patch('/:id', authenticateBarangay, async (req: any, res: Response): Promise<void> => {
  try {
    if (!['captain', 'team_leader'].includes(req.barangayUser?.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    const { name, address, max_capacity, is_active } = req.body;

    const { data, error } = await supabaseAdmin
      .from('evacuation_centers')
      .update({ name, address, max_capacity, is_active })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Update evac center error:', err);
    res.status(500).json({ error: 'Failed to update evacuation center' });
  }
});

// ─── DELETE /api/evacuation-centers/:id ──────────────────────────────────────

router.delete('/:id', authenticateBarangay, async (req: any, res: Response): Promise<void> => {
  try {
    if (req.barangayUser?.role !== 'captain') {
      res.status(403).json({ error: 'Only captains can delete evacuation centers' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('evacuation_centers')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('barangay_id', req.barangayUser.barangayId);

    if (error) throw error;
    res.json({ message: 'Evacuation center deactivated' });
  } catch (err) {
    console.error('Delete evac center error:', err);
    res.status(500).json({ error: 'Failed to delete evacuation center' });
  }
});

// ─── POST /api/evacuation-centers/:id/register ───────────────────────────────
// Public: resident registers themselves and family at an evac center

const registerEvacueeSchema = z.object({
  contact_number: z.string().min(7),
  person_count: z.number().int().positive().default(1),
  has_infants: z.boolean().default(false),
  has_elderly: z.boolean().default(false),
  has_pwd: z.boolean().default(false),
  has_pregnant: z.boolean().default(false),
  notes: z.string().optional(),
});

router.post('/:id/register', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify center exists and is active
    const { data: center, error: centerError } = await supabaseAdmin
      .from('evacuation_centers')
      .select('id, max_capacity, name')
      .eq('id', req.params.id)
      .eq('is_active', true)
      .single();

    if (centerError || !center) {
      res.status(404).json({ error: 'Evacuation center not found or inactive' });
      return;
    }

    const body = registerEvacueeSchema.parse(req.body);

    const { data: registration, error } = await supabaseAdmin
      .from('evacuee_registrations')
      .insert({
        evac_center_id: req.params.id,
        contact_number: body.contact_number,
        person_count: body.person_count,
        has_infants: body.has_infants,
        has_elderly: body.has_elderly,
        has_pwd: body.has_pwd,
        has_pregnant: body.has_pregnant,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: `You have been registered at ${(center as any).name}`,
      registration,
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error('Register evacuee error:', err);
    res.status(500).json({ error: 'Failed to register evacuee' });
  }
});

// ─── GET /api/evacuation-centers/:id/registrations ───────────────────────────

router.get('/:id/registrations', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('evacuee_registrations')
      .select('*')
      .eq('evac_center_id', req.params.id)
      .order('registered_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Fetch registrations error:', err);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});

export default router;
