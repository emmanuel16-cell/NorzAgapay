import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

// GET /api/respond-units - list all units
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('respond_units')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ units: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/respond-units - create new unit
router.post('/', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { unit_name, specialization, officer_ids } = req.body;
    
    if (!unit_name || !specialization) {
      res.status(400).json({ error: 'Unit name and specialization are required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('respond_units')
      .insert([{ 
        unit_name, 
        specialization, 
        officer_ids: officer_ids || [],
        status: 'available'
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/respond-units/:id - update unit
router.patch('/:id', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data, error } = await supabaseAdmin
      .from('respond_units')
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

// DELETE /api/respond-units/:id - delete unit
router.delete('/:id', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('respond_units')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
