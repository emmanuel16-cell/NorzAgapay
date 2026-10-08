import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { currentManilaDate } from '../services/respondUnitAvailability';

const router = Router();

const crewRoles = ['radio_operator', 'driver_responder', 'first_aider_responder'] as const;
const memberRoleLabels: Record<string, string> = {
  team_leader: 'Team Leader',
  radio_operator: 'Radio Operator',
  driver_responder: 'Driver Responder',
  first_aider_responder: 'First Aider Responder',
  unassigned: 'Position needs review',
};

const memberInput = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  member_role: z.enum(crewRoles),
});

function validateRosterCapacity(members: Array<{ member_role: string }>): string | null {
  const limits: Record<string, number> = {
    radio_operator: 1,
    driver_responder: 3,
    first_aider_responder: 3,
  };
  for (const [role, limit] of Object.entries(limits)) {
    if (members.filter((member) => member.member_role === role).length > limit) {
      return `A unit can have at most ${limit} ${memberRoleLabels[role]}${limit === 1 ? '' : 's'}.`;
    }
  }
  return null;
}

function reportDbError(res: Response, error: any, fallback: string): void {
  console.error(fallback, error);
  const message = String(error?.message || '');
  const conflict = ['23505', '23514', 'P0001'].includes(String(error?.code || '')) ||
    /capacity|already leads|already assigned|team leader|role/i.test(message);
  const status = error?.code === 'P0002' ? 404 : error?.code === '42501' ? 403 : conflict ? 409 : 500;
  res.status(status).json({
    error: conflict ? message || 'The unit roster changed. Refresh and try again.' : fallback,
  });
}

