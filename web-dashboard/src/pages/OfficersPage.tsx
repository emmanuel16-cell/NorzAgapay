import { useEffect, useMemo, useState } from 'react';
import { Award, Edit3, Plus, RefreshCw, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import { officerAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import MobileNumberInput from '../components/MobileNumberInput';
import { formatMobileNumber, isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

interface Officer {
  id: string;
  name: string;
  phone: string | null;
  specialization: string;
  rank?: string | null;
  status: string;
  created_at: string;
}

const SPECIALIZATIONS = [
  { value: 'mixed', label: 'Mixed' },
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

const emptyForm = () => ({
  name: '', phone: '', specialization: 'Rescue Officer', rank: '', status: 'active',
});

const getErrorMessage = (error: any, fallback: string) =>
  error?.response?.data?.error || fallback;

export default function OfficersPage() {
  const { user, isMasterAdmin } = useAuth();
  const canManageOfficers = isMasterAdmin || user?.role === 'admin' || user?.role === 'logistics';
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editOfficer, setEditOfficer] = useState<Officer | null>(null);
  const [specializationFilter, setSpecializationFilter] = useState('');
  const [form, setForm] = useState(emptyForm);

  const fetchOfficers = async () => {
    setLoading(true);
    try {
      const response = await officerAPI.list();
      setOfficers(response.data.officers || []);
    } catch {
      toast.error('Failed to load officers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchOfficers(); }, []);
  useRealtimeRefresh(fetchOfficers);

  const filteredOfficers = useMemo(() => officers.filter((officer) =>
    !specializationFilter || officer.specialization === specializationFilter,
  ), [officers, specializationFilter]);

  const closeAdd = () => { setShowAdd(false); setForm(emptyForm()); };
  const closeEdit = () => { setEditOfficer(null); setForm(emptyForm()); };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.phone && !isValidMobileNumber(form.phone)) { toast.error('Enter exactly 11 digits starting with 09.'); return; }
    setSaving(true);
    try {
      await officerAPI.create({
        ...form,
        phone: form.phone.trim() ? normalizeMobileNumberInput(form.phone) : null,
        rank: form.rank.trim() || null,
      });
      toast.success('Officer added successfully');
      closeAdd();
      await fetchOfficers();
    } catch (error: any) {
      toast.error(getErrorMessage(error, 'Failed to add officer'));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (officer: Officer) => {
    setEditOfficer(officer);
    setForm({
      name: officer.name || '',
      phone: officer.phone || '',
      specialization: officer.specialization || 'Rescue Officer',
      rank: officer.rank || '',
      status: officer.status || 'active',
    });
  };

  const handleUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editOfficer) return;
    if (form.phone && !isValidMobileNumber(form.phone)) { toast.error('Enter exactly 11 digits starting with 09.'); return; }
    setSaving(true);
    try {
      await officerAPI.update(editOfficer.id, {
        ...form,
        phone: form.phone.trim() ? normalizeMobileNumberInput(form.phone) : null,
        rank: form.rank.trim() || null,
      });
      toast.success('Officer updated successfully');
      closeEdit();
      await fetchOfficers();
    } catch (error: any) {
      toast.error(getErrorMessage(error, 'Failed to update officer'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editOfficer || !window.confirm(`Delete ${editOfficer.name}? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await officerAPI.delete(editOfficer.id);
      toast.success('Officer deleted');
      closeEdit();
      await fetchOfficers();
    } catch (error: any) {
      toast.error(getErrorMessage(error, 'Could not delete officer. Remove them from any response units first.'));
    } finally {
      setSaving(false);
    }
  };

  const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'O';
  const specialtyLabel = (value: string) => SPECIALIZATIONS.find((entry) => entry.value === value)?.label || value || 'Not set';
  const displayDate = (value?: string) => value ? new Date(value).toLocaleString() : 'Not available';

  const renderFields = (isEdit = false) => <>
    <div className="form-group">
      <label className="form-label" htmlFor={isEdit ? 'edit-officer-name' : 'new-officer-name'}>Name *</label>
      <input id={isEdit ? 'edit-officer-name' : 'new-officer-name'} className="form-input" required maxLength={120} placeholder="e.g. Juan dela Cruz" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
    </div>
      <div className="officers-form-grid">
      <div className="form-group">
        <label className="form-label" htmlFor={isEdit ? 'edit-officer-phone' : 'new-officer-phone'}>Mobile number</label>
        <MobileNumberInput id={isEdit ? 'edit-officer-phone' : 'new-officer-phone'} className="form-input" placeholder="09XXXXXXXXX" value={form.phone} onValueChange={(phone) => setForm({ ...form, phone })} />
      </div>
    </div>
    <div className="form-group">
      <label className="form-label" htmlFor={isEdit ? 'edit-officer-specialization' : 'new-officer-specialization'}>Specialization *</label>
      <select id={isEdit ? 'edit-officer-specialization' : 'new-officer-specialization'} className="form-select" required value={form.specialization} onChange={(event) => setForm({ ...form, specialization: event.target.value })}>
        {SPECIALIZATIONS.map((specialization) => <option key={specialization.value} value={specialization.value}>{specialization.label}</option>)}
      </select>
    </div>
    <div className="officers-form-grid">
      <div className="form-group">
        <label className="form-label" htmlFor={isEdit ? 'edit-officer-rank' : 'new-officer-rank'}>Rank</label>
        <input id={isEdit ? 'edit-officer-rank' : 'new-officer-rank'} className="form-input" maxLength={80} placeholder="e.g. Senior Officer" value={form.rank} onChange={(event) => setForm({ ...form, rank: event.target.value })} />
      </div>
      {isEdit && <div className="form-group">
        <label className="form-label" htmlFor="edit-officer-status">Status</label>
        <select id="edit-officer-status" className="form-select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
          <option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
      </div>}
    </div>
  </>;

  return (
    <>
      <div className="barangay-console-page officers-management-page">
        <header className="barangay-console-header">
          <div>
            <span className="workspace-eyebrow">MDRRMO OPERATIONS</span>
            <h1>MDRRMO Officers</h1>
            <p>View responder contacts, specializations, and availability.</p>
          </div>
          <div className="barangay-console-header-actions officers-page-actions">
            <select aria-label="Filter officers by specialization" className="form-select officers-specialization-filter" value={specializationFilter} onChange={(event) => setSpecializationFilter(event.target.value)}>
              <option value="">All specializations</option>
              {SPECIALIZATIONS.map((specialization) => <option key={specialization.value} value={specialization.value}>{specialization.label}</option>)}
            </select>
            <button className="workspace-secondary-action" type="button" onClick={() => void fetchOfficers()} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh
            </button>
            {canManageOfficers && <button className="workspace-primary-action" type="button" onClick={() => setShowAdd(true)}><Plus size={16} /> Add officer</button>}
          </div>
        </header>

        <section className="barangay-console-stat-grid barangay-console-stat-grid-compact" aria-label="Officer summary">
          <article><span>Active officers</span><strong>{officers.filter((officer) => officer.status === 'active').length}</strong><ShieldCheck size={20} /></article>
          <article><span>Other statuses</span><strong>{officers.filter((officer) => officer.status !== 'active').length}</strong><UsersRound size={20} /></article>
          <article><span>Officers shown</span><strong>{filteredOfficers.length}</strong><Award size={20} /></article>
        </section>

        {loading ? <p className="barangay-console-muted">Loading MDRRMO officers…</p> : filteredOfficers.length === 0 ? (
          <section className="barangay-console-panel officers-empty-state">
            <Award size={28} />
            <h2>{officers.length ? 'No officers match this specialization' : 'No officers have been added'}</h2>
            <p>{officers.length ? 'Choose another specialization filter to see more officers.' : 'MDRRMO officer records will appear here.'}</p>
            {canManageOfficers && !officers.length && <button className="workspace-primary-action" type="button" onClick={() => setShowAdd(true)}><Plus size={16} /> Add first officer</button>}
          </section>
        ) : (
          <section className="barangay-console-panel officers-directory-panel">
            <header><div><h2>Officer directory</h2><p>{filteredOfficers.length} {filteredOfficers.length === 1 ? 'officer' : 'officers'}{specializationFilter ? ` · ${specialtyLabel(specializationFilter)}` : ''}</p></div></header>
            <div className="officers-card-grid">
              {filteredOfficers.map((officer) => (
                <article className={`barangay-team-card officer-team-card${officer.status === 'active' ? '' : ' is-inactive'}`} key={officer.id}>
                  <div className="barangay-team-card-avatar">{initials(officer.name)}</div>
                  <div className="barangay-team-card-info">
                    <strong>{officer.name}</strong>
                    <span className="barangay-console-status">{specialtyLabel(officer.specialization)}</span>
                    <span className={`barangay-console-status ${officer.status === 'active' ? 'active' : 'inactive'}`}>{officer.status || 'unknown'}</span>
                    <small>{officer.rank || 'Rank not set'}{officer.phone ? ` · ${formatMobileNumber(officer.phone)}` : ''}</small>
                  </div>
                  {canManageOfficers && <div className="barangay-team-card-actions"><button type="button" title="Edit officer details" aria-label={`Edit ${officer.name}`} onClick={() => openEdit(officer)}><Edit3 size={16} /></button></div>}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      {canManageOfficers && showAdd && <div className="barangay-console-modal-backdrop officers-modal-backdrop" onClick={() => !saving && closeAdd()}>
        <form className="modal officers-modal" onSubmit={handleAdd} onClick={(event) => event.stopPropagation()}>
          <header><div><span className="workspace-eyebrow">MDRRMO OPERATIONS</span><h2>Add officer</h2><p>Enter the responder’s contact and assignment details.</p></div><button type="button" className="modal-close" aria-label="Close" onClick={closeAdd} disabled={saving}>✕</button></header>
          <div className="officers-modal-body">{renderFields()}</div>
          <footer><button type="button" className="btn btn-outline" onClick={closeAdd} disabled={saving}>Cancel</button><button type="submit" className="workspace-primary-action" disabled={saving}>{saving ? 'Adding…' : 'Add officer'}</button></footer>
        </form>
      </div>}

      {canManageOfficers && editOfficer && <div className="barangay-console-modal-backdrop officers-modal-backdrop" onClick={() => !saving && closeEdit()}>
        <form className="modal officers-modal" onSubmit={handleUpdate} onClick={(event) => event.stopPropagation()}>
          <header><div><span className="workspace-eyebrow">OFFICER RECORD</span><h2>Edit officer</h2><p>Review and update the officer’s complete directory information.</p></div><button type="button" className="modal-close" aria-label="Close" onClick={closeEdit} disabled={saving}>✕</button></header>
          <div className="officers-modal-body">
            <div className="officer-edit-summary"><div className="barangay-team-card-avatar">{initials(editOfficer.name)}</div><div><strong>{editOfficer.name}</strong><span>Created {displayDate(editOfficer.created_at)}</span></div></div>
            {renderFields(true)}
          </div>
          <footer className="officers-edit-footer">
            <button type="button" className="officer-delete-action" onClick={() => void handleDelete()} disabled={saving}><Trash2 size={16} /> Delete officer</button>
            <div><button type="button" className="btn btn-outline" onClick={closeEdit} disabled={saving}>Cancel</button><button type="submit" className="workspace-primary-action" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
          </footer>
        </form>
      </div>}
    </>
  );
}
