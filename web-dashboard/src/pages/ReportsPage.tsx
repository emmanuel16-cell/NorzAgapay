import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { AlertTriangle, CheckCircle2, Image as ImageIcon, MapPin, Paperclip, Phone, Send, UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { reportAPI, socket } from '../lib/api';
import { INCIDENT_SEVERITY_OPTIONS, INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';

type ReportGroup = 'resident' | 'escalated';
type ReportStage = 'pending' | 'responding' | 'resolved';
type Assignment = { responder_id: string; status: string; assigned_at?: string; accepted_at?: string; arrived_at?: string; resolved_at?: string; responder?: { full_name?: string; phone?: string } | null };
type FieldAssessment = { situation: string; people: string; actions: string; risks: string };

interface IncidentReport {
  id: string; type: string; title?: string; specifics?: string; description?: string; status: string;
  send_to?: string; is_escalated?: boolean; beyond_barangay_capability?: boolean; mdrrmo_response_status?: string;
  severity?: string; incident_type?: string; latitude?: number | string | null; longitude?: number | string | null;
  address?: string | null; location_name?: string | null; barangay_name?: string | null;
  proof_url?: string | null; proof_type?: string | null; proof_urls?: string[]; proof_types?: string[];
  responder_media?: Array<{ url: string; type?: string; uploader_name?: string; role?: string; uploader_role?: string; created_at?: string }>;
  reporter_type?: string; reporter_name?: string | null; reporter_phone?: string | null;
  barangay_responder_name?: string | null; barangay_response_notes?: string | null; mdrrmo_coordination_notes?: string | null;
  mdrrmo_response_notes?: string | null; mdrrmo_dispatch_notes?: string | null; mdrrmo_responder_name?: string | null;
  resolved_notes?: string | null; created_at: string; dispatcher_reviewed_at?: string | null;
  incident_occurred_at?: string | null; incident_time_precision?: 'exact' | 'approximate' | 'unknown' | null;
  dispatched_at?: string | null; accepted_at?: string | null; arrived_at?: string | null;
  arrival_recorded_at?: string | null; resolved_at?: string | null; mdrrmo_assignments?: Assignment[];
  reporter?: { id: string; full_name: string; role: string } | null;
}
type ResponderOption = { id: string; full_name: string; phone?: string | null; unit_type?: string | null };

const isVideo = (url?: string | null, type?: string | null) => type === 'video' || Boolean(url && /\.(mp4|mov|webm|3gp|mkv|avi)(\?.*)?$/i.test(url));
const getStage = (report: IncidentReport): ReportStage => {
  const status = String(report.status || '').toLowerCase();
  const response = String(report.mdrrmo_response_status || '').toLowerCase();
  if (['resolved', 'closed'].includes(status) || ['resolved', 'closed'].includes(response)) return 'resolved';
  if (status === 'responding' || response === 'responding') return 'responding';
  return 'pending';
};
const getGroup = (report: IncidentReport): ReportGroup => {
  const barangayNotes = String(report.barangay_response_notes || '').toLowerCase();
  return report.is_escalated || report.beyond_barangay_capability ||
    String(report.status || '').toLowerCase() === 'escalated' ||
    Boolean(report.mdrrmo_coordination_notes?.trim()) || barangayNotes.includes('escalated') ? 'escalated' : 'resident';
};
const getProofs = (report: IncidentReport) => report.proof_urls?.length ? report.proof_urls : report.proof_url ? [report.proof_url] : [];
const timeAgo = (value?: string | null, fallback = 'Time unavailable') => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : formatDistanceToNowStrict(date, { addSuffix: true });
};
const dateTime = (value?: string | null) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : format(date, 'MMM d, yyyy · h:mm a');
};
const incidentTimeLabel = (report: IncidentReport) => {
  if (!report.incident_occurred_at || !['exact', 'approximate'].includes(report.incident_time_precision || '')) {
    return 'Incident time unknown';
  }
  return `Incident occurred: ${dateTime(report.incident_occurred_at)} (${report.incident_time_precision})`;
};
const hasPin = (report: IncidentReport) => report.latitude != null && report.longitude != null && Number.isFinite(Number(report.latitude)) && Number.isFinite(Number(report.longitude));
const parseAssessment = (notes?: string | null): FieldAssessment => {
  const text = String(notes || '').replace(/\[RESPONDER_MEDIA:[\s\S]*?\]/gi, '').trim();
  const marker = text.match(/\[(?:MDRRMO )?FIELD ASSESSMENT\]/i);
  const body = marker?.index !== undefined ? text.slice(marker.index + marker[0].length) : text;
  const fields: Record<string, string> = {};
  body.split(/\r?\n/).forEach((line) => { const i = line.indexOf(':'); if (i >= 0) fields[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); });
  return {
    situation: fields.situation || '',
    people: fields['people affected / urgency'] || fields['people affected'] || '',
    actions: fields['actions taken'] || fields['action taken'] || '',
    risks: fields['risks / resources'] || fields['risk / resource'] || '',
  };
};

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentTime, setCurrentTime] = useState(() => new Date().toLocaleTimeString());
  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [group, setGroup] = useState<ReportGroup>('resident');
  const [stage, setStage] = useState<ReportStage>('pending');
  const [loading, setLoading] = useState(true);
  const [dispatchReport, setDispatchReport] = useState<IncidentReport | null>(null);
  const [incidentType, setIncidentType] = useState('');
  const [severity, setSeverity] = useState('');
  const [responders, setResponders] = useState<ResponderOption[]>([]);
  const [responderIds, setResponderIds] = useState<string[]>([]);
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [loadingResponders, setLoadingResponders] = useState(false);
  const [responderError, setResponderError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ url: string; video: boolean } | null>(null);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const response = await reportAPI.mdrrmoQueue();
      setReports(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch reports', error);
      toast.error('Failed to load incident reports');
    } finally { setLoading(false); }
  };
  useEffect(() => { void fetchReports(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const handleUpdate = (updated: IncidentReport) => {
      if (!updated?.id) return;
      setReports((current) => current.some((item) => item.id === updated.id)
        ? current.map((item) => item.id === updated.id ? { ...item, ...updated } : item)
        : [...current, updated]);
    };
    socket.on('incident_report:updated', handleUpdate);
    const handleLifecycle = () => { void fetchReports(); };
    socket.on('connect', handleLifecycle);
    socket.on('incident:lifecycle', handleLifecycle);
    socket.on('incident_report:new', handleLifecycle);
    return () => {
      socket.off('connect', handleLifecycle);
      socket.off('incident_report:updated', handleUpdate);
      socket.off('incident:lifecycle', handleLifecycle);
      socket.off('incident_report:new', handleLifecycle);
    };
  }, []);
  useEffect(() => {
    const id = searchParams.get('id');
    if (!id || !reports.length) return;
    const target = reports.find((item) => item.id === id);
    if (target) { setSelectedId(target.id); setGroup(getGroup(target)); setStage(getStage(target)); }
  }, [searchParams, reports]);

  const inGroup = useMemo(() => reports.filter((item) => getGroup(item) === group), [reports, group]);
  const counts = useMemo(() => ({
    pending: inGroup.filter((item) => getStage(item) === 'pending').length,
    responding: inGroup.filter((item) => getStage(item) === 'responding').length,
    resolved: inGroup.filter((item) => getStage(item) === 'resolved').length,
  }), [inGroup]);
  const visible = useMemo(() => inGroup.filter((item) => getStage(item) === stage), [inGroup, stage]);
  const selected = visible.find((item) => item.id === selectedId) || visible[0] || null;

  const clearLink = () => {
    if (!searchParams.has('id') && !searchParams.has('status')) return;
    const next = new URLSearchParams(searchParams); next.delete('id'); next.delete('status');
    setSearchParams(next, { replace: true });
  };
  const selectGroup = (value: ReportGroup) => { setGroup(value); setSelectedId(null); clearLink(); };
  const selectStage = (value: ReportStage) => { setStage(value); setSelectedId(null); clearLink(); };
  const selectReport = (report: IncidentReport) => {
    setSelectedId(report.id);
    setSearchParams({ id: report.id, status: getStage(report) }, { replace: true });
  };

  const openDispatch = async (report: IncidentReport) => {
    setIncidentType(report.incident_type || '');
    setSeverity(report.severity || '');
    setDispatchNotes(report.mdrrmo_dispatch_notes || '');
    setResponderIds((report.mdrrmo_assignments || []).filter((item) => item.status !== 'removed').map((item) => item.responder_id));
    setResponderError(''); setDispatchReport(report);
    try {
      setLoadingResponders(true);
      const response = await reportAPI.mdrrmoResponders();
      const available: ResponderOption[] = response.data.responders || [];
      setResponders(available);
      setResponderIds((current) => current.filter((id) => available.some((item) => item.id === id)));
    } catch (error) {
      console.error('Could not load responders', error);
      setResponderError('Could not load active MDRRMO responders.'); setResponders([]);
    } finally { setLoadingResponders(false); }
  };
  const submitDispatch = async () => {
    if (!dispatchReport || !incidentType || !severity || !responderIds.length) {
      toast.error('Choose an incident category, priority, and at least one active responder'); return;
    }
    try {
      setSaving(true);
      await reportAPI.dispatchToMdrrmo(dispatchReport.id, { incident_type: incidentType, severity, responder_ids: responderIds, notes: dispatchNotes.trim() });
      toast.success('Incident classified and assigned to MDRRMO responders.');
      setDispatchReport(null); setStage('pending'); await fetchReports();
    } catch (error) {
      console.error('Dispatch failed', error); toast.error('Failed to dispatch report to MDRRMO responders');
    } finally { setSaving(false); }
  };
  const markInvalid = async (report: IncidentReport) => {
    if (!window.confirm('Mark this report as invalid? This decision will be recorded for the report.')) return;
    try {
      await reportAPI.review(report.id, { outcome: 'false_report', reason: '' });
      toast.success('Report marked invalid.');
      setReports((current) => current.filter((item) => item.id !== report.id)); setSelectedId(null);
    } catch (error) { console.error('Invalid-report review failed', error); toast.error('Could not mark this report invalid'); }
  };

  const residentCount = reports.filter((item) => getGroup(item) === 'resident').length;
  const escalatedCount = reports.filter((item) => getGroup(item) === 'escalated').length;
  const assessment = parseAssessment(selected?.mdrrmo_response_notes || selected?.barangay_response_notes);
  const assignment = selected?.mdrrmo_assignments?.find((item) => item.status !== 'removed');
  const reporterName = selected?.reporter_name || selected?.reporter?.full_name || 'Resident';
  const locationName = selected?.location_name || selected?.address || selected?.barangay_name || 'Norzagaray, Bulacan';
  const locationNote = selected?.address && selected.address !== locationName ? selected.address : selected && hasPin(selected) ? 'Location pin received from the resident' : 'Location not provided';
  const proofs = selected ? getProofs(selected) : [];
  const fieldMedia = selected?.responder_media || [];
  const category = INCIDENT_TYPE_OPTIONS.find((item) => item.value === selected?.incident_type)?.label || selected?.incident_type?.replaceAll('_', ' ');
  const priority = INCIDENT_SEVERITY_OPTIONS.find((item) => item.value === selected?.severity)?.label || selected?.severity;

  return (
    <main className="reports-workspace-v2">
      <header className="reports-page-header-v2">
        <div><h1>Incidents Reports</h1><span>Dispatcher workspace</span></div>
        <div className="reports-live-indicator"><i /> Live <span>·</span> {currentTime}</div>
      </header>
      <nav className="reports-group-tabs-v2" aria-label="Report type">
        <button type="button" className={group === 'resident' ? 'active' : ''} onClick={() => selectGroup('resident')}>Resident Reports <span>{residentCount}</span></button>
        <button type="button" className={group === 'escalated' ? 'active' : ''} onClick={() => selectGroup('escalated')}>Escalate Reports <span>{escalatedCount}</span></button>
      </nav>
      <nav className="reports-stage-tabs-v2" aria-label="Report status">
        {([['pending', 'Pending'], ['responding', 'Responding'], ['resolved', 'Resolved']] as Array<[ReportStage, string]>).map(([value, label]) => (
          <button key={value} type="button" className={'stage-' + value + (stage === value ? ' active' : '')} onClick={() => selectStage(value)}>{label} <span>{counts[value]}</span></button>
        ))}
      </nav>

      <section className="reports-split-view-v2">
        <aside className="reports-queue-v2">
          <div className="reports-queue-heading"><h2>{stage === 'pending' ? 'Pending queue' : stage === 'responding' ? 'Responding reports' : 'Resolved reports'}</h2><span>{visible.length}</span></div>
          {loading ? <div className="reports-empty-v2"><span className="spinner" /><p>Loading reports…</p></div>
            : visible.length === 0 ? <div className="reports-empty-v2"><AlertTriangle size={22} /><strong>No {stage} reports</strong><p>Reports in this queue will appear here.</p></div>
              : <div className="reports-queue-list-v2">{visible.map((report) => {
                const reportProofs = getProofs(report);
                const active = selected?.id === report.id;
                return <button key={report.id} type="button" className={'reports-queue-item-v2 ' + stage + (active ? ' selected' : '')} onClick={() => selectReport(report)}>
                  <span className="reports-queue-item-top"><strong>{report.description?.trim() || 'No report details provided.'}</strong><span className={'report-status-chip-v2 ' + stage}>{stage === 'responding' ? 'Responding' : stage === 'resolved' ? 'Resolved' : 'Pending'}</span></span>
                  <span className="reports-queue-time">Report received {timeAgo(report.created_at)}</span>
                  <span className="reports-queue-time">{incidentTimeLabel(report)}</span>
                  <span className="reports-queue-meta"><span><MapPin size={14} /> {report.barangay_name || 'Location not provided'}</span><span><Paperclip size={13} /> {reportProofs.length} attachment{reportProofs.length === 1 ? '' : 's'}</span></span>
                  {stage !== 'pending' && (report.incident_type || report.severity) && <span className="reports-classification-tags">
                    {report.incident_type && <small>{INCIDENT_TYPE_OPTIONS.find((item) => item.value === report.incident_type)?.label || report.incident_type.replaceAll('_', ' ')}</small>}
                    {report.severity && <small className="priority">{INCIDENT_SEVERITY_OPTIONS.find((item) => item.value === report.severity)?.label || report.severity} priority</small>}
                  </span>}
                </button>;
              })}</div>}
        </aside>

        <section className="reports-detail-v2">
          {!selected ? <div className="reports-detail-empty-v2"><div><ImageIcon size={28} /></div><strong>Select a report</strong><p>Choose an item from the {stage} queue to see its details.</p></div> : <>
            <div className="reports-detail-scroll-v2">
              <header className="reports-detail-heading-v2">
                <div><span className="reports-eyebrow-v2">Selected report</span><h2>Report details</h2><p>{stage === 'pending' ? 'Report received ' : stage === 'responding' ? 'Accepted ' : 'Resolved '}{timeAgo(stage === 'resolved' ? selected.resolved_at : stage === 'responding' ? selected.accepted_at || selected.dispatched_at : selected.created_at)} · {selected.barangay_name || 'Norzagaray'}</p></div>
                <span className={'report-status-chip-v2 detail ' + stage}>{stage === 'responding' ? 'Responding' : stage === 'resolved' ? 'Resolved' : 'Pending'}</span>
              </header>

              <section className="reports-detail-section-v2"><h3>Reporter details</h3><div className="reports-info-grid-v2">
                <div className="reports-info-card-v2"><span>Resident</span><strong><UserRound size={17} /> {reporterName}</strong></div>
                <div className="reports-info-card-v2"><span>Contact number</span><strong><Phone size={17} /> {selected.reporter_phone || 'Not provided'}</strong></div>
              </div></section>

              <section className="reports-detail-section-v2"><h3>Resident’s report</h3><div className="reports-text-card-v2">{selected.description?.trim() || 'No details provided.'}</div></section>

              <section className="reports-detail-section-v2"><h3>Incident time</h3><div className="reports-info-grid-v2">
                <div className="reports-info-card-v2"><span>Incident occurred</span><strong>{incidentTimeLabel(selected)}</strong></div>
                <div className="reports-info-card-v2"><span>Report received</span><strong>{dateTime(selected.created_at)}</strong></div>
              </div></section>

              {stage !== 'pending' && (category || priority) && <section className="reports-detail-section-v2"><h3>Incident classification</h3><div className="reports-info-grid-v2">
                <div className="reports-info-card-v2"><span>Incident category</span><strong>{category || 'Not classified'}</strong></div>
                <div className="reports-info-card-v2"><span>Priority</span><strong>{priority || 'Not classified'}</strong></div>
              </div></section>}

              <section className="reports-detail-section-v2"><h3>Reported location</h3><div className="reports-location-card-v2"><MapPin size={20} /><div><strong>{locationName}</strong><span>{locationNote}</span></div>{hasPin(selected) && <small>Map pin available</small>}</div></section>

              {stage === 'pending' ? <section className="reports-detail-section-v2">
                <div className="reports-section-heading-v2"><h3>Proof of incident</h3><span>{proofs.length} attachment{proofs.length === 1 ? '' : 's'}</span></div>
                {proofs.length ? <div className="reports-media-grid-v2 proof">{proofs.map((url, index) => {
                  const video = isVideo(url, selected.proof_types?.[index] || selected.proof_type);
                  return <button type="button" key={url + index} onClick={() => setPreview({ url, video })} aria-label={'Open proof attachment ' + (index + 1)}>
                    {video ? <span className="reports-video-thumb">▶ Video</span> : <img src={url} alt={'Incident proof ' + (index + 1)} />}
                    <span>{video ? 'Video' : 'Photo'} {String(index + 1).padStart(2, '0')}</span>
                  </button>;
                })}</div> : <div className="reports-no-media-v2">No proof attached to this report.</div>}
              </section> : <>
                {getGroup(selected) === 'escalated' && (selected.mdrrmo_coordination_notes || selected.barangay_response_notes) && <section className="reports-detail-section-v2"><h3>Escalation notes</h3><div className="reports-text-card-v2">{selected.mdrrmo_coordination_notes || selected.barangay_response_notes}</div></section>}
                <section className="reports-detail-section-v2"><h3>Responder and response timeline</h3><div className="reports-timeline-grid-v2">
                  <div className="reports-assignee-card-v2"><strong>{assignment?.responder?.full_name || selected.mdrrmo_responder_name || 'Assigned responder'}</strong><span>MDRRMO response unit</span><em>{stage === 'resolved' ? 'Resolved' : assignment?.status === 'responding' ? 'Accepted' : 'Assigned'}</em></div>
                  <div className="reports-timeline-card-v2">{([
                    ['Report received', selected.created_at],
                    ['Dispatched to MDRRMO', selected.dispatched_at],
                    ['Accepted by responder', selected.accepted_at || assignment?.accepted_at],
                    ['Arrived at incident area', selected.arrived_at || assignment?.arrived_at],
                    ['Incident resolved', selected.resolved_at || assignment?.resolved_at],
                  ] as Array<[string, string | null | undefined]>).filter(([, value]) => Boolean(value)).map(([label, value]) => <div key={label}><CheckCircle2 size={14} /><span>{label}</span><time title={dateTime(value)}>{timeAgo(value)}</time></div>)}</div>
                </div></section>
                <section className="reports-detail-section-v2"><h3>Field assessment</h3><div className="reports-assessment-grid-v2">{([
                  ['Situation', assessment.situation], ['People affected / urgency', assessment.people], ['Actions taken', assessment.actions], ['Risks / resources', assessment.risks],
                ] as Array<[string, string]>).map(([label, value]) => <div key={label}><strong>{label}</strong><p>{value || 'Not submitted yet'}</p></div>)}</div></section>
                <section className="reports-detail-section-v2">
                  <div className="reports-section-heading-v2"><h3>Field photos / videos</h3><span>{fieldMedia.length} attachment{fieldMedia.length === 1 ? '' : 's'}</span></div>
                  {fieldMedia.length ? <div className="reports-media-grid-v2 field">{fieldMedia.map((item, index) => {
                    const video = isVideo(item.url, item.type);
                    return <button type="button" key={item.url + index} onClick={() => setPreview({ url: item.url, video })} aria-label={'Open field attachment ' + (index + 1)}>{video ? <span className="reports-video-thumb">▶ Video</span> : <img src={item.url} alt={'Responder field evidence ' + (index + 1)} />}</button>;
                  })}</div> : <div className="reports-no-media-v2">No responder field media submitted yet.</div>}
                </section>
                {stage === 'resolved' && <section className="reports-resolve-notes-v2"><strong>Resolve notes</strong><p>{selected.resolved_notes?.trim() || 'No resolve notes provided.'}</p></section>}
              </>}
            </div>
            {stage === 'pending' && <footer className="reports-detail-actions-v2">
              <button type="button" className="reports-invalid-button-v2" onClick={() => void markInvalid(selected)}>Mark invalid</button>
              <button type="button" className="reports-dispatch-button-v2" onClick={() => void openDispatch(selected)} disabled={saving}><Send size={17} /> {selected.dispatched_at ? 'Update dispatch' : 'Dispatch to MDRRMO'}</button>
            </footer>}
          </>}
        </section>
      </section>

      {dispatchReport && <div className="reports-modal-backdrop-v2" onClick={() => setDispatchReport(null)}>
        <section className="reports-dispatch-modal-v2" role="dialog" aria-modal="true" aria-labelledby="dispatch-title-v2" onClick={(event) => event.stopPropagation()}>
          <header><div><span className="reports-eyebrow-v2">Dispatcher review</span><h2 id="dispatch-title-v2">{dispatchReport.dispatched_at ? 'Update dispatch' : 'Classify and dispatch'}</h2></div><button type="button" aria-label="Close" onClick={() => setDispatchReport(null)}><X size={19} /></button></header>
          <div className="reports-modal-report-v2">{dispatchReport.description?.trim() || 'No details provided.'}</div>
          {getProofs(dispatchReport).length > 0 && <div className="reports-modal-proof-links-v2"><strong>Submitted evidence</strong>{getProofs(dispatchReport).map((url, index) => <a key={url + index} href={url} target="_blank" rel="noreferrer">Open attachment {index + 1}</a>)}</div>}
          <label htmlFor="report-category-v2">Incident category</label><select id="report-category-v2" value={incidentType} onChange={(event) => setIncidentType(event.target.value)}><option value="">Select incident category</option>{INCIDENT_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <label htmlFor="report-priority-v2">Priority</label><select id="report-priority-v2" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">Select priority</option>{INCIDENT_SEVERITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <label htmlFor="report-dispatch-notes-v2">Dispatcher notes <span>(optional)</span></label><textarea id="report-dispatch-notes-v2" rows={3} maxLength={1000} value={dispatchNotes} onChange={(event) => setDispatchNotes(event.target.value)} placeholder="Add instructions or response details…" />
          <div className="reports-responder-list-heading-v2"><strong>Active MDRRMO responders</strong>{responders.length > 0 && <button type="button" onClick={() => setResponderIds(responderIds.length === responders.length ? [] : responders.map((item) => item.id))}>{responderIds.length === responders.length ? 'Deselect all' : 'Select all'}</button>}</div>
          <div className="reports-responder-list-v2">{loadingResponders ? <p>Loading active responders…</p> : responderError ? <p className="error">{responderError}</p> : responders.length === 0 ? <p>No active MDRRMO responders are available.</p> : responders.map((item) => <label key={item.id}><input type="checkbox" checked={responderIds.includes(item.id)} onChange={(event) => setResponderIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span><strong>{item.full_name}</strong><small>{[item.unit_type, item.phone].filter(Boolean).join(' · ') || 'MDRRMO responder'}</small></span></label>)}</div>
          <footer><button type="button" className="reports-invalid-button-v2" onClick={() => setDispatchReport(null)}>Cancel</button><button type="button" className="reports-dispatch-button-v2" disabled={saving || loadingResponders || !incidentType || !severity || responderIds.length === 0} onClick={() => void submitDispatch()}>{saving ? 'Saving dispatch…' : 'Send responders'}</button></footer>
        </section>
      </div>}

      {preview && <div className="reports-media-preview-v2" role="dialog" aria-modal="true" aria-label="Attachment preview" onClick={() => setPreview(null)}>
        <button type="button" aria-label="Close preview" onClick={() => setPreview(null)}><X size={22} /></button>
        {preview.video ? <video src={preview.url} controls autoPlay onClick={(event) => event.stopPropagation()} /> : <img src={preview.url} alt="Report attachment preview" onClick={(event) => event.stopPropagation()} />}
      </div>}
    </main>
  );
}
