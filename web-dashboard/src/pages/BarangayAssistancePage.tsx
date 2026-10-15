import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ClipboardList, Check, HandHelping, RefreshCw, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { barangayAPI, reportAPI, requestAPI, socket } from '../lib/api';

type Incident = { id: string; title?: string; incident_type?: string; description?: string; response_status?: string; barangay_response_status?: string; created_at?: string };
type Assistance = {
  id: string; requested_by?: string; requested_by_user?: { full_name?: string; role?: string };
  incident_report_id?: string | null; incident_title?: string | null; explanation?: string;
  needs_more_manpower?: boolean; needs_resources?: boolean; needs_equipment?: boolean;
  beyond_barangay_capability?: boolean; status?: string; decision?: string | null;
  dispatcher_notes?: string | null; team_acknowledged?: boolean; created_at?: string;
  decided_at?: string | null; decided_by_user?: { full_name?: string };
};
type RequestForm = { incident_report_id: string; needs_more_manpower: boolean; needs_resources: boolean; needs_equipment: boolean; beyond_barangay_capability: boolean; explanation: string };
const emptyForm: RequestForm = { incident_report_id: '', needs_more_manpower: false, needs_resources: false, needs_equipment: false, beyond_barangay_capability: false, explanation: '' };
const statusLabel = (value?: string) => String(value || 'pending').replaceAll('_', ' ');
const errorText = (error: any) => error?.response?.data?.error || 'The assistance request could not be updated.';

function RequestFields({ form, setForm, incidents }: { form: RequestForm; setForm: (update: (value: RequestForm) => RequestForm) => void; incidents: Incident[] }) {
  return <>
    <label>Linked incident<select value={form.incident_report_id} onChange={(event) => setForm((value) => ({ ...value, incident_report_id: event.target.value }))}><option value="">General assistance request</option>{incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.incident_type?.replaceAll('_', ' ') || incident.title || 'Incident'} · {statusLabel(incident.barangay_response_status || incident.response_status)}</option>)}</select></label>
    <div className="barangay-assistance-needs"><span>Assistance needed</span><label><input type="checkbox" checked={form.needs_more_manpower} onChange={(event) => setForm((value) => ({ ...value, needs_more_manpower: event.target.checked }))} /> Additional responders</label><label><input type="checkbox" checked={form.needs_resources} onChange={(event) => setForm((value) => ({ ...value, needs_resources: event.target.checked }))} /> Supplies or resources</label><label><input type="checkbox" checked={form.needs_equipment} onChange={(event) => setForm((value) => ({ ...value, needs_equipment: event.target.checked }))} /> Equipment</label><label className="urgent"><input type="checkbox" checked={form.beyond_barangay_capability} onChange={(event) => setForm((value) => ({ ...value, beyond_barangay_capability: event.target.checked }))} /> Beyond barangay capability · request MDRRMO coordination</label></div>
    {form.beyond_barangay_capability && !form.incident_report_id && <p className="barangay-assistance-inline-error">Link an active incident before requesting MDRRMO coordination.</p>}
    <label>Explain what is needed<textarea required minLength={10} rows={3} value={form.explanation} onChange={(event) => setForm((value) => ({ ...value, explanation: event.target.value }))} placeholder="Describe the support needed and why…" /></label>
  </>;
}

