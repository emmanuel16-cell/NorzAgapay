import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getRouteWithBlockedAvoidance } from '../services/matchingEngine';

const router = Router();

// POST /api/matching/route — get route between two points
router.post('/route', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { origin_lat, origin_lng, dest_lat, dest_lng } = req.body;
    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng) {
      res.status(400).json({ error: 'origin_lat, origin_lng, dest_lat, dest_lng are required.' });
      return;
    }
    const route = await getRouteWithBlockedAvoidance(origin_lat, origin_lng, dest_lat, dest_lng);
    if (!route) {
      res.status(404).json({ error: 'No route found.' });
      return;
    }
    res.json({ route });
  } catch (err) {
    console.error('Route error:', err);
    res.status(500).json({ error: 'Failed to get route.' });
  }
});

export default router;
