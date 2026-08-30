import { Router, Response } from 'express';
import multer from 'multer';
import { config } from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf', 'image/jpg'];

// ============================================
// POST /api/upload — direct upload (multipart)
// ============================================
router.post('/', authenticate, upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;
    const { category } = req.body;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }

    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      res.status(400).json({ error: 'Invalid file type. Allowed: jpg, png, pdf' });
      return;
    }

    const userId = req.user!.userId;
    const ext = file.originalname.split('.').pop() || 'bin';
    const objectPath = `${category || 'other'}/${userId}/${Date.now()}.${ext}`;

    // Upload to Supabase Storage
    const { data, error } = await supabaseAdmin
      .storage
      .from(config.supabaseBucketName)
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('Supabase Storage Error:', error);
      res.status(500).json({ error: 'Failed to upload file to storage.' });
      return;
    }

    res.json({
      message: 'File uploaded successfully.',
      object_key: objectPath,
    });
  } catch (err) {
    console.error('Upload route error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/upload/presigned-url
// ============================================
router.post('/presigned-url', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { file_type, category, file_name } = req.body;
    
    if (!file_type || !ALLOWED_TYPES.includes(file_type)) {
      res.status(400).json({ error: 'Invalid file type. Allowed: jpg, png, pdf' });
      return;
    }

    const userId = req.user!.userId;
    const ext = (file_name || 'file').split('.').pop() || 'bin';
    const objectPath = `${category || 'other'}/${userId}/${Date.now()}.${ext}`;

    // Create signed upload URL for Supabase Storage
    const { data, error } = await supabaseAdmin
      .storage
      .from(config.supabaseBucketName)
      .createSignedUploadUrl(objectPath);

    if (error) {
      console.error('Supabase Storage Error:', error);
      res.status(500).json({ error: 'Failed to generate upload URL.' });
      return;
    }

    res.json({
      presigned_url: data.signedUrl,
      object_key: objectPath, // This is the path in the bucket
      token: data.token,
      expires_in: 300,
    });
  } catch (err) {
    console.error('Upload route error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/upload/confirm
// ============================================
router.post('/confirm', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { object_key, category, cert_type, cert_number, task_id } = req.body;
    const userId = req.user!.userId;
    
    // Construct the public URL (assuming the bucket is public or we use signed URLs for viewing)
    // For Supabase, the public URL pattern is usually:
    const { data: { publicUrl } } = supabaseAdmin
      .storage
      .from(config.supabaseBucketName)
      .getPublicUrl(object_key);

    if (category === 'certification') {
      const { data: cert, error } = await supabaseAdmin
        .from('certifications')
        .insert({ 
          user_id: userId, 
          cert_type: cert_type || 'Unknown', 
          cert_number: cert_number || null, 
          file_url: publicUrl, 
          verified: false 
        })
        .select().single();
        
      if (error) { 
        res.status(500).json({ error: 'Failed to store certification.' }); 
        return; 
      }
      res.json({ message: 'Certification uploaded.', certification: cert });
    } else if (category === 'proof_photo' && task_id) {
      await supabaseAdmin.from('tasks').update({ proof_photo_url: publicUrl }).eq('id', task_id).eq('assigned_to', userId);
      res.json({ message: 'Proof photo uploaded.', file_url: publicUrl });
    } else {
      res.json({ message: 'File uploaded.', file_url: publicUrl });
    }
  } catch (err) {
    console.error('Confirm upload error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
