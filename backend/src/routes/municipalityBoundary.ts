import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import {
  getMunicipalityBoundaryConfiguration,
  isPointInBoundary,
  normalizeBoundaryGeometry,
  validateBoundaryGeometry,
} from '../utils/norzagarayBoundary';

const router = Router();

router.get('/history', authenticate, authorize('logistics'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from('municipality_boundary_history')
      .select('geometry, is_enabled, revision, updated_by, updated_at')
      .eq('municipality_key', 'norzagaray')
      .order('revision', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json((data || []).map((row) => ({
      geometry: row.geometry,
      enabled: row.is_enabled,
      revision: row.revision,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    })));
  } catch (error) {
    console.error('Fetch municipality boundary history error:', error);
    res.status(500).json({ error: 'Failed to load municipality boundary history' });
  }
});

router.get('/', async (_req, res: Response): Promise<void> => {
  try {
    res.json(await getMunicipalityBoundaryConfiguration());
  } catch (error) {
    console.error('Fetch municipality boundary error:', error);
    res.status(500).json({ error: 'Failed to load municipality boundary' });
  }
});

const updateSchema = z.object({
  geometry: z.unknown(),
  enabled: z.boolean(),
  expectedRevision: z.number().int().nonnegative(),
});

router.put('/', authenticate, authorize('logistics'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = updateSchema.parse(req.body);
    const geometry = normalizeBoundaryGeometry(body.geometry);
    const validationError = validateBoundaryGeometry(geometry);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const { data: current, error: readError } = await supabaseAdmin
      .from('municipality_boundary_config')
      .select('geometry, is_enabled, revision, updated_by, updated_at')
      .eq('municipality_key', 'norzagaray')
      .maybeSingle();
    if (readError) throw readError;

    const revision = Number(current?.revision ?? 0);
    if (revision !== body.expectedRevision) {
      res.status(409).json({
        error: 'The municipality boundary changed. Reload it before saving again.',
        currentRevision: revision,
      });
      return;
    }

    const nextRevision = revision + 1;
    const savedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('municipality_boundary_config')
      .update({
        geometry,
        is_enabled: body.enabled,
        revision: nextRevision,
        updated_by: req.user?.userId ?? null,
        updated_at: savedAt,
      })
      .eq('municipality_key', 'norzagaray')
      .eq('revision', revision)
      .select('geometry, is_enabled, revision, updated_by, updated_at')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      res.status(409).json({
        error: 'The municipality boundary changed. Reload it before saving again.',
      });
      return;
    }

    const { error: historyError } = await supabaseAdmin
      .from('municipality_boundary_history')
      .upsert({
        municipality_key: 'norzagaray',
        revision: updated.revision,
        geometry: updated.geometry,
        is_enabled: updated.is_enabled,
        updated_by: updated.updated_by,
        updated_at: updated.updated_at,
      }, { onConflict: 'municipality_key,revision' });
    if (historyError) console.error('Save municipality boundary history error:', historyError);

    res.json({
      geometry: updated.geometry,
      enabled: updated.is_enabled,
      revision: updated.revision,
      updated_by: updated.updated_by,
      updated_at: updated.updated_at,
    });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      res.status(400).json({ error: error.errors });
      return;
    }
    if (error instanceof Error && error.message.startsWith('Boundary must be a GeoJSON')) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Save municipality boundary error:', error);
    res.status(500).json({ error: 'Failed to save municipality boundary' });
  }
});

export default router;
