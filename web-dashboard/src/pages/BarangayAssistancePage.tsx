import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ClipboardList, Check, HandHelping, RefreshCw, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { barangayAPI, reportAPI, socket } from '../lib/api';

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

export default function BarangayAssistancePage() {
  const { user } = useAuth();
  const isResponder = user?.role === 'responder';
  const [requests, setRequests] = useState<Assistance[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [form, setForm] = useState<RequestForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const reset = () => { setForm(emptyForm); setEditingId(null); };
  const startEdit = (request: Assistance) => {
    setEditingId(request.id);
    setForm({ incident_report_id: request.incident_report_id || '', needs_more_manpower: Boolean(request.needs_more_manpower), needs_resources: Boolean(request.needs_resources), needs_equipment: Boolean(request.needs_equipment), beyond_barangay_capability: Boolean(request.beyond_barangay_capability), explanation: request.explanation || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      <header className="barangay-console-header"><div><span className="workspace-eyebrow">BARANGAY OPERATIONS · {user?.barangay_name || 'YOUR BARANGAY'}</span><h1>{isResponder ? 'My assistance requests' : 'Assistance requests'}</h1><p>{isResponder ? 'Request support for assigned incidents and follow each decision.' : 'Review barangay requests and coordinate local or MDRRMO support.'}</p></div><button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button></header>

      {isResponder && <section className="barangay-console-panel"><header><div><h2>{editingId ? 'Update request' : 'Request assistance'}</h2><p>Only incidents assigned to your responder account are available to link.</p></div>{editingId && <button className="workspace-secondary-action" type="button" onClick={reset}><X size={15} /> Cancel edit</button>}</header><form className="barangay-console-form-grid" onSubmit={(event) => void submit(event)}><RequestFields form={form} setForm={setForm} incidents={incidents} /><div className="barangay-console-form-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'Submitting…' : editingId ? <><Check size={16} /> Save changes</> : <><Send size={16} /> Submit request</>}</button></div></form></section>}

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