async function getUnitDetails(unitIds?: string[]) {
  let query = supabaseAdmin.from('respond_units').select('*').order('created_at', { ascending: false });
  if (unitIds) query = query.in('id', unitIds);
  const { data: units, error: unitError } = await query;
  if (unitError) throw unitError;
  const rows = units || [];
  if (!rows.length) return [];

  const ids = rows.map((unit: any) => unit.id);
  const { data: memberRows, error: membersError } = await supabaseAdmin
    .from('respond_unit_members')
    .select('id, unit_id, officer_id, responder_user_id, member_role, is_active, created_at')
    .in('unit_id', ids)
    .eq('is_active', true);
  if (membersError) throw membersError;
  const { data: activationRows, error: activationError } = await supabaseAdmin
    .from('respond_unit_daily_activations')
    .select('unit_id, activation_date, activation_mode, activated_at')
    .in('unit_id', ids)
    .eq('activation_date', currentManilaDate());
  if (activationError) throw activationError;

  const memberships = memberRows || [];
  const activationByUnit = new Map((activationRows || []).map((activation: any) => [activation.unit_id, activation]));
  const officerIds = [...new Set(memberships.map((member: any) => member.officer_id))];
  const responderIds = [...new Set(memberships.map((member: any) => member.responder_user_id).filter(Boolean))];
  const [officersResult, respondersResult] = await Promise.all([
    officerIds.length
      ? supabaseAdmin.from('officers').select('id, name, email, phone, specialization, rank, status').in('id', officerIds)
      : Promise.resolve({ data: [], error: null } as any),
    responderIds.length
      ? supabaseAdmin.from('users').select('id, full_name, email, phone, role, status').in('id', responderIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (officersResult.error) throw officersResult.error;
  if (respondersResult.error) throw respondersResult.error;

  const officerMap = new Map((officersResult.data || []).map((officer: any) => [officer.id, officer]));
  const responderMap = new Map((respondersResult.data || []).map((responder: any) => [responder.id, responder]));

  return rows.map((unit: any) => {
    const members = memberships
      .filter((member: any) => member.unit_id === unit.id)
      .map((member: any) => {
        const officer: any = officerMap.get(member.officer_id) || {};
        const responder: any = member.responder_user_id ? responderMap.get(member.responder_user_id) || {} : {};
        return {
          id: member.id,
          officer_id: member.officer_id,
          responder_user_id: member.responder_user_id,
          member_role: member.member_role,
          role_label: memberRoleLabels[member.member_role] || member.member_role,
          name: officer.name || responder.full_name || 'Unnamed member',
          email: responder.email || officer.email || null,
          phone: officer.phone || responder.phone || null,
          specialization: officer.specialization || '',
          rank: officer.rank || null,
          status: officer.status || 'active',
          is_active: member.is_active,
        };
      });
    const leader = members.find((member: any) => member.member_role === 'team_leader') || null;
    const leaderAccount: any = leader?.responder_user_id ? responderMap.get(leader.responder_user_id) : null;
    const activeMembers = members.filter((member: any) => member.member_role !== 'unassigned');
    const officerIds = [...new Set(members.map((member: any) => member.officer_id))];
    const activation: any = activationByUnit.get(unit.id);
    const rosterReady = Boolean(leader && leaderAccount?.role === 'responder' && leaderAccount?.status === 'active') &&
      activeMembers.some((member: any) => member.member_role === 'driver_responder') &&
      activeMembers.some((member: any) => member.member_role === 'first_aider_responder');
    return {
      ...unit,
      officer_ids: officerIds,
      team_leader_id: leader?.officer_id || null,
      team_leader_user_id: leader?.responder_user_id || null,
      team_leader: leader ? {
        id: leader.responder_user_id,
        full_name: leaderAccount?.full_name || leader.name,
        email: leaderAccount?.email || leader.email,
        is_active_account: leaderAccount?.role === 'responder' && leaderAccount?.status === 'active',
      } : null,
      members,
      roster_ready: rosterReady,
      is_active_today: Boolean(activation),
      activation_date: activation?.activation_date || null,
      activation_mode: activation?.activation_mode || null,
      activated_at: activation?.activated_at || null,
      can_dispatch_today: Boolean(activation) && unit.status === 'available' && rosterReady,
    };
  });
}

async function ensureOfficerForResponder(user: any, specialization: string) {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('officers')
    .select('id')
    .ilike('email', user.email.trim())
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return { id: existing.id, created: false };

  const { data, error } = await supabaseAdmin
    .from('officers')
    .insert({
      name: user.full_name,
      phone: user.phone || null,
      email: user.email,
      specialization: specialization || 'mixed',
      rank: memberRoleLabels.team_leader,
      status: 'active',
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id, created: true };
}

async function createRosterOfficer(unitId: string, unitSpecialization: string, member: z.infer<typeof memberInput>) {
  const { data: officer, error: officerError } = await supabaseAdmin
    .from('officers')
    .insert({
      name: member.name,
      phone: member.phone?.trim() || null,
      email: null,
      specialization: unitSpecialization || 'mixed',
      rank: memberRoleLabels[member.member_role],
      status: 'active',
    })
    .select('id')
    .single();
  if (officerError) throw officerError;

  const { error: membershipError } = await supabaseAdmin
    .from('respond_unit_members')
    .insert({ unit_id: unitId, officer_id: officer.id, member_role: member.member_role, is_active: true });
  if (membershipError) {
    await supabaseAdmin.from('officers').delete().eq('id', officer.id);
    throw membershipError;
  }
  return officer.id;
}

async function syncLegacyOfficerIds(unitId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('respond_unit_members')
    .select('officer_id')
    .eq('unit_id', unitId)
    .eq('is_active', true);
  if (error) throw error;
  const officerIds = [...new Set((data || []).map((row: any) => row.officer_id))];
  const { error: updateError } = await supabaseAdmin
    .from('respond_units')
    .update({ officer_ids: officerIds })
    .eq('id', unitId);
  if (updateError) throw updateError;
}

router.get('/my-unit', authenticate, authorize('responder'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: leader, error: leaderError } = await supabaseAdmin
      .from('respond_unit_members')
      .select('id, unit_id, officer_id, responder_user_id')
      .eq('responder_user_id', req.user!.userId)
      .eq('member_role', 'team_leader')
      .eq('is_active', true)
      .maybeSingle();
    if (leaderError) throw leaderError;
    if (!leader) {
      res.json({ unit: null, is_team_leader: false, members: [], team_leader: null });
      return;
    }

    const details = await getUnitDetails([leader.unit_id]);
    const unit = details[0] || null;
    if (!unit) {
      res.json({ unit: null, is_team_leader: false, members: [], team_leader: null });
      return;
    }
    const members = unit.members.map((member: any) => ({
      ...member,
      id: member.officer_id,
      unit_member_id: member.id,
    }));
    res.json({
      unit,
      is_team_leader: true,
      officer_id: leader.officer_id,
      members,
      team_leader: members.find((member: any) => member.unit_member_id === leader.id) || null,
    });
  } catch (error: any) {
    reportDbError(res, error, 'Could not load the responder unit.');
  }
});

router.get('/leader-accounts', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentUnitId = typeof req.query.unit_id === 'string' ? req.query.unit_id : '';
    const [{ data: users, error: usersError }, { data: leaders, error: leadersError }, { data: officers, error: officersError }] = await Promise.all([
      supabaseAdmin.from('users')
        .select('id, full_name, email, phone, status')
        .eq('role', 'responder')
        .eq('status', 'active')
        .order('full_name', { ascending: true }),
      supabaseAdmin.from('respond_unit_members')
        .select('responder_user_id, unit_id')
        .eq('member_role', 'team_leader')
        .eq('is_active', true),
      supabaseAdmin.from('officers')
        .select('id, name, email, phone, specialization, status')
        .eq('status', 'active')
        .order('name', { ascending: true }),
    ]);
    if (usersError) throw usersError;
    if (leadersError) throw leadersError;
    if (officersError) throw officersError;

    const leaderUnit = new Map((leaders || []).map((row: any) => [row.responder_user_id, row.unit_id]));
    const officerByEmail = new Map<string, any>();
    for (const officer of officers || []) {
      if (officer.email?.trim()) officerByEmail.set(officer.email.trim().toLowerCase(), officer);
    }
    const activeResponderEmails = new Set((users || []).map((user: any) => user.email?.trim().toLowerCase()).filter(Boolean));
    const available = (users || []).filter((user: any) => {
      const assignedUnit = leaderUnit.get(user.id);
      return !assignedUnit || assignedUnit === currentUnitId;
    }).map((user: any) => {
      const officer = officerByEmail.get(user.email?.trim().toLowerCase());
      return {
        ...user,
        officer_id: officer?.id || null,
        officer_name: officer?.name || null,
        officer_specialization: officer?.specialization || null,
      };
    });
    const officersWithoutResponderAccount = (officers || []).filter((officer: any) =>
      !officer.email?.trim() || !activeResponderEmails.has(officer.email.trim().toLowerCase()),
    );
    res.json({ responders: available, officers_without_responder_account: officersWithoutResponderAccount });
  } catch (error: any) {
    if (['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST200'].includes(error?.code)) {
      res.status(503).json({
        error: 'The Respond Units roster database objects are missing. Apply database/migrations/20261008_respond_units_roster.sql, then retry.',
        code: 'RESPOND_UNITS_SCHEMA_MISSING',
      });
      return;
    }
    reportDbError(res, error, 'Could not load active responder accounts.');
  }
});

