import { supabaseAdmin } from '../config/supabase';

export function currentManilaDate(): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface DispatchableRespondUnit {
  unit_id: string;
  unit_name: string;
  responder_user_id: string;
}

export async function getDispatchableRespondUnits(): Promise<DispatchableRespondUnit[]> {
  const { data: activations, error: activationError } = await supabaseAdmin
    .from('respond_unit_daily_activations')
    .select('unit_id')
    .eq('activation_date', currentManilaDate());
  if (activationError) throw activationError;
  const activatedUnitIds = [...new Set((activations || []).map((row: any) => row.unit_id))];
  if (!activatedUnitIds.length) return [];

  const { data: units, error: unitsError } = await supabaseAdmin
    .from('respond_units')
    .select('id, unit_name')
    .in('id', activatedUnitIds)
    .eq('status', 'available');
  if (unitsError) throw unitsError;
  const activeUnits = units || [];
  if (!activeUnits.length) return [];
  const activeUnitIds = activeUnits.map((unit: any) => unit.id);

  const { data: members, error: membersError } = await supabaseAdmin
    .from('respond_unit_members')
    .select('unit_id, responder_user_id, member_role')
    .in('unit_id', activeUnitIds)
    .eq('is_active', true)
    .in('member_role', ['team_leader', 'driver_responder', 'first_aider_responder']);
  if (membersError) throw membersError;

  const rosterByUnit = new Map<string, any[]>();
  for (const member of members || []) {
    const rows = rosterByUnit.get(member.unit_id) || [];
    rows.push(member);
    rosterByUnit.set(member.unit_id, rows);
  }

  const readyUnits = activeUnits.filter((unit: any) => {
    const roster = rosterByUnit.get(unit.id) || [];
    return roster.some((member) => member.member_role === 'team_leader' && member.responder_user_id) &&
      roster.some((member) => member.member_role === 'driver_responder') &&
      roster.some((member) => member.member_role === 'first_aider_responder');
  });
  if (!readyUnits.length) return [];

  const unitById = new Map(readyUnits.map((unit: any) => [unit.id, unit]));
  const leaderMemberships = readyUnits.flatMap((unit: any) =>
    (rosterByUnit.get(unit.id) || [])
      .filter((member) => member.member_role === 'team_leader' && member.responder_user_id)
      .map((member) => ({ unit_id: unit.id, responder_user_id: member.responder_user_id })),
  );
  const leaderIds = [...new Set(leaderMemberships.map((member) => member.responder_user_id))];
  if (!leaderIds.length) return [];

  const { data: users, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id')
    .in('id', leaderIds)
    .eq('role', 'responder')
    .eq('status', 'active');
  if (usersError) throw usersError;
  const activeLeaderIds = new Set((users || []).map((user: any) => user.id));

  return leaderMemberships
    .filter((leader) => activeLeaderIds.has(leader.responder_user_id))
    .map((leader) => ({
      unit_id: leader.unit_id,
      unit_name: (unitById.get(leader.unit_id) as any)?.unit_name || 'Response unit',
      responder_user_id: leader.responder_user_id,
    }));
}
