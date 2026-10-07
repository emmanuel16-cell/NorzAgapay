import { useEffect, useMemo, useState } from 'react';
import { Activity, HeartPulse, MapPin, Pencil, Plus, Power, Radio, Search, Shield, Trash2, Users, X, Zap } from 'lucide-react';
import { respondUnitAPI } from '../lib/api';
import toast from 'react-hot-toast';
import './RespondUnitsPage.css';

type CrewRole = 'radio_operator' | 'driver_responder' | 'first_aider_responder';
type MemberRole = CrewRole | 'team_leader' | 'unassigned';

interface UnitMember {
  id: string;
  officer_id: string;
  responder_user_id?: string | null;
  member_role: MemberRole;
  role_label?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  specialization?: string;
  status?: string;
  is_active?: boolean;
}

interface ResponderAccount {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
}

interface RespondUnit {
  id: string;
  unit_name: string;
  specialization: string;
  status: string;
  created_at: string;
  team_leader_user_id?: string | null;
  team_leader?: { id: string; full_name: string; email: string } | null;
  members: UnitMember[];
  roster_ready: boolean;
  is_active_today: boolean;
  activation_date?: string | null;
  activation_mode?: 'manual' | 'emergency' | null;
  activated_at?: string | null;
  can_dispatch_today: boolean;
}

const roles: Array<{ value: CrewRole; label: string; limit: number }> = [
  { value: 'radio_operator', label: 'Radio Operator', limit: 1 },
  { value: 'driver_responder', label: 'Driver Responder', limit: 3 },
  { value: 'first_aider_responder', label: 'First Aider Responder', limit: 3 },
];

const roleLabels: Record<MemberRole, string> = {
  team_leader: 'Team Leader',
  radio_operator: 'Radio Operator',
  driver_responder: 'Driver Responder',
  first_aider_responder: 'First Aider Responder',
  unassigned: 'Position needs review',
};

const roleIcons: Record<CrewRole, typeof Radio> = {
  radio_operator: Radio,
  driver_responder: Activity,
  first_aider_responder: HeartPulse,
};

