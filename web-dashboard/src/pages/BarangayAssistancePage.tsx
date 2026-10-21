import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, ChevronDown, ClipboardList, HandHelping, MapPin, RefreshCw, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { barangayAPI, reportAPI, requestAPI, socket } from '../lib/api';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import IncidentLocationCard from '../components/IncidentLocationCard';
import { formatIncidentLocation, hasIncidentPin, type IncidentLocationPreview } from '../lib/incidentLocation';

type Incident = {
  id: string; title?: string; incident_type?: string; description?: string;
  response_status?: string; barangay_response_status?: string; created_at?: string;
  address?: string | null; barangay_name?: string | null;
  latitude?: number | string | null; longitude?: number | string | null; location_name?: string | null;
};
type Assistance = {
  id: string; requested_by?: string; requested_by_user?: { full_name?: string; role?: string };
  incident_report_id?: string | null; incident_title?: string | null; explanation?: string;
  needs_more_manpower?: boolean; needs_resources?: boolean; needs_equipment?: boolean;
  beyond_barangay_capability?: boolean; status?: string; decision?: string | null;
  dispatcher_notes?: string | null; team_acknowledged?: boolean; created_at?: string;
  decided_at?: string | null; decided_by_user?: { full_name?: string };
};
type DispatcherAssistanceGroup = { key: string; incidentId: string | null; incident: Incident | null; requests: Assistance[] };
type RequestForm = { incident_report_id: string; needs_more_manpower: boolean; needs_resources: boolean; needs_equipment: boolean; beyond_barangay_capability: boolean; explanation: string };
type DecisionForm = { decision: 'provide_barangay_assistance' | 'coordinate_mdrrmo' | 'dismissed'; notes: string };
const emptyForm: RequestForm = { incident_report_id: '', needs_more_manpower: false, needs_resources: false, needs_equipment: false, beyond_barangay_capability: false, explanation: '' };
const statusLabel = (value?: string) => String(value || 'pending').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusClass = (value?: string) => String(value || 'pending').toLowerCase().replaceAll(' ', '_');
const errorText = (error: any) => error?.response?.data?.error || 'The assistance request could not be updated.';
const incidentTitle = (incident?: Incident | null) => incident?.title || incident?.incident_type?.replaceAll('_', ' ') || 'Incident report';
const incidentStatus = (incident: Incident) => incident.barangay_response_status || incident.response_status || 'assigned';
const incidentStatusClass = (incident: Incident) => {
  const value = String(incidentStatus(incident)).toLowerCase();
  if (['resolved', 'closed', 'rejected', 'completed'].includes(value)) return 'resolved';
  if (['responding', 'accepted', 'arrived', 'on_scene'].includes(value)) return 'responding';
  return 'pending';
};
const isActiveIncident = (incident: Incident) => !['resolved', 'closed', 'rejected', 'completed'].includes(String(incidentStatus(incident)).toLowerCase());
const dateTime = (value?: string) => {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};
const requestLabel = (request: Assistance) => [request.needs_more_manpower && 'Additional responders', request.needs_resources && 'Supplies or resources', request.needs_equipment && 'Equipment', request.beyond_barangay_capability && 'MDRRMO coordination'].filter(Boolean).join(' · ') || 'General assistance';
const requestDateValue = (request: Assistance) => {
  const value = Date.parse(request.created_at || '');
  return Number.isFinite(value) ? value : 0;
};
const dispatcherRequestStatus = (request: Assistance) => {
  if (request.decision === 'coordinate_mdrrmo') return 'MDRRMO coordination';
  if (request.decision === 'dismissed' || request.status === 'rejected') return 'Rejected';
  if (request.status === 'fulfilled') return 'Received';
  if (request.status === 'approved') return 'Approved';
  if (request.decision === 'provide_barangay_assistance') return 'Provided';
  return statusLabel(request.status);
};

function useIncidentLocationPreviews(incidents: Incident[], isBarangay: boolean) {
  const [previews, setPreviews] = useState<Record<string, IncidentLocationPreview>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const requested = useRef(new Set<string>());

  const loadPreview = useCallback(async (incident: Incident) => {
    if (!hasIncidentPin(incident)) return;
    const key = `${incident.id}:${incident.latitude}:${incident.longitude}`;
    if (requested.current.has(key)) return;
    requested.current.add(key);
    setLoading((current) => ({ ...current, [incident.id]: true }));
    try {
      const response = isBarangay
        ? await reportAPI.barangayLocationPreview(incident.id)
        : await reportAPI.mdrrmoReportLocationPreview(incident.id);
      setPreviews((current) => ({ ...current, [incident.id]: response.data || {} }));
    } catch (error) {
      requested.current.delete(key);
      console.warn(`Could not load incident location details for ${incident.id}:`, error);
    } finally {
      setLoading((current) => ({ ...current, [incident.id]: false }));
    }
  }, [isBarangay]);

  useEffect(() => { incidents.forEach((incident) => void loadPreview(incident)); }, [incidents, loadPreview]);
  return { previews, loading };
}

