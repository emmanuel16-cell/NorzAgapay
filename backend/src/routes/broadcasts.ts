import { randomUUID } from 'crypto';
import path from 'path';
import { Request, Response, Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { io } from '../server';
import { DispatcherVerificationService } from '../services/dispatcherVerificationService';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 50 * 1024 * 1024 },
});

const validCategories = new Set([
  'disaster_yellow',
  'disaster_alert_yellow',
  'disaster_orange',
  'disaster_alert_orange',
  'disaster_red',
  'disaster_alert_red',
  'safety_advisory',
  'relief_assistance',
  'all_clear',
  'all_clear_notice',
]);

type MediaItem = { url: string; type: 'image' | 'video' };

function parseLinks(value: unknown): string[] {
  let links: unknown = value;
  if (typeof links === 'string') {
    try {
      links = JSON.parse(links);
    } catch {
      links = links ? [links] : [];
    }
  }
  if (links == null) return [];
  if (!Array.isArray(links)) throw new Error('Links must be a list of URLs.');

  return links.map((item) => {
    const link = String(item).trim();
    if (!link) return '';
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      throw new Error('Each reference link must be a valid URL.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Reference links must use HTTP or HTTPS.');
    }
    return link;
  }).filter(Boolean);
}

function parseExistingMedia(value: unknown): MediaItem[] {
  let media: unknown = value;
  if (typeof media === 'string') {
    try {
      media = JSON.parse(media);
    } catch {
      throw new Error('Existing media data is invalid.');
    }
  }
  if (media == null) return [];
  if (!Array.isArray(media)) throw new Error('Media must be a list.');

  return media.flatMap((item: any) => {
    if (!item || typeof item.url !== 'string' || !item.url.trim()) return [];
    const type = item.type === 'video' ? 'video' : 'image';
    return [{ url: item.url.trim(), type } as MediaItem];
  });
}

async function uploadMedia(
  files: Express.Multer.File[],
  existing: MediaItem[],
  body: Record<string, any>,
): Promise<{ media: MediaItem[]; storagePaths: string[] }> {
  const media = [...existing];
  const storagePaths: string[] = [];

  for (const [index, file] of files.entries()) {
    const isVideo = body[`media_type_${index}`] === 'video' || file.mimetype.startsWith('video/');
    const extension = path.extname(file.originalname) || (isVideo ? '.mp4' : '.jpg');
    const storagePath = `broadcasts/${randomUUID()}${extension}`;
    const { error } = await supabaseAdmin.storage
      .from(config.supabaseBucketName)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (error) {
      if (storagePaths.length) {
        await supabaseAdmin.storage.from(config.supabaseBucketName).remove(storagePaths).catch(() => undefined);
      }
      throw new Error(`Could not upload ${file.originalname}: ${error.message}`);
    }

    storagePaths.push(storagePath);
    const { data } = supabaseAdmin.storage.from(config.supabaseBucketName).getPublicUrl(storagePath);
    media.push({ url: data.publicUrl, type: isVideo ? 'video' : 'image' });
  }

  return { media, storagePaths };
}

async function cleanupUploadedMedia(storagePaths: string[]) {
  if (!storagePaths.length) return;
  await supabaseAdmin.storage.from(config.supabaseBucketName).remove(storagePaths).catch(() => undefined);
}

