import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

// GET /api/storages - list all storages
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('storages')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json({ storages: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/storages - create new storage
router.post('/', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, address, capacity, status, latitude, longitude } = req.body;
    
    if (!name) {
      res.status(400).json({ error: 'Storage name is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('storages')
      .insert([{ name, address, capacity, status: status || 'active', latitude, longitude }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/storages/:id - update storage
router.patch('/:id', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data, error } = await supabaseAdmin
      .from('storages')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/storages/:id - delete storage
router.delete('/:id', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('storages')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
