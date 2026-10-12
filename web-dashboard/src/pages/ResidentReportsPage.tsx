import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, FileText, MapPin, RefreshCw, Siren } from 'lucide-react';
import { reportAPI } from '../lib/api';
import { INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';
import { useAuth } from '../context/AuthContext';

type ResidentReport = {
  id: string;
  title?: string | null;
  description?: string | null;
  incident_type?: string | null;
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

type ReportTimelineEvent = { label: string; at: string | null; detail?: string | null };

function reportTimeline(report: ResidentReport): ReportTimelineEvent[] {
  const events: ReportTimelineEvent[] = [
    { label: 'Report received by MDRRMO', at: report.created_at || null },
  ];
  if (report.review_outcome) {
    events.push({
      label: report.review_outcome === 'invalid' ? 'Report closed after review' : 'Report reviewed',
      at: report.reviewed_at || null,
      detail: report.review_reason || null,
    });
  }

  const mdrrmoDispatchedAt = report.mdrrmo_dispatched_at ||
    (report.send_to !== 'barangay' ? report.dispatched_at : null);
  const mdrrmoAcceptedAt = report.mdrrmo_accepted_at ||
    (report.send_to !== 'barangay' ? report.accepted_at : null);
  const mdrrmoArrivedAt = report.mdrrmo_arrived_at ||
    (report.send_to !== 'barangay' ? report.arrived_at : null);
  const mdrrmoResolvedAt = report.mdrrmo_resolved_at ||
    (report.send_to !== 'barangay' ? report.resolved_at : null);
  if (mdrrmoDispatchedAt || mdrrmoAcceptedAt) {
    events.push({
      label: 'MDRRMO response dispatched and accepted automatically',
      at: mdrrmoDispatchedAt || mdrrmoAcceptedAt || null,
    });
  }
  if (mdrrmoArrivedAt) events.push({ label: 'MDRRMO responders arrived', at: mdrrmoArrivedAt });
  if (mdrrmoResolvedAt && report.mdrrmo_response_status === 'resolved') {
    events.push({ label: 'MDRRMO response resolved', at: mdrrmoResolvedAt });
  }

  const assignmentEvents = report.barangay_assignment_events || [];
  if (assignmentEvents.length > 0) {
    for (const event of assignmentEvents) {
      const from = event.from_barangay_name;
      const to = event.to_barangay_name;
      const destination = to ? ` · ${to}` : '';
      const label = event.event_type === 'assigned' ? `Assigned to a barangay${destination}`
        : event.event_type === 'reassigned' ? `Reassigned${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`
          : event.event_type === 'recalled' ? `Barangay assignment recalled${from ? ` · ${from}` : ''}`
            : event.event_type === 'dispatched' ? `Barangay responders dispatched and accepted automatically${destination}`
              : event.event_type === 'responding' ? `Barangay response underway${destination}`
                : event.event_type === 'arrived' ? `Barangay responders arrived${destination}`
                  : event.event_type === 'resolved' ? `Resolved by barangay${destination}`
                    : event.event_type === 'escalated' ? `Escalated to MDRRMO${from ? ` · ${from}` : ''}`
                      : null;
      if (label) events.push({ label, at: event.created_at || null, detail: event.notes || null });
    }
  } else if ((report.barangay_assignments || []).length > 0) {
    const assignments = report.barangay_assignments || [];
    for (const assignment of assignments) {
      const destination = assignment.barangay_name ? ` · ${assignment.barangay_name}` : '';
      if (assignment.assigned_at) events.push({ label: `Assigned to a barangay${destination}`, at: assignment.assigned_at });
      if (assignment.dispatched_at || assignment.accepted_at) {
        events.push({
          label: `Barangay responders dispatched and accepted automatically${destination}`,
          at: assignment.dispatched_at || assignment.accepted_at || null,
        });
      }
      if (assignment.arrived_at) events.push({ label: `Barangay responders arrived${destination}`, at: assignment.arrived_at });
      if (assignment.escalated_at) events.push({ label: `Escalated to MDRRMO${destination}`, at: assignment.escalated_at });
      if (assignment.resolved_at) events.push({
        label: `Resolved by barangay${destination}`,
        at: assignment.resolved_at,
        detail: assignment.resolved_notes || null,
      });
    }
  } else {
    const destination = report.response_barangay_name || report.barangay_name;
    const legacyBarangayDispatch = report.send_to === 'barangay' ? report.dispatched_at : null;
    if (report.barangay_assigned_at) events.push({ label: `Assigned to a barangay${destination ? ` · ${destination}` : ''}`, at: report.barangay_assigned_at });
    if (report.barangay_dispatched_at || report.barangay_accepted_at || legacyBarangayDispatch) {
      events.push({
        label: `Barangay responders dispatched and accepted automatically${destination ? ` · ${destination}` : ''}`,
        at: report.barangay_dispatched_at || report.barangay_accepted_at || legacyBarangayDispatch || null,
      });
    }
    if (report.barangay_arrived_at) events.push({ label: `Barangay responders arrived${destination ? ` · ${destination}` : ''}`, at: report.barangay_arrived_at });
    if (report.barangay_escalated_at) events.push({ label: 'Escalated to MDRRMO', at: report.barangay_escalated_at });
    if (report.barangay_resolved_at) events.push({ label: 'Resolved by barangay', at: report.barangay_resolved_at, detail: report.barangay_resolved_notes || null });
  }

  return events
    .map((event, index) => ({ ...event, index, timestamp: event.at ? new Date(event.at).getTime() : Number.NaN }))
    .sort((a, b) => {
      if (!Number.isFinite(a.timestamp)) return Number.isFinite(b.timestamp) ? 1 : a.index - b.index;
      if (!Number.isFinite(b.timestamp)) return -1;
      return a.timestamp - b.timestamp || a.index - b.index;
    });
}

function reportStatus(report: ResidentReport) {
  const mdrrmoStatus = String(report.mdrrmo_response_status || (report.send_to !== 'barangay' ? report.response_status || report.status : 'pending')).toLowerCase();
  const barangayStatus = String(report.barangay_response_status || '').toLowerCase();
  const closedStatuses = ['resolved', 'closed', 'complete', 'completed'];
  if (report.review_outcome === 'invalid' || ['rejected', 'invalid', 'false_report'].includes(String(report.status || '').toLowerCase())) return 'Closed after review';
  if (closedStatuses.includes(mdrrmoStatus) || (!report.is_escalated && closedStatuses.includes(barangayStatus))) return 'Resolved';
  if (['responding', 'accepted', 'en_route', 'on_scene', 'arrived'].includes(mdrrmoStatus) || ['responding', 'accepted', 'en_route', 'on_scene', 'arrived'].includes(barangayStatus)) return 'Response in progress';
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

export default function ResidentReportsPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<ResidentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

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

  const activeCount = reports.filter((report) => !['Resolved', 'Closed after review'].includes(reportStatus(report))).length;
  const resolvedCount = reports.length - activeCount;

  return (
    <div className="resident-workspace">
      <header className="resident-workspace-header">
        <div>
          <span className="workspace-eyebrow">RESIDENT PORTAL</span>
          <h1>Hello, {user?.full_name?.split(' ')[0] || 'there'}</h1>
          <p>Submit a report and follow updates from MDRRMO and the responding team.</p>
        </div>
        <Link className="workspace-primary-action" to="/report"><Siren size={17} /> Report an incident</Link>
      </header>

      <section className="resident-summary-grid" aria-label="Report summary">
        <article><span>All reports</span><strong>{reports.length}</strong></article>
        <article><span>In progress</span><strong>{activeCount}</strong></article>
        <article><span>Resolved</span><strong>{resolvedCount}</strong></article>
      </section>

      <section className="resident-reports-panel">
        <header className="resident-reports-heading">
          <div><h2><FileText size={18} /> My reports</h2><p>Only reports submitted from your account are shown here.</p></div>
          <button type="button" onClick={() => void loadReports(true)} disabled={refreshing} aria-label="Refresh reports"><RefreshCw size={16} className={refreshing ? 'workspace-spinning' : ''} /> Refresh</button>
        </header>

        {error && <div className="workspace-message workspace-message-error" role="alert"><AlertCircle size={17} />{error}<button type="button" onClick={() => void loadReports()}>Try again</button></div>}
        {loading ? <p className="resident-reports-state">Loading your reports…</p> : reports.length === 0 && !error ? (
          <div className="resident-reports-empty"><Siren size={23} /><strong>No reports yet</strong><span>New emergency reports are received by MDRRMO for review and coordination.</span><Link to="/report">Start a report</Link></div>
        ) : (
          <div className="resident-report-list">
            {reports.map((report) => {
              const status = reportStatus(report);
              return <article className="resident-report-card" key={report.id}>
                <div className="resident-report-card-main">
                  <div className="resident-report-card-heading"><strong>{categoryLabel(report)}</strong><span className={`resident-status ${status === 'Resolved' ? 'resolved' : status === 'Response in progress' ? 'responding' : ''}`}>{status}</span></div>
                  <p>{report.description?.trim() || report.title || 'No incident details were provided.'}</p>
                  <div className="resident-report-meta"><span><FileText size={14} /> {formatReportDate(report.created_at)}</span><span><MapPin size={14} /> {report.response_barangay_name || report.barangay_name || 'Norzagaray'}</span></div>
                  <details className="resident-report-timeline">
                    <summary>Track report history</summary>
                    <ol>
                      {reportTimeline(report).map((event, index) => <li key={`${event.label}-${event.at || index}`}>
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
