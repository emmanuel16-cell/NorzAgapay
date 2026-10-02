import { useEffect, useState } from 'react';
import { userAPI } from '../lib/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

interface User {
  id: string; full_name: string; email: string; phone?: string;
  role: string; status: string;
  last_seen?: string; created_at: string;
}

const roleColors: Record<string,string> = {
  master_admin:'badge-high', admin:'badge-critical', responder:'badge-open',
};

export default function UsersPage() {
  const { user } = useAuth();
  const isMasterAdmin = user?.role === 'master_admin';
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('');
  const [editUser, setEditUser] = useState<User|null>(null);
  const [editForm, setEditForm] = useState({ status:'', role:'' });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ full_name:'', email:'', password:'', role:'logistics' });
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
    setEditForm({ status: u.status, role: u.role });
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
    setCreating(true);
    try {
      await userAPI.create(createForm);
      toast.success(`${createForm.role.replace(/_/g, ' ')} account created`);
      setShowCreate(false);
      setCreateForm({ full_name:'', email:'', password:'', role:'logistics' });
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Account creation failed');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">User Management</h1>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
        <select className="form-select" style={{width:'auto'}} value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}>
          <option value="">All Roles</option>
          {isMasterAdmin && <option value="master_admin">Master Admin</option>}
          {isMasterAdmin && <option value="admin">Admin</option>}
          <option value="logistics">Logistics</option>
          <option value="dispatcher">Dispatcher</option>
          {isMasterAdmin && <>
            <option value="responder">Responder</option>
          </>}
        </select>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create Account</button>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner"/></div>
        ) : (
          <div className="table-container">
            <table>
              <thead><tr>
                <th>Name</th><th>Role</th><th>Status</th><th>Last Seen</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{fontWeight:600,color:'var(--text-primary)'}}>{u.full_name}</td>
                    <td><span className={`badge ${roleColors[u.role]||'badge-low'}`}>{u.role.replace(/_/g,' ')}</span></td>
                    <td><span className={`badge ${u.status==='active'?'badge-low':'badge-pending'}`}>{u.status}</span></td>
                    <td style={{fontSize:'12px'}}>{u.last_seen ? new Date(u.last_seen).toLocaleString() : '—'}</td>
                    <td><button className="btn btn-outline btn-sm" onClick={()=>openEdit(u)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                <select className="form-select" value={editForm.role} onChange={e=>setEditForm({...editForm,role:e.target.value})}>
                  <option value="admin">Admin</option>
                  <option value="logistics">Logistics</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="responder">Responder</option>
                </select>
              ) : <input className="form-input" value={editForm.role.replace(/_/g, ' ')} disabled />}
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={editForm.status} onChange={e=>setEditForm({...editForm,status:e.target.value})}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending_verification">Pending Verification</option>
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setEditUser(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
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
              <label className="form-label">Email</label>
              <input className="form-input" type="email" required value={createForm.email} onChange={event => setCreateForm({...createForm,email:event.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Temporary Password (minimum 8 characters)</label>
              <input className="form-input" type="password" required minLength={8} value={createForm.password} onChange={event => setCreateForm({...createForm,password:event.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-select" value={createForm.role} onChange={event => setCreateForm({...createForm,role:event.target.value})}>
                {isMasterAdmin && <option value="admin">Admin</option>}
                <option value="logistics">Logistics</option>
                <option value="dispatcher">Dispatcher</option>
              </select>
            </div>
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
