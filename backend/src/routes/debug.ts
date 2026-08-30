import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

const debugOnly = (_req: Request, res: Response, next: () => void) => {
  if (!config.enableDebugQuickLogin) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
};

// Development-only account picker. It never exposes passwords; selecting an
// account issues a temporary development session instead.
router.get('/accounts', debugOnly, async (req: Request, res: Response) => {
  const audience = req.query.audience === 'barangay' ? 'barangay' : 'standard';
  try {
    if (audience === 'barangay') {
      const { data, error } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name, email, role, barangay_id, is_active')
        .eq('is_active', true)
        .order('full_name');
      if (error) throw error;
      res.json({ accounts: data.map((user) => ({ ...user, audience })) });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('users')
        .select('id, full_name, email, phone, role, unit_type, status, verified')
      .eq('status', 'active')
      .order('full_name');
    if (error) throw error;
    res.json({ accounts: data.map((user) => ({ ...user, audience })) });
  } catch (err) {
    console.error('Debug account list error:', err);
    res.status(500).json({ error: 'Unable to load debug accounts' });
  }
});

router.post('/quick-login', debugOnly, async (req: Request, res: Response) => {
  const { accountId, audience } = req.body as { accountId?: string; audience?: string };
  if (!accountId || !['standard', 'barangay'].includes(audience || '')) {
    res.status(400).json({ error: 'Valid account and audience are required' });
    return;
  }
  try {
    if (audience === 'barangay') {
      const { data: user, error } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name, email, phone, role, barangay_id, is_active')
        .eq('id', accountId).eq('is_active', true).single();
      if (error || !user) {
        res.status(404).json({ error: 'Active account not found' });
        return;
      }
      const { data: barangay } = await supabaseAdmin
        .from('barangays').select('name, municipality').eq('id', user.barangay_id).single();
      const token = jwt.sign(
        { userId: user.id, barangayId: user.barangay_id, role: user.role, debug: true },
        config.jwtSecret, { expiresIn: '1h' },
      );
      res.json({ token, user: { ...user, barangay_name: barangay?.name || '', municipality: barangay?.municipality || 'Norzagaray' } });
      return;
    }
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, phone, role, unit_type, status, verified')
      .eq('id', accountId).eq('status', 'active').single();
    if (error || !user) {
      res.status(404).json({ error: 'Active account not found' });
      return;
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, unitType: user.unit_type, debug: true },
      config.jwtSecret, { expiresIn: '1h' },
    );
    res.json({ token, user });
  } catch (err) {
    console.error('Debug quick login error:', err);
    res.status(500).json({ error: 'Unable to create debug session' });
  }
});

export default router;