async function fetchAuthorNames(rows: any[]) {
  const barangayAuthorIds = [...new Set(rows.map((row) => row.author_id).filter(Boolean))];
  const dashboardAuthorIds = [...new Set(rows.map((row) => row.author_user_id).filter(Boolean))];
  const barangayIds = [...new Set(rows.map((row) => row.barangay_id).filter(Boolean))];

  const [barangayAuthors, dashboardAuthors, barangays] = await Promise.all([
    barangayAuthorIds.length
      ? supabaseAdmin.from('barangay_users').select('id, full_name').in('id', barangayAuthorIds)
      : Promise.resolve({ data: [] as any[] }),
    dashboardAuthorIds.length
      ? supabaseAdmin.from('users').select('id, full_name').in('id', dashboardAuthorIds)
      : Promise.resolve({ data: [] as any[] }),
    barangayIds.length
      ? supabaseAdmin.from('barangays').select('id, name').in('id', barangayIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  return {
    barangayAuthors: new Map((barangayAuthors.data || []).map((row: any) => [row.id, row.full_name])),
    dashboardAuthors: new Map((dashboardAuthors.data || []).map((row: any) => [row.id, row.full_name])),
    barangays: new Map((barangays.data || []).map((row: any) => [row.id, row.name])),
  };
}

function formatPost(row: any, names: Awaited<ReturnType<typeof fetchAuthorNames>>) {
  const isMdrrmo = row.is_mdrrmo === true && !row.barangay_id;
  return {
    id: row.id,
    barangay_id: row.barangay_id || null,
    barangay_name: isMdrrmo ? 'MDRRMO Norzagaray' : names.barangays.get(row.barangay_id) || 'Barangay',
    author_id: row.author_user_id || row.author_id || '',
    author_name: names.dashboardAuthors.get(row.author_user_id)
      || names.barangayAuthors.get(row.author_id)
      || (isMdrrmo ? 'MDRRMO Command Center' : 'Barangay Officer'),
    category: row.category,
    content: row.content,
    links: Array.isArray(row.links) ? row.links : [],
    media: Array.isArray(row.media) ? row.media : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_mdrrmo: isMdrrmo,
    is_from_mdrrmo: isMdrrmo || row.is_from_mdrrmo === true,
    is_pinned: row.is_pinned === true,
    reposted_by: row.reposted_by || null,
  };
}

function emitBroadcastChanged(id: string, action: 'created' | 'updated' | 'deleted') {
  const event = { id, action };
  io.to('role:responder').emit('broadcast:changed', event);
  io.to('role:admin').to('role:master_admin').emit('broadcast:changed', event);
}

async function getRowsForFeed() {
  const { data, error } = await supabaseAdmin
    .from('public_broadcasts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const rows = data || [];
  const barangayIds = [...new Set(rows.map((row: any) => row.barangay_id).filter(Boolean))];
  const activeStatuses = await Promise.all(barangayIds.map(async (id) => [id, await DispatcherVerificationService.isBarangayActive(id)] as const));
  const activeBarangays = new Set(activeStatuses.filter(([, active]) => active).map(([id]) => id));

  return rows.filter((row: any) => {
    if (row.is_mdrrmo === true && !row.barangay_id) return true;
    return Boolean(row.barangay_id && activeBarangays.has(row.barangay_id));
  });
}

// Public feed shared by Resident App and public home views.
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await getRowsForFeed();
    const names = await fetchAuthorNames(rows);
    res.json(rows.map((row: any) => formatPost(row, names)));
  } catch (err: any) {
    console.error('Get public broadcasts error:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch public broadcasts.' });
  }
});

// MDRRMO post manager data.
router.get('/mdrrmo', authenticate, authorize('admin', 'master_admin', 'responder'), async (_req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .select('*')
      .eq('is_mdrrmo', true)
      .is('barangay_id', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = data || [];
    const names = await fetchAuthorNames(rows);
    res.json(rows.map((row: any) => formatPost(row, names)));
  } catch (err: any) {
    console.error('Get MDRRMO broadcast manager list error:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch MDRRMO broadcasts.' });
  }
});

