import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { matchRespondersToIncident, getRouteWithBlockedAvoidance } from '../services/matchingEngine';

const router = Router();

// POST /api/matching/dispatch/:incidentId — trigger matching engine
router.post(
  '/dispatch/:incidentId',
  authenticate,
  authorize('admin', 'commander'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { incidentId } = req.params;
      const { unitId } = req.body;
      console.log(`Manual dispatch for mission ${incidentId} with unit ${unitId}`);
      const result = await matchRespondersToIncident(incidentId, unitId);
      res.json({ message: 'Matching engine executed.', result, unitId });
    } catch (err: any) {
      console.error('Matching engine error:', err);
      res.status(500).json({ error: err.message || 'Matching engine failed.' });
    }
  }
);

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