router.get('/', authenticate, authorize('logistics', 'admin', 'dispatcher', 'master_admin'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json({ units: await getUnitDetails() });
  } catch (error: any) {
    reportDbError(res, error, 'Could not load respond units.');
  }
});

router.put('/:id/activation-today', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Choose whether this unit should be active today.' }); return; }
  try {
    const { data, error } = await supabaseAdmin.rpc('set_respond_unit_activation_today_v1', {
      p_unit_id: req.params.id,
      p_activated_by: req.user!.userId,
      p_active: parsed.data.active,
    });
    if (error) throw error;
    const unit = (await getUnitDetails([req.params.id]))[0];
    if (!unit) { res.status(404).json({ error: 'Respond unit not found.' }); return; }
    res.json({ unit, activation: data });
  } catch (error: any) {
    reportDbError(res, error, 'Could not update today’s unit activation.');
  }
});

router.post('/activate-all-today', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin.rpc('emergency_activate_all_respond_units_today_v1', {
      p_activated_by: req.user!.userId,
    });
    if (error) throw error;
    res.json(data || { activated_count: 0, activation_date: currentManilaDate() });
  } catch (error: any) {
    reportDbError(res, error, 'Could not emergency activate response units.');
  }
});

router.post('/', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    unit_name: z.string().trim().min(2).max(100),
    specialization: z.string().trim().min(1).max(120).default('mixed'),
    team_leader_user_id: z.string().uuid().optional(),
    members: z.array(memberInput).max(7).optional().default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid unit name, optional Team Leader, and roster fields.' });
    return;
  }
  const capacityError = validateRosterCapacity(parsed.data.members);
  if (capacityError) { res.status(400).json({ error: capacityError }); return; }

  let unitId: string | null = null;
  const newOfficerIds: string[] = [];
  try {
    let leaderUser: any = null;
    if (parsed.data.team_leader_user_id) {
      const { data, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, phone, role, status')
        .eq('id', parsed.data.team_leader_user_id)
        .maybeSingle();
      if (userError) throw userError;
      leaderUser = data;
      if (!leaderUser || leaderUser.role !== 'responder' || leaderUser.status !== 'active') {
        res.status(400).json({ error: 'Choose an active responder account as the Team Leader, or leave the position unassigned for now.' });
        return;
      }
    }

    const { data: unit, error: unitError } = await supabaseAdmin
      .from('respond_units')
      .insert({
        unit_name: parsed.data.unit_name,
        specialization: parsed.data.specialization,
        officer_ids: [],
        status: 'available',
      })
      .select('id')
      .single();
    if (unitError) throw unitError;
    unitId = unit.id;

    if (leaderUser) {
      const leaderOfficer = await ensureOfficerForResponder(leaderUser, parsed.data.specialization);
      if (leaderOfficer.created) newOfficerIds.push(leaderOfficer.id);
      const { error: assignError } = await supabaseAdmin.rpc('assign_respond_unit_team_leader_v1', {
        p_unit_id: unit.id,
        p_officer_id: leaderOfficer.id,
        p_responder_user_id: leaderUser.id,
      });
      if (assignError) throw assignError;
    }

    for (const member of parsed.data.members) {
      newOfficerIds.push(await createRosterOfficer(unit.id, parsed.data.specialization, member));
    }
    await syncLegacyOfficerIds(unit.id);
    res.status(201).json({ unit: (await getUnitDetails([unit.id]))[0] });
  } catch (error: any) {
    if (unitId) await supabaseAdmin.from('respond_units').delete().eq('id', unitId);
    if (newOfficerIds.length) await supabaseAdmin.from('officers').delete().in('id', newOfficerIds);
    reportDbError(res, error, 'Could not create the respond unit.');
  }
});

