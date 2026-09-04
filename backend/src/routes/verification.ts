import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

// ============================================
// Verification Helpers
// ============================================

async function approveUserById(userId: string, adminUserId: string) {
  const { data: user, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('full_name, phone, email, role, unit_type')
    .eq('id', userId)
    .single();

  if (fetchError || !user) {
    throw new Error('User not found.');
  }

  const { error: userError } = await supabaseAdmin
    .from('users')
    .update({
      status: 'active',
      verified: true,
    })
    .eq('id', userId);

  if (userError) {
    throw new Error('Failed to approve user.');
  }

  if (user.role === 'professional_unit') {
    const { data: specCerts } = await supabaseAdmin
      .from('certifications')
      .select('cert_type')
      .eq('user_id', userId)
      .eq('cert_number', 'SPECIALIZATION');

    const officerSpecialization = (specCerts && specCerts.length > 0)
      ? specCerts.map((c: any) => c.cert_type).join(', ')
      : (user.unit_type || 'Rescue Officer');

    const { data: existingOfficer } = await supabaseAdmin
      .from('officers')
      .select('id')
      .eq('email', user.email)
      .maybeSingle();

    if (existingOfficer) {
      await supabaseAdmin
        .from('officers')
        .update({
          name: user.full_name,
          phone: user.phone,
          specialization: officerSpecialization,
          status: 'active',
        })
        .eq('id', existingOfficer.id);
    } else {
      const { error: officerError } = await supabaseAdmin
        .from('officers')
        .insert([{
          name: user.full_name,
          phone: user.phone,
          email: user.email,
          specialization: officerSpecialization,
          status: 'active',
        }]);

      if (officerError) {
        console.error('Error adding professional unit to officers table:', officerError);
      }
    }
  }

  // Mark all certifications as verified
  const { error: certError } = await supabaseAdmin
    .from('certifications')
    .update({
      verified: true,
      verified_by: adminUserId,
      verified_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (certError) {
    console.error('Certification verification error:', certError);
  }

  return user;
}

async function rejectUserById(userId: string, reason?: string) {
  const { error } = await supabaseAdmin
    .from('users')
    .update({
      status: 'rejected',
      verified: false,
    })
    .eq('id', userId);

  if (error) {
    throw new Error('Failed to reject verification.');
  }

  return true;
}

async function restoreUserById(userId: string) {
  const { error } = await supabaseAdmin
    .from('users')
    .update({
      status: 'pending_verification',
      verified: false,
    })
    .eq('id', userId);

  if (error) {
    throw new Error('Failed to restore verification.');
  }

  return true;
}

// ============================================
// GET /api/verification/pending — list pending verifications
// ============================================

router.get(
  '/pending',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { data: pendingUsers, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, phone, role, unit_type, status, created_at')
        .eq('status', 'pending_verification')
        .order('created_at', { ascending: false });

      if (usersError) {
        res.status(500).json({ error: 'Failed to fetch pending verifications.' });
        return;
      }

      const usersWithCerts = await Promise.all(
        (pendingUsers || []).map(async (user) => {
          const { data: certs } = await supabaseAdmin
            .from('certifications')
            .select('*')
            .eq('user_id', user.id);

          const allCerts = certs || [];
          const specCerts = allCerts.filter((c: any) => c.cert_number === 'SPECIALIZATION');
          const otherCerts = allCerts.filter((c: any) => c.cert_number !== 'SPECIALIZATION');

          const finalUnitType = specCerts.length > 0
            ? specCerts.map((c: any) => c.cert_type).join(', ')
            : user.unit_type;

          return {
            ...user,
            unit_type: finalUnitType,
            certifications: otherCerts,
          };
        })
      );

      res.json({ pending_verifications: usersWithCerts });
    } catch (err) {
      console.error('Fetch pending verifications error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// GET /api/verification/archived — list archived (rejected) verifications
// ============================================

router.get(
  '/archived',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { data: archivedUsers, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, phone, role, unit_type, status, created_at')
        .eq('status', 'rejected')
        .order('created_at', { ascending: false });

      if (usersError) {
        res.status(500).json({ error: 'Failed to fetch archived verifications.' });
        return;
      }

      const usersWithCerts = await Promise.all(
        (archivedUsers || []).map(async (user) => {
          const { data: certs } = await supabaseAdmin
            .from('certifications')
            .select('*')
            .eq('user_id', user.id);

          const allCerts = certs || [];
          const specCerts = allCerts.filter((c: any) => c.cert_number === 'SPECIALIZATION');
          const otherCerts = allCerts.filter((c: any) => c.cert_number !== 'SPECIALIZATION');

          const finalUnitType = specCerts.length > 0
            ? specCerts.map((c: any) => c.cert_type).join(', ')
            : user.unit_type;

          return {
            ...user,
            unit_type: finalUnitType,
            certifications: otherCerts,
          };
        })
      );

      res.json({ archived_verifications: usersWithCerts });
    } catch (err) {
      console.error('Fetch archived verifications error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// POST /api/verification/bulk-approve — approve multiple
// ============================================

router.post(
  '/bulk-approve',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: 'userIds array is required.' });
        return;
      }

      for (const id of userIds) {
        try {
          await approveUserById(id, req.user!.userId);
        } catch (e) {
          console.error(`Error approving user ${id}:`, e);
        }
      }

      res.json({ message: `Successfully approved ${userIds.length} officer(s).` });
    } catch (err) {
      console.error('Bulk approve error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// POST /api/verification/bulk-reject — reject multiple
// ============================================

router.post(
  '/bulk-reject',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userIds, reason } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: 'userIds array is required.' });
        return;
      }

      for (const id of userIds) {
        try {
          await rejectUserById(id, reason);
        } catch (e) {
          console.error(`Error rejecting user ${id}:`, e);
        }
      }

      res.json({ message: `Successfully archived ${userIds.length} officer(s).` });
    } catch (err) {
      console.error('Bulk reject error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// POST /api/verification/bulk-restore — restore multiple
// ============================================

router.post(
  '/bulk-restore',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: 'userIds array is required.' });
        return;
      }

      for (const id of userIds) {
        try {
          await restoreUserById(id);
        } catch (e) {
          console.error(`Error restoring user ${id}:`, e);
        }
      }

      res.json({ message: `Successfully restored ${userIds.length} officer(s).` });
    } catch (err) {
      console.error('Bulk restore error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// POST /api/verification/:userId/approve — approve specialist
// ============================================

router.post(
  '/:userId/approve',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const user = await approveUserById(userId, req.user!.userId);

      const approvalMessage = user.role === 'professional_unit'
        ? 'MDRRMO Officer approved successfully.'
        : 'Volunteer approved successfully.';

      res.json({ message: approvalMessage });
    } catch (err: any) {
      console.error('Approve verification error:', err);
      res.status(err.message === 'User not found.' ? 404 : 500).json({ error: err.message || 'Internal server error.' });
    }
  }
);

// ============================================
// POST /api/verification/:userId/reject — reject officer (archive)
// ============================================

router.post(
  '/:userId/reject',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      await rejectUserById(userId, reason);

      res.json({
        message: 'Verification rejected and archived.',
        reason: reason || 'No reason provided.',
      });
    } catch (err: any) {
      console.error('Reject verification error:', err);
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  }
);

// ============================================
// POST /api/verification/:userId/restore — restore officer from archive
// ============================================

router.post(
  '/:userId/restore',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      await restoreUserById(userId);

      res.json({ message: 'Officer restored to verification queue.' });
    } catch (err: any) {
      console.error('Restore verification error:', err);
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  }
);

export default router;