function BarangayAssistanceWorkspace() {
  const { user } = useAuth();
  const isResponder = user?.role === 'responder';
  const [requests, setRequests] = useState<Assistance[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [form, setForm] = useState<RequestForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, { decision: 'provide_barangay_assistance' | 'coordinate_mdrrmo' | 'dismissed'; notes: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [requestResponse, incidentResponse] = await Promise.all([
        isResponder ? barangayAPI.myAssistanceRequests() : barangayAPI.assistanceRequests(),
        reportAPI.barangayReports(),
      ]);
      const rows = Array.isArray(requestResponse.data?.requests) ? requestResponse.data.requests : [];
      setRequests(rows);
      setIncidents(Array.isArray(incidentResponse.data) ? incidentResponse.data.filter((item: Incident) => !['resolved', 'closed', 'rejected'].includes(String(item.barangay_response_status || item.response_status || '').toLowerCase())) : []);
      setDecisions((current) => Object.fromEntries(rows.map((request: Assistance) => [request.id, current[request.id] || { decision: request.decision === 'coordinate_mdrrmo' ? 'coordinate_mdrrmo' : 'provide_barangay_assistance', notes: request.dispatcher_notes || '' }])));
    } catch (loadError: any) { setError(loadError?.response?.data?.error || 'Assistance requests could not be loaded.'); }
    finally { setLoading(false); }
  }, [isResponder]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    socket.on('assistance:new_request', load);
    socket.on('assistance:decision', load);
    socket.on('assistance:team_action', load);
    return () => {
      socket.off('assistance:new_request', load);
      socket.off('assistance:decision', load);
      socket.off('assistance:team_action', load);
    };
  }, [load]);

  const reset = () => { setForm(emptyForm); setEditingId(null); setIsRequestModalOpen(false); };
  const startNewRequest = () => { setForm(emptyForm); setEditingId(null); setIsRequestModalOpen(true); };
  const startEdit = (request: Assistance) => {
    setEditingId(request.id);
    setForm({ incident_report_id: request.incident_report_id || '', needs_more_manpower: Boolean(request.needs_more_manpower), needs_resources: Boolean(request.needs_resources), needs_equipment: Boolean(request.needs_equipment), beyond_barangay_capability: Boolean(request.beyond_barangay_capability), explanation: request.explanation || '' });
    setIsRequestModalOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.beyond_barangay_capability && !form.incident_report_id) { toast.error('Link an incident before requesting MDRRMO coordination.'); return; }
    const linked = incidents.find((incident) => incident.id === form.incident_report_id);
    const payload = { ...form, incident_report_id: form.incident_report_id || null, incident_title: linked?.title || linked?.incident_type || null };
    setSaving(true);
    try {
      if (editingId) await barangayAPI.editAssistanceRequest(editingId, payload);
      else await barangayAPI.createAssistanceRequest(payload);
      toast.success(editingId ? 'Assistance request updated.' : 'Assistance request submitted.'); reset(); await load();
    } catch (saveError: any) { toast.error(errorText(saveError)); }
    finally { setSaving(false); }
  };

  const decide = async (request: Assistance) => {
    const value = decisions[request.id] || { decision: 'provide_barangay_assistance' as const, notes: '' };
    if (!window.confirm(`Confirm decision: ${statusLabel(value.decision)}?`)) return;
    setSaving(true);
    try { await barangayAPI.decideAssistanceRequest(request.id, value.decision, value.notes.trim()); toast.success('Assistance decision saved.'); await load(); }
    catch (actionError: any) { toast.error(errorText(actionError)); }
    finally { setSaving(false); }
  };

  const responderAction = async (request: Assistance, action: 'acknowledge' | 'cancel') => {
    if (action === 'cancel' && !window.confirm('Cancel this assistance request?')) return;
    setSaving(true);
    try { await barangayAPI.assistanceTeamAction(request.id, action); toast.success(action === 'cancel' ? 'Request cancelled.' : 'Assistance acknowledged.'); await load(); }
    catch (actionError: any) { toast.error(errorText(actionError)); }
    finally { setSaving(false); }
  };

  const editRequest = (request: Assistance) => request.requested_by === user?.id && ['pending', 'rejected'].includes(String(request.status || '').toLowerCase());

  return (
    <div className="barangay-console-page">
      <header className="barangay-console-header"><div><span className="workspace-eyebrow">BARANGAY OPERATIONS · {user?.barangay_name || 'YOUR BARANGAY'}</span><h1>{isResponder ? 'My assistance requests' : 'Assistance requests'}</h1><p>{isResponder ? 'Request support for assigned incidents and follow each decision.' : 'Review barangay requests and coordinate local or MDRRMO support.'}</p></div><div className="barangay-console-header-actions">{isResponder && <button className="workspace-primary-action" type="button" onClick={startNewRequest} aria-haspopup="dialog" aria-expanded={isRequestModalOpen}><HandHelping size={16} /> Request assistance</button>}<button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button></div></header>

      {isResponder && isRequestModalOpen && <div className="barangay-console-modal-backdrop" role="presentation" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!saving) reset(); }
        if (event.key === 'Tab') {
          const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) reset(); }}>
        <section className="barangay-console-panel barangay-console-form-modal barangay-assistance-request-modal" role="dialog" aria-modal="true" aria-labelledby="barangay-assistance-request-title">
          <header><div><h2 id="barangay-assistance-request-title">{editingId ? 'Update request' : 'Request assistance'}</h2><p>Only incidents assigned to your responder account are available to link.</p></div><button autoFocus className="workspace-secondary-action" type="button" onClick={reset} disabled={saving}><X size={15} /> Cancel</button></header>
          <form className="barangay-console-form-grid" onSubmit={(event) => void submit(event)}><RequestFields form={form} setForm={setForm} incidents={incidents} /><div className="barangay-console-form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Submitting…' : editingId ? <><Check size={16} /> Save changes</> : <><Send size={16} /> Submit request</>}</button></div></form>
        </section>
      </div>}

      {error && <div className="workspace-message workspace-message-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
      <section className="barangay-console-panel"><header><div><h2><ClipboardList size={19} /> {isResponder ? 'Request history' : 'Barangay request inbox'}</h2><p>{isResponder ? 'Your requests and the coordination decision.' : 'Requests submitted by responders in your barangay.'}</p></div><span className="barangay-console-status pending">{requests.filter((request) => String(request.status || '').toLowerCase() === 'pending').length} pending</span></header>
        {loading ? <p className="barangay-console-muted">Loading assistance requests…</p> : requests.length === 0 ? <div className="barangay-console-empty"><HandHelping size={25} /><strong>No assistance requests</strong><span>{isResponder ? 'Submitted requests will appear here.' : 'Responder requests from your barangay will appear here.'}</span></div> : <div className="barangay-assistance-list">{requests.map((request) => {
          const decision = decisions[request.id] || { decision: 'provide_barangay_assistance' as const, notes: '' };
          const isPending = String(request.status || '').toLowerCase() === 'pending';
          const label = [request.needs_more_manpower && 'Additional responders', request.needs_resources && 'Supplies', request.needs_equipment && 'Equipment', request.beyond_barangay_capability && 'MDRRMO coordination'].filter(Boolean).join(' · ') || 'General assistance';
          return <article className="barangay-assistance-card" key={request.id}>
            <div className="barangay-assistance-card-heading"><div><span className={`barangay-console-status ${String(request.status || 'pending').toLowerCase()}`}>{statusLabel(request.status)}</span><strong>{request.incident_title || 'General barangay assistance'}</strong></div><time>{request.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.created_at)) : 'Time unavailable'}</time></div>
            <div className="barangay-assistance-meta"><span>{label}</span>{request.requested_by_user?.full_name && <span>Requested by {request.requested_by_user.full_name}</span>}{request.team_acknowledged && <span className="acknowledged"><Check size={14} /> Team acknowledged</span>}</div>
            <p className="barangay-assistance-explanation">{request.explanation}</p>
            {request.decision && <div className="barangay-assistance-decision"><strong>Decision: {statusLabel(request.decision)}</strong>{request.dispatcher_notes && <p>{request.dispatcher_notes}</p>}{request.decided_by_user?.full_name && <small>Recorded by {request.decided_by_user.full_name}</small>}</div>}
            {isResponder && <footer>{editRequest(request) && <button type="button" onClick={() => startEdit(request)}><Edit3Icon /> Edit request</button>}{request.decision === 'provide_barangay_assistance' && !request.team_acknowledged && <button type="button" onClick={() => void responderAction(request, 'acknowledge')} disabled={saving}><Check size={15} /> Acknowledge support</button>}{isPending && request.requested_by === user?.id && <button className="danger" type="button" onClick={() => void responderAction(request, 'cancel')} disabled={saving}><X size={15} /> Cancel request</button>}</footer>}
            {!isResponder && isPending && <div className="barangay-assistance-review"><label>Decision<select value={decision.decision} onChange={(event) => setDecisions((current) => ({ ...current, [request.id]: { ...decision, decision: event.target.value as typeof decision.decision } }))}><option value="provide_barangay_assistance">Provide barangay assistance</option><option value="coordinate_mdrrmo">Coordinate with MDRRMO</option><option value="dismissed">Dismiss request</option></select></label><label>Dispatcher note<textarea rows={2} value={decision.notes} onChange={(event) => setDecisions((current) => ({ ...current, [request.id]: { ...decision, notes: event.target.value } }))} placeholder="Add context for the response team…" /></label><button className="btn btn-primary" type="button" onClick={() => void decide(request)} disabled={saving}><Check size={15} /> Save decision</button></div>}
          </article>;
        })}</div>}
      </section>
    </div>
  );
}