router.patch('/:id', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({
    unit_name: z.string().trim().min(2).max(100).optional(),
    specialization: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['available', 'unavailable', 'maintenance']).optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data || {}).length) {
    res.status(400).json({ error: 'Provide a valid unit name, specialization, or status.' });
    return;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('respond_units')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'Respond unit not found.' }); return; }
    res.json({ unit: (await getUnitDetails([data.id]))[0] });
  } catch (error: any) {
    reportDbError(res, error, 'Could not update the respond unit.');
  }
});

router.put('/:id/team-leader', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({ responder_user_id: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Choose an active responder account.' }); return; }
  try {
    const { data: unit, error: unitError } = await supabaseAdmin
      .from('respond_units').select('id, specialization').eq('id', req.params.id).maybeSingle();
    if (unitError) throw unitError;
    if (!unit) { res.status(404).json({ error: 'Respond unit not found.' }); return; }

    const { data: account, error: accountError } = await supabaseAdmin
      .from('users').select('id, full_name, email, phone, role, status')
      .eq('id', parsed.data.responder_user_id).maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.role !== 'responder' || account.status !== 'active') {
      res.status(400).json({ error: 'Choose an active responder account as the Team Leader.' });
      return;
    }

    const activeAssignments = await supabaseAdmin.from('mdrrmo_report_assignments')
      .select('id').eq('responder_id', account.id).in('status', ['assigned', 'responding']).limit(1);
    if (activeAssignments.error) throw activeAssignments.error;
    if ((activeAssignments.data || []).length) {
      res.status(409).json({ error: 'This responder has an active dispatch and cannot change units yet.' });
      return;
    }

    const officer = await ensureOfficerForResponder(account, unit.specialization);
    const { error: assignError } = await supabaseAdmin.rpc('assign_respond_unit_team_leader_v1', {
      p_unit_id: unit.id,
      p_officer_id: officer.id,
      p_responder_user_id: account.id,
    });
    if (assignError) throw assignError;
    await syncLegacyOfficerIds(unit.id);
    res.json({ unit: (await getUnitDetails([unit.id]))[0] });
  } catch (error: any) {
    reportDbError(res, error, 'Could not assign the Team Leader.');
  }
});