function RequestFields({ form, setForm, incident }: { form: RequestForm; setForm: (update: (value: RequestForm) => RequestForm) => void; incident?: Incident | null }) {
  return <>
    <div className="reports-text-card-v2 barangay-assistance-linked-summary"><strong>Requesting assistance for:</strong> {incident ? incidentTitle(incident) : 'General barangay assistance'}{incident && <span>{statusLabel(incidentStatus(incident))} · {incident.address || incident.barangay_name || 'Location not provided'}</span>}</div>
    <div className="barangay-assistance-needs"><span>Assistance needed</span>
      <label><input type="checkbox" checked={form.needs_more_manpower} onChange={(event) => setForm((value) => ({ ...value, needs_more_manpower: event.target.checked }))} /> Additional responders</label>
      <label><input type="checkbox" checked={form.needs_resources} onChange={(event) => setForm((value) => ({ ...value, needs_resources: event.target.checked }))} /> Supplies or resources</label>
      <label><input type="checkbox" checked={form.needs_equipment} onChange={(event) => setForm((value) => ({ ...value, needs_equipment: event.target.checked }))} /> Equipment</label>
      <label className="urgent"><input type="checkbox" checked={form.beyond_barangay_capability} onChange={(event) => setForm((value) => ({ ...value, beyond_barangay_capability: event.target.checked }))} /> Beyond barangay capability · request MDRRMO coordination</label>
    </div>
    {form.beyond_barangay_capability && !form.incident_report_id && <p className="barangay-assistance-inline-error">Select an assigned incident before requesting MDRRMO coordination.</p>}
    <label>Explain what is needed<textarea required minLength={10} rows={3} value={form.explanation} onChange={(event) => setForm((value) => ({ ...value, explanation: event.target.value }))} placeholder="Describe the support needed and why…" /></label>
  </>;
}