router.post('/mdrrmo', authenticate, authorize('admin', 'master_admin'), upload.array('media'), async (req: AuthRequest, res: Response) => {
  let storagePaths: string[] = [];
  try {
    const category = String(req.body.category || 'safety_advisory');
    const content = String(req.body.content || '').trim();
    if (!validCategories.has(category)) {
      res.status(400).json({ error: 'Choose a valid broadcast category.' });
      return;
    }
    if (!content) {
      res.status(400).json({ error: 'Post content cannot be empty.' });
      return;
    }
    const links = parseLinks(req.body.links);
    const files = (req.files as Express.Multer.File[]) || [];
    const uploaded = await uploadMedia(files, [], req.body);
    storagePaths = uploaded.storagePaths;

    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .insert({
        barangay_id: null,
        author_id: null,
        author_user_id: req.user!.userId,
        category,
        content,
        links,
        media: uploaded.media,
        is_mdrrmo: true,
        is_from_mdrrmo: true,
        is_pinned: req.body.is_pinned === 'true',
      })
      .select('*')
      .single();
    if (error || !data) throw error || new Error('The broadcast was not saved.');
    const names = await fetchAuthorNames([data]);
    const post = formatPost(data, names);
    emitBroadcastChanged(data.id, 'created');
    res.status(201).json(post);
  } catch (err: any) {
    await cleanupUploadedMedia(storagePaths);
    console.error('Create MDRRMO broadcast error:', err);
    res.status(400).json({ error: err?.message || 'Failed to publish broadcast.' });
  }
});

router.patch('/mdrrmo/:id/pin', authenticate, authorize('admin', 'master_admin'), async (req: AuthRequest, res: Response) => {
  if (typeof req.body?.is_pinned !== 'boolean') {
    res.status(400).json({ error: 'is_pinned must be a boolean.' });
    return;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .update({ is_pinned: req.body.is_pinned, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('is_mdrrmo', true)
      .is('barangay_id', null)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'MDRRMO broadcast not found.' });
      return;
    }
    const names = await fetchAuthorNames([data]);
    emitBroadcastChanged(data.id, 'updated');
    res.json(formatPost(data, names));
  } catch (err: any) {
    console.error('Update MDRRMO broadcast pinned status error:', err);
    res.status(500).json({ error: err?.message || 'Failed to update pinned status.' });
  }
});

router.patch('/mdrrmo/:id', authenticate, authorize('admin', 'master_admin'), upload.array('media'), async (req: AuthRequest, res: Response) => {
  let storagePaths: string[] = [];
  try {
    const category = String(req.body.category || '');
    const content = String(req.body.content || '').trim();
    if (!validCategories.has(category)) {
      res.status(400).json({ error: 'Choose a valid broadcast category.' });
      return;
    }
    if (!content) {
      res.status(400).json({ error: 'Post content cannot be empty.' });
      return;
    }
    const links = parseLinks(req.body.links);
    const existingMedia = parseExistingMedia(req.body.existing_media);
    const files = (req.files as Express.Multer.File[]) || [];
    const uploaded = await uploadMedia(files, existingMedia, req.body);
    storagePaths = uploaded.storagePaths;

    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .update({
        category,
        content,
        links,
        media: uploaded.media,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('is_mdrrmo', true)
      .is('barangay_id', null)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      await cleanupUploadedMedia(storagePaths);
      res.status(404).json({ error: 'MDRRMO broadcast not found.' });
      return;
    }
    emitBroadcastChanged(data.id, 'updated');
    const names = await fetchAuthorNames([data]);
    res.json(formatPost(data, names));
  } catch (err: any) {
    await cleanupUploadedMedia(storagePaths);
    console.error('Update MDRRMO broadcast error:', err);
    res.status(400).json({ error: err?.message || 'Failed to update broadcast.' });
  }
});

router.delete('/mdrrmo/:id', authenticate, authorize('admin', 'master_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('public_broadcasts')
      .delete()
      .eq('id', req.params.id)
      .eq('is_mdrrmo', true)
      .is('barangay_id', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'MDRRMO broadcast not found.' });
      return;
    }
    emitBroadcastChanged(data.id, 'deleted');
    res.json({ success: true, id: data.id });
  } catch (err: any) {
    console.error('Delete MDRRMO broadcast error:', err);
    res.status(500).json({ error: err?.message || 'Failed to remove broadcast.' });
  }
});

export default router;
