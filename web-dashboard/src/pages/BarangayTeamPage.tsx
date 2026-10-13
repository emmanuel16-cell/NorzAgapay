import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, CircleUserRound, Edit3, Plus, RefreshCw, ShieldAlert, UserRoundX, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { barangayAPI, socket } from '../lib/api';
import PasswordInput from '../components/PasswordInput';

type Member = { id: string; full_name: string; email?: string | null; phone?: string | null; role: 'admin' | 'dispatcher' | 'responder' | 'staff'; is_active: boolean; created_at?: string };
type MemberForm = { full_name: string; email: string; phone: string; password: string; role: 'dispatcher' | 'responder' | 'staff' };
const emptyForm: MemberForm = { full_name: '', email: '', phone: '', password: '', role: 'responder' };

export default function BarangayTeamPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const canManageTeam = user?.role === 'admin';
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState<MemberForm>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await barangayAPI.team();
      setMembers(Array.isArray(data) ? data : []);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || 'Barangay team could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user?.coordination_verified) void load(); else setLoading(false); }, [load, user?.coordination_verified]);
  useEffect(() => {
    socket.on('team:member_added', load);
    socket.on('team:member_updated', load);
    return () => {
      socket.off('team:member_added', load);
      socket.off('team:member_updated', load);
    };
  }, [load]);

  const resetForm = useCallback(() => { setForm(emptyForm); setEditingId(null); setIsFormOpen(false); }, []);
  useEffect(() => {
    if (!isFormOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFormOpen]);
  const beginEdit = (member: Member) => {
    setEditingId(member.id);
    setForm({ full_name: member.full_name || '', email: member.email || '', phone: member.phone || '', password: '', role: member.role === 'admin' ? 'staff' : member.role });
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await barangayAPI.updateTeamMember(editingId, {
          full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() || null,
          role: form.role, ...(form.password ? { password: form.password } : {}),
        });
        toast.success('Barangay team member updated.');
      } else {
        if (form.password.length < 8) { toast.error('Set a password with at least eight characters.'); setSaving(false); return; }
        await barangayAPI.createTeamMember({
          full_name: form.full_name.trim(), email: form.email.trim(), password: form.password,
          phone: form.phone.trim(), role: form.role,
        });
        toast.success('Barangay account added to the team.');
      }
      resetForm();
      await load();
    } catch (saveError: any) {
      toast.error(saveError?.response?.data?.error || 'Team member could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (member: Member) => {
    const next = !member.is_active;
    if (!next && !window.confirm(`Deactivate ${member.full_name}'s barangay account? They will no longer be able to sign in. Historical reports and crew records will remain.`)) return;
    try {
      await barangayAPI.setTeamMemberActive(member.id, next);
      toast.success(next ? 'Account reactivated.' : 'Account deactivated.');
      await load();
    } catch (actionError: any) {
      toast.error(actionError?.response?.data?.error || 'The account status could not be updated.');
    }
  };

  if (!user?.coordination_verified) return <div className={`barangay-console-page${embedded ? ' barangay-console-page-embedded' : ''}`}><div className="barangay-console-message"><ShieldAlert /><div><strong>Barangay access is not active</strong><p>Complete the Barangay Account Request and wait for MDRRMO activation before managing the team.</p>{!embedded && <Link to="/barangay-settings">Open account request</Link>}</div></div></div>;

  const activeMembers = members.filter((member) => member.is_active);
  const inactiveMembers = members.filter((member) => !member.is_active);

  return (
    <div className={`barangay-console-page${embedded ? ' barangay-console-page-embedded' : ''}`}>
      <header className="barangay-console-header">
        <div><span className="workspace-eyebrow">BARANGAY ADMINISTRATION · {user?.barangay_name || 'YOUR BARANGAY'}</span><h1>Barangay team</h1><p>{canManageTeam ? 'Manage accounts in this barangay roster. Response crew selection remains limited to this roster.' : 'View your barangay team roster and contact details.'}</p></div>
        <div className="barangay-console-header-actions">
          {canManageTeam && !isFormOpen && <button className="workspace-primary-action" type="button" onClick={() => { setForm(emptyForm); setEditingId(null); setIsFormOpen(true); }} aria-haspopup="dialog" aria-expanded={isFormOpen}><Plus size={16} /> Add Barangay Account</button>}
          <button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button>
        </div>
      </header>

      <section className="barangay-console-stat-grid barangay-console-stat-grid-compact"><article><span>Active accounts</span><strong>{activeMembers.length}</strong><CircleUserRound size={20} /></article><article><span>Inactive accounts</span><strong>{inactiveMembers.length}</strong><UserRoundX size={20} /></article><article><span>Roster scope</span><strong>{user?.barangay_name || 'Barangay'}</strong><ShieldAlert size={20} /></article></section>

      {canManageTeam && isFormOpen && <div className="barangay-team-modal-backdrop" role="presentation" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!saving) resetForm(); }
        if (event.key === 'Tab') {
          const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) resetForm(); }}>
        <section id="barangay-team-account-form" className="barangay-console-panel barangay-team-form-panel barangay-team-account-modal" role="dialog" aria-modal="true" aria-labelledby="barangay-team-account-title">
        <header><div><h2 id="barangay-team-account-title">{editingId ? 'Edit team account' : 'Add Barangay Account'}</h2><p>Barangay administrators cannot be added from this form. Dispatcher accounts require an active Barangay Account Request.</p></div><button autoFocus className="workspace-secondary-action" type="button" onClick={resetForm} disabled={saving}><X size={15} /> Cancel</button></header>
        <form className="barangay-console-form-grid" onSubmit={(event) => void submit(event)}>
          <label>Full name<input required minLength={2} maxLength={120} value={form.full_name} onChange={(event) => setForm((value) => ({ ...value, full_name: event.target.value }))} /></label>
          <label>Email<input required type="email" value={form.email} onChange={(event) => setForm((value) => ({ ...value, email: event.target.value }))} /></label>
          <label>Phone number<input type="tel" value={form.phone} onChange={(event) => setForm((value) => ({ ...value, phone: event.target.value }))} placeholder="09XXXXXXXXX" /></label>
          <label>Barangay role<select value={form.role} onChange={(event) => setForm((value) => ({ ...value, role: event.target.value as MemberForm['role'] }))}><option value="responder">Responder</option><option value="dispatcher">Dispatcher</option><option value="staff">Staff</option></select></label>
          <label className="barangay-console-form-wide">{editingId ? 'New password (optional)' : 'Initial password'}<PasswordInput required={!editingId} minLength={editingId ? undefined : 8} autoComplete="new-password" value={form.password} onChange={(event) => setForm((value) => ({ ...value, password: event.target.value }))} placeholder={editingId ? 'Leave blank to keep the current password' : 'At least 8 characters'} /></label>
          <div className="barangay-console-form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? <><Check size={16} /> Save account</> : <><Plus size={16} /> Add account</>}</button></div>
        </form>
        </section>
      </div>}

      {error && <div className="workspace-message workspace-message-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
      {loading ? <p className="barangay-console-muted">Loading the barangay roster…</p> : <>
        <section className="barangay-console-panel"><header><div><h2>Active team</h2><p>Responders and staff here can be used for barangay operations as allowed by their role.</p></div></header><div className="barangay-team-grid">
          {activeMembers.map((member) => <article className="barangay-team-card" key={member.id}><div className="barangay-team-card-avatar">{member.full_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><div className="barangay-team-card-info"><strong>{member.full_name}</strong><span className="barangay-console-status active">{member.role.replaceAll('_', ' ')}</span><small>{member.email || 'No email'}{member.phone ? ` · ${member.phone}` : ''}</small></div>{canManageTeam && member.role !== 'admin' && <div className="barangay-team-card-actions"><button type="button" title="Edit account" aria-label={`Edit ${member.full_name}`} onClick={() => beginEdit(member)}><Edit3 size={16} /></button><button type="button" title="Deactivate account" aria-label={`Deactivate ${member.full_name}`} onClick={() => void toggleActive(member)}><UserRoundX size={16} /></button></div>}</article>)}
          {activeMembers.length === 0 && <p className="barangay-console-muted">No active team accounts were found.</p>}
        </div></section>
        {inactiveMembers.length > 0 && <section className="barangay-console-panel"><header><div><h2>{canManageTeam ? 'Inactive accounts' : 'Inactive team accounts'}</h2><p>{canManageTeam ? 'Historical assignments remain available. Reactivation restores sign-in access.' : 'These accounts are currently inactive.'}</p></div></header><div className="barangay-team-grid">{inactiveMembers.map((member) => <article className="barangay-team-card is-inactive" key={member.id}><div className="barangay-team-card-avatar">{member.full_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><div className="barangay-team-card-info"><strong>{member.full_name}</strong><span className="barangay-console-status inactive">Inactive · {member.role}</span><small>{member.email || 'No email'}{member.phone ? ` · ${member.phone}` : ''}</small></div>{canManageTeam && <button className="workspace-secondary-action" type="button" onClick={() => void toggleActive(member)}><Check size={15} /> Reactivate</button>}</article>)}</div></section>}
      </>}
    </div>
  );
}
