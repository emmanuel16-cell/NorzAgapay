import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, FileText, RefreshCw, Siren } from 'lucide-react';
import { reportAPI } from '../lib/api';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';
import { buildIncidentTimeline } from '../lib/reportTimeline';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import EditAndResubmitReportForm from '../components/EditAndResubmitReportForm';

type ResidentReport = {
  id: string;
  title?: string | null;
  title?: string | null;
  description?: string | null;
  specifics?: string | null;
  incident_type?: string | null;
  severity?: string | null;
  type?: string | null;
  source_type?: string | null;
  send_to?: string | null;
  status?: string | null;
  assignment_status?: string | null;
  is_escalated?: boolean;
  response_status?: string | null;
  mdrrmo_response_status?: string | null;
  barangay_response_status?: string | null;
  barangay_name?: string | null;
  response_barangay_name?: string | null;
  response_barangay_id?: string | null;
  review_outcome?: string | null;
  review_reason?: string | null;
  reviewed_at?: string | null;
  resubmission_count?: number | null;
  resubmitted_at?: string | null;
  incident_occurred_at?: string | null;
  incident_time_precision?: 'exact' | 'approximate' | 'unknown' | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  address?: string | null;
  location_name?: string | null;
  proof_url?: string | null;
  proof_type?: string | null;
  proof_urls?: string[] | null;
  proof_types?: string[] | null;
  evidence_status?: string | null;
  dispatched_at?: string | null;
  accepted_at?: string | null;
  arrived_at?: string | null;
  resolved_at?: string | null;
  mdrrmo_dispatched_at?: string | null;
  mdrrmo_accepted_at?: string | null;
  mdrrmo_arrived_at?: string | null;
  mdrrmo_resolved_at?: string | null;
  barangay_assigned_at?: string | null;
  barangay_dispatched_at?: string | null;
  barangay_accepted_at?: string | null;
  barangay_arrived_at?: string | null;
  barangay_resolved_at?: string | null;
  barangay_escalated_at?: string | null;
  barangay_resolved_notes?: string | null;
  barangay_assignments?: Array<{
    id?: string;
    barangay_name?: string | null;
    assignment_status?: string | null;
    response_status?: string | null;
    assigned_at?: string | null;
    dispatched_at?: string | null;
    accepted_at?: string | null;
    arrived_at?: string | null;
    resolved_at?: string | null;
    resolved_notes?: string | null;
    escalated_at?: string | null;
    updated_at?: string | null;
  }>;
  barangay_assignment_events?: Array<{
    event_type?: string | null;
    from_barangay_name?: string | null;
    to_barangay_name?: string | null;
    notes?: string | null;
    created_at?: string | null;
  }>;
  created_at?: string | null;
};

type IncidentLocationPreview = {
  road?: string | null;
  landmark?: string | null;
  landmark_distance_meters?: number | null;
  nearest_response_barangay_name?: string | null;
};

function reportWasClosedAfterReview(report: ResidentReport) {
  return ['invalid', 'inconclusive', 'false_report'].includes(String(report.review_outcome || '').toLowerCase()) ||
    ['rejected', 'invalid', 'false_report'].includes(String(report.status || '').toLowerCase());
}