export default function RespondUnitsPage() {
  const [units, setUnits] = useState<RespondUnit[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [leaderAccounts, setLeaderAccounts] = useState<ResponderAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activatingAll, setActivatingAll] = useState(false);
  const [query, setQuery] = useState('');
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<RespondUnit | null>(null);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [unitForm, setUnitForm] = useState({ unit_name: '', specialization: 'mixed', status: 'available', team_leader_user_id: '' });
  const [memberForm, setMemberForm] = useState({ name: '', phone: '', member_role: 'driver_responder' as CrewRole });

  const selectedUnit = units.find((unit) => unit.id === selectedId) || null;
  const filteredUnits = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return units;
    return units.filter((unit) =>
      unit.unit_name.toLowerCase().includes(normalized) ||
      (unit.team_leader?.full_name || '').toLowerCase().includes(normalized) ||
      unit.specialization.toLowerCase().includes(normalized),
    );
  }, [query, units]);

  const fetchUnits = async (preferredId?: string) => {
    setLoading(true);
    try {
      const response = await respondUnitAPI.list();
      const nextUnits: RespondUnit[] = response.data.units || [];
      setUnits(nextUnits);
      setSelectedId((current) => {
        const desired = preferredId || current;
        return nextUnits.some((unit) => unit.id === desired) ? desired : nextUnits[0]?.id || '';
      });
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not load respond units.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchUnits(); }, []);

  const openCreate = async () => {
    setUnitForm({ unit_name: '', specialization: 'mixed', status: 'available', team_leader_user_id: '' });
    setEditingUnit(null);
    setSaving(true);
    try {
      const response = await respondUnitAPI.leaderAccounts();
      setLeaderAccounts(response.data.responders || []);
      setShowUnitForm(true);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not load active responder accounts.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = async (unit: RespondUnit) => {
    setSaving(true);
    try {
      const response = await respondUnitAPI.leaderAccounts(unit.id);
      setLeaderAccounts(response.data.responders || []);
      setEditingUnit(unit);
      setUnitForm({
        unit_name: unit.unit_name,
        specialization: unit.specialization || 'mixed',
        status: unit.status || 'available',
        team_leader_user_id: unit.team_leader_user_id || '',
      });
      setShowUnitForm(true);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not load unit details.');
    } finally {
      setSaving(false);
    }
  };

  const saveUnit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!unitForm.team_leader_user_id) {
      toast.error('Choose an active responder account as the Team Leader.');
      return;
    }
    setSaving(true);
    try {
      if (editingUnit) {
        await respondUnitAPI.update(editingUnit.id, {
          unit_name: unitForm.unit_name,
          specialization: unitForm.specialization,
          status: unitForm.status,
        });
        if (editingUnit.team_leader_user_id !== unitForm.team_leader_user_id) {
          await respondUnitAPI.assignLeader(editingUnit.id, unitForm.team_leader_user_id);
        }
        toast.success('Respond unit updated.');
      } else {
        const response = await respondUnitAPI.create({
          unit_name: unitForm.unit_name,
          specialization: unitForm.specialization,
          team_leader_user_id: unitForm.team_leader_user_id,
        });
        toast.success('Respond unit created.');
        setShowUnitForm(false);
        await fetchUnits(response.data.unit.id);
        return;
      }
      setShowUnitForm(false);
      setEditingUnit(null);
      await fetchUnits(editingUnit.id);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not save the respond unit.');
    } finally {
      setSaving(false);
    }
  };

  const addMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedUnit) return;
    setSaving(true);
    try {
      const response = await respondUnitAPI.addMember(selectedUnit.id, {
        name: memberForm.name,
        phone: memberForm.phone || undefined,
        member_role: memberForm.member_role,
      });
      toast.success(`${roleLabels[memberForm.member_role]} added.`);
      setMemberForm({ name: '', phone: '', member_role: 'driver_responder' });
      setShowMemberForm(false);
      await fetchUnits(response.data.unit.id);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not add this crew member.');
    } finally {
      setSaving(false);
    }
  };

  const updateMemberRole = async (member: UnitMember, member_role: CrewRole) => {
    if (!selectedUnit || member.member_role === member_role) return;
    try {
      const response = await respondUnitAPI.updateMember(selectedUnit.id, member.id, { member_role });
      await fetchUnits(response.data.unit.id);
      toast.success('Crew position updated.');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not update crew position.');
    }
  };

  const removeMember = async (member: UnitMember) => {
    if (!selectedUnit || !window.confirm(`Remove ${member.name} from ${selectedUnit.unit_name}?`)) return;
    try {
      const response = await respondUnitAPI.removeMember(selectedUnit.id, member.id);
      await fetchUnits(response.data.unit.id);
      toast.success('Crew member removed from the unit.');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not remove this crew member.');
    }
  };

  const setUnitActiveToday = async (unit: RespondUnit, active: boolean) => {
    if (active && (unit.status !== 'available' || !unit.roster_ready)) return;
    setSaving(true);
    try {
      const response = await respondUnitAPI.activateToday(unit.id, active);
      await fetchUnits(unit.id);
      toast.success(active ? `${unit.unit_name} is active for dispatch today.` : `${unit.unit_name} is inactive for new dispatches today.`);
      return response.data;
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not update today’s unit activation.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const emergencyActivateAll = async () => {
    const eligibleCount = units.filter((unit) => unit.status === 'available' && unit.roster_ready).length;
    if (!eligibleCount) {
      toast.error('No available units have a complete responder roster.');
      return;
    }
    if (!window.confirm('Emergency activation will make every available unit with a complete roster selectable for MDRRMO dispatch today. Continue?')) return;
    setActivatingAll(true);
    try {
      const response = await respondUnitAPI.emergencyActivateAllToday();
      await fetchUnits();
      const { activated_count, skipped_count } = response.data;
      toast.success(`Emergency activation enabled ${activated_count} unit(s); ${skipped_count} unit(s) were not eligible.`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not emergency activate response units.');
    } finally {
      setActivatingAll(false);
    }
  };

  return (
    <div className="ru-page">
      <header className="ru-page-header">
        <div className="ru-title-group">
          <h1>Respond Units</h1>
          <span>Staff workspace</span>
        </div>
        <div className="ru-header-actions">
          <span className="ru-live"><i /> Unit roster</span>
          <button className="btn btn-outline ru-emergency-button" onClick={() => void emergencyActivateAll()} disabled={saving || activatingAll || !units.length}><Zap size={16} /> {activatingAll ? 'Activating…' : 'Emergency activate all'}</button>
          <button className="btn btn-primary" onClick={openCreate} disabled={saving || activatingAll}><Plus size={17} /> Create Unit</button>
        </div>
      </header>

      <section className="ru-split-view">
        <aside className="ru-unit-queue">
          <div className="ru-queue-heading"><h2>Response units</h2><span>{units.length}</span></div>
          <label className="ru-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search units or leaders" />
          </label>
          {loading ? <div className="ru-queue-empty">Loading units…</div> : filteredUnits.length === 0 ? (
            <div className="ru-queue-empty"><Users size={22} /><strong>No units found</strong><span>Create a unit and assign its Team Leader.</span></div>
          ) : (
            <div className="ru-unit-list">
              {filteredUnits.map((unit) => {
                const activeMembers = unit.members.filter((member) => member.member_role !== 'unassigned');
                const active = unit.id === selectedId;
                return (
                  <button key={unit.id} type="button" className={`ru-unit-item ${active ? 'selected' : ''}`} onClick={() => setSelectedId(unit.id)}>
                    <span className="ru-unit-item-icon"><Shield size={18} /></span>
                    <span className="ru-unit-item-content">
                      <strong>{unit.unit_name}</strong>
                      <small>{unit.team_leader?.full_name || 'Team Leader unassigned'}</small>
                      <small>{activeMembers.length} roster members · {unit.status || 'available'}</small>
                      <small className={`ru-unit-activation ${unit.can_dispatch_today ? 'dispatchable' : ''}`}>
                        {unit.can_dispatch_today ? 'Active today · dispatchable' : unit.is_active_today ? 'Activated · not dispatchable' : 'Inactive today'}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <main className="ru-unit-detail">
          {!selectedUnit ? (
            <div className="ru-detail-empty">
              <div><Users size={28} /></div>
              <strong>Select a response unit</strong>
              <p>Choose a unit from the list to review its team and roster.</p>
            </div>
          ) : (
            <>
              <div className="ru-detail-header">
                <div>
                  <div className="ru-eyebrow">Response unit</div>
                  <h2>{selectedUnit.unit_name}</h2>
                  <p><MapPin size={14} /> {selectedUnit.specialization || 'Mixed response'} <span>·</span> {selectedUnit.status || 'available'}</p>
                  <div className={`ru-activation-state ${selectedUnit.can_dispatch_today ? 'dispatchable' : ''}`}>
                    <Power size={15} />
                    <span>{selectedUnit.can_dispatch_today ? 'Active today · dispatchers can assign this unit' : selectedUnit.is_active_today ? 'Activated today · unavailable for dispatch' : 'Inactive today · hidden from dispatchers'}</span>
                    {selectedUnit.activation_mode === 'emergency' && <small>Emergency activation</small>}
                  </div>
                </div>
                <div className="ru-detail-actions">
                  <button className={`btn btn-sm ${selectedUnit.is_active_today ? 'btn-outline' : 'btn-primary'}`} onClick={() => void setUnitActiveToday(selectedUnit, !selectedUnit.is_active_today)} disabled={saving || (!selectedUnit.is_active_today && (selectedUnit.status !== 'available' || !selectedUnit.roster_ready))}>
                    <Power size={14} /> {selectedUnit.is_active_today ? 'Deactivate today' : 'Activate today'}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => void openEdit(selectedUnit)} disabled={saving}><Pencil size={14} /> Edit unit</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setShowMemberForm((visible) => !visible)}><Plus size={15} /> Add crew</button>
                </div>
              </div>

              {showMemberForm && (
                <form className="ru-add-member" onSubmit={addMember}>
                  <div className="ru-add-member-title"><strong>Add unit member</strong><button type="button" aria-label="Close add member form" onClick={() => setShowMemberForm(false)}><X size={16} /></button></div>
                  <div className="ru-add-member-fields">
                    <input className="form-input" required minLength={2} maxLength={120} placeholder="Full name" value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} />
                    <input className="form-input" maxLength={30} placeholder="Phone (optional)" value={memberForm.phone} onChange={(event) => setMemberForm({ ...memberForm, phone: event.target.value })} />
                    <select className="form-select" value={memberForm.member_role} onChange={(event) => setMemberForm({ ...memberForm, member_role: event.target.value as CrewRole })}>
                      {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                    <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add Member'}</button>
                  </div>
                </form>
              )}

              <div className="ru-leader-card">
                <div className="ru-member-icon leader"><Shield size={18} /></div>
                <div className="ru-member-info">
                  <small>TEAM LEADER · RESPONDER ACCOUNT</small>
                  <strong>{selectedUnit.team_leader?.full_name || 'No Team Leader assigned'}</strong>
                  {selectedUnit.team_leader?.email && <span>{selectedUnit.team_leader.email}</span>}
                </div>
                <span className="ru-member-status">{selectedUnit.team_leader ? 'Assigned' : 'Required'}</span>
              </div>

              <div className="ru-roster-title"><div><h3>Unit roster</h3><span>One radio operator · up to three drivers · up to three first aiders</span></div><span>{selectedUnit.members.length} members</span></div>
              <div className="ru-roster-grid">
                {roles.map((role) => {
                  const Icon = roleIcons[role.value];
                  const members = selectedUnit.members.filter((member) => member.member_role === role.value);
                  return (
                    <section className="ru-role-card" key={role.value}>
                      <header><Icon size={17} /><strong>{role.label}</strong><span>{members.length}/{role.limit}</span></header>
                      {members.length ? members.map((member) => (
                        <div className="ru-roster-member" key={member.id}>
                          <div className="ru-member-avatar">{member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>
                          <div className="ru-member-info"><strong>{member.name}</strong><span>{member.phone || member.specialization || 'Unit crew'}</span></div>
                          <select aria-label={`Position for ${member.name}`} value={member.member_role} onChange={(event) => void updateMemberRole(member, event.target.value as CrewRole)}>
                            {roles.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                          </select>
                          <button type="button" className="ru-remove-member" aria-label={`Remove ${member.name}`} onClick={() => void removeMember(member)}><Trash2 size={15} /></button>
                        </div>
                      )) : <div className="ru-role-empty">No {role.label.toLowerCase()} assigned</div>}
                    </section>
                  );
                })}
              </div>

              {selectedUnit.members.some((member) => member.member_role === 'unassigned') && (
                <section className="ru-role-card ru-review-card">
                  <header><Users size={17} /><strong>Legacy members to classify</strong><span>{selectedUnit.members.filter((member) => member.member_role === 'unassigned').length}</span></header>
                  {selectedUnit.members.filter((member) => member.member_role === 'unassigned').map((member) => (
                    <div className="ru-roster-member" key={member.id}>
                      <div className="ru-member-avatar">{member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>
                      <div className="ru-member-info"><strong>{member.name}</strong><span>Choose the correct unit position</span></div>
                      <select aria-label={`Assign position for ${member.name}`} defaultValue="" onChange={(event) => event.target.value && void updateMemberRole(member, event.target.value as CrewRole)}>
                        <option value="" disabled>Select position</option>
                        {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                      </select>
                      <button type="button" className="ru-remove-member" aria-label={`Remove ${member.name}`} onClick={() => void removeMember(member)}><Trash2 size={15} /></button>
                    </div>
                  ))}
                </section>
              )}

              {!selectedUnit.roster_ready && (
                <div className="ru-readiness-note"><Activity size={16} /> This unit cannot accept a dispatch until it has an active Team Leader, at least one Driver Responder, and at least one First Aider Responder.</div>
              )}
            </>
          )}
        </main>
      </section>

      {showUnitForm && (
        <div className="modal-backdrop" onClick={() => { setShowUnitForm(false); setEditingUnit(null); }}>
          <form className="modal ru-unit-modal" onSubmit={saveUnit} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingUnit ? 'Edit response unit' : 'Create response unit'}</h2>
              <button type="button" className="modal-close" onClick={() => { setShowUnitForm(false); setEditingUnit(null); }}>✕</button>
            </div>
            <div className="form-group"><label className="form-label">Unit name *</label><input className="form-input" required minLength={2} maxLength={100} placeholder="e.g. Alpha Rescue Team" value={unitForm.unit_name} onChange={(event) => setUnitForm({ ...unitForm, unit_name: event.target.value })} /></div>
            <div className="form-group"><label className="form-label">Specialization *</label><input className="form-input" required maxLength={120} value={unitForm.specialization} onChange={(event) => setUnitForm({ ...unitForm, specialization: event.target.value })} /></div>
            {editingUnit && <div className="form-group"><label className="form-label">Status</label><select className="form-select" value={unitForm.status} onChange={(event) => setUnitForm({ ...unitForm, status: event.target.value })}><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="maintenance">Maintenance</option></select></div>}
            <div className="form-group"><label className="form-label">Team Leader responder account *</label><select className="form-select" required value={unitForm.team_leader_user_id} onChange={(event) => setUnitForm({ ...unitForm, team_leader_user_id: event.target.value })}><option value="">Choose an active responder</option>{leaderAccounts.map((account) => <option key={account.id} value={account.id}>{account.full_name} · {account.email}</option>)}</select><small className="ru-form-hint">Each Team Leader account can lead one active response unit.</small></div>
            <div className="modal-footer"><button type="button" className="btn btn-outline" onClick={() => { setShowUnitForm(false); setEditingUnit(null); }}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editingUnit ? 'Save Unit' : 'Create Unit'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
