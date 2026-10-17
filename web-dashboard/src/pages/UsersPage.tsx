import { useEffect, useState } from 'react';
import { userAPI } from '../lib/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import { CircleUserRound, Edit3, Plus, RefreshCw, UserRoundX, UsersRound } from 'lucide-react';
import MobileNumberInput from '../components/MobileNumberInput';
import { formatMobileNumber, isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';

interface User {
  id: string; full_name: string; phone: string;
  role: string; status: string;
  last_seen?: string; created_at: string;
}

const roleLabel = (role: string) => role === 'logistics' ? 'Staff' : role.replace(/_/g, ' ');

export default function UsersPage() {
  const { user } = useAuth();
  const isMasterAdmin = user?.role === 'master_admin';
  const canCreateAccounts = user?.role === 'admin' || isMasterAdmin;
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('');
  const [editUser, setEditUser] = useState<User|null>(null);
  const [editForm, setEditForm] = useState({ status:'', role:'' });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ full_name:'', password:'', phone:'', unit_type:'', role:'logistics' });
  const [creating, setCreating] = useState(false);

  const fetchUsers = () => {
    setLoading(true);
    userAPI.list(roleFilter ? { role: roleFilter } : undefined)
      .then(r => setUsers(r.data.users || []))
      .catch(() => toast.error('Failed to load users'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, [roleFilter]);

  const openEdit = (u: User) => {
    setEditUser(u);
    setEditForm({
      status: u.role === 'responder' && u.status === 'pending_verification' ? 'active' : u.status,
      role: u.role,
    });
  };

  const handleSave = async () => {
    if (!editUser) return;
    try {
      await userAPI.update(editUser.id, editForm);
      toast.success('User updated');
      setEditUser(null);
      fetchUsers();
    } catch { toast.error('Update failed'); }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidMobileNumber(createForm.phone)) { toast.error('Enter exactly 11 digits starting with 09.'); return; }
    setCreating(true);
    try {
      await userAPI.create({
        ...createForm,
        phone: normalizeMobileNumberInput(createForm.phone),
        unit_type: createForm.role === 'responder' ? createForm.unit_type || undefined : undefined,
      });
      toast.success(`${roleLabel(createForm.role)} account created`);
      setShowCreate(false);
      setCreateForm({ full_name:'', password:'', phone:'', unit_type:'', role:'logistics' });
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Account creation failed');
    } finally {
      setCreating(false);
    }
  };

  const activeUsers = users.filter((entry) => entry.status === 'active');
  const otherUsers = users.filter((entry) => entry.status !== 'active');
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const renderAccount = (entry: User, inactive = false) => (
    <article className={`barangay-team-card${inactive ? ' is-inactive' : ''}`} key={entry.id}>
      <div className="barangay-team-card-avatar">{initials(entry.full_name)}</div>
      <div className="barangay-team-card-info">
        <strong>{entry.full_name}</strong>
        <span className="barangay-console-status">{roleLabel(entry.role)}</span>
        <span className={`barangay-console-status ${entry.status === 'active' ? 'active' : entry.status === 'inactive' ? 'inactive' : 'pending'}`}>{entry.status.replaceAll('_', ' ')}</span>
        <small>{formatMobileNumber(entry.phone)}</small>
      </div>
      <div className="barangay-team-card-actions">
        <button type="button" title="Edit account" aria-label={`Edit ${entry.full_name}`} onClick={() => openEdit(entry)}><Edit3 size={16} /></button>
      </div>
    </article>
  );

  return (
    <>
      <div className="barangay-console-page user-management-page">
        <header className="barangay-console-header">
          <div><span className="workspace-eyebrow">MDRRMO ADMINISTRATION</span><h1>User management</h1><p>Manage command-center accounts, roles, and access status.</p></div>
          <div className="barangay-console-header-actions user-management-header-actions">
            <select aria-label="Filter accounts by role" className="form-select user-management-role-filter" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">All roles</option>
              {isMasterAdmin && <option value="master_admin">Master admin</option>}
              {isMasterAdmin && <option value="admin">Admin</option>}
              <option value="logistics">Staff</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="responder">Responder</option>
            </select>
            {canCreateAccounts && <button className="workspace-primary-action" type="button" onClick={() => setShowCreate(true)}><Plus size={16} /> Create account</button>}
            <button className="workspace-secondary-action" type="button" onClick={fetchUsers} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button>
          </div>
        </header>

        <section className="barangay-console-stat-grid barangay-console-stat-grid-compact" aria-label="User account summary">
          <article><span>Active accounts</span><strong>{activeUsers.length}</strong><CircleUserRound size={20} /></article>
          <article><span>Other accounts</span><strong>{otherUsers.length}</strong><UserRoundX size={20} /></article>
          <article><span>Accounts shown</span><strong>{users.length}</strong><UsersRound size={20} /></article>
        </section>

        {loading ? <p className="barangay-console-muted">Loading dashboard accounts…</p> : <>
          <section className="barangay-console-panel">
            <header><div><h2>Active team</h2><p>Accounts currently able to sign in to the MDRRMO dashboard.</p></div></header>
            <div className="barangay-team-grid">
              {activeUsers.map((entry) => renderAccount(entry))}
              {activeUsers.length === 0 && <p className="barangay-console-muted">No active accounts match this filter.</p>}
            </div>
          </section>
          {otherUsers.length > 0 && <section className="barangay-console-panel">
            <header><div><h2>Inactive and pending accounts</h2><p>Accounts that cannot currently sign in or still need verification.</p></div></header>
            <div className="barangay-team-grid">{otherUsers.map((entry) => renderAccount(entry, true))}</div>
          </section>}
        </>}
      </div>

      {editUser && (
        <div className="modal-backdrop" onClick={()=>setEditUser(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit: {editUser.full_name}</h2>
              <button className="modal-close" onClick={()=>setEditUser(null)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              {isMasterAdmin ? (
                <select className="form-select" value={editForm.role} onChange={e=>setEditForm({...editForm,role:e.target.value,...(e.target.value === 'responder' ? {status:'active'} : {})})}>
                  <option value="admin">Admin</option>
                  <option value="logistics">Staff</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="responder">Responder</option>
                </select>
              ) : <input className="form-input" value={roleLabel(editForm.role)} disabled />}
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={editForm.status} onChange={e=>setEditForm({...editForm,status:e.target.value})}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                {editForm.role !== 'responder' && <option value="pending_verification">Pending Verification</option>}
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setEditUser(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {canCreateAccounts && showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form className="modal" onSubmit={handleCreate} onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Create Dashboard Account</h2>
              <button type="button" className="modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" required minLength={2} value={createForm.full_name} onChange={event => setCreateForm({...createForm,full_name:event.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Mobile number</label>
              <MobileNumberInput className="form-input" value={createForm.phone} onValueChange={(phone) => setCreateForm({...createForm, phone})} placeholder="09XXXXXXXXX" required />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-select" value={createForm.role} onChange={event => setCreateForm({...createForm,role:event.target.value})}>
                {isMasterAdmin && <option value="admin">Admin</option>}
                <option value="logistics">Staff</option>
                <option value="dispatcher">Dispatcher</option>
                <option value="responder">Responder</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Password (minimum 8 characters)</label>
              <PasswordInput className="form-input" autoComplete="new-password" required minLength={8} value={createForm.password} onChange={event => setCreateForm({...createForm,password:event.target.value})} />
            </div>
            {createForm.role === 'responder' && (
              <div className="form-group">
                <label className="form-label">Starting Specialization (optional)</label>
                <select className="form-select" value={createForm.unit_type} onChange={event => setCreateForm({...createForm,unit_type:event.target.value})}>
                  <option value="">No specialization yet</option>
                  <option value="Rescue Officer">Rescue Officer</option>
                  <option value="Swift Water Rescue Officer">Swift Water Rescue Officer</option>
                  <option value="Mountain Rescue Officer">Mountain Rescue Officer</option>
                  <option value="Emergency Medical Responder (EMR)">Emergency Medical Responder (EMR)</option>
                  <option value="Ambulance Officer / EMS Personnel">Ambulance Officer / EMS Personnel</option>
                  <option value="Fire Response Officer">Fire Response Officer</option>
                  <option value="Evacuation Officer">Evacuation Officer</option>
                  <option value="Safety & Security Officer">Safety &amp; Security Officer</option>
                  <option value="Traffic & Road Clearing Officer">Traffic &amp; Road Clearing Officer</option>
                  <option value="Communications Officer">Communications Officer</option>
                  <option value="Logistics Response Officer">Logistics Response Officer</option>
                  <option value="Damage Assessment Officer">Damage Assessment Officer</option>
                </select>
              </div>
            )}
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create Account'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
