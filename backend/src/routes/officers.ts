import { Router, Response } from 'express';
import { z } from 'zod';
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

const officerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  specialization: z.string().trim().min(1).max(120),
  rank: z.string().trim().max(80).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

// POST /api/officers - create new officer
router.post('/', authenticate, authorize('admin', 'logistics', 'master_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = officerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a name and specialization, and check the contact details.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('officers')
      .insert([{ ...parsed.data, status: parsed.data.status || 'active' }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/officers/:id - update officer
router.patch('/:id', authenticate, authorize('admin', 'logistics', 'master_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = officerSchema.partial().safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
      res.status(400).json({ error: 'Provide valid officer details to update.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('officers')
      .update(parsed.data)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Officer not found.' });
      return;
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/officers/:id - delete officer
router.delete('/:id', authenticate, authorize('admin', 'logistics', 'master_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('officers')
      .delete()
      .eq('id', id);

    if (error?.code === '23503') {
      res.status(409).json({ error: 'This officer is assigned to a response unit. Remove them from the unit before deleting the record.' });
      return;
    }
    if (error) throw error;
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
