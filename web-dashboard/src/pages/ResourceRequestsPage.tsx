import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertTriangle, ChevronDown, ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import { reportAPI, requestAPI, socket } from '../lib/api';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import IncidentLocationCard from '../components/IncidentLocationCard';
import { formatIncidentLocation, hasIncidentPin, type IncidentLocationPreview } from '../lib/incidentLocation';

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled';

interface LinkedReport {
  id: string;
  type?: string;
  title?: string;
  description?: string;
  status?: string;
  address?: string | null;
  location_name?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  reporter_type?: string;
  barangay_name?: string | null;
  created_at?: string;
  mdrrmo_response_status?: string | null;
  barangay_response_status?: string | null;
  send_to?: string | null;
  specifics?: string | null;
  mdrrmo_coordination_notes?: string | null;
  barangay_response_notes?: string | null;
  is_escalated?: boolean | string | null;
  beyond_barangay_capability?: boolean | string | null;
}

interface AssistanceRequest {
  id: string;
  request_type: string;
  sub_type?: string | null;
  details: string;
  status: RequestStatus;
  incident_id: string;
  requested_by: string;
  created_at: string;
  source?: 'mdrrmo' | 'barangay' | 'resident';
  explanation?: string | null;
  decision?: string | null;
  dispatcher_notes?: string | null;
  decided_at?: string | null;
  needs_more_manpower?: boolean;
  needs_resources?: boolean;
  needs_equipment?: boolean;
  beyond_barangay_capability?: boolean;
  requested_by_user?: {
    full_name?: string;
    role?: string;
    unit_type?: string | null;
    phone?: string | null;
  } | null;
  incident_report?: LinkedReport | null;
}

interface AssistanceIncidentGroup {
  key: string;
  incidentId: string | null;
  incident: LinkedReport | null;
  requests: AssistanceRequest[];
}

function dateTime(value?: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : format(date, 'MMM d, yyyy · h:mm a');
}

function statusLabel(status?: string): string {
  return status ? status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown';
}

function requestStatusLabel(request: AssistanceRequest): string {
  return request.status === 'fulfilled' && request.source === 'mdrrmo'
    ? 'Received'
    : statusLabel(request.status);
}

function requestTypeLabel(type?: string, subType?: string | null): string {
  const typeLabel = type === 'responders' ? 'Responders' : statusLabel(type);
  return subType ? `${typeLabel} · ${statusLabel(subType)}` : typeLabel;
}

function coordinationLabel(request: AssistanceRequest): string {
  if (request.decision === 'provide_barangay_assistance') return 'Provided assistance';
  if (request.decision === 'coordinate_mdrrmo') return 'MDRRMO coordination';
  if (request.decision === 'dismissed' || request.status === 'rejected') return 'Rejected';
  if (request.status === 'fulfilled') return request.source === 'mdrrmo' ? 'Received' : 'Provided';
  if (request.status === 'approved') return 'Approved';
  return statusLabel(request.status);
}

function requestCategories(request: AssistanceRequest): string[] {
  const categories = new Set<string>();
  if (request.needs_more_manpower) categories.add('Manpower');
  if (request.needs_resources) categories.add('Resources');
  if (request.needs_equipment) categories.add('Equipment');

  if (categories.size === 0) {
    const type = `${request.request_type || ''} ${request.sub_type || ''}`.toLowerCase().replaceAll('_', ' ');
    if (/responder|manpower|personnel/.test(type)) categories.add('Manpower');
    if (/equipment/.test(type)) categories.add('Equipment');
    if (/resource|suppl|goods/.test(type)) categories.add('Resources');
  }

  return [...categories];
}

function incidentStatusClass(value?: string | null): string {
  const status = String(value || '').toLowerCase().replaceAll(' ', '_');
  if (['resolved', 'closed', 'rejected', 'completed'].includes(status)) return 'resolved';
  if (['responding', 'accepted', 'arrived', 'on_scene'].includes(status)) return 'responding';
  return 'pending';
}