function BarangayAssistanceWorkspace() {
  const { user } = useAuth();
  const isResponder = user?.role === 'responder';
  const [requests, setRequests] = useState<Assistance[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<string | false | null>(null);
  const [form, setForm] = useState<RequestForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, DecisionForm>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date().toLocaleTimeString());

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [requestResponse, incidentResponse] = await Promise.all([
        isResponder ? barangayAPI.myAssistanceRequests() : barangayAPI.assistanceRequests(),
        reportAPI.barangayReports(),
      ]);
      const rows: Assistance[] = Array.isArray(requestResponse.data?.requests) ? requestResponse.data.requests : [];
      const reports: Incident[] = Array.isArray(incidentResponse.data) ? incidentResponse.data : [];
      setRequests(rows);
      setIncidents(reports);
      setDecisions((current) => Object.fromEntries(rows.map((request) => [request.id, current[request.id] || {
        decision: request.decision === 'coordinate_mdrrmo' ? 'coordinate_mdrrmo' : 'provide_barangay_assistance',
        notes: request.dispatcher_notes || '',
      }])));
      if (isResponder) {
        const queueIds = new Set(reports.filter(isActiveIncident).map((incident) => incident.id));
        rows.forEach((request) => { if (request.incident_report_id) queueIds.add(request.incident_report_id); });
        const hasGeneralRequests = rows.some((request) => !request.incident_report_id);
        setSelectedIncidentId((current) => current && (queueIds.has(current) || (current === 'general' && hasGeneralRequests)) ? current : reports.find(isActiveIncident)?.id || (hasGeneralRequests ? 'general' : null));
      } else {
        const newestFirst = rows.slice().sort((a, b) => requestDateValue(b) - requestDateValue(a));
        setSelectedRequestId((current) => current && rows.some((request) => request.id === current) ? current : newestFirst.find((request) => request.status === 'pending')?.id || newestFirst[0]?.id || null);
      }
    } catch (loadError: any) { setError(loadError?.response?.data?.error || 'Assistance requests could not be loaded.'); }
    finally { setLoading(false); }
  }, [isResponder]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(load, { events: ['incident:new'] });
  useEffect(() => {
    socket.on('assistance:new_request', load);
    socket.on('assistance:decision', load);
    socket.on('assistance:team_action', load);
    socket.on('incident:lifecycle', load);
    return () => {
      socket.off('assistance:new_request', load);
      socket.off('assistance:decision', load);
      socket.off('assistance:team_action', load);
      socket.off('incident:lifecycle', load);
    };
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const incidentQueue = useMemo(() => {
    const linkedIds = new Set(requests.map((request) => request.incident_report_id).filter((id): id is string => Boolean(id)));
    return incidents.filter((incident) => isActiveIncident(incident) || linkedIds.has(incident.id));
  }, [incidents, requests]);
  const dispatcherGroups = useMemo<DispatcherAssistanceGroup[]>(() => {
    const groups = new Map<string, DispatcherAssistanceGroup>();
    requests.forEach((request) => {
      const incidentId = request.incident_report_id || null;
      const key = incidentId ? `incident:${incidentId}` : `request:${request.id}`;
      const incident = incidentId ? incidents.find((row) => row.id === incidentId) || null : null;
      const group = groups.get(key) || { key, incidentId, incident, requests: [] };
      group.requests.push(request);
      if (!group.incident && incident) group.incident = incident;
      groups.set(key, group);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      requests: group.requests.slice().sort((a, b) => requestDateValue(a) - requestDateValue(b)),
    })).sort((a, b) => requestDateValue(b.requests[b.requests.length - 1]) - requestDateValue(a.requests[a.requests.length - 1]));
  }, [incidents, requests]);
  const incidentLocations = useIncidentLocationPreviews(incidentQueue, true);
  const selectedIncident = selectedIncidentId && selectedIncidentId !== 'general' ? incidents.find((incident) => incident.id === selectedIncidentId) || null : null;
  const incidentRequests = selectedIncidentId === 'general'
    ? requests.filter((request) => !request.incident_report_id)
    : requests.filter((request) => request.incident_report_id === selectedIncidentId);
  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ||
    requests.slice().sort((a, b) => requestDateValue(b) - requestDateValue(a)).find((request) => request.status === 'pending') ||
    requests.slice().sort((a, b) => requestDateValue(b) - requestDateValue(a))[0] || null;
  const selectedDispatcherGroup = selectedRequest
    ? dispatcherGroups.find((group) => group.key === (selectedRequest.incident_report_id ? `incident:${selectedRequest.incident_report_id}` : `request:${selectedRequest.id}`)) || null
    : null;
  const selectedDispatcherIncident = selectedDispatcherGroup?.incident || null;
  const selectedDispatcherRequests = selectedDispatcherGroup?.requests || [];
  const latestDispatcherRequestId = selectedDispatcherRequests[selectedDispatcherRequests.length - 1]?.id || null;
  const effectiveExpandedDispatcherRequestId = expandedRequestId === null ? latestDispatcherRequestId : expandedRequestId || null;

  useEffect(() => { setExpandedRequestId(null); }, [selectedDispatcherGroup?.key, latestDispatcherRequestId]);

  const toggleDispatcherRequest = (request: Assistance) => {
    setSelectedRequestId(request.id);
    setExpandedRequestId((current) => {
      const currentlyExpanded = current === null ? latestDispatcherRequestId : current || null;
      return currentlyExpanded === request.id ? false : request.id;
    });
  };

  const reset = () => { setForm(emptyForm); setEditingId(null); setIsRequestModalOpen(false); };
  const startNewRequest = () => {
    if (!selectedIncident || !isActiveIncident(selectedIncident)) return;
    setForm({ ...emptyForm, incident_report_id: selectedIncident.id });
    setEditingId(null);
    setIsRequestModalOpen(true);
  };
  const startEdit = (request: Assistance) => {
    setEditingId(request.id);
    setForm({ incident_report_id: request.incident_report_id || '', needs_more_manpower: Boolean(request.needs_more_manpower), needs_resources: Boolean(request.needs_resources), needs_equipment: Boolean(request.needs_equipment), beyond_barangay_capability: Boolean(request.beyond_barangay_capability), explanation: request.explanation || '' });
    setIsRequestModalOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const linked = incidents.find((incident) => incident.id === form.incident_report_id);
    if (!editingId && (!linked || !isActiveIncident(linked))) { toast.error('Select an active assigned incident before requesting assistance.'); return; }
    if (form.beyond_barangay_capability && !form.incident_report_id) { toast.error('Select an incident before requesting MDRRMO coordination.'); return; }
    const payload = { ...form, incident_report_id: form.incident_report_id || null, incident_title: linked ? incidentTitle(linked) : null };
    setSaving(true);
    try {
      if (editingId) await barangayAPI.editAssistanceRequest(editingId, payload);
      else await barangayAPI.createAssistanceRequest(payload);
      toast.success(editingId ? 'Assistance request updated.' : 'Assistance request submitted.'); reset(); await load();
    } catch (saveError: any) { toast.error(errorText(saveError)); }
    finally { setSaving(false); }
  };

  const decide = async (request: Assistance, decisionOverride?: DecisionForm['decision']) => {
    const value = decisions[request.id] || { decision: 'provide_barangay_assistance' as const, notes: '' };
    const decision = decisionOverride || value.decision;
    const notes = value.notes.trim();
    if (decision !== 'dismissed' && (notes.length < 3 || notes.length > 300)) { toast.error('Add a short dispatcher note before approving (3–300 characters).'); return; }
    if (notes.length > 300) { toast.error('Dispatcher notes must be 300 characters or fewer.'); return; }
    if (!window.confirm(`Confirm decision: ${statusLabel(decision)}?`)) return;
    setSaving(true);
    try { await barangayAPI.decideAssistanceRequest(request.id, decision, notes); toast.success('Assistance decision saved.'); await load(); }
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
  const isSelectedActive = Boolean(selectedIncident && isActiveIncident(selectedIncident));
  const detailOpen = isResponder ? Boolean(selectedIncidentId) : Boolean(selectedRequest);

  return (
    <main className={`reports-workspace-v2 assistance-workspace ${isResponder ? 'responder-mobile-workspace-v2' : ''}`}>
      <header className="reports-page-header-v2">
        <div><h1>Assistance Requests</h1><span>{isResponder ? `Responder workspace · ${user?.barangay_name || 'your barangay'}` : `Dispatcher workspace · ${user?.barangay_name || 'your barangay'}`}</span></div>
        <div className="assistance-header-actions-v2"><div className="reports-live-indicator"><i /> Live <span>·</span> {currentTime}</div><button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button></div>
      </header>

      {isResponder && isRequestModalOpen && <div className="barangay-console-modal-backdrop" role="presentation" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!saving) reset(); }
        if (event.key === 'Tab') {
          const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
          const first = focusable[0]; const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) reset(); }}>
        <section className="barangay-console-panel barangay-console-form-modal barangay-assistance-request-modal" role="dialog" aria-modal="true" aria-labelledby="barangay-assistance-request-title">
          <header><div><h2 id="barangay-assistance-request-title">{editingId ? 'Update request' : 'Request assistance'}</h2><p>The request will be attached to the selected incident.</p></div><button autoFocus className="workspace-secondary-action" type="button" onClick={reset} disabled={saving}><X size={15} /> Cancel</button></header>
          <form className="barangay-console-form-grid" onSubmit={(event) => void submit(event)}><RequestFields form={form} setForm={setForm} incident={incidents.find((incident) => incident.id === form.incident_report_id)} /><div className="barangay-console-form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Submitting…' : editingId ? <><Check size={16} /> Save changes</> : <><Send size={16} /> Submit request</>}</button></div></form>
        </section>
      </div>}

      {error && <div className="workspace-message workspace-message-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}

      <section className={`reports-split-view-v2 ${isResponder ? detailOpen ? 'responder-mobile-detail-v2' : 'responder-mobile-list-v2' : ''}`}>
        <aside className="reports-queue-v2">
          <div className="reports-queue-heading"><h2>Responding incidents</h2><span>{isResponder ? incidentQueue.length : dispatcherGroups.length}</span></div>
          {loading ? <div className="reports-empty-v2"><span className="spinner" /><p>Loading assistance requests…</p></div> : isResponder ? incidentQueue.length === 0 && !requests.some((request) => !request.incident_report_id) ? (
            <div className="reports-empty-v2"><HandHelping size={22} /><strong>No active incidents</strong><p>Incidents assigned to you will appear here. Select one to request assistance.</p></div>
          ) : (
            <div className="reports-queue-list-v2">
              {incidentQueue.map((incident) => {
                const count = requests.filter((request) => request.incident_report_id === incident.id).length;
                return <button key={incident.id} type="button" className={`reports-queue-item-v2 ${incidentStatusClass(incident)} ${selectedIncidentId === incident.id ? 'selected' : ''}`} onClick={() => setSelectedIncidentId(incident.id)}>
                  <span className="reports-queue-item-top"><strong>{incidentTitle(incident)}</strong><span className={`report-status-chip-v2 ${incidentStatusClass(incident)}`}>{statusLabel(incidentStatus(incident))}</span></span>
                  <span className="reports-queue-time">Incident occurred · {dateTime(incident.created_at)}</span>
                  <IncidentLocationCard compact showTitle={false} showLandmarkDistance={false} location={incidentLocations.previews[incident.id]} fallbackLabel={formatIncidentLocation(incident)} loading={Boolean(incidentLocations.loading[incident.id])} coordinates={hasIncidentPin(incident) ? `${Number(incident.latitude).toFixed(5)}, ${Number(incident.longitude).toFixed(5)}` : null} />
                  {incident.description && <span className="reports-queue-time assistance-request-preview">{incident.description}</span>}
                  <span className="reports-queue-time">{count} assistance {count === 1 ? 'request' : 'requests'}</span>
                </button>;
              })}
              {requests.some((request) => !request.incident_report_id) && <button type="button" className={`reports-queue-item-v2 assistance-request-item ${selectedIncidentId === 'general' ? 'selected' : ''}`} onClick={() => setSelectedIncidentId('general')}>
                <span className="reports-queue-item-top"><strong>General assistance</strong><span className="assistance-status-chip pending">{requests.filter((request) => !request.incident_report_id).length}</span></span>
                <span className="reports-queue-time">Previously submitted requests without an incident</span>
              </button>}
            </div>
          ) : dispatcherGroups.length === 0 ? (
            <div className="reports-empty-v2"><HandHelping size={22} /><strong>No assistance requests</strong><p>Responder requests from your barangay will appear here.</p></div>
          ) : (
            <div className="reports-queue-list-v2">{dispatcherGroups.map((group) => {
              const latestRequest = group.requests[group.requests.length - 1];
              const pendingCount = group.requests.filter((request) => request.status === 'pending').length;
              const active = selectedDispatcherGroup?.key === group.key;
              const location = group.incident ? incidentLocations.previews[group.incident.id] : undefined;
              return <button key={group.key} type="button" className={`reports-queue-item-v2 ${group.incident ? incidentStatusClass(group.incident) : statusClass(latestRequest.status)} ${active ? 'selected' : ''}`} onClick={() => {
                const reviewRequest = [...group.requests].reverse().find((request) => request.status === 'pending') || latestRequest;
                setSelectedRequestId(reviewRequest.id);
                setExpandedRequestId(null);
              }}>
                <span className="reports-queue-item-top"><strong>{group.incident ? incidentTitle(group.incident) : latestRequest.incident_title || 'General barangay assistance'}</strong><span className={`report-status-chip-v2 ${group.incident ? incidentStatusClass(group.incident) : statusClass(latestRequest.status)}`}>{group.incident ? statusLabel(incidentStatus(group.incident)) : statusLabel(latestRequest.status)}</span></span>
                <span className="reports-queue-time">Incident occurred · {dateTime(group.incident?.created_at || latestRequest.created_at)}</span>
                {group.incident ? <IncidentLocationCard compact showTitle={false} showLandmarkDistance={false} location={location} fallbackLabel={formatIncidentLocation(group.incident)} loading={Boolean(incidentLocations.loading[group.incident.id])} coordinates={hasIncidentPin(group.incident) ? `${Number(group.incident.latitude).toFixed(5)}, ${Number(group.incident.longitude).toFixed(5)}` : null} /> : <span className="reports-queue-time">Location not provided</span>}
                {(group.incident?.description || latestRequest.explanation) && <span className="reports-queue-time assistance-request-preview">{group.incident?.description || latestRequest.explanation}</span>}
                <span className="reports-queue-time">{group.requests.length} assistance {group.requests.length === 1 ? 'request' : 'requests'}{pendingCount ? ` · ${pendingCount} pending` : ''}</span>
              </button>;
            })}</div>
          )}
        </aside>

        <section className="reports-detail-v2">
          {!detailOpen ? (
            <div className="reports-detail-empty-v2"><div><ClipboardList size={28} /></div><strong>{isResponder ? 'Select a responding incident' : 'Select an incident'}</strong><p>{isResponder ? 'Choose one of your assigned incidents to review its assistance history.' : 'Choose an incident from the queue to review its assistance requests.'}</p></div>
          ) : isResponder ? (
            <>
              <div className="reports-detail-scroll-v2">
                <header className="reports-detail-heading-v2 reports-detail-heading-responder-v2">
                  <button type="button" className="reports-mobile-back-v2" onClick={() => setSelectedIncidentId(null)}><ArrowLeft size={16} /> Responding incidents</button>
                  <div><span className="reports-eyebrow-v2">Selected incident</span><h2>{selectedIncident ? incidentTitle(selectedIncident) : 'General assistance'}</h2><p>{selectedIncident ? `${statusLabel(incidentStatus(selectedIncident))} · ${dateTime(selectedIncident.created_at)}` : 'Requests submitted without an incident link'}</p></div>
                  <div className="reports-detail-heading-actions-v2"><span className={`report-status-chip-v2 detail ${selectedIncident ? incidentStatusClass(selectedIncident) : 'pending'}`}>{selectedIncident ? statusLabel(incidentStatus(selectedIncident)) : 'History'}</span><button className="workspace-primary-action" type="button" onClick={startNewRequest} disabled={!isSelectedActive}><HandHelping size={16} /> Request assistance</button></div>
                </header>
                {selectedIncident && <section className="reports-detail-section-v2"><h3>Incident location</h3><IncidentLocationCard showTitle={false} showLandmarkDistance={false} location={incidentLocations.previews[selectedIncident.id]} fallbackLabel={formatIncidentLocation(selectedIncident)} loading={Boolean(incidentLocations.loading[selectedIncident.id])} coordinates={hasIncidentPin(selectedIncident) ? `${Number(selectedIncident.latitude).toFixed(5)}, ${Number(selectedIncident.longitude).toFixed(5)}` : null} />{selectedIncident.description && <div className="reports-text-card-v2" style={{ marginTop: 10 }}>{selectedIncident.description}</div>}</section>}
                <section className="reports-detail-section-v2 assistance-history-section">
                  <div className="reports-section-heading-v2"><h3>Request history</h3><span>{incidentRequests.length} requests</span></div>
                  {incidentRequests.length ? <div className="assistance-history-list">{incidentRequests.map((request) => <article className="assistance-history-card" key={request.id}>
                    <header><div><span className="assistance-history-sos">SOS</span><strong>{requestLabel(request)}</strong></div><span className={`assistance-status-chip ${statusClass(request.status)}`}>{statusLabel(request.status)}</span></header>
                    <div className="assistance-history-entry"><strong>{selectedIncident ? incidentTitle(selectedIncident) : 'General assistance'}</strong><div className="assistance-history-meta"><span>{request.requested_by_user?.full_name || 'You'}</span><time>{dateTime(request.created_at)}</time></div><p>{request.explanation || 'No request details provided.'}</p></div>
                    {request.decision && <div className="assistance-history-entry dispatcher"><strong>Dispatcher response · {statusLabel(request.decision)}</strong>{request.dispatcher_notes && <p>{request.dispatcher_notes}</p>}{request.decided_by_user?.full_name && <small>Recorded by {request.decided_by_user.full_name}</small>}</div>}
                    <footer className="barangay-assistance-card-footer">{editRequest(request) && <button type="button" onClick={() => startEdit(request)}><ClipboardList size={15} /> Edit request</button>}{request.decision === 'provide_barangay_assistance' && !request.team_acknowledged && <button type="button" onClick={() => void responderAction(request, 'acknowledge')} disabled={saving}><Check size={15} /> Acknowledge support</button>}{String(request.status || '').toLowerCase() === 'pending' && request.requested_by === user?.id && <button className="danger" type="button" onClick={() => void responderAction(request, 'cancel')} disabled={saving}><X size={15} /> Cancel request</button>}{request.team_acknowledged && <span className="barangay-assistance-acknowledged"><Check size={14} /> Support acknowledged</span>}</footer>
                  </article>)}</div> : <div className="reports-no-media-v2">No assistance requests for this incident yet.</div>}
                </section>
              </div>
            </>
          ) : selectedRequest ? (
            <>
              <div className="reports-detail-scroll-v2">
                <header className="reports-detail-heading-v2 reports-detail-heading-responder-v2">
                  <div><span className="reports-eyebrow-v2">Selected incident</span><h2>{selectedDispatcherIncident ? incidentTitle(selectedDispatcherIncident) : selectedRequest.incident_title || 'General barangay assistance'}</h2><p>{selectedDispatcherIncident ? `${statusLabel(incidentStatus(selectedDispatcherIncident))} · ${dateTime(selectedDispatcherIncident.created_at)}` : `Assistance request · ${dateTime(selectedRequest.created_at)}`}</p></div>
                  <span className={`report-status-chip-v2 detail ${selectedDispatcherIncident ? incidentStatusClass(selectedDispatcherIncident) : 'pending'}`}>{selectedDispatcherIncident ? statusLabel(incidentStatus(selectedDispatcherIncident)) : 'Assistance'}</span>
                </header>
                {selectedDispatcherIncident ? <section className="reports-detail-section-v2"><h3>Incident location</h3><IncidentLocationCard showTitle={false} showLandmarkDistance={false} location={incidentLocations.previews[selectedDispatcherIncident.id]} fallbackLabel={formatIncidentLocation(selectedDispatcherIncident)} loading={Boolean(incidentLocations.loading[selectedDispatcherIncident.id])} coordinates={hasIncidentPin(selectedDispatcherIncident) ? `${Number(selectedDispatcherIncident.latitude).toFixed(5)}, ${Number(selectedDispatcherIncident.longitude).toFixed(5)}` : null} />{selectedDispatcherIncident.description && <div className="reports-text-card-v2" style={{ marginTop: 10 }}>{selectedDispatcherIncident.description}</div>}</section> : <section className="reports-detail-section-v2"><h3>Incident location</h3><div className="reports-location-card-v2"><MapPin size={19} /><div><strong>{selectedRequest.incident_title || 'General barangay assistance'}</strong><span>{user?.barangay_name || 'Location not provided'}</span></div></div></section>}
                <section className="reports-detail-section-v2 assistance-history-section">
                  <div className="reports-section-heading-v2"><h3>Request history</h3><span>{selectedDispatcherRequests.length} requests</span></div>
                  {selectedDispatcherRequests.length ? <div className="assistance-history-list">{selectedDispatcherRequests.map((request) => {
                    const isSelectedForReview = selectedRequest.id === request.id;
                    const categories = [
                      request.needs_more_manpower ? 'Manpower' : null,
                      request.needs_resources ? 'Resources' : null,
                      request.needs_equipment ? 'Equipment' : null,
                      request.beyond_barangay_capability ? 'MDRRMO coordination' : null,
                    ].filter((category): category is string => Boolean(category));
                    return <article
                      className={`assistance-history-card assistance-review-selectable ${isSelectedForReview ? 'review-selected' : ''} ${effectiveExpandedDispatcherRequestId === request.id ? '' : 'is-collapsed'}`}
                      key={request.id}
                    >
                      <header><button type="button" className="assistance-history-toggle" aria-expanded={effectiveExpandedDispatcherRequestId === request.id} aria-controls={`barangay-assistance-history-${request.id}`} aria-label={`${effectiveExpandedDispatcherRequestId === request.id ? 'Minimize' : 'Maximize'} assistance request from ${request.requested_by_user?.full_name || 'Responder'}`} onClick={() => toggleDispatcherRequest(request)}><span className="assistance-history-title"><span className="assistance-history-sos">SOS</span><strong>Assistance Request</strong></span><span className={`assistance-status-chip ${statusClass(request.status)}`}>{dispatcherRequestStatus(request)}</span><ChevronDown className={effectiveExpandedDispatcherRequestId === request.id ? '' : 'collapsed'} size={17} aria-hidden="true" /></button></header>
                      <div id={`barangay-assistance-history-${request.id}`} hidden={effectiveExpandedDispatcherRequestId !== request.id}>
                        <div className="assistance-history-entry"><strong>From: {request.requested_by_user?.full_name || 'Responder'}</strong><time>{dateTime(request.created_at)}</time>{categories.length > 0 && <div className="assistance-history-tags" aria-label="Requested assistance categories">{categories.map((category) => <span key={category}>✓ {category}</span>)}</div>}<p>{request.explanation || 'No request details provided.'}</p></div>
                        {(request.dispatcher_notes || request.decision || request.status !== 'pending') && <div className="assistance-history-entry dispatcher"><strong>From: Dispatcher</strong><span className={`assistance-decision-badge ${request.decision === 'coordinate_mdrrmo' ? 'coordination' : request.decision === 'dismissed' || request.status === 'rejected' ? 'rejected' : 'provided'}`}>{dispatcherRequestStatus(request)}</span>{request.dispatcher_notes && <p>{request.dispatcher_notes}</p>}</div>}
                      </div>
                    </article>;
                  })}</div> : <div className="reports-no-media-v2">No assistance requests for this incident yet.</div>}
                </section>
                {String(selectedRequest.status || '').toLowerCase() === 'pending' && <section className="reports-detail-section-v2 barangay-assistance-review-panel"><h3>Dispatcher response</h3><label>Decision<select value={(decisions[selectedRequest.id] || { decision: 'provide_barangay_assistance', notes: '' }).decision} onChange={(event) => setDecisions((current) => ({ ...current, [selectedRequest.id]: { ...(current[selectedRequest.id] || { decision: 'provide_barangay_assistance', notes: '' }), decision: event.target.value as DecisionForm['decision'] } }))}><option value="provide_barangay_assistance">Provide barangay assistance</option><option value="coordinate_mdrrmo">Coordinate with MDRRMO</option><option value="dismissed">Dismiss request</option></select></label><label>Dispatcher note{(decisions[selectedRequest.id] || { decision: 'provide_barangay_assistance', notes: '' }).decision !== 'dismissed' ? ' (required)' : ' (optional)'}<textarea rows={3} maxLength={300} value={(decisions[selectedRequest.id] || { decision: 'provide_barangay_assistance', notes: '' }).notes} onChange={(event) => setDecisions((current) => ({ ...current, [selectedRequest.id]: { ...(current[selectedRequest.id] || { decision: 'provide_barangay_assistance', notes: '' }), notes: event.target.value } }))} placeholder="Add a brief note for the response team…" /></label></section>}
              </div>
                {String(selectedRequest.status || '').toLowerCase() === 'pending' && <footer className="reports-detail-actions-v2 assistance-request-actions"><button type="button" className="reports-invalid-button-v2" disabled={saving} onClick={() => void decide(selectedRequest, 'dismissed')}>Dismiss</button><button type="button" className="reports-dispatch-button-v2" disabled={saving} onClick={() => void decide(selectedRequest)}><Check size={16} /> Save decision</button></footer>}
            </>
          ) : null}
        </section>
      </section>
    </main>
  );
}