function Edit3Icon() { return <ClipboardList size={15} />; }

type MdrrmoIncident = { id: string; title?: string; incident_type?: string; response_status?: string; created_at?: string };
type MdrrmoAssistance = {
  id: string;
  incident_id: string;
  request_type: 'responders' | 'goods';
  sub_type?: string | null;
  details?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  dispatcher_notes?: string | null;
  created_at?: string;
};
type MdrrmoRequestForm = { incident_id: string; category: string; details: string };
const initialMdrrmoRequest: MdrrmoRequestForm = { incident_id: '', category: 'manpower', details: '' };

function MdrrmoResponderAssistanceWorkspace() {
  const [requests, setRequests] = useState<MdrrmoAssistance[]>([]);
  const [incidents, setIncidents] = useState<MdrrmoIncident[]>([]);
  const [form, setForm] = useState<MdrrmoRequestForm>(initialMdrrmoRequest);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [requestResponse, incidentResponse] = await Promise.all([requestAPI.mine(), reportAPI.mdrrmoQueue()]);
      setRequests(Array.isArray(requestResponse.data) ? requestResponse.data : []);
      const reports = Array.isArray(incidentResponse.data) ? incidentResponse.data : [];
      setIncidents(reports);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || 'Your MDRRMO assistance requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    socket.on('resource:request', load);
    socket.on('incident_report:updated', load);
    return () => {
      socket.off('resource:request', load);
      socket.off('incident_report:updated', load);
    };
  }, [load]);

  const reset = () => { setForm(initialMdrrmoRequest); setIsRequestModalOpen(false); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.incident_id) { toast.error('Choose an active incident for this request.'); return; }
    setSaving(true);
    try {
      await requestAPI.create({
        request_type: form.category === 'manpower' ? 'responders' : 'goods',
        sub_type: form.category,
        details: form.details.trim(),
        incident_id: form.incident_id,
      });
      toast.success('Assistance request submitted to MDRRMO dispatch.');
      reset();
      await load();
    } catch (saveError: any) {
      toast.error(saveError?.response?.data?.error || 'The assistance request could not be submitted.');
    } finally {
      setSaving(false);
    }
  };

  const confirmReceived = async (request: MdrrmoAssistance) => {
    setSaving(true);
    try {
      await requestAPI.updateStatus(request.id, 'fulfilled');
      toast.success('Assistance receipt confirmed.');
      await load();
    } catch (actionError: any) {
      toast.error(actionError?.response?.data?.error || 'Assistance receipt could not be confirmed.');
    } finally {
      setSaving(false);
    }
  };

  const incidentName = (id: string) => {
    const incident = incidents.find((item) => item.id === id);
    return incident?.title || incident?.incident_type?.replaceAll('_', ' ') || 'Assigned incident';
  };
  const activeIncidents = incidents.filter((incident) => !['resolved', 'closed', 'rejected'].includes(String(incident.response_status || '').toLowerCase()));

  return (
    <div className="barangay-console-page">
      <header className="barangay-console-header"><div><span className="workspace-eyebrow">MDRRMO FIELD RESPONSE</span><h1>My assistance requests</h1><p>Request additional resources or responders for an incident assigned to your unit.</p></div><div className="barangay-console-header-actions"><button className="workspace-primary-action" type="button" onClick={() => { setForm(initialMdrrmoRequest); setIsRequestModalOpen(true); }} aria-haspopup="dialog"><HandHelping size={16} /> Request assistance</button><button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button></div></header>

      {isRequestModalOpen && <div className="barangay-console-modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape' && !saving) reset(); }} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) reset(); }}>
        <section className="barangay-console-panel barangay-console-form-modal barangay-assistance-request-modal" role="dialog" aria-modal="true" aria-labelledby="mdrrmo-assistance-request-title">
          <header><div><h2 id="mdrrmo-assistance-request-title">Request MDRRMO assistance</h2><p>Link the request to an active incident assigned to your responder account.</p></div><button autoFocus className="workspace-secondary-action" type="button" onClick={reset} disabled={saving}><X size={15} /> Cancel</button></header>
          <form className="barangay-console-form-grid" onSubmit={(event) => void submit(event)}>
            <label className="barangay-console-form-wide">Linked incident<select required value={form.incident_id} onChange={(event) => setForm((current) => ({ ...current, incident_id: event.target.value }))}><option value="">Choose an assigned incident</option>{activeIncidents.map((incident) => <option value={incident.id} key={incident.id}>{incident.title || incident.incident_type?.replaceAll('_', ' ') || 'Incident'}</option>)}</select></label>
            <label className="barangay-console-form-wide">Assistance type<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}><option value="manpower">Additional responders</option><option value="supplies">Supplies or resources</option><option value="equipment">Equipment</option><option value="other">Other support</option></select></label>
            <label className="barangay-console-form-wide">Explain what is needed<textarea required minLength={10} rows={3} value={form.details} onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))} placeholder="Describe the support needed and why…" /></label>
            <div className="barangay-console-form-actions"><button className="btn btn-primary" type="submit" disabled={saving || activeIncidents.length === 0}>{saving ? 'Submitting…' : <><Send size={16} /> Submit request</>}</button>{activeIncidents.length === 0 && <span className="barangay-console-muted">There are no active assigned incidents to link.</span>}</div>
          </form>
        </section>
      </div>}

      {error && <div className="workspace-message workspace-message-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
      <section className="barangay-console-panel"><header><div><h2><ClipboardList size={19} /> Request history</h2><p>Your requests and the dispatcher’s response.</p></div><span className="barangay-console-status pending">{requests.filter((request) => request.status === 'pending').length} pending</span></header>
        {loading ? <p className="barangay-console-muted">Loading assistance requests…</p> : requests.length === 0 ? <div className="barangay-console-empty"><HandHelping size={25} /><strong>No assistance requests</strong><span>Requests submitted for your assigned incidents will appear here.</span></div> : <div className="barangay-assistance-list">{requests.map((request) => <article className="barangay-assistance-card" key={request.id}>
          <div className="barangay-assistance-card-heading"><div><span className={`barangay-console-status ${request.status || 'pending'}`}>{statusLabel(request.status)}</span><strong>{incidentName(request.incident_id)}</strong></div><time>{request.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.created_at)) : 'Time unavailable'}</time></div>
          <div className="barangay-assistance-meta"><span>{request.sub_type?.replaceAll('_', ' ') || (request.request_type === 'responders' ? 'Additional responders' : 'Resources')}</span><span>Incident {incidentName(request.incident_id)}</span></div>
          <p className="barangay-assistance-explanation">{request.details || 'No request details provided.'}</p>
          {request.dispatcher_notes && <div className="barangay-assistance-decision"><strong>Dispatcher response</strong><p>{request.dispatcher_notes}</p></div>}
          {request.status === 'approved' && <footer><button type="button" onClick={() => void confirmReceived(request)} disabled={saving}><Check size={15} /> Confirm received</button></footer>}
        </article>)}</div>}
      </section>
    </div>
  );
}

export default function BarangayAssistancePage() {
  const { user } = useAuth();
  if (user?.account_kind !== 'barangay' && user?.role === 'responder') return <MdrrmoResponderAssistanceWorkspace />;
  return <BarangayAssistanceWorkspace />;
}
