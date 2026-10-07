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

const activateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  expectedUpdatedAt: z.string().nullable(),
});

router.post('/history/:revision/use', authenticate, authorize('logistics'), async (req: AuthRequest, res: Response): Promise<void> => {
  const selectedRevision = Number(req.params.revision);
  if (!Number.isSafeInteger(selectedRevision) || selectedRevision < 1) {
    res.status(400).json({ error: 'A valid boundary revision is required.' });
    return;
  }

  try {
    const body = activateSchema.parse(req.body);
    const { data: current, error: readError } = await supabaseAdmin
      .from('municipality_boundary_config')
      .select('geometry, revision, updated_at')
      .eq('municipality_key', 'norzagaray')
      .maybeSingle();
    if (readError) throw readError;

    const currentRevision = Number(current?.revision ?? 0);
    const currentUpdatedAt = current?.updated_at ?? null;
    if (currentRevision !== body.expectedRevision || currentUpdatedAt !== body.expectedUpdatedAt) {
      res.status(409).json({
        error: 'The municipality boundary changed. Reload it before using another version.',
        currentRevision,
      });
      return;
    }

    let selectedGeometry = selectedRevision === currentRevision ? current?.geometry : null;
    if (selectedRevision !== currentRevision) {
      const { data: selected, error: selectedError } = await supabaseAdmin
        .from('municipality_boundary_history')
        .select('geometry')
        .eq('municipality_key', 'norzagaray')
        .eq('revision', selectedRevision)
        .maybeSingle();
      if (selectedError) throw selectedError;
      if (!selected) {
        res.status(404).json({ error: 'That saved boundary version was not found.' });
        return;
      }
      selectedGeometry = selected.geometry;
    }

    const geometry = normalizeBoundaryGeometry(selectedGeometry);
    const validationError = validateBoundaryGeometry(geometry);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const { data: activated, error: activateError } = await supabaseAdmin
      .from('municipality_boundary_config')
      .update({
        geometry,
        is_enabled: true,
        revision: selectedRevision,
        updated_by: req.user?.userId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('municipality_key', 'norzagaray')
      .eq('revision', body.expectedRevision)
      .eq('updated_at', body.expectedUpdatedAt ?? '')
      .select('geometry, is_enabled, revision, updated_by, updated_at')
      .maybeSingle();
    if (activateError) throw activateError;
    if (!activated) {
      res.status(409).json({ error: 'The municipality boundary changed. Reload it before using another version.' });
      return;
    }

    res.json({
      geometry: activated.geometry,
      enabled: activated.is_enabled,
      revision: activated.revision,
      updated_by: activated.updated_by,
      updated_at: activated.updated_at,
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
    console.error('Activate municipality boundary version error:', error);
    res.status(500).json({ error: 'Failed to use municipality boundary version' });
  }
});

router.delete('/history/:revision', authenticate, authorize('logistics'), async (req: AuthRequest, res: Response): Promise<void> => {
  const revision = Number(req.params.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    res.status(400).json({ error: 'A valid boundary revision is required.' });
    return;
  }

  try {
    const { data: current, error: readError } = await supabaseAdmin
      .from('municipality_boundary_config')
      .select('revision')
      .eq('municipality_key', 'norzagaray')
      .maybeSingle();
    if (readError) throw readError;
    if (Number(current?.revision ?? 0) === revision) {
      res.status(409).json({ error: 'The boundary currently in use cannot be deleted. Use another version first.' });
      return;
    }

    const { data: deleted, error: deleteError } = await supabaseAdmin
      .from('municipality_boundary_history')
      .delete()
      .eq('municipality_key', 'norzagaray')
      .eq('revision', revision)
      .select('revision')
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) {
      res.status(404).json({ error: 'That saved boundary version was not found.' });
      return;
    }

    res.json({ success: true, revision });
  } catch (error) {
    console.error('Delete municipality boundary version error:', error);
    res.status(500).json({ error: 'Failed to delete municipality boundary version' });
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
  expectedUpdatedAt: z.string().nullable(),
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
    const currentUpdatedAt = current?.updated_at ?? null;
    if (revision !== body.expectedRevision || currentUpdatedAt !== body.expectedUpdatedAt) {
      res.status(409).json({
        error: 'The municipality boundary changed. Reload it before saving again.',
        currentRevision: revision,
      });
      return;
    }

    const { data: latestHistory, error: historyReadError } = await supabaseAdmin
      .from('municipality_boundary_history')
      .select('revision')
      .eq('municipality_key', 'norzagaray')
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (historyReadError) throw historyReadError;
    const nextRevision = Math.max(revision, Number(latestHistory?.revision ?? 0)) + 1;
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
      .eq('updated_at', body.expectedUpdatedAt ?? '')
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