function reportStatus(report: ResidentReport) {
  const mdrrmoStatus = String(report.mdrrmo_response_status || (report.send_to !== 'barangay' ? report.response_status || report.status : 'pending')).toLowerCase();
  const barangayStatus = String(report.barangay_response_status || '').toLowerCase();
  const closedStatuses = ['resolved', 'closed', 'complete', 'completed'];
  if (report.review_outcome === 'inconclusive') return 'Marked inconclusive';
  if (report.review_outcome === 'false_report') return 'Marked false reporter';
  if (reportWasClosedAfterReview(report)) return 'Closed after review';
  if (closedStatuses.includes(mdrrmoStatus) || (!report.is_escalated && closedStatuses.includes(barangayStatus))) return 'Resolved';
  if (['responding', 'accepted', 'en_route', 'on_scene', 'arrived'].includes(mdrrmoStatus) || ['responding', 'accepted', 'en_route', 'on_scene', 'arrived'].includes(barangayStatus) || report.mdrrmo_dispatched_at || report.barangay_dispatched_at || (report.send_to !== 'barangay' && report.dispatched_at) || (report.send_to === 'barangay' && report.dispatched_at)) return 'Response in progress';
  if (report.assignment_status === 'active') return 'Assigned to barangay';
  if (closedStatuses.includes(String(report.status || '').toLowerCase())) return 'Resolved';
  return 'Received by MDRRMO';
}

function categoryLabel(report: ResidentReport) {
  return INCIDENT_TYPE_OPTIONS.find((item) => item.value === report.incident_type)?.label ||
    report.incident_type?.replaceAll('_', ' ') || 'Not sure';
}

