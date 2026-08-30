import { useEffect, useState } from 'react';
import { officerAPI } from '../lib/api';
import toast from 'react-hot-toast';

interface Officer {
  id: string;
  name: string;
  phone: string;
  email: string;
  specialization: string;
  rank?: string;
  status: string;
  created_at: string;
}

const SPECIALIZATIONS = [
  { value: 'Rescue Officer', label: 'Rescue Officer' },
  { value: 'Swift Water Rescue Officer', label: 'Swift Water Rescue Officer' },
  { value: 'Mountain Rescue Officer', label: 'Mountain Rescue Officer' },
  { value: 'Emergency Medical Responder (EMR)', label: 'Emergency Medical Responder (EMR)' },
  { value: 'Ambulance Officer / EMS Personnel', label: 'Ambulance Officer / EMS Personnel' },
  { value: 'Fire Response Officer', label: 'Fire Response Officer' },
  { value: 'Evacuation Officer', label: 'Evacuation Officer' },
  { value: 'Safety & Security Officer', label: 'Safety & Security Officer' },
  { value: 'Traffic & Road Clearing Officer', label: 'Traffic & Road Clearing Officer' },
  { value: 'Communications Officer', label: 'Communications Officer' },
  { value: 'Logistics Response Officer', label: 'Logistics Response Officer' },
  { value: 'Damage Assessment Officer', label: 'Damage Assessment Officer' },
  { value: 'other', label: 'Other' },
];

export default function OfficersPage() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editOfficer, setEditOfficer] = useState<Officer | null>(null);
  const [specializationFilter, setSpecializationFilter] = useState('');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    specialization: 'Rescue Officer',
    rank: '',
    status: 'active'
  });

  const fetchOfficers = () => {
    setLoading(true);
    officerAPI.list()
      .then(r => setOfficers(r.data.officers || []))
      .catch(() => toast.error('Failed to load officers'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOfficers();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await officerAPI.create(form);
      toast.success('Officer added successfully');
      setShowAdd(false);
      setForm({ name: '', phone: '', email: '', specialization: 'Rescue Officer', rank: '', status: 'active' });
      fetchOfficers();
    } catch {
      toast.error('Failed to add officer');
    }
  };

  const handleUpdate = async () => {
    if (!editOfficer) return;
    try {
      await officerAPI.update(editOfficer.id, form);
      toast.success('Officer updated successfully');
      setEditOfficer(null);
      setForm({ name: '', phone: '', email: '', specialization: 'Rescue Officer', rank: '', status: 'active' });
      fetchOfficers();
    } catch {
      toast.error('Failed to update officer');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this officer?')) return;
    try {
      await officerAPI.delete(id);
      toast.success('Officer deleted');
      fetchOfficers();
    } catch {
      toast.error('Failed to delete officer');
    }
  };

  const openEdit = (officer: Officer) => {
    setEditOfficer(officer);
    setForm({
      name: officer.name,
      phone: officer.phone,
      email: officer.email,
      specialization: officer.specialization,
      rank: officer.rank || '',
      status: officer.status
    });
  };

  const filteredOfficers = officers.filter(o => {
    if (specializationFilter === '') return true;
    return o.specialization === specializationFilter;
  });

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">MDRRMO Officers</h1>
        <div className="header-actions">
          <select
            className="form-select"
            style={{ width: 'auto' }}
            value={specializationFilter}
            onChange={e => setSpecializationFilter(e.target.value)}
          >
            <option value="">All Specializations</option>
            {SPECIALIZATIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Officer</button>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner" /></div>
        ) : filteredOfficers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🎖️</div>
            <p>No officers found</p>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: '16px' }}>Add First Officer</button>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Specialization</th>
                  <th>Rank</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOfficers.map(officer => (
                  <tr key={officer.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{officer.name}</td>
                    <td>{officer.phone || '—'}</td>
                    <td>{officer.email || '—'}</td>
                    <td>
                      <span className="badge badge-open" style={{ fontSize: '11px' }}>
                        {SPECIALIZATIONS.find(s => s.value === officer.specialization)?.label || officer.specialization}
                      </span>
                    </td>
                    <td>{officer.rank || '—'}</td>
                    <td>
                      <span className={`badge ${officer.status === 'active' ? 'badge-low' : 'badge-pending'}`}>
                        {officer.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(officer)}>Edit</button>
                        <button className="btn btn-outline btn-sm" style={{ color: '#ff4d4f' }} onClick={() => handleDelete(officer.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Add New Officer</h2>
              <button className="modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <form onSubmit={handleAdd}>
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input
                  className="form-input"
                  required
                  placeholder="e.g. Juan dela Cruz"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Phone</label>
                <input
                  className="form-input"
                  type="tel"
                  placeholder="e.g. 0912-345-6789"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="e.g. juan.delacruz@mdrrmo.gov.ph"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Specialization *</label>
                <select
                  className="form-select"
                  required
                  value={form.specialization}
                  onChange={e => setForm({ ...form, specialization: e.target.value })}
                >
                  {SPECIALIZATIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Rank</label>
                <input
                  className="form-input"
                  placeholder="e.g. Senior Officer, Chief, etc."
                  value={form.rank}
                  onChange={e => setForm({ ...form, rank: e.target.value })}
                />
              </div>

              <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Officer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editOfficer && (
        <div className="modal-backdrop" onClick={() => setEditOfficer(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Officer: {editOfficer.name}</h2>
              <button className="modal-close" onClick={() => setEditOfficer(null)}>✕</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleUpdate(); }}>
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input
                  className="form-input"
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Phone</label>
                <input
                  className="form-input"
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Specialization *</label>
                <select
                  className="form-select"
                  required
                  value={form.specialization}
                  onChange={e => setForm({ ...form, specialization: e.target.value })}
                >
                  {SPECIALIZATIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Rank</label>
                <input
                  className="form-input"
                  value={form.rank}
                  onChange={e => setForm({ ...form, rank: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn btn-outline" onClick={() => setEditOfficer(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}