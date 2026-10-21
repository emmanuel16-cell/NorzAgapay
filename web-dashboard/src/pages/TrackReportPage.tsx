import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ExternalLink, FileText, HandHelping, MapPin, Search, Send, X } from 'lucide-react';
import PublicHeader from '../components/PublicHeader';
import CameraEvidenceCapture from '../components/CameraEvidenceCapture';
import { reportAPI, socket } from '../lib/api';
import { INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';
import { buildIncidentTimeline } from '../lib/reportTimeline';
import MobileNumberInput from '../components/MobileNumberInput';
import { isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';
import { useRealtimeConnection } from '../hooks/useRealtimeRefresh';
import EditAndResubmitReportForm from '../components/EditAndResubmitReportForm';

type TrackedReport = {
  id: string;
  title?: string | null;
  description?: string | null;
  specifics?: string | null;
  incident_type?: string | null;
  severity?: string | null;
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
  send_to?: string | null;
  status?: string | null;
  assignment_status?: string | null;
  is_escalated?: boolean;
  response_status?: string | null;
  review_outcome?: string | null;
  review_reason?: string | null;
  reviewed_at?: string | null;
  resubmission_count?: number | null;
  resubmitted_at?: string | null;
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
    assignment_status?: string | null;
    response_status?: string | null;
    barangay_name?: string | null;
    assigned_at?: string | null;
    dispatched_at?: string | null;
    accepted_at?: string | null;
    arrived_at?: string | null;
    resolved_at?: string | null;
    escalated_at?: string | null;
    resolved_notes?: string | null;
    updated_at?: string | null;
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

type IncidentLocationPreview = {
  road?: string | null;
  landmark?: string | null;
  landmark_distance_meters?: number | null;
  nearest_response_barangay_name?: string | null;
};

function reportWasClosedAfterReview(report: TrackedReport) {
  return ['invalid', 'inconclusive', 'false_report'].includes(String(report.review_outcome || '').toLowerCase()) ||
    ['invalid', 'rejected', 'false_report'].includes(String(report.status || '').toLowerCase());
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

function incidentLocation(report: TrackedReport, preview?: IncidentLocationPreview | null) {
  const resolvedLocation = preview?.road?.trim() || preview?.landmark?.trim();
  if (resolvedLocation) return resolvedLocation;
  const specific = [report.location_name, report.address]
    .map((value) => value?.trim())
    .find((value) => value && !/^(?:norzagaray(?:,?\s*bulacan)?|bulacan)$/i.test(value));
  if (specific) return specific;
  if (report.barangay_name?.trim()) return `Barangay ${report.barangay_name.replace(/^(?:barangay|brgy\.?)\s*/i, '').trim()}`;
  return coordinatesFor(report) ? 'Pinned incident location' : 'Location not provided';
}

function coordinatesFor(report: Pick<TrackedReport, 'latitude' | 'longitude'>) {
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
  if (report.review_outcome === 'inconclusive') return 'Marked inconclusive';
  if (report.review_outcome === 'false_report') return 'Marked false reporter';
  if (reportWasClosedAfterReview(report)) return 'Closed after review';
  if (resolvedStatuses.includes(mdrrmoStatus) || (!report.is_escalated && resolvedStatuses.includes(barangayStatus))) return 'Resolved';
  if (['responding', 'accepted', 'en_route', 'on_scene', 'arrived'].includes(mdrrmoStatus) || ['responding', 'accepted', 'en_route', 'on_scene', 'arrived'].includes(barangayStatus) || report.barangay_dispatched_at || report.mdrrmo_dispatched_at) return 'Response in progress';
  if (report.assignment_status === 'active') return 'Assigned to barangay';
  if (resolvedStatuses.includes(String(report.status || '').toLowerCase())) return 'Resolved';
  return 'Received by MDRRMO';
}

function responderHasArrived(report: TrackedReport) {
  const statuses = [report.mdrrmo_response_status, report.barangay_response_status, report.response_status, report.assignment_status]
    .map((value) => String(value || '').toLowerCase());
  return Boolean(report.arrived_at || report.mdrrmo_arrived_at || report.barangay_arrived_at ||
    report.barangay_assignments?.some((assignment) => assignment.arrived_at || ['arrived', 'on_scene', 'resolved'].includes(String(assignment.assignment_status || '').toLowerCase()) || ['arrived', 'on_scene', 'resolved'].includes(String(assignment.response_status || '').toLowerCase())) ||
    statuses.some((status) => ['arrived', 'on_scene', 'resolved', 'closed', 'completed'].includes(status)));
}

function followUpIsClosed(report: TrackedReport) {
  return responderHasArrived(report) || reportWasClosedAfterReview(report) ||
    ['Resolved', 'Closed after review'].includes(statusLabel(report));
}

export default function TrackReportPage() {
  const liveConnected = useRealtimeConnection();
  const [searchParams] = useSearchParams();
  const routeLocation = useLocation();
  const navigate = useNavigate();
  const routeTracking = (routeLocation.state as { guestTracking?: { reference?: string; phone?: string } } | null)?.guestTracking;
  const autoTrackingHandled = useRef(false);
  const [reference, setReference] = useState(routeTracking?.reference || searchParams.get('reference') || '');
  const [phone, setPhone] = useState(routeTracking?.phone || '');
  const [report, setReport] = useState<TrackedReport | null>(null);
  const [trackingCredentials, setTrackingCredentials] = useState<{ reference: string; phone: string } | null>(null);
  const [locationPreview, setLocationPreview] = useState<IncidentLocationPreview | null>(null);
  const [locationPreviewLoading, setLocationPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpFiles, setFollowUpFiles] = useState<File[]>([]);
  const followUpFilesRef = useRef<File[]>([]);
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false);
  const [followUpError, setFollowUpError] = useState('');
  const [followUpSuccess, setFollowUpSuccess] = useState('');
  const [editingResubmission, setEditingResubmission] = useState(false);
  const [resubmissionSuccess, setResubmissionSuccess] = useState('');

  const loadGuestReport = useCallback(async (reportReference: string, reportPhone: string) => {
    setError('');
    setTrackingCredentials(null);
    setReport(null);
    setFollowUpOpen(false);
    followUpFilesRef.current = [];
    setFollowUpFiles([]);
    setFollowUpError('');
    setFollowUpSuccess('');
    if (!reportReference.trim()) { setError('Enter the report reference.'); return; }
    if (!isValidMobileNumber(reportPhone)) { setError('Enter exactly 11 digits starting with 09.'); return; }
    setLoading(true);
    try {
      const credentials = { reference: reportReference.trim(), phone: normalizeMobileNumberInput(reportPhone) };
      const response = await reportAPI.trackGuestReport(credentials.reference, credentials.phone);
      setReport(response.data);
      setTrackingCredentials(credentials);
    } catch (trackError: any) {
      setError(trackError?.response?.status === 404
        ? 'We could not find a report matching that reference and mobile number.'
        : trackError?.response?.data?.error || 'The report status could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const trackReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadGuestReport(reference, phone);
  };

  const submitFollowUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!report || !trackingCredentials) return;
    if (followUpIsClosed(report)) {
      setFollowUpOpen(false);
      setFollowUpError('Follow-up requests are unavailable after a responder arrives.');
      return;
    }
    setFollowUpSubmitting(true);
    setFollowUpError('');
    setFollowUpSuccess('');
    try {
      const response = await reportAPI.submitReportFollowUp(report.id, trackingCredentials.phone, followUpFilesRef.current);
      const updatedReport = response.data?.report || response.data;
      setReport((current) => current ? {
        ...current,
        proof_url: updatedReport?.proof_url ?? current.proof_url,
        proof_type: updatedReport?.proof_type ?? current.proof_type,
        proof_urls: updatedReport?.proof_urls ?? current.proof_urls,
        proof_types: updatedReport?.proof_types ?? current.proof_types,
      } : current);
      followUpFilesRef.current = [];
      setFollowUpFiles([]);
      setFollowUpOpen(false);
      setFollowUpSuccess('Follow-up request sent to dispatch.');
    } catch (submitError: any) {
      setFollowUpError(submitError?.response?.data?.error || 'The follow-up request could not be sent. Please try again.');
      if (submitError?.response?.status === 409) {
        try {
          const latest = await reportAPI.trackGuestReport(trackingCredentials.reference, trackingCredentials.phone);
          setReport(latest.data);
          setFollowUpOpen(false);
        } catch { /* Keep the current report visible if the refresh fails. */ }
      }
    } finally {
      setFollowUpSubmitting(false);
    }
  };

  useEffect(() => {
    const tracking = (routeLocation.state as { guestTracking?: { reference?: string; phone?: string } } | null)?.guestTracking;
    if (!tracking?.reference || !tracking.phone || autoTrackingHandled.current) return;
    autoTrackingHandled.current = true;
    setReference(tracking.reference);
    setPhone(tracking.phone);
    void loadGuestReport(tracking.reference, tracking.phone);
    navigate(`${routeLocation.pathname}${routeLocation.search}`, { replace: true, state: null });
  }, [loadGuestReport, navigate, routeLocation.pathname, routeLocation.search, routeLocation.state]);

  const trackedReportId = report?.id;
  useEffect(() => {
    if (!trackedReportId || !trackingCredentials) return;
    let active = true;
    const refreshTrackedReport = async () => {
      try {
        const response = await reportAPI.trackGuestReport(trackingCredentials.reference, trackingCredentials.phone);
        if (active && response.data?.id === trackedReportId) setReport(response.data);
      } catch {
        // Keep the last successful report visible if the API is temporarily unavailable.
      }
    };
    const subscribe = () => {
      socket.emit('guest-report:subscribe', { reportId: trackedReportId, phone: trackingCredentials.phone });
      void refreshTrackedReport();
    };
    const onReportUpdate = (event: { reportId?: string }) => {
      if (event?.reportId === trackedReportId) void refreshTrackedReport();
    };
    const onSubscribed = (event: { reportId?: string }) => {
      if (event?.reportId === trackedReportId) void refreshTrackedReport();
    };
    socket.on('connect', subscribe);
    socket.on('guest-report:updated', onReportUpdate);
    socket.on('guest-report:subscribed', onSubscribed);
    if (socket.connected) subscribe();
    return () => {
      active = false;
      socket.off('connect', subscribe);
      socket.off('guest-report:updated', onReportUpdate);
      socket.off('guest-report:subscribed', onSubscribed);
      socket.emit('guest-report:unsubscribe');
    };
  }, [trackedReportId, trackingCredentials]);

  const trackedLatitude = report?.latitude;
  const trackedLongitude = report?.longitude;
  useEffect(() => {
    const reportCoordinates = coordinatesFor({ latitude: trackedLatitude, longitude: trackedLongitude });
    if (!trackedReportId || !trackingCredentials || !reportCoordinates) {
      setLocationPreview(null);
      setLocationPreviewLoading(false);
      return;
    }

    let active = true;
    setLocationPreview(null);
    setLocationPreviewLoading(true);
    reportAPI.residentReportLocationPreview(trackedReportId, trackingCredentials.phone)
      .then((response) => {
        if (active) setLocationPreview(response.data || null);
      })
      .catch(() => {
        if (active) setLocationPreview(null);
      })
      .finally(() => {
        if (active) setLocationPreviewLoading(false);
      });

    return () => { active = false; };
  }, [trackedReportId, trackedLatitude, trackedLongitude, trackingCredentials]);

  const categoryLabel = INCIDENT_TYPE_OPTIONS.find((item) => item.value === report?.incident_type)?.label || report?.incident_type || 'Not provided';
  const reportEvidence = report ? evidenceFor(report) : [];
  const canSendFollowUp = Boolean(report && trackingCredentials && !followUpIsClosed(report));
  const canResubmit = Boolean(report && trackingCredentials && ['inconclusive', 'false_report'].includes(String(report.review_outcome || '')));
  const coordinates = report ? coordinatesFor(report) : null;
  const details = report?.title?.toLowerCase().startsWith('visual ')
    ? ''
    : report?.description?.trim();
  const location = report ? incidentLocation(report, locationPreview) : '';

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
          {report.review_outcome && <section className="public-report-review-notice" aria-label="MDRRMO report review">
            <strong>{report.review_outcome === 'inconclusive' ? 'MDRRMO marked this report inconclusive' : 'MDRRMO marked this report False Reporter'}</strong>
            {report.review_reason && <p>{report.review_reason}</p>}
            <p>Correct the report details and resubmit it using this same reference.</p>
            {canResubmit && (editingResubmission
              ? <EditAndResubmitReportForm report={report} guestPhone={trackingCredentials?.phone} onCancel={() => setEditingResubmission(false)} onSubmitted={() => {
                setEditingResubmission(false);
                setResubmissionSuccess('Your corrected report was sent to MDRRMO for review.');
                if (trackingCredentials) void loadGuestReport(trackingCredentials.reference, trackingCredentials.phone);
              }} />
              : <button type="button" className="btn btn-primary" onClick={() => { setFollowUpOpen(false); setEditingResubmission(true); }}>Edit and resubmit</button>)}
          </section>}
          <p className="public-tracked-refresh-note" role="status">{liveConnected ? 'Live updates connected.' : 'Connecting to live updates…'}</p>
          {resubmissionSuccess && <p className="public-follow-up-status" role="status">{resubmissionSuccess}</p>}
          <div className="public-tracked-facts" aria-label="Incident information">
            <div className="public-tracked-fact"><span>Incident category</span><strong>{categoryLabel}</strong>{report.incident_type === 'other' && report.specifics?.trim() && <small>{report.specifics.replace(/^Other emergency:\s*/i, '')}</small>}</div>
            <div className="public-tracked-fact"><span>Incident occurred</span><strong>{incidentTimeLabel(report)}</strong></div>
            <div className="public-tracked-fact public-tracked-location">
              <span>Incident location</span>
              <strong>{locationPreviewLoading ? 'Looking up the road and nearby places…' : location}</strong>
              {!locationPreviewLoading && locationPreview?.road && locationPreview.landmark &&
                <small>Near {locationPreview.landmark}{locationPreview.landmark_distance_meters != null ? ` · ${locationPreview.landmark_distance_meters} m` : ''}</small>}
              {!locationPreviewLoading && locationPreview?.nearest_response_barangay_name &&
                <small>Closest response barangay: {locationPreview.nearest_response_barangay_name.replace(/^(?:barangay|brgy\.?)\s*/i, '')}</small>}
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
            <div className="public-tracked-evidence-heading">
              <h3 id="tracked-evidence-title">Photo or video evidence</h3>
              {canSendFollowUp && <button className="public-follow-up-button" type="button" onClick={() => { setFollowUpOpen((open) => !open); setFollowUpError(''); setFollowUpSuccess(''); }}>
                {followUpOpen ? <X size={15} aria-hidden="true" /> : <HandHelping size={15} aria-hidden="true" />}
                {followUpOpen ? 'Cancel follow-up' : 'Follow-up request'}
              </button>}
            </div>
            {followUpSuccess && <p className="public-follow-up-status" role="status">{followUpSuccess}</p>}
            {followUpError && <p className="public-follow-up-error" role="alert"><AlertCircle size={14} /> {followUpError}</p>}
            {followUpOpen && canSendFollowUp && <form className="public-follow-up-form" onSubmit={(event) => void submitFollowUp(event)}>
              <p>Send an additional emergency update to dispatch. Photo or video evidence is optional.</p>
              <CameraEvidenceCapture files={followUpFiles} onFilesChange={(files) => { followUpFilesRef.current = files; setFollowUpFiles(files); }} />
              <button className="btn btn-primary public-follow-up-submit" type="submit" disabled={followUpSubmitting}>
                <Send size={15} aria-hidden="true" /> {followUpSubmitting ? 'Sending follow-up…' : 'Send follow-up request'}
              </button>
            </form>}
            {reportEvidence.length ? <div className="public-tracked-evidence-grid">{reportEvidence.map((item, index) => isVideoEvidence(item.url, item.type)
              ? <video key={`${item.url}-${index}`} src={item.url} controls playsInline preload="metadata" aria-label={`Incident video evidence ${index + 1}`} />
              : <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer" aria-label={`Open incident photo evidence ${index + 1}`}><img src={item.url} alt={`Incident photo evidence ${index + 1}`} loading="lazy" /></a>)}</div>
              : report.evidence_status === 'pending'
                ? <p>Evidence is still uploading and will appear here when ready.</p>
                : report.evidence_status === 'failed'
                  ? <p>Photo or video evidence could not be attached to this report.</p>
                  : <p>No photo or video evidence was attached to this report.</p>}
          </section>
          <h3 className="public-tracked-timeline-title">Response timeline</h3>
          <p className="public-tracked-timeline-intro">Clear updates on when the report was received and how responders handled it.</p>
          <ol className="resident-report-timeline public-tracked-timeline">
            {buildIncidentTimeline(report).map((event, index) => <li key={`${event.label}-${event.at || index}`}><span className="resident-timeline-marker" aria-hidden="true" /><div><strong>{event.label}</strong>{event.at && <time>{dateLabel(event.at)}</time>}{event.detail && <p>{event.detail}</p>}</div></li>)}
          </ol>
        </article>}
      </section>
    </main>
  </div>;
}