function formatReportDate(value?: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function incidentTimeLabel(report: ResidentReport) {
  if (!report.incident_occurred_at || !['exact', 'approximate'].includes(String(report.incident_time_precision))) return 'Unknown';
  const formatted = formatReportDate(report.incident_occurred_at);
  return formatted === 'Date unavailable' ? 'Unknown' : `${formatted} · ${report.incident_time_precision === 'exact' ? 'Exact time' : 'Approximate time'}`;
}

function reportLocation(report: ResidentReport, preview?: IncidentLocationPreview | null) {
  const resolvedLocation = preview?.road?.trim() || preview?.landmark?.trim();
  if (resolvedLocation) return resolvedLocation;
  const specific = [report.location_name, report.address].map((value) => value?.trim())
    .find((value) => value && !/^(?:norzagaray(?:,?\s*bulacan)?|bulacan)$/i.test(value));
  if (specific) return specific;
  if (report.barangay_name?.trim()) return `Barangay ${report.barangay_name.replace(/^(?:barangay|brgy\.?)\s*/i, '').trim()}`;
  if (reportCoordinates(report)) return 'Pinned incident location';
  return 'Location not provided';
}

function reportCoordinates(report: ResidentReport) {
  if (report.latitude == null || report.longitude == null || String(report.latitude).trim() === '' || String(report.longitude).trim() === '') return null;
  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

function reportEvidence(report: ResidentReport) {
  const urls = [...(report.proof_urls || [])].filter(Boolean);
  if (urls.length === 0 && report.proof_url) urls.push(report.proof_url);
  return urls.map((url, index) => ({ url, type: report.proof_types?.[index] || (index === 0 ? report.proof_type : '') || '' }));
}

function isVideoEvidence(url: string, type: string) {
  return type.toLowerCase() === 'video' || /\.(mp4|mov|webm|3gp|mkv|avi)(?:\?|$)/i.test(url);
}

export default function ResidentReportsPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedReportId = searchParams.get('report');
  const focusedReportId = useRef('');
  const requestedLocationPreviewIds = useRef(new Set<string>());
  const componentMounted = useRef(false);
  const [reports, setReports] = useState<ResidentReport[]>([]);
  const [locationPreviews, setLocationPreviews] = useState<Record<string, IncidentLocationPreview | null>>({});
  const [locationPreviewLoadingIds, setLocationPreviewLoadingIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [editingReportId, setEditingReportId] = useState<string | null>(null);

  const loadReports = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await reportAPI.mine();
      setReports(Array.isArray(response.data) ? response.data : []);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || 'Your reports could not be loaded. Try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadReports(); }, [loadReports]);
  useRealtimeRefresh(loadReports, { events: ['incident_report:updated', 'incident_report:reviewed', 'incident:lifecycle'] });

  useEffect(() => {
    componentMounted.current = true;
    return () => { componentMounted.current = false; };
  }, []);

  useEffect(() => {
    reports.forEach((report) => {
      if (!reportCoordinates(report) || requestedLocationPreviewIds.current.has(report.id)) return;
      requestedLocationPreviewIds.current.add(report.id);
      setLocationPreviewLoadingIds((current) => new Set(current).add(report.id));
      void reportAPI.residentReportLocationPreview(report.id)
        .then((response) => {
          if (componentMounted.current) {
            setLocationPreviews((current) => ({ ...current, [report.id]: response.data || null }));
          }
        })
        .catch(() => {
          requestedLocationPreviewIds.current.delete(report.id);
        })
        .finally(() => {
          if (componentMounted.current) {
            setLocationPreviewLoadingIds((current) => {
              if (!current.has(report.id)) return current;
              const next = new Set(current);
              next.delete(report.id);
              return next;
            });
          }
        });
    });
  }, [reports]);

  useEffect(() => {
    if (!requestedReportId || focusedReportId.current === requestedReportId || loading || !reports.some((report) => report.id === requestedReportId)) return;
    focusedReportId.current = requestedReportId;
    document.getElementById(`resident-report-${requestedReportId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [loading, reports, requestedReportId]);

  const activeCount = reports.filter((report) => !['Resolved', 'Closed after review', 'Marked inconclusive', 'Marked false reporter'].includes(reportStatus(report))).length;
  const resolvedCount = reports.filter((report) => reportStatus(report) === 'Resolved').length;

  return (
    <div className="resident-workspace">
      <header className="resident-workspace-header">
        <div>
          <span className="workspace-eyebrow">RESIDENT PORTAL</span>
          <h1>Hello, {user?.full_name?.split(' ')[0] || 'there'}</h1>
          <p>Submit a report and follow updates from MDRRMO and the responding team.</p>
        </div>
        <Link className="workspace-primary-action" to="/resident-report"><Siren size={17} /> Report an incident</Link>
      </header>

      <section className="resident-summary-grid" aria-label="Report summary">
        <article><span>All reports</span><strong>{loading || error ? '—' : reports.length}</strong></article>
        <article><span>In progress</span><strong>{loading || error ? '—' : activeCount}</strong></article>
        <article><span>Resolved</span><strong>{loading || error ? '—' : resolvedCount}</strong></article>
      </section>

      <section className="resident-reports-panel">
        <header className="resident-reports-heading">
          <div><h2><FileText size={18} /> My reports</h2><p>Only reports submitted from your account are shown here.</p></div>
          <button type="button" onClick={() => void loadReports(true)} disabled={refreshing} aria-label="Refresh reports"><RefreshCw size={16} className={refreshing ? 'workspace-spinning' : ''} /> Refresh</button>
        </header>

        {error && <div className="workspace-message workspace-message-error" role="alert"><AlertCircle size={17} />{error}<button type="button" onClick={() => void loadReports()}>Try again</button></div>}
        {loading ? <p className="resident-reports-state">Loading your reports…</p> : reports.length === 0 && !error ? (
          <div className="resident-reports-empty"><Siren size={23} /><strong>No reports yet</strong><span>New emergency reports are received by MDRRMO for review and coordination.</span><Link to="/resident-report">Start a report</Link></div>
        ) : (
          <div className="resident-report-list">
            {reports.map((report) => {
              const status = reportStatus(report);
              const locationPreview = locationPreviews[report.id];
              const location = reportLocation(report, locationPreview);
              const locationPreviewLoading = locationPreviewLoadingIds.has(report.id);
              const coordinates = reportCoordinates(report);
              const evidence = reportEvidence(report);
              const details = report.title?.toLowerCase().startsWith('visual ')
                ? ''
                : report.description?.trim();
              return <article id={`resident-report-${report.id}`} className={`resident-report-card${report.id === requestedReportId ? ' is-focus-target' : ''}`} key={report.id}>
                <div className="resident-report-card-main">
                  <div className="resident-report-card-heading"><strong>{categoryLabel(report)}</strong><span className={`resident-status ${status === 'Resolved' ? 'resolved' : status === 'Response in progress' ? 'responding' : ''}`}>{status}</span></div>
                  {report.review_outcome && <section className="resident-review-notice" aria-label="MDRRMO report review">
                    <strong>{report.review_outcome === 'inconclusive' ? 'MDRRMO marked this report inconclusive' : 'MDRRMO marked this report False Reporter'}</strong>
                    {report.review_reason && <p>{report.review_reason}</p>}
                    <p>Update the report details and resubmit it for review.</p>
                    {editingReportId === report.id
                      ? <EditAndResubmitReportForm report={report} onCancel={() => setEditingReportId(null)} onSubmitted={() => { setEditingReportId(null); toast.success('Report resubmitted to MDRRMO.'); void loadReports(true); }} />
                      : <button type="button" className="workspace-primary-action" onClick={() => setEditingReportId(report.id)}>Edit and resubmit</button>}
                  </section>}
                  {details && <p>{details}</p>}
                  {!details && report.title?.toLowerCase().startsWith('visual ') && <p>Visual report submitted. See the captured evidence below.</p>}
                  {!details && !report.title?.toLowerCase().startsWith('visual ') && <p>No written incident details were provided.</p>}
                  {report.incident_type === 'other' && report.specifics?.trim() && <p className="resident-report-other-emergency"><strong>Other emergency:</strong> {report.specifics.replace(/^Other emergency:\s*/i, '')}</p>}
                  <dl className="resident-report-facts">
                    <div><dt>Incident occurred</dt><dd>{incidentTimeLabel(report)}</dd></div>
                    <div><dt>Incident location</dt><dd>{locationPreviewLoading ? 'Looking up the road and nearby places…' : location}{!locationPreviewLoading && locationPreview?.road && locationPreview.landmark ? ` · Near ${locationPreview.landmark}${locationPreview.landmark_distance_meters != null ? ` (${locationPreview.landmark_distance_meters} m)` : ''}` : ''}{!locationPreviewLoading && locationPreview?.nearest_response_barangay_name ? ` · Closest response barangay: ${locationPreview.nearest_response_barangay_name.replace(/^(?:barangay|brgy\.?)\s*/i, '')}` : ''}{coordinates && <> · <a href={`https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`} target="_blank" rel="noreferrer">Open map</a></>}</dd></div>
                  </dl>
                  <div className="resident-report-meta"><span><FileText size={14} /> Received {formatReportDate(report.created_at)}</span></div>
                  <section className="resident-report-evidence" aria-label="Photo or video evidence"><strong>Photo or video evidence</strong>{evidence.length ? <div>{evidence.map((item, index) => isVideoEvidence(item.url, item.type)
                    ? <video key={`${item.url}-${index}`} src={item.url} controls playsInline preload="metadata" aria-label={`Incident video ${index + 1}`} />
                    : <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer" aria-label={`Open incident photo ${index + 1}`}><img src={item.url} alt={`Incident photo ${index + 1}`} loading="lazy" /></a>)}</div> : <p>{report.evidence_status === 'pending' ? 'Evidence is still uploading and will appear here when ready.' : report.evidence_status === 'failed' ? 'Photo or video evidence could not be attached to this report.' : 'No photo or video evidence was attached to this report.'}</p>}</section>
                  <details className="resident-report-timeline" open={report.id === requestedReportId}>
                    <summary>Track report history</summary>
                    <ol>
                      {buildIncidentTimeline(report).map((event, index) => <li key={`${event.label}-${event.at || index}`}>
                        <span className="resident-timeline-marker" aria-hidden="true" />
                        <div><strong>{event.label}</strong><time>{formatReportDate(event.at)}</time>{event.detail && <p>{event.detail}</p>}</div>
                      </li>)}
                    </ol>
                  </details>
                </div>
              </article>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
