import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, FileText, MapPin, Search } from 'lucide-react';
import PublicHeader from '../components/PublicHeader';
import { reportAPI } from '../lib/api';
import { INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';

type TrackedReport = {
  id: string;
  title?: string | null;
  description?: string | null;
  incident_type?: string | null;
  send_to?: string | null;
  status?: string | null;
  assignment_status?: string | null;
  is_escalated?: boolean;
  response_status?: string | null;
  review_outcome?: string | null;
  review_reason?: string | null;
  created_at?: string | null;
  mdrrmo_response_status?: string | null;
  barangay_response_status?: string | null;
  mdrrmo_dispatched_at?: string | null;
  mdrrmo_accepted_at?: string | null;
  mdrrmo_arrived_at?: string | null;
  mdrrmo_resolved_at?: string | null;
  dispatched_at?: string | null;
  accepted_at?: string | null;
  arrived_at?: string | null;
  resolved_at?: string | null;
  barangay_assignments?: Array<{
    barangay_name?: string | null;
    assigned_at?: string | null;
    dispatched_at?: string | null;
    accepted_at?: string | null;
    arrived_at?: string | null;
    resolved_at?: string | null;
    escalated_at?: string | null;
    resolved_notes?: string | null;
  }>;
  barangay_assignment_events?: Array<{
    event_type?: string | null;
    from_barangay_name?: string | null;
    to_barangay_name?: string | null;
    notes?: string | null;
    created_at?: string | null;
  }>;
  barangay_name?: string | null;
  response_barangay_name?: string | null;
  barangay_assigned_at?: string | null;
  barangay_dispatched_at?: string | null;
  barangay_accepted_at?: string | null;
  barangay_arrived_at?: string | null;
  barangay_resolved_at?: string | null;
  barangay_escalated_at?: string | null;
  barangay_resolved_notes?: string | null;
};

type TimelineItem = { label: string; at?: string | null; detail?: string | null };

function timelineFor(report: TrackedReport): TimelineItem[] {
  const events: TimelineItem[] = [{ label: 'Report received by MDRRMO', at: report.created_at }];
  if (report.review_outcome) events.push({
    label: report.review_outcome === 'invalid' ? 'Report closed after review' : 'Report reviewed',
    at: null,
    detail: report.review_reason,
  });

  const hasBarangayDestination = report.send_to === 'barangay';
  const dispatched = report.mdrrmo_dispatched_at || (!hasBarangayDestination ? report.dispatched_at : null);
  const accepted = report.mdrrmo_accepted_at || (!hasBarangayDestination ? report.accepted_at : null);
  const arrived = report.mdrrmo_arrived_at || (!hasBarangayDestination ? report.arrived_at : null);
  const resolved = report.mdrrmo_resolved_at || (!hasBarangayDestination ? report.resolved_at : null);
  if (dispatched || accepted) events.push({ label: 'MDRRMO response dispatched and accepted automatically', at: dispatched || accepted });
  if (arrived) events.push({ label: 'MDRRMO responders arrived', at: arrived });
  if (resolved && !hasBarangayDestination && [report.mdrrmo_response_status, report.response_status, report.status].some((value) => String(value || '').toLowerCase() === 'resolved')) {
    events.push({ label: 'MDRRMO response resolved', at: resolved });
  }

  if (report.barangay_assignment_events?.length) {
    report.barangay_assignment_events.forEach((event) => {
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
      if (label) events.push({ label, at: event.created_at, detail: event.notes });
    });
  } else if (report.barangay_assignments?.length) {
    report.barangay_assignments.forEach((assignment) => {
      const destination = assignment.barangay_name ? ` · ${assignment.barangay_name}` : '';
      if (assignment.assigned_at) events.push({ label: `Assigned to a barangay${destination}`, at: assignment.assigned_at });
      if (assignment.dispatched_at || assignment.accepted_at) events.push({
        label: `Barangay responders dispatched and accepted automatically${destination}`,
        at: assignment.dispatched_at || assignment.accepted_at,
      });
      if (assignment.arrived_at) events.push({ label: `Barangay responders arrived${destination}`, at: assignment.arrived_at });
      if (assignment.escalated_at) events.push({ label: `Escalated to MDRRMO${destination}`, at: assignment.escalated_at });
      if (assignment.resolved_at) events.push({ label: `Resolved by barangay${destination}`, at: assignment.resolved_at, detail: assignment.resolved_notes });
    });
  } else {
    const destination = report.response_barangay_name || report.barangay_name;
    if (report.barangay_assigned_at) events.push({ label: `Assigned to a barangay${destination ? ` · ${destination}` : ''}`, at: report.barangay_assigned_at });
    const barangayDispatched = report.barangay_dispatched_at || (hasBarangayDestination ? report.dispatched_at : null);
    if (barangayDispatched || report.barangay_accepted_at) events.push({
      label: `Barangay responders dispatched and accepted automatically${destination ? ` · ${destination}` : ''}`,
      at: barangayDispatched || report.barangay_accepted_at,
    });
    if (report.barangay_arrived_at) events.push({ label: `Barangay responders arrived${destination ? ` · ${destination}` : ''}`, at: report.barangay_arrived_at });
    if (report.barangay_escalated_at) events.push({ label: 'Escalated to MDRRMO', at: report.barangay_escalated_at });
    if (report.barangay_resolved_at) events.push({ label: 'Resolved by barangay', at: report.barangay_resolved_at, detail: report.barangay_resolved_notes });
  }

  return events.map((event, index) => ({ event, index, time: event.at ? Date.parse(event.at) : Number.NaN }))
    .sort((a, b) => Number.isFinite(a.time) && Number.isFinite(b.time) ? a.time - b.time || a.index - b.index : Number.isFinite(a.time) ? -1 : Number.isFinite(b.time) ? 1 : a.index - b.index)
    .map(({ event }) => event);
}

function dateLabel(value?: string | null) {
  if (!value) return 'Time pending';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusLabel(report: TrackedReport) {
  const mdrrmoStatus = String(report.mdrrmo_response_status || (report.send_to !== 'barangay' ? report.response_status || report.status : 'pending')).toLowerCase();
  const barangayStatus = String(report.barangay_response_status || '').toLowerCase();
  const resolvedStatuses = ['resolved', 'closed', 'complete', 'completed'];
  if (report.review_outcome === 'invalid' || ['invalid', 'rejected', 'false_report'].includes(String(report.status || '').toLowerCase())) return 'Closed after review';
  if (resolvedStatuses.includes(mdrrmoStatus) || (!report.is_escalated && resolvedStatuses.includes(barangayStatus))) return 'Resolved';
  if (['responding', 'accepted', 'en_route', 'on_scene', 'arrived'].includes(mdrrmoStatus) || ['responding', 'accepted', 'en_route', 'on_scene', 'arrived'].includes(barangayStatus) || report.barangay_dispatched_at || report.mdrrmo_dispatched_at) return 'Response in progress';
  if (report.assignment_status === 'active') return 'Assigned to barangay';
  if (resolvedStatuses.includes(String(report.status || '').toLowerCase())) return 'Resolved';
  return 'Received by MDRRMO';
}

export default function TrackReportPage() {
  const [searchParams] = useSearchParams();
  const [reference, setReference] = useState(searchParams.get('reference') || '');
  const [phone, setPhone] = useState('');
  const [report, setReport] = useState<TrackedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const trackReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const response = await reportAPI.trackGuestReport(reference.trim(), phone.replace(/\D/g, ''));
      setReport(response.data);
    } catch (trackError: any) {
      setError(trackError?.response?.status === 404
        ? 'We could not find a report matching that reference and mobile number.'
        : trackError?.response?.data?.error || 'The report status could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return <div className="public-report-page">
    <PublicHeader />
    <main className="public-report-layout public-track-layout">
      <div className="public-report-intro">
        <span className="public-home-eyebrow">PUBLIC REPORT TRACKING</span>
        <h1>Follow your report.</h1>
        <p>Enter the report reference and the mobile number used when submitting it.</p>
      </div>
      <section className="public-intake-panel public-track-panel" aria-labelledby="track-report-title">
        <div className="public-intake-heading"><span><Search size={19} /></span><div><h2 id="track-report-title">Track a guest report</h2><p>Only the matching reference and mobile number can open a guest report.</p></div></div>
        <form className="public-report-form" onSubmit={(event) => void trackReport(event)}>
          <label htmlFor="tracking-reference">Report reference <b>Required</b></label>
          <input id="tracking-reference" autoComplete="off" value={reference} onChange={(event) => setReference(event.target.value)} required />
          <label htmlFor="tracking-phone">Mobile number <b>Required</b></label>
          <input id="tracking-phone" type="tel" inputMode="numeric" autoComplete="tel" pattern="09[0-9]{9}" maxLength={11} placeholder="09XXXXXXXXX" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} required />
          {error && <p className="public-report-error" role="alert"><AlertCircle size={15} /> {error}</p>}
          <button className="btn btn-primary btn-lg public-report-submit" type="submit" disabled={loading}>{loading ? 'Loading report…' : 'View report status'}</button>
        </form>
        {report && <article className="public-tracked-report" aria-live="polite">
          <header><div><span className="public-home-eyebrow">{INCIDENT_TYPE_OPTIONS.find((item) => item.value === report.incident_type)?.label || 'Incident report'}</span><h2>{statusLabel(report)}</h2></div><span className={`resident-status ${statusLabel(report) === 'Resolved' ? 'resolved' : statusLabel(report) === 'Response in progress' ? 'responding' : ''}`}>{statusLabel(report)}</span></header>
          <p>{report.description?.trim() || report.title || 'No incident details were provided.'}</p>
          <div className="resident-report-meta"><span><FileText size={14} /> Received {dateLabel(report.created_at)}</span><span><MapPin size={14} /> {report.response_barangay_name || report.barangay_name || 'Norzagaray'}</span></div>
          <ol className="resident-report-timeline public-tracked-timeline">
            {timelineFor(report).map((event, index) => <li key={`${event.label}-${event.at || index}`}><span className="resident-timeline-marker" aria-hidden="true" /><div><strong>{event.label}</strong><time>{dateLabel(event.at)}</time>{event.detail && <p>{event.detail}</p>}</div></li>)}
          </ol>
        </article>}
      </section>
    </main>
  </div>;
}
