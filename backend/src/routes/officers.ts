import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

// GET /api/officers - list all officers
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('officers')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json({ officers: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/officers - create new officer
router.post('/', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, phone, email, specialization, rank, status } = req.body;
    
    if (!name || !specialization) {
      res.status(400).json({ error: 'Name and specialization are required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('officers')
      .insert([{ name, phone, email, specialization, rank, status: status || 'active' }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/officers/:id - update officer
router.patch('/:id', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data, error } = await supabaseAdmin
      .from('officers')
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

// DELETE /api/officers/:id - delete officer
router.delete('/:id', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('officers')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
