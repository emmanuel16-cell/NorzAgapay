import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

// ============================================
// GET /api/verification/pending — list pending verifications
// ============================================

router.get(
  '/pending',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      // Get all users with pending verification
      const { data: pendingUsers, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, phone, role, unit_type, status, created_at')
        .eq('status', 'pending_verification')
        .order('created_at', { ascending: true });

      if (usersError) {
        res.status(500).json({ error: 'Failed to fetch pending verifications.' });
        return;
      }

      // For each pending user, get their certifications
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
// POST /api/verification/:userId/approve — approve specialist
// ============================================

router.post(
  '/:userId/approve',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;

      // Get user info before update to check if they are a professional unit
      const { data: user, error: fetchError } = await supabaseAdmin
        .from('users')
        .select('full_name, phone, email, role, unit_type')
        .eq('id', userId)
        .single();

      if (fetchError || !user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      // Update user status and verified flag
      const { error: userError } = await supabaseAdmin
        .from('users')
        .update({
          status: 'active',
          verified: true,
        })
        .eq('id', userId);

      if (userError) {
        res.status(500).json({ error: 'Failed to approve user.' });
        return;
      }

      // If user is a professional unit, add/update in officers table
      if (user.role === 'professional_unit') {
        // Fetch full specializations list if stored in certifications
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

      // Mark all their certifications as verified
      const { error: certError } = await supabaseAdmin
        .from('certifications')
        .update({
          verified: true,
          verified_by: req.user!.userId,
          verified_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (certError) {
        console.error('Certification verification error:', certError);
      }

      const approvalMessage = user.role === 'professional_unit'
        ? 'MDRRMO Officer approved successfully.'
        : 'Volunteer approved successfully.';

      res.json({ message: approvalMessage });
    } catch (err) {
      console.error('Approve verification error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// POST /api/verification/:userId/reject — reject volunteer
// ============================================

router.post(
  '/:userId/reject',
  authenticate,
  authorize('admin'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      // For rejection, we could either delete the user or keep them as inactive
      // Here we'll set them to inactive so they can't try again with the same email easily
      // or we can just delete them if the admin wants them gone.
      // Let's stick to the demotion logic if they were specialists, 
      // but if they are general, what do we do? 
      // The user wants "Volunteer Verification", so if rejected, they probably shouldn't be able to login at all.
      
      const { error } = await supabaseAdmin
        .from('users')
        .update({
          status: 'rejected',
          verified: false,
        })
        .eq('id', userId);

      if (error) {
        res.status(500).json({ error: 'Failed to reject verification.' });
        return;
      }

      res.json({
        message: 'Verification rejected.',
        reason: reason || 'No reason provided.',
      });
    } catch (err) {
      console.error('Reject verification error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

export default router;
