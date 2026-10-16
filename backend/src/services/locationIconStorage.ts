import { randomUUID } from 'crypto';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type UploadedImage = { mimetype: string; buffer: Buffer };

export function isValidLocationIcon(file?: UploadedImage | null): file is UploadedImage {
  return Boolean(file && file.mimetype === 'image/png' && file.buffer.length > PNG_SIGNATURE.length && file.buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE));
}

export async function storeLocationIcon(file: UploadedImage, folder: string) {
  const storagePath = `location-icons/${folder}/${randomUUID()}.png`;
  const { error } = await supabaseAdmin.storage.from(config.supabaseBucketName).upload(storagePath, file.buffer, {
    contentType: 'image/png',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabaseAdmin.storage.from(config.supabaseBucketName).getPublicUrl(storagePath);
  return { url: data.publicUrl, storagePath };
}

export async function removeStoredLocationIcon(storagePath?: string | null) {
  if (!storagePath) return;
  const { error } = await supabaseAdmin.storage.from(config.supabaseBucketName).remove([storagePath]);
  if (error) throw error;
}
