import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ExternalLink, FileText, MapPin, Search } from 'lucide-react';
import PublicHeader from '../components/PublicHeader';
import { reportAPI } from '../lib/api';
import { INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';
import MobileNumberInput from '../components/MobileNumberInput';
import { isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';

type TrackedReport = {
  id: string;
  title?: string | null;
  description?: string | null;
  specifics?: string | null;
  incident_type?: string | null;
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
  const events: TimelineItem[] = [{
    label: 'Report received by MDRRMO',
    at: report.created_at,
    detail: 'MDRRMO received the report for review.',
  }];
  if (report.review_outcome) events.push({
    label: report.review_outcome === 'invalid' ? 'Report closed after review' : 'Report reviewed',
    at: null,
    detail: report.review_reason || (report.review_outcome === 'invalid'
      ? 'MDRRMO closed the report after review.'
      : 'MDRRMO reviewed the report.'),
  });

  const hasBarangayDestination = report.send_to === 'barangay';
  const dispatched = report.mdrrmo_dispatched_at || (!hasBarangayDestination ? report.dispatched_at : null);
  const accepted = report.mdrrmo_accepted_at || (!hasBarangayDestination ? report.accepted_at : null);
  const arrived = report.mdrrmo_arrived_at || (!hasBarangayDestination ? report.arrived_at : null);
  const resolved = report.mdrrmo_resolved_at || (!hasBarangayDestination ? report.resolved_at : null);
  if (dispatched || accepted) events.push({
    label: 'MDRRMO responders dispatched',
    at: dispatched || accepted,
    detail: 'MDRRMO sent a response team to the incident.',
  });
  if (arrived) events.push({
    label: 'MDRRMO responders arrived',
    at: arrived,
    detail: 'The response team confirmed arrival at the incident location.',
  });
  if (resolved && !hasBarangayDestination && [report.mdrrmo_response_status, report.response_status, report.status].some((value) => String(value || '').toLowerCase() === 'resolved')) {
    events.push({ label: 'MDRRMO response completed', at: resolved, detail: 'MDRRMO marked its response complete.' });
  }

  if (report.barangay_assignment_events?.length) {
    report.barangay_assignment_events.forEach((event) => {
      const from = event.from_barangay_name;
      const to = event.to_barangay_name;
      const destination = to ? ` · ${to}` : '';
      const label = event.event_type === 'assigned' ? (to ? `Assigned to ${to}` : 'Assigned to a barangay response team')
        : event.event_type === 'reassigned' ? `Reassigned${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`
          : event.event_type === 'recalled' ? `Barangay assignment recalled${from ? ` · ${from}` : ''}`
            : event.event_type === 'dispatched' ? `Barangay responders dispatched${destination}`
              : event.event_type === 'responding' ? `Barangay response in progress${destination}`
                : event.event_type === 'arrived' ? `Barangay responders arrived${destination}`
                  : event.event_type === 'resolved' ? `Barangay response completed${destination}`
                    : event.event_type === 'escalated' ? `Escalated to MDRRMO${from ? ` · ${from}` : ''}`
                      : null;
      const detail = event.notes || (event.event_type === 'dispatched'
        ? 'The barangay response team was sent to the incident.'
        : event.event_type === 'responding'
          ? 'The barangay team is responding to the incident.'
          : event.event_type === 'arrived'
            ? 'The barangay team confirmed arrival at the incident location.'
            : event.event_type === 'resolved'
              ? 'The barangay team marked its response complete.'
              : null);
      if (label) events.push({ label, at: event.created_at, detail });
    });
  } else if (report.barangay_assignments?.length) {
    report.barangay_assignments.forEach((assignment) => {
      const destination = assignment.barangay_name ? ` · ${assignment.barangay_name}` : '';
      if (assignment.assigned_at) events.push({ label: `Assigned to a barangay${destination}`, at: assignment.assigned_at });
      if (assignment.dispatched_at || assignment.accepted_at) events.push({
        label: `Barangay responders dispatched${destination}`,
        at: assignment.dispatched_at || assignment.accepted_at,
        detail: 'The barangay response team was sent to the incident.',
      });
      if (assignment.arrived_at) events.push({ label: `Barangay responders arrived${destination}`, at: assignment.arrived_at, detail: 'The barangay team confirmed arrival at the incident location.' });
      if (assignment.escalated_at) events.push({ label: `Escalated to MDRRMO${destination}`, at: assignment.escalated_at });
      if (assignment.resolved_at) events.push({ label: `Barangay response completed${destination}`, at: assignment.resolved_at, detail: assignment.resolved_notes || 'The barangay team marked its response complete.' });
    });
  } else {
    const destination = report.response_barangay_name || report.barangay_name;
    if (report.barangay_assigned_at) events.push({ label: `Assigned to a barangay${destination ? ` · ${destination}` : ''}`, at: report.barangay_assigned_at });
    const barangayDispatched = report.barangay_dispatched_at || (hasBarangayDestination ? report.dispatched_at : null);
    if (barangayDispatched || report.barangay_accepted_at) events.push({
      label: `Barangay responders dispatched${destination ? ` · ${destination}` : ''}`,
      at: barangayDispatched || report.barangay_accepted_at,
      detail: 'The barangay response team was sent to the incident.',
    });
    if (report.barangay_arrived_at) events.push({ label: `Barangay responders arrived${destination ? ` · ${destination}` : ''}`, at: report.barangay_arrived_at, detail: 'The barangay team confirmed arrival at the incident location.' });
    if (report.barangay_escalated_at) events.push({ label: 'Escalated to MDRRMO', at: report.barangay_escalated_at });
    if (report.barangay_resolved_at) events.push({ label: 'Barangay response completed', at: report.barangay_resolved_at, detail: report.barangay_resolved_notes || 'The barangay team marked its response complete.' });
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

function incidentTimeLabel(report: TrackedReport) {
  const precision = report.incident_time_precision;
  if (!report.incident_occurred_at || (precision !== 'exact' && precision !== 'approximate')) return 'Unknown';
  const formatted = dateLabel(report.incident_occurred_at);
  if (formatted === 'Time unavailable') return 'Unknown';
  return `${formatted} · ${precision === 'exact' ? 'Exact time' : 'Approximate time'}`;
}

function incidentLocation(report: TrackedReport) {
  const specific = [report.location_name, report.address]
    .map((value) => value?.trim())
    .find((value) => value && !/^(?:norzagaray(?:,?\s*bulacan)?|bulacan)$/i.test(value));
  if (specific) return specific;
  if (report.barangay_name?.trim()) return `Barangay ${report.barangay_name.replace(/^(?:barangay|brgy\.?)\s*/i, '').trim()}`;
  return coordinatesFor(report) ? 'Pinned incident location' : 'Location not provided';
}

function coordinatesFor(report: TrackedReport) {
  if (report.latitude == null || report.longitude == null ||
      String(report.latitude).trim() === '' || String(report.longitude).trim() === '') return null;
  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

function evidenceFor(report: TrackedReport) {
  const urls = report.proof_urls?.filter(Boolean) || [];
  if (urls.length === 0 && report.proof_url) urls.push(report.proof_url);
  return urls.map((url, index) => ({
    url,
    type: report.proof_types?.[index] || (index === 0 ? report.proof_type : null) || '',
  }));
}

function isVideoEvidence(url: string, type: string) {
  return type.toLowerCase() === 'video' || /\.(mp4|mov|webm|3gp|mkv|avi)(?:\?|$)/i.test(url);
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
    setError('');
    if (!isValidMobileNumber(phone)) { setError('Enter exactly 11 digits starting with 09.'); return; }
    setLoading(true);
    setReport(null);
    try {
      const response = await reportAPI.trackGuestReport(reference.trim(), normalizeMobileNumberInput(phone));
      setReport(response.data);
    } catch (trackError: any) {
      setError(trackError?.response?.status === 404
        ? 'We could not find a report matching that reference and mobile number.'
        : trackError?.response?.data?.error || 'The report status could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const categoryLabel = INCIDENT_TYPE_OPTIONS.find((item) => item.value === report?.incident_type)?.label || report?.incident_type || 'Not provided';
  const reportEvidence = report ? evidenceFor(report) : [];
  const coordinates = report ? coordinatesFor(report) : null;
  const details = report?.title?.toLowerCase().startsWith('visual ')
    ? ''
    : report?.description?.trim();
  const location = report ? incidentLocation(report) : '';

  return <div className="public-report-page">
    <PublicHeader showActions={false} />
    <main className="public-report-layout public-track-layout">
      <div className="public-report-intro">
        <div className="public-track-intro-row">
          <span className="public-home-eyebrow">PUBLIC REPORT TRACKING</span>
          <Link className="public-track-back" to="/report"><ArrowLeft size={16} aria-hidden="true" /> Back to reporting</Link>
        </div>
        <h1>Follow your report.</h1>
        <p>Enter the report reference and the mobile number used when submitting it.</p>
      </div>
      <section className="public-intake-panel public-track-panel" aria-labelledby="track-report-title">
        <div className="public-intake-heading"><span><Search size={19} /></span><div><h2 id="track-report-title">Track a guest report</h2><p>Only the matching reference and mobile number can open a guest report.</p></div></div>
        <form className="public-report-form" onSubmit={(event) => void trackReport(event)}>
          <label htmlFor="tracking-reference">Report reference <b>Required</b></label>
          <input id="tracking-reference" autoComplete="off" value={reference} onChange={(event) => setReference(event.target.value)} required />
          <label htmlFor="tracking-phone">Mobile number <b>Required</b></label>
          <MobileNumberInput id="tracking-phone" value={phone} onValueChange={setPhone} placeholder="09XXXXXXXXX" required />
          {error && <p className="public-report-error" role="alert"><AlertCircle size={15} /> {error}</p>}
          <button className="btn btn-primary btn-lg public-report-submit" type="submit" disabled={loading}>{loading ? 'Loading report…' : 'View report status'}</button>
        </form>
        {report && <article className="public-tracked-report" aria-live="polite">
          <header><div><span className="public-home-eyebrow">REPORT STATUS</span><h2>{statusLabel(report)}</h2></div><span className={`resident-status ${statusLabel(report) === 'Resolved' ? 'resolved' : statusLabel(report) === 'Response in progress' ? 'responding' : ''}`}>{statusLabel(report)}</span></header>
          <div className="public-tracked-facts" aria-label="Incident information">
            <div className="public-tracked-fact"><span>Incident category</span><strong>{categoryLabel}</strong>{report.incident_type === 'other' && report.specifics?.trim() && <small>{report.specifics.replace(/^Other emergency:\s*/i, '')}</small>}</div>
            <div className="public-tracked-fact"><span>Incident occurred</span><strong>{incidentTimeLabel(report)}</strong></div>
            <div className="public-tracked-fact public-tracked-location">
              <span>Incident location</span>
              <strong>{location}</strong>
              {report.barangay_name && location !== `Barangay ${report.barangay_name.replace(/^(?:barangay|brgy\.?)\s*/i, '').trim()}` &&
                <small>Barangay {report.barangay_name.replace(/^(?:barangay|brgy\.?)\s*/i, '').trim()}</small>}
              {coordinates && <>
                <a href={`https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`} target="_blank" rel="noreferrer">
                  <MapPin size={14} aria-hidden="true" /> Open incident location in map <ExternalLink size={13} aria-hidden="true" />
                </a>
                <small>Coordinates: {coordinates.latitude.toFixed(5)}, {coordinates.longitude.toFixed(5)}</small>
              </>}
            </div>
            {details && <div className="public-tracked-fact public-tracked-details"><span>Incident details</span><p>{details}</p></div>}
          </div>
          <div className="resident-report-meta"><span><FileText size={14} /> Report received {dateLabel(report.created_at)}</span></div>
          <section className="public-tracked-evidence" aria-labelledby="tracked-evidence-title">
            <h3 id="tracked-evidence-title">Photo or video evidence</h3>
            {reportEvidence.length ? <div className="public-tracked-evidence-grid">{reportEvidence.map((item, index) => isVideoEvidence(item.url, item.type)
              ? <video key={`${item.url}-${index}`} src={item.url} controls playsInline preload="metadata" aria-label={`Incident video evidence ${index + 1}`} />
              : <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer" aria-label={`Open incident photo evidence ${index + 1}`}><img src={item.url} alt={`Incident photo evidence ${index + 1}`} loading="lazy" /></a>)}</div>
              : <p>No photo or video evidence was attached to this report.</p>}
          </section>
          <h3 className="public-tracked-timeline-title">Response timeline</h3>
          <p className="public-tracked-timeline-intro">Clear updates on when the report was received and how responders handled it.</p>
          <ol className="resident-report-timeline public-tracked-timeline">
            {timelineFor(report).map((event, index) => <li key={`${event.label}-${event.at || index}`}><span className="resident-timeline-marker" aria-hidden="true" /><div><strong>{event.label}</strong>{event.at && <time>{dateLabel(event.at)}</time>}{event.detail && <p>{event.detail}</p>}</div></li>)}
          </ol>
        </article>}
      </section>
    </main>
  </div>;
}
