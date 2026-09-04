import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

// Helper to decorate unit with team_leader_id
const formatUnit = (unit: any) => {
  const leaderId = unit.officer_ids && unit.officer_ids.length > 0 ? unit.officer_ids[0] : null;
  return {
    ...unit,
    team_leader_id: leaderId,
  };
};

// GET /api/respond-units/my-unit - get unit for currently logged in officer
router.get('/my-unit', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    // Find the officer corresponding to this user
    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('email, full_name')
      .eq('id', user.userId)
      .maybeSingle();

    const email = userRecord?.email || user.email;

    let officerId: string | null = null;
    let officerName = userRecord?.full_name || '';

    if (email) {
      const { data: off } = await supabaseAdmin
        .from('officers')
        .select('id, name')
        .eq('email', email)
        .maybeSingle();
      if (off) {
        officerId = off.id;
        officerName = off.name;
      }
    }

    if (!officerId) {
      const { data: offById } = await supabaseAdmin
        .from('officers')
        .select('id, name')
        .eq('id', user.userId)
        .maybeSingle();
      if (offById) {
        officerId = offById.id;
        officerName = offById.name;
      }
    }

    // Find all units
    const { data: allUnits, error: unitsError } = await supabaseAdmin
      .from('respond_units')
      .select('*')
      .order('created_at', { ascending: false });

    if (unitsError) throw unitsError;

    // Find unit where officer is listed, or user is listed
    let myUnit = (allUnits || []).find((u) => {
      if (!u.officer_ids || !Array.isArray(u.officer_ids)) return false;
      return (officerId && u.officer_ids.includes(officerId)) || u.officer_ids.includes(user.userId);
    });

    if (!myUnit && (allUnits || []).length > 0 && user.role === 'professional_unit') {
      myUnit = allUnits![0];
    }

    if (!myUnit) {
      res.json({ unit: null, is_team_leader: false, members: [], team_leader: null });
      return;
    }

    const formatted = formatUnit(myUnit);
    const isTeamLeader = formatted.team_leader_id === officerId || formatted.team_leader_id === user.userId;

    // Fetch details for all officers in this unit
    let members: any[] = [];
    if (myUnit.officer_ids && myUnit.officer_ids.length > 0) {
      const { data: officerDetails } = await supabaseAdmin
        .from('officers')
        .select('*')
        .in('id', myUnit.officer_ids);
      members = officerDetails || [];
    }

    const teamLeader = members.find((m) => m.id === formatted.team_leader_id) || null;

    res.json({
      unit: formatted,
      is_team_leader: isTeamLeader,
      officer_id: officerId,
      members,
      team_leader: teamLeader,
    });
  } catch (err: any) {
    console.error('Fetch my-unit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/respond-units - list all units
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('respond_units')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ units: (data || []).map(formatUnit) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/respond-units - create new unit
router.post('/', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { unit_name, specialization, officer_ids, team_leader_id } = req.body;
    
    if (!unit_name || !specialization) {
      res.status(400).json({ error: 'Unit name and specialization are required' });
      return;
    }

    let orderedOfficers = Array.isArray(officer_ids) ? [...officer_ids] : [];
    
    // If team_leader_id is provided, place it first
    if (team_leader_id) {
      orderedOfficers = [
        team_leader_id,
        ...orderedOfficers.filter((id) => id !== team_leader_id),
      ];

      await supabaseAdmin
        .from('officers')
        .update({ rank: 'Team Leader' })
        .eq('id', team_leader_id);

      const otherOfficers = orderedOfficers.slice(1);
      if (otherOfficers.length > 0) {
        await supabaseAdmin
          .from('officers')
          .update({ rank: 'Responder' })
          .in('id', otherOfficers);
      }
    }

    const { data, error } = await supabaseAdmin
      .from('respond_units')
      .insert([{ 
        unit_name, 
        specialization, 
        officer_ids: orderedOfficers,
        status: 'available'
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(formatUnit(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/respond-units/:id - update unit
router.patch('/:id', authenticate, authorize('admin', 'commander'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    const { team_leader_id, officer_ids } = req.body;

    if (officer_ids && Array.isArray(officer_ids)) {
      let ordered = [...officer_ids];
      if (team_leader_id) {
        ordered = [team_leader_id, ...ordered.filter((oid) => oid !== team_leader_id)];
      }
      updates.officer_ids = ordered;
    } else if (team_leader_id) {
      const { data: cur } = await supabaseAdmin
        .from('respond_units')
        .select('officer_ids')
        .eq('id', id)
        .single();
      if (cur && cur.officer_ids) {
        updates.officer_ids = [
          team_leader_id,
          ...cur.officer_ids.filter((oid: string) => oid !== team_leader_id),
        ];
      }
    }

    delete updates.team_leader_id;

    const { data, error } = await supabaseAdmin
      .from('respond_units')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (team_leader_id) {
      await supabaseAdmin
        .from('officers')
        .update({ rank: 'Team Leader' })
        .eq('id', team_leader_id);
    }

    res.json(formatUnit(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/respond-units/:id/members - add members to a respond unit
router.post('/:id/members', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { officer_ids } = req.body;

    if (!officer_ids || !Array.isArray(officer_ids) || officer_ids.length === 0) {
      res.status(400).json({ error: 'officer_ids array is required' });
      return;
    }

    const { data: unit, error: fetchErr } = await supabaseAdmin
      .from('respond_units')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !unit) {
      res.status(404).json({ error: 'Respond unit not found' });
      return;
    }

    const currentOfficers: string[] = unit.officer_ids || [];
    const newOfficerIds = officer_ids.filter((oid: string) => !currentOfficers.includes(oid));
    const merged = [...currentOfficers, ...newOfficerIds];

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('respond_units')
      .update({ officer_ids: merged })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    res.json({ message: 'Members added successfully', unit: formatUnit(updated) });
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
