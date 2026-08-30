import { useEffect, useState } from 'react';
import { respondUnitAPI, officerAPI } from '../lib/api';
import toast from 'react-hot-toast';

interface RespondUnit {
  id: string;
  unit_name: string;
  specialization: string;
  officer_ids: string[];
  status: string;
  created_at: string;
}

interface Officer {
  id: string;
  name: string;
  specialization: string;
  rank?: string;
  status: string;
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
  { value: 'mixed', label: 'Mixed/Multiple' },
  { value: 'other', label: 'Other' },
];

export default function RespondUnitsPage() {
  const [units, setUnits] = useState<RespondUnit[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [specializationFilter, setSpecializationFilter] = useState('');
  const [form, setForm] = useState({
    unit_name: '',
    specialization: 'Rescue Officer',
    officer_ids: [] as string[]
  });

  const [editForm, setEditForm] = useState({
    unit_name: '',
    specialization: 'Rescue Officer',
    officer_ids: [] as string[]
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [unitsRes, officersRes] = await Promise.all([
        respondUnitAPI.list(),
        officerAPI.list()
      ]);
      setUnits(unitsRes.data.units || []);
      setOfficers(officersRes.data.officers || []);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.officer_ids.length === 0) {
      toast.error('Please select at least one officer');
      return;
    }
    try {
      await respondUnitAPI.create(form);
      toast.success('Respond Unit created');
      setShowAdd(false);
      setForm({ unit_name: '', specialization: 'Rescue Officer', officer_ids: [] });
      fetchData();
    } catch {
      toast.error('Failed to create respond unit');
    }
  };

  const handleEdit = (unit: RespondUnit) => {
    setEditingId(unit.id);
    setEditForm({
      unit_name: unit.unit_name,
      specialization: unit.specialization,
      officer_ids: [...unit.officer_ids]
    });
    setShowEdit(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    if (editForm.officer_ids.length === 0) {
      toast.error('Please select at least one officer');
      return;
    }
    try {
      await respondUnitAPI.update(editingId, editForm);
      toast.success('Respond Unit updated');
      setShowEdit(false);
      setEditingId(null);
      fetchData();
    } catch {
      toast.error('Failed to update respond unit');
    }
  };

  const toggleOfficer = (officerId: string, isEdit: boolean = false) => {
    if (isEdit) {
      setEditForm(prev => ({
        ...prev,
        officer_ids: prev.officer_ids.includes(officerId)
          ? prev.officer_ids.filter(id => id !== officerId)
          : [...prev.officer_ids, officerId]
      }));
    } else {
      setForm(prev => ({
        ...prev,
        officer_ids: prev.officer_ids.includes(officerId)
          ? prev.officer_ids.filter(id => id !== officerId)
          : [...prev.officer_ids, officerId]
      }));
    }
  };

  const filteredUnits = units.filter(u => {
    if (specializationFilter === '') return true;
    return u.specialization === specializationFilter;
  });

  const filteredOfficersForSelection = officers.filter(o => {
    if (form.specialization === 'mixed') return true;
    return o.specialization === form.specialization;
  });

  const filteredOfficersForEdit = officers.filter(o => {
    if (editForm.specialization === 'mixed') return true;
    return o.specialization === editForm.specialization;
  });

  const getSpecLabel = (spec: string) => {
    return SPECIALIZATIONS.find(s => s.value === spec)?.label || spec;
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Respond Units</h1>
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
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Create Respond Unit</button>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner" /></div>
        ) : filteredUnits.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚓</div>
            <p>No respond units found</p>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: '16px' }}>Create First Unit</button>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Unit Name</th>
                  <th>Specialization</th>
                  <th>Officers</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnits.map(unit => (
                  <tr key={unit.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{unit.unit_name}</td>
                    <td>
                      <span className="badge badge-open" style={{ fontSize: '11px' }}>
                        {getSpecLabel(unit.specialization)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {unit.officer_ids && unit.officer_ids.length > 0 ? (
                          unit.officer_ids.map(id => {
                            const officer = officers.find(o => o.id === id);
                            return officer ? (
                              <span key={id} className="badge" style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)' }}>
                                {officer.name}
                              </span>
                            ) : null;
                          })
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>No officers</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${unit.status === 'available' ? 'badge-open' : 'badge-pending'}`}>
                        {unit.status || 'available'}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px' }}>{new Date(unit.created_at).toLocaleDateString()}</td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => handleEdit(unit)}>Edit</button>
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
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Create Respond Unit</h2>
              <button className="modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <form onSubmit={handleAdd}>
              <div className="form-group">
                <label className="form-label">Unit Name *</label>
                <input
                  className="form-input"
                  required
                  placeholder="e.g. Alpha Rescue Team"
                  value={form.unit_name}
                  onChange={e => setForm({ ...form, unit_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Unit Specialization *</label>
                <select
                  className="form-select"
                  required
                  value={form.specialization}
                  onChange={e => setForm({ ...form, specialization: e.target.value, officer_ids: [] })}
                >
                  {SPECIALIZATIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {form.specialization !== 'mixed'
                    ? 'Only officers with matching specialization will be shown for selection'
                    : 'Select officers from any specialization'}
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Select Officers ({form.officer_ids.length} selected)
                </label>
                <div style={{
                  maxHeight: '220px',
                  overflowY: 'auto',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.2)'
                }}>
                  {filteredOfficersForSelection.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px' }}>
                      No officers found with "{getSpecLabel(form.specialization)}" specialization.
                      {!officers.some(o => o.specialization === form.specialization) && ' Add officers with this specialization first.'}
                    </p>
                  ) : (
                    filteredOfficersForSelection.map(officer => (
                      <div
                        key={officer.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '6px',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer'
                        }}
                        onClick={() => toggleOfficer(officer.id)}
                      >
                        <input
                          type="checkbox"
                          checked={form.officer_ids.includes(officer.id)}
                          onChange={() => {}}
                          style={{ cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: 500 }}>{officer.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {getSpecLabel(officer.specialization)}
                            {officer.rank && ` • ${officer.rank}`}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Only active officers are shown
                </p>
              </div>

              <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={form.officer_ids.length === 0}>
                  Create Respond Unit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEdit && (
        <div className="modal-backdrop" onClick={() => { setShowEdit(false); setEditingId(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Respond Unit</h2>
              <button className="modal-close" onClick={() => { setShowEdit(false); setEditingId(null); }}>✕</button>
            </div>
            <form onSubmit={handleUpdate}>
              <div className="form-group">
                <label className="form-label">Unit Name *</label>
                <input
                  className="form-input"
                  required
                  placeholder="e.g. Alpha Rescue Team"
                  value={editForm.unit_name}
                  onChange={e => setEditForm({ ...editForm, unit_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Unit Specialization *</label>
                <select
                  className="form-select"
                  required
                  value={editForm.specialization}
                  onChange={e => setEditForm({ ...editForm, specialization: e.target.value, officer_ids: [] })}
                >
                  {SPECIALIZATIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Changing specialization will reset officer selection.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Manage Officers ({editForm.officer_ids.length} selected)
                </label>
                <div style={{
                  maxHeight: '220px',
                  overflowY: 'auto',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.2)'
                }}>
                  {filteredOfficersForEdit.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px' }}>
                      No officers found with "{getSpecLabel(editForm.specialization)}" specialization.
                    </p>
                  ) : (
                    filteredOfficersForEdit.map(officer => (
                      <div
                        key={officer.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '6px',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer'
                        }}
                        onClick={() => toggleOfficer(officer.id, true)}
                      >
                        <input
                          type="checkbox"
                          checked={editForm.officer_ids.includes(officer.id)}
                          onChange={() => {}}
                          style={{ cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: 500 }}>{officer.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {getSpecLabel(officer.specialization)}
                            {officer.rank && ` • ${officer.rank}`}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn btn-outline" onClick={() => { setShowEdit(false); setEditingId(null); }}>Drop Changes</button>
                <button type="submit" className="btn btn-primary" disabled={editForm.officer_ids.length === 0}>
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}