router.delete('/:id/team-leader', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { error } = await supabaseAdmin.rpc('clear_respond_unit_team_leader_v1', {
      p_unit_id: req.params.id,
    });
    if (error) throw error;
    await syncLegacyOfficerIds(req.params.id);
    res.json({ unit: (await getUnitDetails([req.params.id]))[0] });
  } catch (error: any) {
    reportDbError(res, error, 'Could not clear the Team Leader.');
  }
});

router.post('/:id/members', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isStaff = req.user!.role === 'logistics' || req.user!.role === 'master_admin';
    const { data: leaderMembership, error: leaderError } = await supabaseAdmin
      .from('respond_unit_members')
      .select('id')
      .eq('unit_id', req.params.id)
      .eq('responder_user_id', req.user!.userId)
      .eq('member_role', 'team_leader')
      .eq('is_active', true)
      .maybeSingle();
    if (leaderError) throw leaderError;
    if (!isStaff && !(req.user!.role === 'responder' && leaderMembership)) {
      res.status(403).json({ error: 'Only Staff or this unit’s Team Leader can add members.' });
      return;
    }

    // Keep supporting the mobile team-leader task flow while the roster UI
    // uses role-tagged staff-created profiles.
    if (Array.isArray(req.body.officer_ids)) {
      if (req.user!.role !== 'responder' && !isStaff) {
        res.status(403).json({ error: 'Insufficient permissions.' });
        return;
      }
      const ids: string[] = [...new Set<string>(
        (req.body.officer_ids as unknown[]).filter((id): id is string => typeof id === 'string'),
      )];
      if (!ids.length) { res.status(400).json({ error: 'Choose at least one unit member.' }); return; }
      const { data: unit, error: unitError } = await supabaseAdmin
        .from('respond_units').select('officer_ids').eq('id', req.params.id).maybeSingle();
      if (unitError) throw unitError;
      if (!unit) { res.status(404).json({ error: 'Respond unit not found.' }); return; }
      const { data: officers, error: officersError } = await supabaseAdmin
        .from('officers').select('id').in('id', ids);
      if (officersError) throw officersError;
      if ((officers || []).length !== ids.length) {
        res.status(400).json({ error: 'One or more selected responders are no longer available.' });
        return;
      }
      const { data: existingMembers, error: membersError } = await supabaseAdmin
        .from('respond_unit_members').select('id, officer_id, member_role, is_active')
        .eq('unit_id', req.params.id).in('officer_id', ids);
      if (membersError) throw membersError;
      const existingIds = new Set((existingMembers || []).map((member: any) => member.officer_id));
      const additions = ids.filter((id: string) => !existingIds.has(id));
      if (additions.length) {
        const { error: insertError } = await supabaseAdmin.from('respond_unit_members').insert(
          additions.map((officerId: string) => ({
            unit_id: req.params.id,
            officer_id: officerId,
            member_role: 'unassigned',
            is_active: true,
          })),
        );
        if (insertError) throw insertError;
      }
      const inactiveIds = (existingMembers || [])
        .filter((member: any) => !member.is_active && member.member_role !== 'team_leader')
        .map((member: any) => member.id);
      if (inactiveIds.length) {
        const { error: activateError } = await supabaseAdmin.from('respond_unit_members')
          .update({ is_active: true }).in('id', inactiveIds);
        if (activateError) throw activateError;
      }
      const officerIds = [...new Set([...(unit.officer_ids || []), ...ids])];
      const { error: updateError } = await supabaseAdmin.from('respond_units')
        .update({ officer_ids: officerIds }).eq('id', req.params.id);
      if (updateError) throw updateError;
      res.json({ message: 'Members added successfully', unit: (await getUnitDetails([req.params.id]))[0] });
      return;
    }

    if (!isStaff) { res.status(403).json({ error: 'Only Staff can add roster profiles.' }); return; }
    const parsed = memberInput.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Enter a member name and choose a roster position.' }); return; }
    const { data: unit, error: unitError } = await supabaseAdmin
      .from('respond_units').select('id, specialization').eq('id', req.params.id).maybeSingle();
    if (unitError) throw unitError;
    if (!unit) { res.status(404).json({ error: 'Respond unit not found.' }); return; }
    await createRosterOfficer(unit.id, unit.specialization, parsed.data);
    await syncLegacyOfficerIds(unit.id);
    res.status(201).json({ unit: (await getUnitDetails([unit.id]))[0] });
  } catch (error: any) {
    reportDbError(res, error, 'Could not add the unit member.');
  }
});