type MdrrmoAssistance = {
  id: string; incident_id: string; request_type: 'responders' | 'goods'; sub_type?: string | null;
  details?: string; status?: 'pending' | 'approved' | 'rejected' | 'fulfilled'; dispatcher_notes?: string | null; created_at?: string;
};
type MdrrmoRequestForm = { incident_id: string; needs_more_manpower: boolean; needs_resources: boolean; needs_equipment: boolean; details: string };
const initialMdrrmoRequest: MdrrmoRequestForm = { incident_id: '', needs_more_manpower: false, needs_resources: false, needs_equipment: false, details: '' };
const mdrrmoRequestCategories = (request: MdrrmoAssistance) => {
  const categories = String(request.sub_type || '').split(',').map((value) => value.trim()).filter(Boolean).map(statusLabel);
  return categories.length ? categories : [request.request_type === 'responders' ? 'Manpower' : 'Resources'];
};

function MdrrmoResponderAssistanceWorkspace() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<MdrrmoAssistance[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [form, setForm] = useState<MdrrmoRequestForm>(initialMdrrmoRequest);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date().toLocaleTimeString());

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [requestResponse, incidentResponse] = await Promise.all([requestAPI.mine(), reportAPI.mdrrmoQueue()]);
      const rows: MdrrmoAssistance[] = Array.isArray(requestResponse.data) ? requestResponse.data : [];
      const reports: Incident[] = Array.isArray(incidentResponse.data) ? incidentResponse.data : [];
      setRequests(rows); setIncidents(reports);
      const queueIds = new Set(reports.filter(isActiveIncident).map((incident) => incident.id));
      rows.forEach((request) => queueIds.add(request.incident_id));
      setSelectedIncidentId((current) => current && queueIds.has(current) ? current : reports.find(isActiveIncident)?.id || rows[0]?.incident_id || null);
    } catch (loadError: any) { setError(loadError?.response?.data?.error || 'Your MDRRMO assistance requests could not be loaded.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(load, { events: ['incident:new'] });
  useEffect(() => {
    socket.on('resource:request', load); socket.on('incident_report:updated', load);
    return () => { socket.off('resource:request', load); socket.off('incident_report:updated', load); };
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const incidentQueue = useMemo(() => {
    const requestIds = new Set(requests.map((request) => request.incident_id));
    return incidents.filter((incident) => isActiveIncident(incident) || requestIds.has(incident.id));
  }, [incidents, requests]);
  const incidentLocations = useIncidentLocationPreviews(incidentQueue, false);
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) || null;
  const incidentRequests = requests.filter((request) => request.incident_id === selectedIncidentId);
  const isSelectedActive = Boolean(selectedIncident && isActiveIncident(selectedIncident));

  const reset = () => { setForm(initialMdrrmoRequest); setIsRequestModalOpen(false); };
  const startRequest = () => {
    if (!selectedIncident || !isActiveIncident(selectedIncident)) return;
    setForm({ ...initialMdrrmoRequest, incident_id: selectedIncident.id }); setIsRequestModalOpen(true);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const linkedIncident = incidents.find((incident) => incident.id === form.incident_id);
    if (!linkedIncident || !isActiveIncident(linkedIncident)) { toast.error('Select an active assigned incident before requesting assistance.'); return; }
    const categories = [form.needs_more_manpower ? 'manpower' : null, form.needs_resources ? 'resources' : null, form.needs_equipment ? 'equipment' : null].filter((category): category is string => Boolean(category));
    if (!categories.length) { toast.error('Select at least one type of assistance.'); return; }
    if (form.details.trim().length < 10) { toast.error('Add a short explanation of at least 10 characters.'); return; }
    setSaving(true);
    try {
      await requestAPI.create({ request_type: form.needs_more_manpower ? 'responders' : 'goods', sub_type: categories.join(','), details: form.details.trim(), incident_id: form.incident_id });
      toast.success('Assistance request submitted to MDRRMO dispatch.'); reset(); await load();
    } catch (saveError: any) { toast.error(saveError?.response?.data?.error || 'The assistance request could not be submitted.'); }
    finally { setSaving(false); }
  };
  const confirmReceived = async (request: MdrrmoAssistance) => {
    setSaving(true);
    try { await requestAPI.updateStatus(request.id, 'fulfilled'); toast.success('Assistance receipt confirmed.'); await load(); }
    catch (actionError: any) { toast.error(actionError?.response?.data?.error || 'Assistance receipt could not be confirmed.'); }
    finally { setSaving(false); }
  };
  const detailOpen = Boolean(selectedIncidentId);

  return (
    <main className="reports-workspace-v2 assistance-workspace responder-mobile-workspace-v2">
      <header className="reports-page-header-v2"><div><h1>Assistance Requests</h1><span>MDRRMO responder workspace</span></div><div className="assistance-header-actions-v2"><div className="reports-live-indicator"><i /> Live <span>·</span> {currentTime}</div><button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button></div></header>
      {isRequestModalOpen && <div className="barangay-console-modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape' && !saving) reset(); }} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) reset(); }}>
        <section className="barangay-console-panel barangay-console-form-modal barangay-assistance-request-modal" role="dialog" aria-modal="true" aria-labelledby="mdrrmo-assistance-request-title">
          <header><div><h2 id="mdrrmo-assistance-request-title">Request assistance</h2><p>This request will be attached to {incidentTitle(selectedIncident)}.</p></div><button autoFocus className="workspace-secondary-action" type="button" onClick={reset} disabled={saving}><X size={15} /> Cancel</button></header>
          <form className="barangay-console-form-grid" onSubmit={(event) => void submit(event)}>
            <div className="reports-text-card-v2 barangay-assistance-linked-summary"><strong>Selected incident:</strong> {incidentTitle(selectedIncident)}<span>{selectedIncident ? `${statusLabel(incidentStatus(selectedIncident))} · ${selectedIncident.address || selectedIncident.barangay_name || 'Location not provided'}` : 'Incident unavailable'}</span></div>
            <div className="barangay-assistance-needs barangay-console-form-wide"><span>Assistance needed</span><label><input type="checkbox" checked={form.needs_more_manpower} onChange={(event) => setForm((current) => ({ ...current, needs_more_manpower: event.target.checked }))} /> Additional responders</label><label><input type="checkbox" checked={form.needs_resources} onChange={(event) => setForm((current) => ({ ...current, needs_resources: event.target.checked }))} /> Supplies or resources</label><label><input type="checkbox" checked={form.needs_equipment} onChange={(event) => setForm((current) => ({ ...current, needs_equipment: event.target.checked }))} /> Equipment</label></div>
            <label className="barangay-console-form-wide">Additional information for responders<textarea required minLength={10} rows={3} value={form.details} onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))} placeholder="Explain what is needed and how it will help…" /></label>
            <div className="barangay-console-form-actions"><button className="btn btn-primary" type="submit" disabled={saving || !form.incident_id}>{saving ? 'Submitting…' : <><Send size={16} /> Submit request</>}</button></div>
          </form>
        </section>
      </div>}
      {error && <div className="workspace-message workspace-message-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
      <section className={`reports-split-view-v2 ${detailOpen ? 'responder-mobile-detail-v2' : 'responder-mobile-list-v2'}`}>
        <aside className="reports-queue-v2"><div className="reports-queue-heading"><h2>Responding incidents</h2><span>{incidentQueue.length}</span></div>
          {loading ? <div className="reports-empty-v2"><span className="spinner" /><p>Loading incidents…</p></div> : incidentQueue.length === 0 ? <div className="reports-empty-v2"><HandHelping size={22} /><strong>No active incidents</strong><p>Assigned incidents will appear here. Select an incident to request assistance.</p></div> : <div className="reports-queue-list-v2">{incidentQueue.map((incident) => {
            const count = requests.filter((request) => request.incident_id === incident.id).length;
            return <button key={incident.id} type="button" className={`reports-queue-item-v2 ${incidentStatusClass(incident)} ${selectedIncidentId === incident.id ? 'selected' : ''}`} onClick={() => setSelectedIncidentId(incident.id)}>
              <span className="reports-queue-item-top"><strong>{incidentTitle(incident)}</strong><span className={`report-status-chip-v2 ${incidentStatusClass(incident)}`}>{statusLabel(incidentStatus(incident))}</span></span>
              <span className="reports-queue-time">Incident occurred · {dateTime(incident.created_at)}</span>
              <IncidentLocationCard compact showTitle={false} showLandmarkDistance={false} location={incidentLocations.previews[incident.id]} fallbackLabel={formatIncidentLocation(incident)} loading={Boolean(incidentLocations.loading[incident.id])} coordinates={hasIncidentPin(incident) ? `${Number(incident.latitude).toFixed(5)}, ${Number(incident.longitude).toFixed(5)}` : null} />
              {incident.description && <span className="reports-queue-time assistance-request-preview">{incident.description}</span>}
              <span className="reports-queue-time">{count} assistance {count === 1 ? 'request' : 'requests'}</span>
            </button>;
          })}</div>}
        </aside>
        <section className="reports-detail-v2">{!selectedIncident ? <div className="reports-detail-empty-v2"><div><ClipboardList size={28} /></div><strong>Select a responding incident</strong><p>Choose an incident assigned to your unit to review requests and ask for support.</p></div> : <>
          <div className="reports-detail-scroll-v2"><header className="reports-detail-heading-v2 reports-detail-heading-responder-v2"><button type="button" className="reports-mobile-back-v2" onClick={() => setSelectedIncidentId(null)}><ArrowLeft size={16} /> Responding incidents</button><div><span className="reports-eyebrow-v2">Selected incident</span><h2>{incidentTitle(selectedIncident)}</h2><p>{statusLabel(incidentStatus(selectedIncident))} · {dateTime(selectedIncident.created_at)}</p></div><div className="reports-detail-heading-actions-v2"><span className={`report-status-chip-v2 detail ${incidentStatusClass(selectedIncident)}`}>{statusLabel(incidentStatus(selectedIncident))}</span><button className="workspace-primary-action" type="button" onClick={startRequest} disabled={!isSelectedActive}><HandHelping size={16} /> Request assistance</button></div></header>
            <section className="reports-detail-section-v2"><h3>Incident location</h3><IncidentLocationCard showTitle={false} showLandmarkDistance={false} location={incidentLocations.previews[selectedIncident.id]} fallbackLabel={formatIncidentLocation(selectedIncident)} loading={Boolean(incidentLocations.loading[selectedIncident.id])} coordinates={hasIncidentPin(selectedIncident) ? `${Number(selectedIncident.latitude).toFixed(5)}, ${Number(selectedIncident.longitude).toFixed(5)}` : null} />{selectedIncident.description && <div className="reports-text-card-v2" style={{ marginTop: 10 }}>{selectedIncident.description}</div>}</section>
            <section className="reports-detail-section-v2 assistance-history-section"><div className="reports-section-heading-v2"><h3>Request history</h3><span>{incidentRequests.length} requests</span></div>{incidentRequests.length ? <div className="assistance-history-list">{incidentRequests.map((request) => <article className="assistance-history-card" key={request.id}>
              <header><div><span className="assistance-history-sos">SOS</span><strong>Assistance Request</strong></div><span className={`assistance-status-chip ${statusClass(request.status)}`}>{request.status === 'fulfilled' ? 'Received' : statusLabel(request.status)}</span></header>
              <div className="assistance-history-entry"><strong>From: {user?.full_name || 'You'}</strong><time>{dateTime(request.created_at)}</time><div className="assistance-history-tags" aria-label="Requested assistance categories">{mdrrmoRequestCategories(request).map((category) => <span key={category}>✓ {category}</span>)}</div><p>{request.details || 'No request details provided.'}</p></div>
              {(request.dispatcher_notes || request.status !== 'pending') && <div className="assistance-history-entry dispatcher"><strong>From: Dispatcher</strong><span className={`assistance-decision-badge ${request.status === 'rejected' ? 'rejected' : 'provided'}`}>{request.status === 'fulfilled' ? 'Received' : statusLabel(request.status)}</span>{request.dispatcher_notes && <p>{request.dispatcher_notes}</p>}</div>}
              {request.status === 'approved' && <footer className="barangay-assistance-card-footer"><button type="button" onClick={() => void confirmReceived(request)} disabled={saving}><Check size={15} /> Confirm received</button></footer>}
            </article>)}</div> : <div className="reports-no-media-v2">No assistance requests for this incident yet.</div>}</section>
          </div>
        </>}</section>
      </section>
    </main>
  );
}

export default function BarangayAssistancePage() {
  const { user } = useAuth();
  if (user?.account_kind !== 'barangay' && user?.role === 'responder') return <MdrrmoResponderAssistanceWorkspace />;
  return <BarangayAssistanceWorkspace />;
}
