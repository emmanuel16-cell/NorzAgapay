import { useEffect, useState } from 'react';
import { userAPI } from '../lib/api';
import toast from 'react-hot-toast';

interface User {
  id: string; full_name: string; email: string; phone?: string;
  role: string; unit_type?: string; status: string; verified: boolean;
  last_seen?: string; created_at: string;
}

const roleColors: Record<string,string> = {
  admin:'badge-critical', commander:'badge-high',
  professional_unit:'badge-open'
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('');
  const [editUser, setEditUser] = useState<User|null>(null);
  const [editForm, setEditForm] = useState({ status:'', role:'' });

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

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">User Management</h1>
        <select className="form-select" style={{width:'auto'}} value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}>
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="commander">Commander</option>
          <option value="professional_unit">MDRRMO Officer</option>
        </select>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner"/></div>
        ) : (
          <div className="table-container">
            <table>
              <thead><tr>
                <th>Name</th><th>Email</th><th>Role</th><th>Unit</th><th>Status</th><th>Verified</th><th>Last Seen</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{fontWeight:600,color:'var(--text-primary)'}}>{u.full_name}</td>
                    <td>{u.email}</td>
                    <td><span className={`badge ${roleColors[u.role]||'badge-low'}`}>{u.role === 'professional_unit' ? 'MDRRMO Officer' : u.role.replace(/_/g,' ')}</span></td>
                    <td>{u.unit_type || '—'}</td>
                    <td><span className={`badge ${u.status==='active'?'badge-low':'badge-pending'}`}>{u.status}</span></td>
                    <td>{u.verified ? '✅' : '❌'}</td>
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
              <select className="form-select" value={editForm.role} onChange={e=>setEditForm({...editForm,role:e.target.value})}>
                <option value="admin">Admin</option>
                <option value="commander">Commander</option>
                <option value="professional_unit">MDRRMO Officer</option>
              </select>
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
    </>
  );
}