router.patch('/:id/members/:memberId', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    member_role: z.enum(crewRoles).optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data || {}).length) {
    res.status(400).json({ error: 'Provide a valid name, phone, or crew position.' });
    return;
  }
  try {
    const { data: member, error: memberError } = await supabaseAdmin
      .from('respond_unit_members')
      .select('id, unit_id, officer_id, member_role')
      .eq('id', req.params.memberId)
      .eq('unit_id', req.params.id)
      .eq('is_active', true)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.member_role === 'team_leader') { res.status(404).json({ error: 'Crew member not found.' }); return; }
    if (parsed.data.member_role) {
      const { error } = await supabaseAdmin.from('respond_unit_members')
        .update({ member_role: parsed.data.member_role }).eq('id', member.id);
      if (error) throw error;
    }
    const officerUpdates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) officerUpdates.name = parsed.data.name;
    if (parsed.data.phone !== undefined) officerUpdates.phone = parsed.data.phone;
    if (parsed.data.member_role) officerUpdates.rank = memberRoleLabels[parsed.data.member_role];
    if (Object.keys(officerUpdates).length) {
      const { error } = await supabaseAdmin.from('officers').update(officerUpdates).eq('id', member.officer_id);
      if (error) throw error;
    }
    res.json({ unit: (await getUnitDetails([member.unit_id]))[0] });
  } catch (error: any) {
    reportDbError(res, error, 'Could not update the unit member.');
  }
});

router.delete('/:id/members/:memberId', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: member, error: memberError } = await supabaseAdmin
      .from('respond_unit_members')
      .select('id, unit_id, officer_id, member_role')
      .eq('id', req.params.memberId)
      .eq('unit_id', req.params.id)
      .eq('is_active', true)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.member_role === 'team_leader') { res.status(404).json({ error: 'Crew member not found.' }); return; }
    const { error: updateError } = await supabaseAdmin.from('respond_unit_members')
      .update({ is_active: false }).eq('id', member.id);
    if (updateError) throw updateError;
    await syncLegacyOfficerIds(member.unit_id);
    res.json({ unit: (await getUnitDetails([member.unit_id]))[0] });
  } catch (error: any) {
    reportDbError(res, error, 'Could not remove the unit member.');
  }
});

router.delete('/:id', authenticate, authorize('logistics', 'master_admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { error } = await supabaseAdmin.rpc('delete_empty_respond_unit_v1', {
      p_unit_id: req.params.id,
    });
    if (error) throw error;
    res.status(204).send();
  } catch (error: any) {
    reportDbError(res, error, 'Could not delete the respond unit.');
  }
});

export default router;
