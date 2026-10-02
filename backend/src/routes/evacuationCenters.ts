import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticateBarangay } from './barangay';
import { getVerifiedBarangayIds } from '../services/verifiedBarangayService';

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
// Public operations list; the resident-facing directory uses /nearest.

router.get('/', async (req: Request, res: Response) => {
  try {
    const { barangay_id } = req.query;
    const barangayAddedOnly = req.query.barangay_added === 'true' || req.query.barangay_added === '1';
    const verifiedOnly = req.query.verified_only === 'true' || req.query.verified_only === '1';

    let query = supabaseAdmin
      .from('evacuation_centers')
      .select(`
        id,
        name,
        address,
        latitude,
        longitude,
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
    if (barangayAddedOnly) {
      query = query.not('created_by', 'is', null);
    }

    const { data: centers, error } = await query;
    if (error) throw error;

    const verifiedIds = verifiedOnly ? new Set(await getVerifiedBarangayIds()) : null;
    const visibleCenters = (centers || []).filter((center: any) => !verifiedIds || verifiedIds.has(center.barangay_id));
    res.json(visibleCenters);
  } catch (err) {
    console.error('Fetch evacuation centers error:', err);
    res.status(500).json({ error: 'Failed to fetch evacuation centers' });
  }
});

// ─── GET /api/evacuation-centers/nearest ─────────────────────────────────────
// Public: return the nearest active stations, distance, and estimated travel time.

router.get('/nearest', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, limit = '5' } = req.query;
    if (!latitude || !longitude) {
      res.status(400).json({ error: 'latitude and longitude are required' });
      return;
    }

    const lat = parseFloat(latitude as string);
    const lng = parseFloat(longitude as string);
    const verifiedOnly = req.query.verified_only === 'true' || req.query.verified_only === '1';

    const { data: centers, error } = await supabaseAdmin
      .from('evacuation_centers')
      .select(`
        id, name, address, latitude, longitude,
        barangays ( id, name, municipality )
      `)
      .eq('is_active', true);

    if (error) throw error;

    const verifiedIds = verifiedOnly ? new Set(await getVerifiedBarangayIds()) : null;
    const sorted = (centers || [])
      .filter((center: any) => !verifiedIds || verifiedIds.has(center.barangay_id))
      .map((c: any) => ({
        ...c,
        distance_km: haversineDistance(lat, lng, c.latitude, c.longitude),
      }))
      .sort((a: any, b: any) => a.distance_km - b.distance_km)
      .slice(0, Math.max(1, Math.min(20, parseInt(limit as string, 10) || 5)))
      .map((center: any) => ({
        ...center,
        estimated_travel_minutes: Math.max(1, Math.round((center.distance_km * 1.3 / 25) * 60)),
        distance_method: 'straight-line distance; travel time estimated at 25 km/h with a 1.3 road-distance factor',
      }));

    res.json(sorted);
  } catch (err) {
    console.error('Nearest evac centers error:', err);
    res.status(500).json({ error: 'Failed to find nearest centers' });
  }
});

// ─── POST /api/evacuation-centers ─────────────────────────────────────────────
// Administrator, responder, or staff: create new evac center

const createCenterSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
});

router.post('/', authenticateBarangay, async (req: any, res: Response): Promise<void> => {
  try {
    if (!['admin', 'responder', 'staff'].includes(req.barangayUser?.role)) {
      res.status(403).json({ error: 'Your account cannot add evacuation centers.' });
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
        id, name, address, latitude, longitude, is_active, created_at, barangay_id,
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

export default router;