function isResponderAssistanceRequest(request: AssistanceRequest): boolean {
  const subtype = String(request.sub_type || '').trim().toLowerCase().replaceAll(' ', '_');
  const type = String(request.request_type || '').trim().toLowerCase().replaceAll(' ', '_');
  return (request.source === 'mdrrmo' || request.source === 'barangay') &&
    subtype !== 'escalation' && type !== 'escalation' &&
    !request.id.startsWith('resident-request-') &&
    !request.id.startsWith('escalation-');
}

export default function ResourceRequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const incidentId = searchParams.get('incident_id');
  const requestedId = searchParams.get('request_id');
  const [requests, setRequests] = useState<AssistanceRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<string | false | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approvalNote, setApprovalNote] = useState('');
  const [locationPreviewState, setLocationPreviewState] = useState<{
    incidentId: string;
    preview: IncidentLocationPreview | null;
    loading: boolean;
    error: string;
  } | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date().toLocaleTimeString());

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const response = await requestAPI.list();
      setRequests(Array.isArray(response.data.requests) ? response.data.requests : []);
    } catch (error) {
      console.error('Failed to fetch assistance requests', error);
      toast.error('Failed to load assistance requests');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchRequests(); }, [fetchRequests]);
  useRealtimeRefresh(fetchRequests, { events: ['incident:new'] });

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refresh = () => { void fetchRequests(); };
    socket.on('connect', refresh);
    socket.on('resource:request', refresh);
    socket.on('incident_report:updated', refresh);
    socket.on('incident_report:new', refresh);
    socket.on('barangay:escalated', refresh);
    return () => {
      socket.off('connect', refresh);
      socket.off('resource:request', refresh);
      socket.off('incident_report:updated', refresh);
      socket.off('incident_report:new', refresh);
      socket.off('barangay:escalated', refresh);
    };
  }, [fetchRequests]);

  const visibleRequests = useMemo(() => requests
    .filter(isResponderAssistanceRequest)
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.created_at);
      const bTime = Date.parse(b.created_at);
      const safeATime = Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY;
      const safeBTime = Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY;
      return safeATime - safeBTime || a.id.localeCompare(b.id);
    }), [requests]);
  const incidentGroups = useMemo<AssistanceIncidentGroup[]>(() => {
    const groups = new Map<string, AssistanceIncidentGroup>();
    visibleRequests.forEach((request) => {
      const incidentId = request.incident_id || null;
      const key = incidentId ? `incident:${incidentId}` : `request:${request.id}`;
      const group = groups.get(key) || {
        key,
        incidentId,
        incident: request.incident_report || null,
        requests: [],
      };
      group.requests.push(request);
      if (!group.incident && request.incident_report) group.incident = request.incident_report;
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => {
      const aTime = Date.parse(a.requests[a.requests.length - 1]?.created_at || '');
      const bTime = Date.parse(b.requests[b.requests.length - 1]?.created_at || '');
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [visibleRequests]);
  const selected = visibleRequests.find((request) => request.id === selectedId) ||
    visibleRequests.slice().reverse().find((request) => request.status === 'pending') ||
    visibleRequests[visibleRequests.length - 1] || null;
  const selectedGroup = selected
    ? incidentGroups.find((group) => group.key === (selected.incident_id ? `incident:${selected.incident_id}` : `request:${selected.id}`)) || null
    : null;
  const selectedHistory = selectedGroup?.requests || [];
  const latestHistoryRequestId = selectedHistory[selectedHistory.length - 1]?.id || null;
  const effectiveExpandedRequestId = expandedRequestId === null ? latestHistoryRequestId : expandedRequestId || null;
  const linkedIncident = selectedGroup?.incident || selected?.incident_report || null;
  const linkedIncidentId = linkedIncident?.id;
  const linkedIncidentHasPin = linkedIncident ? hasIncidentPin(linkedIncident) : false;
  const linkedLocationPreview = locationPreviewState?.incidentId === linkedIncident?.id ? locationPreviewState : null;

  useEffect(() => { setApprovalNote(''); }, [selected?.id]);
  useEffect(() => { setExpandedRequestId(null); }, [selectedGroup?.key, latestHistoryRequestId]);

  useEffect(() => {
    if (!linkedIncidentId || !linkedIncidentHasPin) {
      setLocationPreviewState(linkedIncidentId ? { incidentId: linkedIncidentId, preview: null, loading: false, error: '' } : null);
      return;
    }
    let cancelled = false;
    setLocationPreviewState({ incidentId: linkedIncidentId, preview: null, loading: true, error: '' });
    reportAPI.mdrrmoReportLocationPreview(linkedIncidentId)
      .then((response) => {
        if (!cancelled) setLocationPreviewState({ incidentId: linkedIncidentId, preview: response.data || {}, loading: false, error: '' });
      })
      .catch((error) => {
        if (!cancelled) setLocationPreviewState({
          incidentId: linkedIncidentId,
          preview: null,
          loading: false,
          error: error?.response?.data?.error || 'Detailed location is unavailable.',
        });
      });
    return () => { cancelled = true; };
  }, [linkedIncidentId, linkedIncidentHasPin]);

  useEffect(() => {
    if (!visibleRequests.length) return;
    const incidentLinkedRequests = incidentId ? visibleRequests.filter((request) => request.incident_id === incidentId) : [];
    const deepLinked = requestedId
      ? visibleRequests.find((request) => request.id === requestedId)
      : incidentLinkedRequests.slice().reverse().find((request) => request.status === 'pending') || incidentLinkedRequests[incidentLinkedRequests.length - 1] || null;
    if (deepLinked) {
      setSelectedId(deepLinked.id);
      return;
    }
    if (!selectedId || !visibleRequests.some((request) => request.id === selectedId)) {
      const firstPending = visibleRequests.slice().reverse().find((request) => request.status === 'pending');
      setSelectedId(firstPending?.id || visibleRequests[visibleRequests.length - 1].id);
    }
  }, [incidentId, requestedId, selectedId, visibleRequests]);

  const selectRequest = (request: AssistanceRequest) => {
    setSelectedId(request.id);
    setSearchParams({ incident_id: request.incident_id, request_id: request.id }, { replace: true });
  };

  const selectIncidentGroup = (group: AssistanceIncidentGroup) => {
    const activeRequest = [...group.requests].reverse().find((request) => request.status === 'pending') || group.requests[group.requests.length - 1];
    if (!activeRequest) return;
    setExpandedRequestId(null);
    selectRequest(activeRequest);
  };

  const toggleRequestCard = (request: AssistanceRequest) => {
    selectRequest(request);
    setExpandedRequestId((current) => {
      const currentlyExpanded = current === null ? latestHistoryRequestId : current || null;
      return currentlyExpanded === request.id ? false : request.id;
    });
  };

  const updateStatus = async (request: AssistanceRequest, status: RequestStatus) => {
    const note = approvalNote.trim();
    if (status === 'approved' && (note.length < 3 || note.length > 300)) {
      toast.error('Add a short approval note (3–300 characters).');
      return;
    }
    try {
      setSaving(true);
      await requestAPI.updateStatus(request.id, status, status === 'approved' ? note : undefined);
      toast.success(`Assistance request marked ${status}.`);
      if (status === 'approved') setApprovalNote('');
      await fetchRequests();
    } catch (error) {
      console.error('Failed to update assistance request', error);
      toast.error('Could not update assistance request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="reports-workspace-v2 assistance-workspace">
      <header className="reports-page-header-v2">
        <div><h1>Assistance Requests</h1><span>Dispatcher workspace</span></div>
        <div className="reports-live-indicator"><i /> Live <span>·</span> {currentTime}</div>
      </header>

      <section className="reports-split-view-v2">
        <aside className="reports-queue-v2">
          <div className="reports-queue-heading">
            <h2>Responding incidents</h2>
            <span>{incidentGroups.length}</span>
          </div>
          {loading ? (
            <div className="reports-empty-v2"><span className="spinner" /><p>Loading assistance requests…</p></div>
          ) : incidentGroups.length === 0 ? (
            <div className="reports-empty-v2"><AlertTriangle size={22} /><strong>No assistance requests</strong><p>Responder requests for support will appear here.</p></div>
          ) : (
            <div className="reports-queue-list-v2">
              {incidentGroups.map((group) => {
                const active = selectedGroup?.key === group.key;
                const latestRequest = group.requests[group.requests.length - 1];
                const pendingCount = group.requests.filter((request) => request.status === 'pending').length;
                const linkedReport = group.incident;
                const groupLocationPreview = locationPreviewState?.incidentId === linkedReport?.id ? locationPreviewState : null;
                return (
                  <button key={group.key} type="button" className={`reports-queue-item-v2 ${incidentStatusClass(linkedReport?.status)} ${active ? 'selected' : ''}`} onClick={() => selectIncidentGroup(group)}>
                    <span className="reports-queue-item-top">
                      <strong>{linkedReport?.title || 'Incident Report'}</strong>
                      <span className={`report-status-chip-v2 ${incidentStatusClass(linkedReport?.status)}`}>{linkedReport?.status ? statusLabel(linkedReport.status) : requestStatusLabel(latestRequest)}</span>
                    </span>
                    <span className="reports-queue-time">Incident occurred · {dateTime(linkedReport?.created_at || latestRequest.created_at)}</span>
                    {linkedReport ? <IncidentLocationCard compact showTitle={false} showLandmarkDistance={false} location={groupLocationPreview?.preview} loading={Boolean(groupLocationPreview?.loading)} fallbackLabel={formatIncidentLocation(linkedReport)} coordinates={hasIncidentPin(linkedReport) ? `${Number(linkedReport.latitude).toFixed(5)}, ${Number(linkedReport.longitude).toFixed(5)}` : null} /> : <span className="reports-queue-time">Location not provided</span>}
                    {(linkedReport?.description || linkedReport?.specifics || latestRequest.details) && <span className="reports-queue-time assistance-request-preview">{linkedReport?.description || linkedReport?.specifics || latestRequest.details}</span>}
                    <span className="reports-queue-time">{group.requests.length} assistance {group.requests.length === 1 ? 'request' : 'requests'}{pendingCount ? ` · ${pendingCount} pending` : ''}</span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="reports-detail-v2">
          {!selected ? (
            <div className="reports-detail-empty-v2"><div><ClipboardList size={28} /></div><strong>Select an incident</strong><p>Choose an incident from the queue to review its assistance requests.</p></div>
          ) : (
            <>
              <div className="reports-detail-scroll-v2">
                <header className="reports-detail-heading-v2 reports-detail-heading-responder-v2">
                  <div>
                    <span className="reports-eyebrow-v2">Selected incident</span>
                    <h2>{linkedIncident?.title || 'Incident Report'}</h2>
                    <p>{statusLabel(linkedIncident?.status || 'active')} · {dateTime(linkedIncident?.created_at || selected.created_at)}</p>
                  </div>
                  <span className={`report-status-chip-v2 detail ${incidentStatusClass(linkedIncident?.status)}`}>{statusLabel(linkedIncident?.status || 'Active')}</span>
                </header>

                <section className="reports-detail-section-v2">
                  <h3>Incident location</h3>
                  {linkedIncident ? (
                    <IncidentLocationCard
                      showTitle={false}
                      location={linkedLocationPreview?.preview}
                      loading={Boolean(linkedLocationPreview?.loading)}
                      error={linkedLocationPreview?.error || ''}
                      fallbackLabel={formatIncidentLocation(linkedIncident)}
                      coordinates={hasIncidentPin(linkedIncident) ? `${Number(linkedIncident.latitude).toFixed(5)}, ${Number(linkedIncident.longitude).toFixed(5)}` : null}
                    />
                  ) : <div className="reports-location-card-v2"><div><strong>Location not provided</strong></div></div>}
                </section>

                {(linkedIncident?.description || linkedIncident?.specifics) && <div className="reports-text-card-v2 assistance-linked-report-description">{linkedIncident.description || linkedIncident.specifics}</div>}

                <section className="reports-detail-section-v2 assistance-history-section">
                  <div className="reports-section-heading-v2"><h3>Request history</h3><span>{selectedHistory.length} requests</span></div>
                  {selectedHistory.length ? (
                    <div className="assistance-history-list">
                      {selectedHistory.map((request) => {
                        const hasDispatcherResponse = Boolean(request.decision || request.dispatcher_notes) || request.status !== 'pending';
                        const categoryTags = [
                          ...requestCategories(request),
                          request.beyond_barangay_capability ? 'Needs MDRRMO' : null,
                        ].filter((tag): tag is string => Boolean(tag));
                        return (
                          <article
                            className={`assistance-history-card assistance-review-selectable ${selected.id === request.id ? 'review-selected' : ''} ${effectiveExpandedRequestId === request.id ? '' : 'is-collapsed'}`}
                            key={request.id}
                          >
                            <header>
                              <button
                                type="button"
                                className="assistance-history-toggle"
                                aria-expanded={effectiveExpandedRequestId === request.id}
                                aria-controls={`mdrrmo-assistance-history-${request.id}`}
                                aria-label={`${effectiveExpandedRequestId === request.id ? 'Minimize' : 'Maximize'} assistance request from ${request.requested_by_user?.full_name || 'Responder'}`}
                                onClick={() => toggleRequestCard(request)}
                              >
                                <span className="assistance-history-title"><span className="assistance-history-sos">SOS</span><strong>Assistance Request</strong></span>
                                <span className={`assistance-status-chip ${request.status}`}>{hasDispatcherResponse ? coordinationLabel(request) : 'Pending'}</span>
                                <ChevronDown className={effectiveExpandedRequestId === request.id ? '' : 'collapsed'} size={17} aria-hidden="true" />
                              </button>
                            </header>
                            <div id={`mdrrmo-assistance-history-${request.id}`} hidden={effectiveExpandedRequestId !== request.id}>
                              <div className="assistance-history-entry">
                                <strong>From: {request.requested_by_user?.full_name || 'Responder'}</strong>
                                <div className="assistance-history-meta">
                                  <time>{dateTime(request.created_at)}</time>
                                </div>
                                {categoryTags.length > 0 && <div className="assistance-history-tags" aria-label="Requested assistance categories">{categoryTags.map((tag) => <span key={tag}>✓ {tag}</span>)}</div>}
                                <p>{request.explanation || request.details || 'No request details provided.'}</p>
                              </div>
                              {hasDispatcherResponse && (
                                <div className="assistance-history-entry dispatcher">
                                  <strong>From: Dispatcher</strong>
                                  <span className={`assistance-decision-badge ${request.decision === 'coordinate_mdrrmo' ? 'coordination' : request.decision === 'dismissed' || request.status === 'rejected' ? 'rejected' : 'provided'}`}>
                                    {coordinationLabel(request)}
                                  </span>
                                  {request.dispatcher_notes && <p>{request.dispatcher_notes}</p>}
                                  {request.decided_at && <time>{dateTime(request.decided_at)}</time>}
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : <div className="reports-no-media-v2">No request history is available for this incident.</div>}
                </section>
              </div>

              {(selected.status === 'pending' || (selected.status === 'approved' && selected.source !== 'mdrrmo')) && (
                <footer className="reports-detail-actions-v2 assistance-request-actions">
                  {selected.status === 'pending' ? <>
                    <label className="assistance-approval-note">
                      <span>Approval note <small>Required to approve · 3–300 characters</small></span>
                      <textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} maxLength={300} rows={2} placeholder="Add a brief note for the responder…" disabled={saving} />
                    </label>
                    <button type="button" className="reports-invalid-button-v2" disabled={saving} onClick={() => void updateStatus(selected, 'rejected')}>Reject</button>
                    <button type="button" className="reports-dispatch-button-v2" disabled={saving || approvalNote.trim().length < 3} onClick={() => void updateStatus(selected, 'approved')}>Approve request</button>
                  </> : (
                    <button type="button" className="reports-dispatch-button-v2" disabled={saving} onClick={() => void updateStatus(selected, 'fulfilled')}>Mark fulfilled</button>
                  )}
                </footer>
              )}
            </>
          )}
        </section>
      </section>
    </main>
  );
}
