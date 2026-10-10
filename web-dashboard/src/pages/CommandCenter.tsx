import { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useNavigate } from 'react-router-dom';
import { CARTO_DARK_MAP_URL, CARTO_ATTRIBUTION } from '../lib/mapConfig';
import 'leaflet/dist/leaflet.css';
import { reportAPI, requestAPI, respondUnitAPI, socket } from '../lib/api';
import { getMdrrmoReportGroup, isVisibleToMdrrmo } from '../lib/mdrrmoReportVisibility';
import { useAuth } from '../context/AuthContext';
import { useMunicipalityBoundary } from '../context/MunicipalityBoundaryContext';
import MunicipalityBoundaryMapLayer from '../components/MunicipalityBoundaryMapLayer';
import CurrentWeatherPanel from '../components/CurrentWeatherPanel';
import { boundaryRings, isCoordinateInsideBoundary, type MunicipalityBoundary } from '../lib/municipalityBoundary';
import toast from 'react-hot-toast';
import { AlertTriangle, Siren, Users, CheckCircle2, X } from 'lucide-react';

type ReportKind = 'resident' | 'escalated';
type ReportStage = 'pending' | 'responding' | 'arrived' | 'resolved';

interface IncidentItem {
  id: string;
  title: string;
  type: string;
  incident_type?: string;
  report_kind: ReportKind;
  status: ReportStage;
  severity?: string;
  latitude: number;
  longitude: number;
  description?: string;
  specifics?: string;
  proof_url?: string;
  proof_type?: string;
  proof_urls?: string[];
  proof_types?: string[];
  responder_media?: Array<{
    id?: string;
    url: string;
    type?: string;
    uploader_name?: string;
    role?: string;
    uploader_role?: string;
    created_at?: string;
  }>;
  created_at?: string;
  incident_occurred_at?: string | null;
  incident_time_precision?: 'exact' | 'approximate' | 'unknown' | null;
  reporter_name?: string;
  reporter_phone?: string;
  reporter_id?: string | null;
  reporter_type?: string;
  reporter_false_report_count?: number;
  reporter_account_status?: string;
  review_outcome?: 'inconclusive' | 'false_report' | null;
  review_reason?: string | null;
  responder_name?: string;
  responder_phone?: string;
  barangay_response_notes?: string;
  assigned_unit_id?: string;
  barangay_name?: string;
  barangay_response_status?: string;
  barangay_responder_name?: string;
  mdrrmo_response_status?: string;
  mdrrmo_responder_name?: string;
  mdrrmo_response_notes?: string;
  mdrrmo_dispatch_notes?: string;
  mdrrmo_coordination_notes?: string;
  mdrrmo_dispatched?: boolean;
  barangay_responded_by?: string | null;
  mdrrmo_responded_by?: string | null;
  arrived_at?: string | null;
  resolved_notes?: string | null;
}

const incidentTimeText = (occurredAt?: string | null, precision?: string | null) => {
  if (!occurredAt || (precision !== 'exact' && precision !== 'approximate')) {
    return 'Incident time unknown';
  }
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return 'Incident time unknown';
  return `Incident occurred: ${date.toLocaleString()} (${precision})`;
};

const reportReceivedText = (createdAt?: string) => {
  if (!createdAt) return 'Report received: Not recorded';
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? 'Report received: Not recorded'
    : `Report received: ${date.toLocaleString()}`;
};

interface DispatchUnitItem {
  id: string;
  name: string;
  unit_type: string;
  specialization?: string;
  leader_name: string;
  members: string[];
  latitude: number;
  longitude: number;
  target_incident_id?: string;
  target_location?: string;
}

interface MdrrmoDispatchResponder {
  id: string;
  full_name: string;
  unit_name?: string | null;
  officer_name?: string | null;
}

interface LiveResponderAssignment {
  incidentId: string;
  title: string;
  latitude: number;
  longitude: number;
  crew: LiveResponderCrewMember[];
}

interface LiveResponderCrewMember {
  name: string;
  memberRole: string;
}

interface LiveResponderLocation {
  responderId: string;
  responderName: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  assignments: LiveResponderAssignment[];
}

interface CommandLocationPin {
  id: string;
  name: string;
  type: 'office' | 'barangay';
  latitude: number;
  longitude: number;
  address?: string | null;
  barangay_id?: string;
}

interface AvailableResponderPin {
  id: string;
  full_name: string;
  phone?: string | null;
  distance_m: number;
  last_seen?: string;
}

const commandOfficePinIcon = L.divIcon({ className: 'dashboard-command-pin office', html: '<span>MDRRMO</span>', iconSize: [82, 38], iconAnchor: [41, 19] });
const commandBarangayPinIcon = L.divIcon({ className: 'dashboard-command-pin barangay', html: '<span>BARANGAY</span>', iconSize: [86, 38], iconAnchor: [43, 19] });

const LIVE_LOCATION_MAX_AGE_MS = 30_000;

function normalizeLiveResponderLocation(value: any): LiveResponderLocation | null {
  if (!value || typeof value.responderId !== 'string' ||
      !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
      value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180 ||
      typeof value.timestamp !== 'string') return null;
  const timestamp = Date.parse(value.timestamp);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > LIVE_LOCATION_MAX_AGE_MS) return null;
  const assignments = Array.isArray(value.assignments) ? value.assignments.filter((assignment: any) =>
    typeof assignment?.incidentId === 'string' && typeof assignment?.title === 'string' &&
    Number.isFinite(assignment.latitude) && Number.isFinite(assignment.longitude)).map((assignment: any) => ({
      incidentId: assignment.incidentId,
      title: assignment.title,
      latitude: assignment.latitude,
      longitude: assignment.longitude,
      crew: Array.isArray(assignment.crew) ? assignment.crew
        .filter((member: any) => typeof member?.name === 'string' && typeof member?.memberRole === 'string')
        .map((member: any) => ({ name: member.name, memberRole: member.memberRole })) : [],
    })) : [];
  if (!assignments.length) return null;
  return {
    responderId: value.responderId,
    responderName: typeof value.responderName === 'string' ? value.responderName : 'Responder',
    latitude: value.latitude,
    longitude: value.longitude,
    timestamp: value.timestamp,
    assignments,
  };
}

interface AssistanceRequestItem {
  id: string;
  incident_id: string;
  request_type: string;
  sub_type?: string | null;
  details: string;
  status: string;
  created_at: string;
  decision?: string | null;
  dispatcher_notes?: string | null;
  requested_by_user?: { full_name?: string; role?: string; unit_type?: string | null; phone?: string | null } | null;
}

function requestTimestamp(request: AssistanceRequestItem): number {
  const timestamp = Date.parse(request.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

const MDRRMO_DISPATCH_INCIDENT_TYPES = [
  { value: 'flash_flood', label: 'Flood / Flash Flood' },
  { value: 'fire', label: 'Fire' },
  { value: 'earthquake', label: 'Earthquake' },
  { value: 'medical_emergency', label: 'Medical Emergency' },
  { value: 'typhoon', label: 'Typhoon / Severe Weather' },
  { value: 'other', label: 'Other Emergency' },
] as const;

const MDRRMO_DISPATCH_SEVERITIES = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
] as const;

function parseFieldAssessment(notes?: string) {
  const content = (notes || '')
    .replace(/^\[ASSIGNED:[^\]]+\]\s*/i, '')
    .replace(/\[RESPONDER_MEDIA:[\s\S]*?\]/gi, '')
    .trim();
  const marker = content.indexOf('FIELD ASSESSMENT');
  const assessment = marker >= 0 ? content.slice(marker + 'FIELD ASSESSMENT'.length) : content;
  const fields: Record<string, string> = {};
  assessment.split(/\r?\n/).forEach((line) => {
    const splitAt = line.indexOf(':');
    if (splitAt < 0) return;
    fields[line.slice(0, splitAt).trim().toLowerCase()] = line.slice(splitAt + 1).trim();
  });
  return {
    situation: fields.situation || '',
    people: fields['people affected / urgency'] || '',
    actions: fields['action taken'] || fields['actions taken'] || '',
    risks: fields['risk / resource'] || fields['risks / resources'] || '',
  };
}

function isMdrrmoMedia(media: NonNullable<IncidentItem['responder_media']>[number]): boolean {
  return Boolean(media.id?.startsWith('mdrrmo_') || /mdrrmo/i.test(`${media.role || ''} ${media.uploader_role || ''}`));
}

function AssessmentSections({ notes }: { notes?: string }) {
  const assessment = parseFieldAssessment(notes);
  const sections = [
    { label: 'Situation', value: assessment.situation },
    { label: 'People Affected / Urgency', value: assessment.people },
    { label: 'Action Taken', value: assessment.actions },
    { label: 'Risk / Resource', value: assessment.risks },
  ];

  return (
    <div className="assessment-sections">
      {sections.map(({ label, value }) => (
        <section key={label}>
          <h3>{label}</h3>
          <p>{value || 'No details provided.'}</p>
        </section>
      ))}
    </div>
  );
}

function FieldPhotosGallery({
  incident,
  source,
  onPreview,
}: {
  incident: IncidentItem;
  source: 'barangay' | 'mdrrmo' | 'all';
  onPreview: (url: string) => void;
}) {
  const fieldPhotos = (incident.responder_media || []).filter((media) => {
    if (source === 'all') return true;
    return source === 'mdrrmo' ? isMdrrmoMedia(media) : !isMdrrmoMedia(media);
  });

  return (
    <section className="field-photos-section">
      <div className="field-photos-heading">
        <span>Field Photos/Videos</span>
        <strong>{fieldPhotos.length} Attachment{fieldPhotos.length === 1 ? '' : 's'}</strong>
      </div>
      <div className="assessment-field-photos">
        {fieldPhotos.length > 0 ? (
          <div>
            {fieldPhotos.map((media, index) => (
              <button
                type="button"
                key={`${media.url}-${index}`}
                onClick={() => onPreview(media.url)}
                title={media.uploader_name || 'Field photo'}
              >
                {isVideoProof(media.url, media.type)
                  ? <span>▶ Video</span>
                  : <img src={media.url} alt={`${source === 'mdrrmo' ? 'MDRRMO' : source === 'barangay' ? 'Barangay' : 'Responder'} field evidence ${index + 1}`} />}
              </button>
            ))}
          </div>
        ) : (
          <span className="assessment-no-photos">No field photos submitted.</span>
        )}
      </div>
    </section>
  );
}

function ResponderAssessmentPanel({
  incident,
  assistanceRequests,
  assistanceRequestLoading,
  notes,
  mediaSource,
  view,
  onViewChange,
  onPreview,
  showTitle = true,
}: {
  incident: IncidentItem;
  assistanceRequests: AssistanceRequestItem[];
  assistanceRequestLoading: boolean;
  notes?: string;
  mediaSource: 'barangay' | 'mdrrmo' | 'all';
  view: 'assessment' | 'assistance';
  onViewChange: (view: 'assessment' | 'assistance') => void;
  onPreview: (url: string) => void;
  showTitle?: boolean;
}) {
  const navigate = useNavigate();
  const latestAssistanceRequest = assistanceRequests.reduce<AssistanceRequestItem | null>(
    (latest, request) => !latest || requestTimestamp(request) > requestTimestamp(latest) ? request : latest,
    null,
  );

  return (
    <div className="responder-detail-panel">
      {showTitle && <div className="responder-panel-title">RESPONDER</div>}
      <div className="responder-panel-tabs" role="tablist" aria-label="Responder information">
        <button type="button" role="tab" aria-selected={view === 'assessment'} className={view === 'assessment' ? 'active' : ''} onClick={() => onViewChange('assessment')}>
          Field Assessment
        </button>
        <button type="button" role="tab" aria-selected={view === 'assistance'} className={view === 'assistance' ? 'active' : ''} onClick={() => onViewChange('assistance')}>
          Assistance Request
        </button>
      </div>
      {view === 'assessment' ? (
        <div className="responder-panel-content">
          <AssessmentSections notes={notes} />
          <FieldPhotosGallery incident={incident} source={mediaSource} onPreview={onPreview} />
          {incident.status === 'resolved' && (
            <>
              <section className="resolve-notes-card">
                <strong>Resolve notes</strong>
                <p>{incident.resolved_notes?.trim() || 'No resolve notes provided.'}</p>
              </section>
              <button
                type="button"
                className="resolved-view-details"
                onClick={() => navigate('/reports?id=' + encodeURIComponent(incident.id) + '&status=resolved')}
              >
                View Details
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="assistance-request-list">
          {assistanceRequestLoading ? <div className="assistance-request-card"><strong>Assistance Request</strong><span>Loading assistance requests…</span></div> : latestAssistanceRequest ? [latestAssistanceRequest].map((request) => (
            <div className="assistance-request-card" key={request.id}>
              <strong>Latest Assistance Request</strong>
              <div className="assistance-request-card-facts">
                <span><small>Type</small><b>{request.request_type === 'responders' ? 'Responders' : request.request_type.replaceAll('_', ' ')}</b></span>
                {request.sub_type && <span><small>Category</small><b>{request.sub_type.replaceAll('_', ' ')}</b></span>}
                <span><small>Status</small><b>{request.status.replaceAll('_', ' ')}</b></span>
                {request.decision && <span><small>Decision</small><b>{request.decision.replaceAll('_', ' ')}</b></span>}
                <span><small>Requested</small><b>{new Date(request.created_at).toLocaleString()}</b></span>
              </div>
              <p>{request.details}</p>
              {request.dispatcher_notes && <p><b>Dispatcher notes:</b> {request.dispatcher_notes}</p>}
              {request.requested_by_user && <small>Requested by {request.requested_by_user.full_name || 'Responder'}{request.requested_by_user.phone ? ` · ${request.requested_by_user.phone}` : ''}</small>}
            </div>
          )) : <div className="assistance-request-card"><strong>Assistance Request</strong><span>No assistance request details provided.</span></div>}
          {assistanceRequests.length > 1 && <small className="assistance-request-history-count">Showing the latest of {assistanceRequests.length} requests.</small>}
          <button type="button" className="assistance-request-view-all" onClick={() => navigate(`/requests?incident_id=${encodeURIComponent(incident.id)}`)}>
            View all assistance requests
          </button>
        </div>
      )}
    </div>
  );
}

function EscalatedResponsePanel({
  incident,
  assistanceRequests,
  assistanceRequestLoading,
  tab,
  onTabChange,
  responderView,
  onResponderViewChange,
  onPreview,
}: {
  incident: IncidentItem;
  assistanceRequests: AssistanceRequestItem[];
  assistanceRequestLoading: boolean;
  tab: 'barangay' | 'responder';
  onTabChange: (tab: 'barangay' | 'responder') => void;
  responderView: 'assessment' | 'assistance';
  onResponderViewChange: (view: 'assessment' | 'assistance') => void;
  onPreview: (url: string) => void;
}) {
  const coordinationNotes = incident.mdrrmo_coordination_notes;
  return (
    <div className="escalated-response-panel">
      <div className={`escalated-response-tabs ${incident.status === 'pending' ? 'single-tab' : ''}`} role="tablist" aria-label="Escalated report response">
        <button type="button" role="tab" aria-selected={tab === 'barangay'} className={tab === 'barangay' ? 'active' : ''} onClick={() => onTabChange('barangay')}>
          {incident.barangay_name || 'Barangay name'}
        </button>
        {incident.status !== 'pending' && <button type="button" role="tab" aria-selected={tab === 'responder'} className={tab === 'responder' ? 'active' : ''} onClick={() => onTabChange('responder')}>
          RESPONDER
        </button>}
      </div>
      {tab === 'responder' ? (
        <ResponderAssessmentPanel
          incident={incident}
          assistanceRequests={assistanceRequests}
          assistanceRequestLoading={assistanceRequestLoading}
          notes={incident.mdrrmo_response_notes}
          mediaSource="mdrrmo"
          view={responderView}
          onViewChange={onResponderViewChange}
          onPreview={onPreview}
          showTitle={false}
        />
      ) : (
        <div className="barangay-response-content">
          <h2>Field Assessment</h2>
          <div className="escalation-notes-card">
            {coordinationNotes?.trim() || 'No escalation notes provided.'}
          </div>
          <AssessmentSections notes={incident.barangay_response_notes} />
          <FieldPhotosGallery incident={incident} source="barangay" onPreview={onPreview} />
        </div>
      )}
    </div>
  );
}

// Helper to detect video from URL or proof_type
const isVideoProof = (url?: string | null, proof_type?: string | null): boolean => {
  if (proof_type === 'video') return true;
  if (!url) return false;
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm') ||
    lower.endsWith('.3gp') || lower.endsWith('.mkv') || lower.endsWith('.avi');
};

// Circular report markers use the white normal ring and yellow selected ring
// shown in the Command Center reference.
const createTeardropPin = (reportKind: ReportKind, status: ReportStage, selected = false) => {
  const size = 64;
  const color = status === 'resolved'
    ? '#5CE76B'
    : reportKind === 'escalated'
      ? '#FF3C43'
      : '#FF7838';
  const symbol = status === 'pending'
    ? reportKind === 'escalated' ? '‼' : '!'
    : status === 'responding'
      ? '⟳'
      : status === 'arrived'
        ? '<svg class="command-map-pin-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>'
        : '✓';
  return L.divIcon({
    html: `
      <div class="command-map-dot ${selected ? 'selected' : ''}" style="width:${size}px;height:${size}px;background:${color}">
        ${symbol.startsWith('<svg') ? symbol : `<span class="command-map-symbol command-map-symbol-${status}">${symbol}</span>`}
      </div>
    `,
    className: 'command-map-dot-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
};

const createResponderUnitBadge = (selected = false) => {
  const size = 64;
  return L.divIcon({
    html: `
      <div class="command-map-dot ${selected ? 'selected' : ''}" style="width:${size}px;height:${size}px;background:#06b6d4">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </div>
    `,
    className: 'command-map-dot-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const createLiveResponderBadge = (selected = false) => {
  const size = 56;
  return L.divIcon({
    html: `
      <div class="command-map-dot ${selected ? 'selected' : ''}" style="width:${size}px;height:${size}px;background:#1478f8">
        <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </div>
    `,
    className: 'command-map-dot-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
};

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize({ pan: false });
    const timer = setTimeout(() => map.invalidateSize({ pan: false }), 300);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

function CommandCenterViewportController({
  points,
  fitKey,
  boundary,
  selectionKey,
  selectedPosition,
}: {
  points: [number, number][];
  fitKey: string;
  boundary: MunicipalityBoundary;
  selectionKey: string | null;
  selectedPosition: [number, number] | null;
}) {
  const map = useMap();
  const lastSelectionRef = useRef<string | null>(null);
  const lastOverviewKeyRef = useRef<string>('');

  useEffect(() => {
    if (selectionKey && selectedPosition &&
        Number.isFinite(selectedPosition[0]) && Number.isFinite(selectedPosition[1])) {
      // Selection takes priority over automatic fitting. Focus only when the
      // selected dot changes, so live GPS updates and incoming reports cannot
      // pull the map away after it has centered on the user's selection.
      if (lastSelectionRef.current !== selectionKey) {
        lastSelectionRef.current = selectionKey;
        lastOverviewKeyRef.current = '';
        map.stop();
        map.flyTo(selectedPosition, Math.max(map.getZoom(), 15), {
          animate: true,
          duration: 0.9,
        });
      }
      return;
    }
    const validPoints = points.filter(([lat, lng]) => lat !== 0 && lng !== 0);
    lastSelectionRef.current = null;
    const boundaryKey = `${boundary.revision}:${boundary.enabled}:${Boolean(boundary.geometry)}`;
    const currentHash = `${fitKey}|${boundaryKey}|${validPoints.length}`;
    if (currentHash === lastOverviewKeyRef.current) return;
    lastOverviewKeyRef.current = currentHash;

    if (validPoints.length === 1) {
      map.flyTo(validPoints[0], 14, { animate: true, duration: 1.2 });
    } else if (validPoints.length > 1) {
      const bounds = L.latLngBounds(validPoints.map(([lat, lng]) => L.latLng(lat, lng)));
      map.flyToBounds(bounds, { padding: [60, 60], animate: true, duration: 1.2, maxZoom: 15 });
    } else {
      const boundaryPoints = boundaryRings(boundary.geometry)
        .flat()
        .map(([longitude, latitude]) => L.latLng(latitude, longitude));
      if (boundaryPoints.length > 0) {
        map.fitBounds(L.latLngBounds(boundaryPoints), { padding: [24, 24], maxZoom: 13 });
      } else {
        map.setView([14.9055, 121.045], 13);
      }
    }
  }, [boundary, fitKey, map, points, selectedPosition, selectionKey]);

  return null;
}

function createIncidentClusterIcon(count: number) {
  const size = 54;
  return L.divIcon({
    html: `<div class="command-map-cluster-badge" aria-label="${count} nearby reports"><svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="6" cy="7" r="2.2"/><path d="M12 7h12M12 15h12M12 23h12"/><circle cx="6" cy="15" r="2.2"/><circle cx="6" cy="23" r="2.2"/></svg><span>${count}</span></div>`,
    className: 'command-map-cluster-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function incidentClusterLabel(incident: IncidentItem): string {
  const group = incident.report_kind === 'escalated' ? 'Escalation report' : 'Resident report';
  const stage = incident.status === 'pending'
    ? 'Pending'
    : incident.status.charAt(0).toUpperCase() + incident.status.slice(1);
  return `${group} · ${stage}`;
}

function incidentClusterColor(incident: IncidentItem): string {
  if (incident.status === 'resolved') return '#5ce76b';
  if (incident.status === 'responding') return '#9b86ff';
  if (incident.status === 'arrived') return '#f5c542';
  return incident.report_kind === 'escalated' ? '#ff3c43' : '#ff7838';
}

function ClusteredIncidentMarkers({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: IncidentItem[];
  selectedId?: string;
  onSelect: (incident: IncidentItem) => void;
}) {
  const map = useMap();
  const [viewportRevision, setViewportRevision] = useState(0);

  useMapEvents({
    zoomend: () => setViewportRevision((revision) => revision + 1),
    moveend: () => setViewportRevision((revision) => revision + 1),
  });

  const groups = useMemo(() => {
    const projected = incidents.map((incident) => ({
      incident,
      point: map.latLngToContainerPoint([incident.latitude, incident.longitude]),
    }));
    const parents = projected.map((_entry, index) => index);
    const findRoot = (index: number): number => {
      if (parents[index] !== index) parents[index] = findRoot(parents[index]);
      return parents[index];
    };

    for (let left = 0; left < projected.length; left += 1) {
      for (let right = left + 1; right < projected.length; right += 1) {
        if (projected[left].point.distanceTo(projected[right].point) > 72) continue;
        const leftRoot = findRoot(left);
        const rightRoot = findRoot(right);
        if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
      }
    }

    const grouped = new Map<number, IncidentItem[]>();
    projected.forEach(({ incident }, index) => {
      const root = findRoot(index);
      grouped.set(root, [...(grouped.get(root) || []), incident]);
    });
    return [...grouped.values()];
  }, [incidents, map, viewportRevision]);

  return <>
    {groups.map((group) => {
      if (group.length === 1) {
        const incident = group[0];
        return (
          <Marker
            key={incident.id}
            position={[incident.latitude, incident.longitude]}
            icon={createTeardropPin(incident.report_kind, incident.status, selectedId === incident.id)}
            zIndexOffset={selectedId === incident.id ? 1600 : 0}
            eventHandlers={{ click: () => onSelect(incident) }}
          />
        );
      }

      const groupKey = group.map((incident) => incident.id).sort().join(':');
      const center: [number, number] = [
        group.reduce((total, incident) => total + incident.latitude, 0) / group.length,
        group.reduce((total, incident) => total + incident.longitude, 0) / group.length,
      ];
      return (
        <Marker key={`cluster-${groupKey}`} position={center} icon={createIncidentClusterIcon(group.length)} zIndexOffset={1200}>
          <Popup className="command-map-cluster-popup" minWidth={240} maxWidth={320}>
            <div className="command-map-cluster-list">
              <strong>Nearby reports <span>{group.length}</span></strong>
              {group.map((incident) => (
                <button key={incident.id} type="button" onClick={(event) => { event.stopPropagation(); onSelect(incident); }}>
                  <i style={{ backgroundColor: incidentClusterColor(incident) }} />
                  <span>{incidentClusterLabel(incident)}</span>
                </button>
              ))}
            </div>
          </Popup>
        </Marker>
      );
    })}
  </>;
}

function LiveResponderOverlays({
  locations,
  incidents,
  selectedResponderId,
  onSelectResponder,
  onSelectIncident,
}: {
  locations: LiveResponderLocation[];
  incidents: IncidentItem[];
  selectedResponderId: string | null;
  onSelectResponder: (responderId: string) => void;
  onSelectIncident: (incident: IncidentItem) => void;
}) {
  return <>
    {locations.flatMap((location: LiveResponderLocation) => {
      const targets = location.assignments
        .map((assignment) => incidents.find((incident) => incident.id === assignment.incidentId))
        .filter((incident): incident is IncidentItem => Boolean(incident));
      if (!targets.length) return [];

      return [
        ...targets.map((target) => (
          <Polyline
            key={`live-route-${location.responderId}-${target.id}`}
            positions={[[location.latitude, location.longitude], [target.latitude, target.longitude]]}
            pathOptions={{ color: '#818cf8', weight: 3, dashArray: '8, 8', opacity: 0.9 }}
          />
        )),
        <Marker
          key={`live-responder-${location.responderId}`}
          position={[location.latitude, location.longitude]}
          icon={createLiveResponderBadge(selectedResponderId === location.responderId)}
          zIndexOffset={selectedResponderId === location.responderId ? 1800 : 1400}
          eventHandlers={{ click: () => onSelectResponder(location.responderId) }}
        >
          <Popup className="command-map-cluster-popup" minWidth={220} maxWidth={320}>
            <div className="command-map-cluster-list">
              <strong>{location.responderName}<span>Live</span></strong>
              {targets.map((target) => {
                const assignment = location.assignments.find((item) => item.incidentId === target.id);
                const crew = assignment?.crew || [];
                return (
                  <button key={target.id} type="button" onClick={(event) => { event.stopPropagation(); onSelectIncident(target); }}>
                    <i style={{ backgroundColor: target.report_kind === 'escalated' ? '#ff3c43' : '#ff7838' }} />
                    <div className="command-map-live-target-details">
                      <span>En route · {target.title}</span>
                      {crew.length > 0 && (
                        <small>
                          Crew · {crew
                            .map((member) => `${member.name} (${member.memberRole.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')})`)
                            .join(', ')}
                        </small>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Popup>
        </Marker>,
      ];
    })}
  </>;
}

export default function CommandCenter() {
  const { user } = useAuth();
  const isBarangayDashboard = user?.account_kind === 'barangay';
  const { boundary } = useMunicipalityBoundary();
  const navigate = useNavigate();

  // Clock
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Filters matching Image 3
  const [filters, setFilters] = useState({
    incidents: true,
    escalated: true,
    arrived: true,
    responding: true,
    resolved: true,
  });

  // Data lists
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [reportMetrics, setReportMetrics] = useState<Array<Pick<IncidentItem, 'report_kind' | 'status'>>>([]);
  const [dispatchUnits, setDispatchUnits] = useState<DispatchUnitItem[]>([]);
  const [activeDispatchCount, setActiveDispatchCount] = useState(0);
  const [commandLocationPins, setCommandLocationPins] = useState<CommandLocationPin[]>([]);
  const [availableResponderPins, setAvailableResponderPins] = useState<AvailableResponderPin[]>([]);
  const [selectedAvailabilityPin, setSelectedAvailabilityPin] = useState<CommandLocationPin | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [liveResponderLocations, setLiveResponderLocations] = useState<LiveResponderLocation[]>([]);
  const [selectedResponderId, setSelectedResponderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Interactive Modal State
  const [activeModalType, setActiveModalType] = useState<'incident' | 'escalated' | 'unit' | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<IncidentItem | null>(null);
  const [assistanceRequests, setAssistanceRequests] = useState<AssistanceRequestItem[]>([]);
  const [assistanceRequestsLoading, setAssistanceRequestsLoading] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<DispatchUnitItem | null>(null);
  const [selectedVisualUrl, setSelectedVisualUrl] = useState<string | null>(null);
  const [proofPreviewOpen, setProofPreviewOpen] = useState(false);
  const [invalidReviewStep, setInvalidReviewStep] = useState<'choice' | 'reason' | null>(null);
  const [invalidReason, setInvalidReason] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [mdrrmoNotes, setMdrrmoNotes] = useState('');
  const [escalatedResponseTab, setEscalatedResponseTab] = useState<'barangay' | 'responder'>('barangay');
  const [responderInfoTab, setResponderInfoTab] = useState<'assessment' | 'assistance'>('assessment');
  const [mdrrmoDispatchIncident, setMdrrmoDispatchIncident] = useState<IncidentItem | null>(null);
  const [mdrrmoDispatchResponders, setMdrrmoDispatchResponders] = useState<MdrrmoDispatchResponder[]>([]);
  const [mdrrmoDispatchLoading, setMdrrmoDispatchLoading] = useState(false);
  const [mdrrmoDispatchError, setMdrrmoDispatchError] = useState('');
  const [selectedMdrrmoResponderIds, setSelectedMdrrmoResponderIds] = useState<string[]>([]);
  const [mdrrmoDispatchIncidentType, setMdrrmoDispatchIncidentType] = useState('');
  const [mdrrmoDispatchSeverity, setMdrrmoDispatchSeverity] = useState('');
  const [mdrrmoDispatchNotes, setMdrrmoDispatchNotes] = useState('');
  const mdrrmoDispatchRequestId = useRef(0);
  const previewMediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
  const selectedIncidentId = selectedIncident?.id;

  useEffect(() => {
    if (!selectedIncidentId || !['incident', 'escalated'].includes(activeModalType || '')) {
      setAssistanceRequests([]);
      setAssistanceRequestsLoading(false);
      return;
    }

    let active = true;
    setAssistanceRequestsLoading(true);
    if (isBarangayDashboard) {
      setAssistanceRequests([]);
      setAssistanceRequestsLoading(false);
      return;
    }
    requestAPI.list({ incident_id: selectedIncidentId })
      .then((response) => {
        if (active) setAssistanceRequests(Array.isArray(response.data.requests) ? response.data.requests : []);
      })
      .catch((error) => {
        console.error('Could not load the assistance request for this report:', error);
        if (active) setAssistanceRequests([]);
      })
      .finally(() => { if (active) setAssistanceRequestsLoading(false); });

    return () => { active = false; };
  }, [activeModalType, selectedIncidentId, isBarangayDashboard]);

  // Fetch data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [reportsRes, unitsRes, queueRes] = await Promise.allSettled([
        isBarangayDashboard ? reportAPI.barangayReports() : reportAPI.list(),
        isBarangayDashboard ? Promise.resolve({ data: [] }) : respondUnitAPI.list(),
        isBarangayDashboard ? Promise.resolve({ data: [] }) : reportAPI.mdrrmoQueue(),
      ]);

      const items: IncidentItem[] = [];
      const metrics: Array<Pick<IncidentItem, 'report_kind' | 'status'>> = [];

      if (reportsRes.status === 'fulfilled' && Array.isArray(reportsRes.value.data)) {
        reportsRes.value.data.forEach((r: any) => {
          if (!isBarangayDashboard && !isVisibleToMdrrmo(r)) return;
          const lat = parseFloat(r.latitude);
          const lng = parseFloat(r.longitude);
          const reportStatus = String(r.status || '').toLowerCase();
          const barangayStatus = String(r.barangay_response_status || '').toLowerCase();
          const mdrrmoStatus = String(r.mdrrmo_response_status || r.response_status || '').toLowerCase();
          const reportGroup = isBarangayDashboard ? 'resident' : getMdrrmoReportGroup(r);
          const isEscalated = reportGroup === 'escalated';
          const mdrrmoCycleStatus = mdrrmoStatus || (isEscalated
            ? r.mdrrmo_resolved_at ? 'resolved' : r.mdrrmo_accepted_at || r.mdrrmo_arrived_at ? 'responding' : 'pending'
            : reportStatus);
          const barangayCycleStatus = barangayStatus || (isEscalated
            ? r.barangay_resolved_at ? 'resolved' : r.barangay_accepted_at || r.barangay_arrived_at ? 'responding' : 'pending'
            : reportStatus);
          const barangayDashboardStatus = String(r.barangay_response_status || r.response_status || r.status || '').toLowerCase();
          const isResolved = isBarangayDashboard
            ? ['resolved', 'closed'].includes(barangayDashboardStatus)
            : ['resolved', 'closed'].includes(mdrrmoCycleStatus) && (!isEscalated || ['resolved', 'closed'].includes(barangayCycleStatus));
          const isResponding = isBarangayDashboard ? barangayDashboardStatus === 'responding' : mdrrmoCycleStatus === 'responding';
          const isArrived = isBarangayDashboard ? Boolean(r.barangay_arrived_at) : Boolean(r.mdrrmo_arrived_at) ||
            (!isEscalated && !r.mdrrmo_response_status && Boolean(r.arrived_at));
          const stage: ReportStage = isResolved
            ? 'resolved'
            : isArrived
              ? 'arrived'
              : isResponding
                ? 'responding'
                : 'pending';

          metrics.push({ report_kind: reportGroup, status: stage });
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; // keep coordinate-less reports in the metrics, but not on the map

          items.push({
            id: r.id,
            title: r.title || 'Emergency Incident',
            type: r.type || 'emergency',
            incident_type: r.incident_type || r.type || '',
            report_kind: reportGroup,
            status: stage,
            severity: r.severity || '',
            latitude: lat,
            longitude: lng,
            description: r.description || '',
            specifics: r.specifics || '',
            proof_url: r.proof_url || null,
            proof_type: r.proof_type || 'image',
            proof_urls: Array.isArray(r.proof_urls) && r.proof_urls.length > 0 ? r.proof_urls : (r.proof_url ? [r.proof_url] : []),
            proof_types: Array.isArray(r.proof_types) ? r.proof_types : (r.proof_type ? [r.proof_type] : []),
            responder_media: Array.isArray(r.responder_media) ? r.responder_media : [],
            created_at: r.created_at,
            incident_occurred_at: r.incident_occurred_at || null,
            incident_time_precision: r.incident_time_precision || 'unknown',
            reporter_name: r.reporter_name || r.reporter?.full_name || 'Resident',
            reporter_phone: r.reporter_phone || r.contact_number || '',
            responder_name: r.barangay_responder_name || r.mdrrmo_responder_name || '',
            responder_phone: '',
            barangay_response_notes: r.barangay_response_notes || '',
            reporter_id: r.reporter_id || null,
            reporter_type: r.reporter_type || '',
            reporter_false_report_count: Number(r.reporter_false_report_count || 0),
            reporter_account_status: r.reporter_account_status || '',
            review_outcome: r.review_outcome || null,
            review_reason: r.review_reason || null,
            assigned_unit_id: r.assigned_unit_id || null,
            barangay_name: r.barangay_name || (r.barangays && r.barangays.name) || '',
            barangay_response_status: r.barangay_response_status || 'pending',
            barangay_responder_name: r.barangay_responder_name,
            mdrrmo_response_status: r.mdrrmo_response_status || 'pending',
            mdrrmo_responder_name: r.mdrrmo_responder_name,
            mdrrmo_response_notes: r.mdrrmo_response_notes || '',
            mdrrmo_dispatch_notes: r.mdrrmo_dispatch_notes || '',
            mdrrmo_coordination_notes: r.mdrrmo_coordination_notes || '',
            mdrrmo_dispatched: isEscalated
              ? Boolean(r.mdrrmo_dispatched_at || r.mdrrmo_responded_at || r.mdrrmo_responder_name)
              : Boolean(r.mdrrmo_dispatched_at || r.dispatched_at || r.mdrrmo_responded_at || r.mdrrmo_responder_name),
            barangay_responded_by: r.barangay_responded_by || null,
            mdrrmo_responded_by: r.mdrrmo_responded_by || null,
            arrived_at: r.arrived_at || null,
            resolved_notes: r.resolved_notes || null,
          });
        });
      }

      setIncidents(items);
      setReportMetrics(metrics);

      if (queueRes.status === 'fulfilled' && Array.isArray(queueRes.value.data)) {
        const enRouteResponderIds = new Set<string>();
        queueRes.value.data.forEach((report: any) => {
          if (!Array.isArray(report?.mdrrmo_assignments)) return;
          report.mdrrmo_assignments.forEach((assignment: any) => {
            if (assignment?.status === 'responding' && !assignment?.arrived_at && typeof assignment?.responder_id === 'string') {
              enRouteResponderIds.add(assignment.responder_id);
            }
          });
        });
        setActiveDispatchCount(enRouteResponderIds.size);
      }

      // Real dispatch units from API
      const unitItems: DispatchUnitItem[] = [];
      if (unitsRes.status === 'fulfilled' && Array.isArray(unitsRes.value.data)) {
        unitsRes.value.data.forEach((u: any) => {
          const lat = parseFloat(u.latitude);
          const lng = parseFloat(u.longitude);
          if (!lat || !lng) return;
          unitItems.push({
            id: u.id,
            name: u.unit_name || u.name || 'Unit',
            unit_type: u.specialization || u.unit_type || '',
            specialization: u.specialization || '',
            leader_name: u.leader_name || u.team_leader_name || '',
            members: Array.isArray(u.members) ? u.members : [],
            latitude: lat,
            longitude: lng,
            target_incident_id: u.target_incident_id || null,
            target_location: u.target_location || u.address || '',
          });
        });
      }
      setDispatchUnits(unitItems);
    } catch (err) {
      console.error('Failed to load command center data:', err);
    } finally {
      setLoading(false);
    }
  };

  const openAvailabilityForPin = async (pin: CommandLocationPin) => {
    setSelectedAvailabilityPin(pin);
    setAvailableResponderPins([]);
    if (isBarangayDashboard && pin.type === 'office') return;
    setAvailabilityLoading(true);
    try {
      const response = isBarangayDashboard
        ? await reportAPI.availableBarangayResponders()
        : await reportAPI.availableResponders({ location_type: pin.type, ...(pin.type === 'barangay' ? { barangay_id: pin.barangay_id || pin.id } : {}) });
      setAvailableResponderPins(Array.isArray(response.data.responders) ? response.data.responders : []);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not load responders near this location.');
    } finally { setAvailabilityLoading(false); }
  };

  useEffect(() => {
    let active = true;
    const loadLocations = async () => {
      try {
        if (isBarangayDashboard) {
          const response = await reportAPI.barangayLocation();
          if (!active) return;
          const pins: CommandLocationPin[] = [];
          const office = response.data.office;
          const own = response.data.barangay;
          if (office?.latitude != null && office?.longitude != null) pins.push({
            id: 'office', name: 'MDRRMO office', type: 'office', latitude: Number(office.latitude), longitude: Number(office.longitude), address: office.address,
          });
          if (own?.location_latitude != null && own?.location_longitude != null) pins.push({
            id: own.id, barangay_id: own.id, name: `Barangay ${own.name || user?.barangay_name || ''}`.trim(), type: 'barangay', latitude: Number(own.location_latitude), longitude: Number(own.location_longitude), address: own.location_address,
          });
          setCommandLocationPins(pins);
        } else {
          const response = await reportAPI.commandLocations();
          if (!active) return;
          const pins: CommandLocationPin[] = [];
          const office = response.data.office;
          if (office?.latitude != null && office?.longitude != null) pins.push({
            id: 'office', name: 'MDRRMO office', type: 'office', latitude: Number(office.latitude), longitude: Number(office.longitude), address: office.address,
          });
          for (const row of response.data.barangays || []) {
            if (row.location_latitude == null || row.location_longitude == null) continue;
            pins.push({ id: row.id, barangay_id: row.id, name: `Barangay ${row.name}`, type: 'barangay', latitude: Number(row.location_latitude), longitude: Number(row.location_longitude), address: row.location_address });
          }
          setCommandLocationPins(pins.filter((pin) => Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude)));
        }
      } catch (error) {
        console.error('Could not load command location pins:', error);
        if (active) setCommandLocationPins([]);
      }
    };
    const refresh = () => { void loadLocations(); };
    refresh();
    socket.on('command:locations_updated', refresh);
    return () => { active = false; socket.off('command:locations_updated', refresh); };
  }, [isBarangayDashboard, user?.barangay_name]);

  useEffect(() => {
    fetchData();
    const requestLiveLocations = () => { if (!isBarangayDashboard) socket.emit('mdrrmo:requestResponderLocations'); };
    const handleRefresh = () => {
      void fetchData();
      requestLiveLocations();
      if (selectedAvailabilityPin) void openAvailabilityForPin(selectedAvailabilityPin);
    };
    const handleLiveLocation = (payload: any) => {
      if (payload?.responderId && Array.isArray(payload.assignments) && payload.assignments.length === 0) {
        setLiveResponderLocations((current) => current.filter((location) => location.responderId !== payload.responderId));
        setSelectedResponderId((current) => current === payload.responderId ? null : current);
        return;
      }
      const location = normalizeLiveResponderLocation(payload);
      if (!location) return;
      setLiveResponderLocations((current) => {
        const previous = current.find((item) => item.responderId === location.responderId);
        if (previous && Date.parse(previous.timestamp) > Date.parse(location.timestamp)) return current;
        return [...current.filter((item) => item.responderId !== location.responderId), location];
      });
    };
    const handleLiveLocations = (payload: any) => {
      const locations = Array.isArray(payload?.locations)
        ? payload.locations.map(normalizeLiveResponderLocation).filter((location: LiveResponderLocation | null): location is LiveResponderLocation => Boolean(location))
        : [];
      setLiveResponderLocations(locations);
      setSelectedResponderId((current) => current && locations.some((location: LiveResponderLocation) => location.responderId === current) ? current : null);
    };
    const expireStaleLocations = () => {
      setLiveResponderLocations((current) => {
        const fresh = current.filter((location) => Date.now() - Date.parse(location.timestamp) <= LIVE_LOCATION_MAX_AGE_MS);
        if (fresh.length === current.length) return current;
        return fresh;
      });
    };

    socket.on('connect', handleRefresh);
    socket.on('barangay:responding', handleRefresh);
    socket.on('incident_report:new', handleRefresh);
    socket.on('barangay:escalated', handleRefresh);
    socket.on('incident_report:mdrrmo_responding', handleRefresh);
    socket.on('incident_report:updated', handleRefresh);
    socket.on('barangay:report_updated', handleRefresh);
    socket.on('barangay:report_assigned', handleRefresh);
    socket.on('barangay:report_assignment_removed', handleRefresh);
    socket.on('barangay:availability_changed', handleRefresh);
    socket.on('mdrrmo:availability_changed', handleRefresh);
    socket.on('command:locations_updated', handleRefresh);
    socket.on('incident:lifecycle', handleRefresh);
    socket.on('task:statusChanged', handleRefresh);
    socket.on('mdrrmo:responder_location', handleLiveLocation);
    socket.on('mdrrmo:responder_locations', handleLiveLocations);
    requestLiveLocations();
    const expiryTimer = setInterval(expireStaleLocations, 5_000);
    return () => {
      clearInterval(expiryTimer);
      socket.off('connect', handleRefresh);
      socket.off('barangay:responding', handleRefresh);
      socket.off('incident_report:new', handleRefresh);
      socket.off('barangay:escalated', handleRefresh);
      socket.off('incident_report:mdrrmo_responding', handleRefresh);
      socket.off('incident_report:updated', handleRefresh);
      socket.off('barangay:report_updated', handleRefresh);
      socket.off('barangay:report_assigned', handleRefresh);
      socket.off('barangay:report_assignment_removed', handleRefresh);
      socket.off('barangay:availability_changed', handleRefresh);
      socket.off('mdrrmo:availability_changed', handleRefresh);
      socket.off('command:locations_updated', handleRefresh);
      socket.off('incident:lifecycle', handleRefresh);
      socket.off('task:statusChanged', handleRefresh);
      socket.off('mdrrmo:responder_location', handleLiveLocation);
      socket.off('mdrrmo:responder_locations', handleLiveLocations);
    };
  }, [isBarangayDashboard, selectedAvailabilityPin]);

  useEffect(() => {
    const pin = selectedAvailabilityPin;
    if (!pin || (isBarangayDashboard && pin.type === 'office')) return;
    const refreshAvailability = async () => {
      try {
        const response = isBarangayDashboard
          ? await reportAPI.availableBarangayResponders()
          : await reportAPI.availableResponders({ location_type: pin.type, ...(pin.type === 'barangay' ? { barangay_id: pin.barangay_id || pin.id } : {}) });
        setAvailableResponderPins(Array.isArray(response.data.responders) ? response.data.responders : []);
      } catch (error) {
        console.error('Could not refresh pin-scoped responder availability:', error);
      }
    };
    const timer = window.setInterval(() => void refreshAvailability(), 10_000);
    return () => window.clearInterval(timer);
  }, [isBarangayDashboard, selectedAvailabilityPin]);

  // Stats calculation — real counts, no demo padding
  const stats = useMemo(() => {
    const incCount = reportMetrics.filter(i => i.report_kind === 'resident' && i.status !== 'resolved').length;
    const escCount = reportMetrics.filter(i => i.report_kind === 'escalated' && i.status !== 'resolved').length;
    const resCount = reportMetrics.filter(i => i.status === 'resolved').length;
    return {
      incident: incCount,
      escalated: escCount,
      dispatch: activeDispatchCount,
      resolved: resCount,
    };
  }, [reportMetrics, activeDispatchCount]);

  const visibleIncidents = useMemo(() => incidents.filter((incident) => {
    if (incident.report_kind === 'resident' && !filters.incidents) return false;
    if (incident.report_kind === 'escalated' && !filters.escalated) return false;
    if (incident.status === 'arrived' && !filters.arrived) return false;
    if (incident.status === 'responding' && !filters.responding) return false;
    if (incident.status === 'resolved' && !filters.resolved) return false;
    return !boundary.enabled || isCoordinateInsideBoundary(incident.latitude, incident.longitude, boundary.geometry);
  }), [incidents, filters, boundary]);

  const visibleLiveResponders = useMemo(() => {
    if (!filters.responding) return [];
    const now = Date.now();
    return liveResponderLocations.filter((location: LiveResponderLocation) => {
      const age = now - Date.parse(location.timestamp);
      if (!Number.isFinite(age) || age > LIVE_LOCATION_MAX_AGE_MS) return false;
      if (boundary.enabled && !isCoordinateInsideBoundary(location.latitude, location.longitude, boundary.geometry)) return false;
      return location.assignments.some((assignment) => visibleIncidents.some((incident) => incident.id === assignment.incidentId));
    });
  }, [liveResponderLocations, visibleIncidents, filters.responding, boundary]);

  // Fit the initial and filtered map view to every report and visible unit point.
  const visiblePinPoints = useMemo((): [number, number][] => {
    const points = visibleIncidents.map((incident) => [incident.latitude, incident.longitude] as [number, number]);
    commandLocationPins.forEach((pin) => points.push([pin.latitude, pin.longitude]));
    if (filters.responding) {
      dispatchUnits.forEach((unit) => {
        if (!boundary.enabled || isCoordinateInsideBoundary(unit.latitude, unit.longitude, boundary.geometry)) {
          points.push([unit.latitude, unit.longitude]);
        }
      });
      visibleLiveResponders.forEach((responder) => points.push([responder.latitude, responder.longitude]));
    }
    return points;
  }, [visibleIncidents, commandLocationPins, dispatchUnits, visibleLiveResponders, filters.responding, boundary]);

  const selectedResponder = visibleLiveResponders.find((responder) => responder.responderId === selectedResponderId) || null;
  const selectedMapDot = selectedAvailabilityPin
    ? { key: `command-location:${selectedAvailabilityPin.id}`, position: [selectedAvailabilityPin.latitude, selectedAvailabilityPin.longitude] as [number, number] }
    : selectedIncident
    ? { key: `incident:${selectedIncident.id}`, position: [selectedIncident.latitude, selectedIncident.longitude] as [number, number] }
    : selectedUnit
      ? { key: `unit:${selectedUnit.id}`, position: [selectedUnit.latitude, selectedUnit.longitude] as [number, number] }
      : selectedResponder
        ? { key: `responder:${selectedResponder.responderId}`, position: [selectedResponder.latitude, selectedResponder.longitude] as [number, number] }
        : null;

  const mapFitKey = useMemo(() => [
    ...visibleIncidents.map((incident) => `report:${incident.id}:${incident.latitude}:${incident.longitude}`),
    ...commandLocationPins.map((pin) => `command-location:${pin.id}:${pin.latitude}:${pin.longitude}`),
    ...(filters.responding ? dispatchUnits
      .filter((unit) => !boundary.enabled || isCoordinateInsideBoundary(unit.latitude, unit.longitude, boundary.geometry))
      .map((unit) => `unit:${unit.id}:${unit.latitude}:${unit.longitude}`) : []),
    ...visibleLiveResponders.map((responder) => `responder:${responder.responderId}`),
  ].sort().join('|'), [visibleIncidents, commandLocationPins, dispatchUnits, filters.responding, boundary, visibleLiveResponders]);

  // Click Handlers
  const handleOpenIncidentPin = (item: IncidentItem) => {
    setSelectedAvailabilityPin(null);
    setAvailableResponderPins([]);
    setSelectedResponderId(null);
    setSelectedUnit(null);
    setSelectedIncident(item);
    setInvalidReviewStep(null);
    setInvalidReason('');
    // Dispatcher instructions have their own field. Never seed them from
    // barangay escalation or responder field-assessment notes.
    setMdrrmoNotes(item.mdrrmo_dispatch_notes || '');
    setEscalatedResponseTab('barangay');
    setResponderInfoTab('assessment');
    setProofPreviewOpen(false);
    const firstVisual = (item.proof_urls && item.proof_urls.length > 0)
      ? item.proof_urls[0]
      : (item.proof_url || (item.responder_media && item.responder_media.length > 0 ? item.responder_media[0].url : null));
    setSelectedVisualUrl(firstVisual);
    setActiveModalType(item.report_kind === 'escalated' ? 'escalated' : 'incident');
  };

  const handleOpenUnitPin = (unit: DispatchUnitItem) => {
    setSelectedAvailabilityPin(null);
    setAvailableResponderPins([]);
    setSelectedResponderId(null);
    setSelectedIncident(null);
    setSelectedVisualUrl(null);
    setProofPreviewOpen(false);
    setSelectedUnit(unit);
    setActiveModalType('unit');
  };

  const handleSelectResponderPin = (responderId: string) => {
    setSelectedIncident(null);
    setSelectedUnit(null);
    setSelectedResponderId(responderId);
  };

  const closeModal = () => {
    setActiveModalType(null);
    setSelectedIncident(null);
    setSelectedUnit(null);
    setSelectedVisualUrl(null);
    setProofPreviewOpen(false);
    setInvalidReviewStep(null);
    setInvalidReason('');
  };

  const closeInvalidReview = () => {
    setInvalidReviewStep(null);
    setInvalidReason('');
  };

  const submitInvalidReview = async (outcome: 'inconclusive' | 'false_report') => {
    if (!selectedIncident || reviewSubmitting) return;
    const reason = invalidReason.trim();
    if (outcome === 'inconclusive' && !reason) {
      toast.error('Enter a reason before marking this report inconclusive.');
      return;
    }
    setReviewSubmitting(true);
    try {
      const response = await reportAPI.review(selectedIncident.id, { outcome, reason });
      const count = Number(response.data?.false_report_count ?? selectedIncident.reporter_false_report_count ?? 0);
      if (outcome === 'false_report') {
        toast.success(response.data?.resident_status === 'inactive'
          ? 'Report marked false. The resident account has been deactivated after 3 false reports.'
          : selectedIncident.reporter_id
            ? `Report marked false (${count} of 3 resident marks).`
            : 'Report marked false. No linked resident account was available for a strike.');
      } else {
        toast.success('Report marked inconclusive. The resident will be notified.');
      }
      setInvalidReviewStep(null);
      setSelectedIncident(null);
      setActiveModalType(null);
      await fetchData();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not save the report decision.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const copyToClipboard = (text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success(`Copied: ${text}`);
  };

  const openMdrrmoDispatch = async (incident: IncidentItem) => {
    const requestId = ++mdrrmoDispatchRequestId.current;
    setMdrrmoDispatchIncident(incident);
    setMdrrmoDispatchResponders([]);
    setSelectedMdrrmoResponderIds([]);
    setMdrrmoDispatchError('');
    setMdrrmoDispatchNotes(mdrrmoNotes.trim());
    const incidentType = incident.incident_type || '';
    setMdrrmoDispatchIncidentType(MDRRMO_DISPATCH_INCIDENT_TYPES.some((option) => option.value === incidentType) ? incidentType : '');
    setMdrrmoDispatchSeverity(MDRRMO_DISPATCH_SEVERITIES.some((option) => option.value === incident.severity) ? incident.severity || '' : '');
    setMdrrmoDispatchLoading(true);
    try {
      const response = await reportAPI.mdrrmoResponders();
      if (requestId !== mdrrmoDispatchRequestId.current) return;
      setMdrrmoDispatchResponders(response.data?.responders || []);
    } catch (error: any) {
      if (requestId !== mdrrmoDispatchRequestId.current) return;
      setMdrrmoDispatchError(error?.response?.data?.error || 'Could not load active MDRRMO responders.');
    } finally {
      if (requestId === mdrrmoDispatchRequestId.current) setMdrrmoDispatchLoading(false);
    }
  };

  const closeMdrrmoDispatch = () => {
    if (dispatching) return;
    mdrrmoDispatchRequestId.current += 1;
    setMdrrmoDispatchIncident(null);
    setMdrrmoDispatchLoading(false);
  };

  const submitMdrrmoDispatch = async () => {
    const incident = mdrrmoDispatchIncident;
    if (!incident || dispatching || selectedMdrrmoResponderIds.length === 0 || !mdrrmoDispatchIncidentType || !mdrrmoDispatchSeverity) return;

    setDispatching(true);
    try {
      await reportAPI.dispatchToMdrrmo(incident.id, {
        responder_ids: selectedMdrrmoResponderIds,
        incident_type: mdrrmoDispatchIncidentType,
        severity: mdrrmoDispatchSeverity,
        notes: mdrrmoDispatchNotes.trim(),
      });
      const assignedNames = mdrrmoDispatchResponders
        .filter((responder) => selectedMdrrmoResponderIds.includes(responder.id))
        .map((responder) => responder.officer_name || responder.full_name)
        .join(', ');
      toast.success(selectedMdrrmoResponderIds.length === 1
        ? `Dispatched to ${assignedNames}. The report is in their pending queue.`
        : `Dispatched to ${assignedNames} (${selectedMdrrmoResponderIds.length} responders).`);
      setMdrrmoDispatchIncident(null);
      setMdrrmoNotes('');
      closeModal();
      await fetchData();
    } catch (error: any) {
      const response = error?.response?.data;
      const diagnostics = [
        response?.stage ? `Stage: ${response.stage}` : null,
        response?.cause_code ? `Code: ${response.cause_code}` : null,
      ].filter(Boolean).join(' · ');
      const message = response?.error || 'Could not dispatch the report to MDRRMO responders.';
      toast.error(diagnostics ? `${message} (${diagnostics})` : message);
    } finally {
      setDispatching(false);
    }
  };

  const openVisualFullscreen = () => {
    const media = previewMediaRef.current;
    if (media?.requestFullscreen) {
      media.requestFullscreen().catch(() => window.open(selectedVisualUrl || '', '_blank', 'noopener,noreferrer'));
      return;
    }
    if (selectedVisualUrl) window.open(selectedVisualUrl, '_blank', 'noopener,noreferrer');
  };

  // Co-response confirmation modal state
  const [coResponseConfirmModal, setCoResponseConfirmModal] = useState<{
    open: boolean;
    incident: IncidentItem | null;
  } | null>(null);

  const executeMdrrmoDispatch = async (incident: IncidentItem) => {
    setCoResponseConfirmModal(null);
    await openMdrrmoDispatch(incident);
  };

  const handleDispatch = (overrideConfirm = false) => {
    if (!selectedIncident) return;
    if (isBarangayDashboard) {
      navigate(`/reports?id=${encodeURIComponent(selectedIncident.id)}&status=${selectedIncident.status === 'resolved' ? 'resolved' : selectedIncident.status === 'responding' || selectedIncident.status === 'arrived' ? 'responding' : 'pending'}`);
      return;
    }

    // Check if Barangay is currently responding
    const isBarangayResponding =
      selectedIncident.barangay_response_status === 'responding' ||
      Boolean(selectedIncident.responder_name && selectedIncident.responder_name !== 'MDRRMO');

    if (activeModalType === 'incident' && !isBarangayResponding && !overrideConfirm) {
      void openMdrrmoDispatch(selectedIncident);
      return;
    }

    if (isBarangayResponding && !overrideConfirm) {
      // Show confirmation prompt
      setCoResponseConfirmModal({
        open: true,
        incident: selectedIncident
      });
      return;
    }

    executeMdrrmoDispatch(selectedIncident);
  };

  return (
    <div className="command-center-wrapper">
      {/* Top Header */}
      <div className="command-center-header">
        <h1 className="command-center-title">Command Center</h1>
        <div className="command-center-live">
          <span className="live-dot"></span>
          Live • {currentTime}
        </div>
      </div>

      {/* Compact stats and layer filters */}
      <div className="command-center-toolbar">
        <div className="command-hud-top-row">
          <div className="command-hud-top-row-stats">
              <div className="command-stat-card incident">
                <div className="stat-info">
                  <span className="stat-val">{stats.incident}</span>
                  <span className="stat-name">Incident</span>
                </div>
                <span className="stat-card-icon"><AlertTriangle size={20} strokeWidth={2} color="#f59e0b" /></span>
              </div>

              <div className="command-stat-card escalated">
                <div className="stat-info">
                  <span className="stat-val">{stats.escalated}</span>
                  <span className="stat-name">Escalated</span>
                </div>
                <span className="stat-card-icon"><Siren size={20} strokeWidth={2} color="#ef4444" /></span>
              </div>

              <div className="command-stat-card dispatch">
                <div className="stat-info">
                  <span className="stat-val">{stats.dispatch}</span>
                  <span className="stat-name">Dispatch Units</span>
                </div>
                <span className="stat-card-icon"><Users size={20} strokeWidth={2} color="#38bdf8" /></span>
              </div>

              <div className="command-stat-card resolved">
                <div className="stat-info">
                  <span className="stat-val">{stats.resolved}</span>
                  <span className="stat-name">Resolved</span>
                </div>
                <span className="stat-card-icon"><CheckCircle2 size={20} strokeWidth={2} color="#10b981" /></span>
              </div>
          </div>
        </div>

        <div className="command-hud-filter-row">
            <span className="command-hud-filter-heading">Showing:</span>
            <label className="hud-checkbox-label" style={{ color: filters.incidents ? '#f97316' : '#64748b' }}>
              <input
                type="checkbox"
                checked={filters.incidents}
                onChange={(e) => setFilters({ ...filters, incidents: e.target.checked })}
                style={{ accentColor: '#f97316' }}
              />
              Resident Report
            </label>

            <label className="hud-checkbox-label" style={{ color: filters.escalated ? '#ef4444' : '#64748b' }}>
              <input
                type="checkbox"
                checked={filters.escalated}
                onChange={(e) => setFilters({ ...filters, escalated: e.target.checked })}
                style={{ accentColor: '#ef4444' }}
              />
              Escalated Report
            </label>

            <label className="hud-checkbox-label" style={{ color: filters.arrived ? '#06b6d4' : '#64748b' }}>
              <input
                type="checkbox"
                checked={filters.arrived}
                onChange={(e) => setFilters({ ...filters, arrived: e.target.checked })}
                style={{ accentColor: '#06b6d4' }}
              />
              Rescuer Arrived
            </label>

            <label className="hud-checkbox-label" style={{ color: filters.responding ? '#818cf8' : '#64748b' }}>
              <input
                type="checkbox"
                checked={filters.responding}
                onChange={(e) => setFilters({ ...filters, responding: e.target.checked })}
                style={{ accentColor: '#818cf8' }}
              />
              Responding
            </label>

            <label className="hud-checkbox-label" style={{ color: filters.resolved ? '#10b981' : '#64748b' }}>
              <input
                type="checkbox"
                checked={filters.resolved}
                onChange={(e) => setFilters({ ...filters, resolved: e.target.checked })}
                style={{ accentColor: '#10b981' }}
              />
              Resolved
            </label>
        </div>
      </div>

      {/* Full-height operational map */}
      <div className="map-card-container">
        {/* Leaflet Map */}
        <MapContainer
          center={[14.9055, 121.0450]}
          zoom={13}
          zoomControl={false}
          style={{ width: '100%', height: '100%', background: '#ffffff' }}
        >
          <TileLayer url={CARTO_DARK_MAP_URL} attribution={CARTO_ATTRIBUTION} />
          <MapResizer />
          <CommandCenterViewportController
            points={visiblePinPoints}
            fitKey={mapFitKey}
            boundary={boundary}
            selectionKey={selectedMapDot?.key || null}
            selectedPosition={selectedMapDot?.position || null}
          />

          <ClusteredIncidentMarkers incidents={visibleIncidents} selectedId={selectedIncident?.id} onSelect={handleOpenIncidentPin} />

          {commandLocationPins.map((pin) => (
            <Marker
              key={`command-location-pin-${pin.id}`}
              position={[pin.latitude, pin.longitude]}
              icon={pin.type === 'office' ? commandOfficePinIcon : commandBarangayPinIcon}
              zIndexOffset={1800}
              eventHandlers={{ click: () => void openAvailabilityForPin(pin) }}
            >
              <Popup className="command-map-cluster-popup" minWidth={220}>
                <div className="command-pin-popup">
                  <strong>{pin.name}</strong>
                  {pin.address && <span>{pin.address}</span>}
                  <small>{isBarangayDashboard && pin.type === 'office' ? 'Responder availability is limited to the MDRRMO dashboard.' : 'Click this pin to see available responders within 100 meters.'}</small>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Dispatch Units Markers */}
          {filters.responding &&
            dispatchUnits.map((u) => (
              (!boundary.enabled || isCoordinateInsideBoundary(u.latitude, u.longitude, boundary.geometry)) &&
              <Marker
                key={u.id}
                position={[u.latitude, u.longitude]}
                icon={createResponderUnitBadge(selectedUnit?.id === u.id)}
                zIndexOffset={selectedUnit?.id === u.id ? 1600 : 0}
                eventHandlers={{ click: () => handleOpenUnitPin(u) }}
              />
            ))}

          {/* Units Line (Dashed Polyline connecting Unit to Target Incident) */}
          {filters.responding &&
            dispatchUnits.map((u) => {
              if (!u.target_incident_id) return null;
              if (boundary.enabled && !isCoordinateInsideBoundary(u.latitude, u.longitude, boundary.geometry)) return null;
              const target = incidents.find((i) => i.id === u.target_incident_id);
              if (!target) return null;
              if (boundary.enabled && !isCoordinateInsideBoundary(target.latitude, target.longitude, boundary.geometry)) return null;

              return (
                <Polyline
                  key={`line-${u.id}-${target.id}`}
                  positions={[
                    [u.latitude, u.longitude],
                    [target.latitude, target.longitude],
                  ]}
                  pathOptions={{
                    color: '#6366F1',
                    weight: 3,
                    dashArray: '8, 8',
                    opacity: 0.9,
                  }}
                />
              );
            })}

          {filters.responding && (
            <LiveResponderOverlays
              locations={visibleLiveResponders}
              incidents={visibleIncidents}
              selectedResponderId={selectedResponderId}
              onSelectResponder={handleSelectResponderPin}
              onSelectIncident={handleOpenIncidentPin}
            />
          )}
          <MunicipalityBoundaryMapLayer boundary={boundary} />
        </MapContainer>

        {selectedAvailabilityPin && <aside className="command-availability-panel" aria-live="polite">
          <header><div><strong>{selectedAvailabilityPin.name}</strong><span>Available responders within 100 m</span></div><button type="button" aria-label="Close responder list" onClick={() => { setSelectedAvailabilityPin(null); setAvailableResponderPins([]); }}>×</button></header>
          {isBarangayDashboard && selectedAvailabilityPin.type === 'office'
            ? <p>Only MDRRMO command-center users can view MDRRMO responder availability.</p>
            : availabilityLoading ? <p>Checking active assignments and fresh GPS…</p>
              : availableResponderPins.length === 0 ? <p>No responders currently meet the availability and location requirements.</p>
                : <ul>{availableResponderPins.map((responder) => <li key={responder.id}><span><strong>{responder.full_name}</strong>{responder.phone && <a href={`tel:${responder.phone}`}>{responder.phone}</a>}</span><small>{responder.distance_m} m away</small></li>)}</ul>}
        </aside>}

        {!(activeModalType === 'escalated' || (activeModalType === 'incident' && selectedIncident?.status !== 'pending')) && <CurrentWeatherPanel />}

        {/* ── MODALS (Image 5, 1, 2) ── */}

        {/* 1. ORANGE INCIDENT PIN CLICK: 2-Panel Modal (Image 5) */}
        {activeModalType === 'incident' && selectedIncident && (
          <div className="pin-modal-backdrop report-selection-overlay resident-selection-overlay" onClick={closeModal}>
            <div className="pin-modal-container" onClick={(e) => e.stopPropagation()}>
              {/* Left Card: Resident Details & Visual Proofs */}
              <div className="panel-resident">
                <div className="selection-panel-heading">
                  <span>Resident Report</span>
                  <strong className={`report-status-badge status-${selectedIncident.status}`}>{selectedIncident.status === 'arrived' ? 'Arrived' : selectedIncident.status === 'responding' ? 'Responding' : selectedIncident.status === 'resolved' ? 'Resolved' : 'Pending'}</strong>
                  <button className="selection-close-btn" onClick={closeModal} aria-label="Close report"><X size={20} /></button>
                </div>
                <section className="reporter-detail-card">
                  <h2>Reporter Detail</h2>
                {/* Resident Header */}
                <div className="panel-header-user">
                  <div className="user-identity">
                    <div className="user-avatar-circle">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                    </div>
                    <div className="user-details-text">
                      <span className="user-title">{selectedIncident.reporter_name || 'Resident'}</span>
                      {selectedIncident.reporter_phone && <span className="user-phone">{selectedIncident.reporter_phone}</span>}
                    </div>
                  </div>
                  <div className="reporter-phone-row">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 11.19 18a19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.09 3.18 2 2 0 0 1 4.08 1h3a2 2 0 0 1 2 1.72c.12.9.34 1.78.65 2.62a2 2 0 0 1-.45 2.11L8 8.73a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.84.31 1.72.53 2.62.65A2 2 0 0 1 22 16.92z" /></svg>
                    <span>{selectedIncident.reporter_phone || 'Phone number unavailable'}</span>
                  </div>
                  {selectedIncident.reporter_phone && <button
                    className="copy-btn"
                    title="Copy phone number"
                    onClick={() => copyToClipboard(selectedIncident.reporter_phone)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>}
                </div>
                </section>

                <div className="panel-details-box reporter-notes">
                  <div className="reporter-note-content">
                    <strong>Incident time</strong>
                    <p>{incidentTimeText(selectedIncident.incident_occurred_at, selectedIncident.incident_time_precision)}</p>
                    <p>{reportReceivedText(selectedIncident.created_at)}</p>
                  </div>
                </div>

                {/* Section Title */}
                <div className="section-label-row resident-proof-heading">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                  <span>Proof</span>
                  <strong>{(selectedIncident.proof_urls?.length || (selectedIncident.proof_url ? 1 : 0))} Attachment{(selectedIncident.proof_urls?.length || (selectedIncident.proof_url ? 1 : 0)) === 1 ? '' : 's'}</strong>
                </div>

                {/* Proof thumbnail grid */}
                {(() => {
                  const proofs = (selectedIncident.proof_urls && selectedIncident.proof_urls.length > 0)
                    ? selectedIncident.proof_urls
                    : (selectedIncident.proof_url ? [selectedIncident.proof_url] : []);

                  if (proofs.length === 0) {
                    return (
                      <div className="resident-proof-grid resident-proof-empty">
                        No visual proof submitted
                      </div>
                    );
                  }

                  return (
                    <div className="resident-proof-grid">
                      {proofs.map((url, idx) => {
                        const isVid = isVideoProof(url, selectedIncident.proof_types?.[idx] || selectedIncident.proof_type);
                        const isActive = selectedVisualUrl === url;
                        return (
                          <div
                            key={url + idx}
                            className={`grid-thumb-item ${isActive ? 'active' : ''}`}
                            onClick={() => { setSelectedVisualUrl(url); setProofPreviewOpen(true); }}
                            style={{
                              position: 'relative',
                              width: '64px',
                              height: '64px',
                              cursor: 'pointer',
                              border: isActive ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.15)',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              background: '#000',
                            }}
                          >
                            {isVid ? (
                              <>
                                <video src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                </div>
                              </>
                            ) : (
                              <img src={url} alt={`Proof thumbnail ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Responder Field Media Section */}
                {selectedIncident.responder_media && selectedIncident.responder_media.length > 0 && (
                  <div className="responder-media-section" style={{ marginTop: '8px', marginBottom: '12px' }}>
                    <div className="section-label-row" style={{ marginBottom: '6px' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                        <circle cx="12" cy="13" r="4"></circle>
                      </svg>
                      <span style={{ color: '#10b981' }}>
                        From the responder ({selectedIncident.responder_media.length})
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {selectedIncident.responder_media.map((item, mIdx) => {
                        const isVid = isVideoProof(item.url, item.type);
                        const isActive = selectedVisualUrl === item.url;
                        return (
                          <div
                            key={item.url + mIdx}
                            className={`grid-thumb-item ${isActive ? 'active' : ''}`}
                            onClick={() => { setSelectedVisualUrl(item.url); setProofPreviewOpen(true); }}
                            title={`Uploaded by ${item.uploader_name || 'Responder'}`}
                            style={{
                              position: 'relative',
                              width: '64px',
                              height: '64px',
                              cursor: 'pointer',
                              border: isActive ? '2px solid #10b981' : '1px solid rgba(16,185,129,0.35)',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              background: '#0a192f',
                            }}
                          >
                            {isVid ? (
                              <>
                                <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                </div>
                              </>
                            ) : (
                              <img src={item.url} alt="Field media" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            )}
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.75)', fontSize: '8px', color: '#fff', textAlign: 'center', padding: '1px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.uploader_name || 'Field'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Response details box */}
                <div className="panel-details-box reporter-notes">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <div className="reporter-note-content">
                    <strong>Details about the report..</strong>
                    {selectedIncident.description?.trim()
                      ? <p>{selectedIncident.description}</p>
                      : <div className="reporter-note-empty"><strong>No Details Provided</strong><span>Review the attached media</span></div>}
                  </div>
                </div>
                {selectedIncident.status === 'pending' && <div className="selection-actions">
                  {!isBarangayDashboard && <button className="selection-invalid-btn" onClick={() => setInvalidReviewStep('choice')}>Invalid Report</button>}
                  {!selectedIncident.mdrrmo_dispatched && (
                    <button type="button" className="selection-dispatch-btn" onClick={() => handleDispatch()} disabled={dispatching}>
                      {dispatching ? 'Dispatching…' : 'Dispatch'}
                    </button>
                  )}
                </div>}
              </div>

              {/* Right Card: Visual Preview Viewport */}
              <div className="panel-preview">
                <div className="preview-header-row">
                  <div className="preview-title-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    <span>Visual Preview</span>
                  </div>
                  <button className="close-x-btn" onClick={closeModal} title="Close">
                    ✕
                  </button>
                </div>

                <div className="preview-display-viewport">
                  {selectedVisualUrl ? (
                    <>
                      {isVideoProof(selectedVisualUrl, selectedIncident.proof_type) ? (
                        <video
                          ref={(element) => { previewMediaRef.current = element; }}
                          key={selectedVisualUrl}
                          src={selectedVisualUrl}
                          controls
                          playsInline
                          className="preview-display-image"
                          style={{ background: '#000' }}
                        />
                      ) : (
                        <img ref={(element) => { previewMediaRef.current = element; }} src={selectedVisualUrl} alt="Visual preview" className="preview-display-image" />
                      )}
                      <button
                        className="preview-fullscreen-btn"
                        onClick={openVisualFullscreen}
                        title="View full screen"
                        aria-label="View full screen"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <polyline points="9 21 3 21 3 15"></polyline>
                          <line x1="21" y1="3" x2="14" y2="10"></line>
                          <line x1="3" y1="21" x2="10" y2="14"></line>
                        </svg>
                      </button>
                    </>
                  ) : (
                    <div className="preview-empty-state">
                      <div className="preview-empty-icon">🖼️</div>
                      <div className="preview-empty-title">Choose Visual to Preview</div>
                      <div className="preview-empty-sub">Select a proof thumbnail to preview it here</div>
                    </div>
                  )}
                </div>

                <div className="preview-action-row">
                  <button className="btn-preview-close" onClick={closeModal}>
                    ✕ CLOSE
                  </button>
                  <button className="btn-preview-dispatch" onClick={() => handleDispatch()}>
                    🚑 DISPATCH
                  </button>
                </div>
              </div>
              {selectedIncident.status !== 'pending' && (
                <ResponderAssessmentPanel
                  incident={selectedIncident}
                  assistanceRequests={assistanceRequests}
                  assistanceRequestLoading={assistanceRequestsLoading}
                  notes={selectedIncident.barangay_response_notes || selectedIncident.mdrrmo_response_notes}
                  mediaSource="all"
                  view={responderInfoTab}
                  onViewChange={setResponderInfoTab}
                  onPreview={(url) => { setSelectedVisualUrl(url); setProofPreviewOpen(true); }}
                />
              )}
            </div>
          </div>
        )}

        {/* 2. RED ESCALATED PIN CLICK: 3-Panel Modal (User request Image 1) */}
        {activeModalType === 'escalated' && selectedIncident && (
          <div className="pin-modal-backdrop report-selection-overlay escalated-selection-overlay" onClick={closeModal}>
            <div className="pin-modal-container" onClick={(e) => e.stopPropagation()}>
              {/* Left Card: Resident Details & Visual Proofs */}
              <div className="panel-resident escalated-report-panel">
                <div className="selection-panel-heading">
                  <span>Escalated Report</span>
                  <strong className={`report-status-badge status-${selectedIncident.status}`}>{selectedIncident.status === 'arrived' ? 'Arrived' : selectedIncident.status === 'responding' ? 'Responding' : selectedIncident.status === 'resolved' ? 'Resolved' : 'Pending'}</strong>
                  <button className="selection-close-btn" onClick={closeModal} aria-label="Close report"><X size={20} /></button>
                </div>
                <section className="reporter-detail-card">
                  <h2>Reporter Detail</h2>
                <div className="panel-header-user">
                  <div className="user-identity">
                    <div className="user-avatar-circle">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                    </div>
                    <div className="user-details-text">
                      <span className="user-title">{selectedIncident.reporter_name || 'Resident'}</span>
                      {selectedIncident.reporter_phone && <span className="user-phone">{selectedIncident.reporter_phone}</span>}
                    </div>
                  </div>
                  <div className="reporter-phone-row">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 11.19 18a19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.09 3.18 2 2 0 0 1 4.08 1h3a2 2 0 0 1 2 1.72c.12.9.34 1.78.65 2.62a2 2 0 0 1-.45 2.11L8 8.73a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.84.31 1.72.53 2.62.65A2 2 0 0 1 22 16.92z" /></svg>
                    <span>{selectedIncident.reporter_phone || 'Phone number unavailable'}</span>
                  </div>
                  {selectedIncident.reporter_phone && <button
                    className="copy-btn"
                    title="Copy phone number"
                    onClick={() => copyToClipboard(selectedIncident.reporter_phone)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>}
                </div>
                </section>

                <div className="panel-details-box reporter-notes">
                  <div className="reporter-note-content">
                    <strong>Incident time</strong>
                    <p>{incidentTimeText(selectedIncident.incident_occurred_at, selectedIncident.incident_time_precision)}</p>
                    <p>{reportReceivedText(selectedIncident.created_at)}</p>
                  </div>
                </div>

                <div className="panel-details-box reporter-notes">
                  <div className="reporter-note-content">
                    <strong>Details about the report..</strong>
                    {selectedIncident.description?.trim()
                      ? <p>{selectedIncident.description}</p>
                      : <div className="reporter-note-empty"><strong>No Details Provided</strong><span>Review the attached media</span></div>}
                  </div>
                </div>

                <div className="section-label-row resident-proof-heading">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                  <span>Proof</span>
                  <strong>{(selectedIncident.proof_urls?.length || (selectedIncident.proof_url ? 1 : 0))} Attachment{(selectedIncident.proof_urls?.length || (selectedIncident.proof_url ? 1 : 0)) === 1 ? '' : 's'}</strong>
                </div>

                {/* Proof thumbnail grid */}
                {(() => {
                  const proofs = (selectedIncident.proof_urls && selectedIncident.proof_urls.length > 0)
                    ? selectedIncident.proof_urls
                    : (selectedIncident.proof_url ? [selectedIncident.proof_url] : []);

                  if (proofs.length === 0) {
                    return (
                      <div className="resident-proof-grid resident-proof-empty">
                        No visual proof submitted
                      </div>
                    );
                  }

                  return (
                    <div className="resident-proof-grid">
                      {proofs.map((url, idx) => {
                        const isVid = isVideoProof(url, selectedIncident.proof_types?.[idx] || selectedIncident.proof_type);
                        const isActive = selectedVisualUrl === url;
                        return (
                          <div
                            key={url + idx}
                            className={`grid-thumb-item ${isActive ? 'active' : ''}`}
                            onClick={() => { setSelectedVisualUrl(url); setProofPreviewOpen(true); }}
                            style={{
                              position: 'relative',
                              width: '64px',
                              height: '64px',
                              cursor: 'pointer',
                              border: isActive ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.15)',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              background: '#000',
                            }}
                          >
                            {isVid ? (
                              <>
                                <video src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                </div>
                              </>
                            ) : (
                              <img src={url} alt={`Proof thumbnail ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Responder Field Media Section */}
                {selectedIncident.responder_media && selectedIncident.responder_media.length > 0 && (
                  <div className="responder-media-section" style={{ marginTop: '8px', marginBottom: '12px' }}>
                    <div className="section-label-row" style={{ marginBottom: '6px' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                        <circle cx="12" cy="13" r="4"></circle>
                      </svg>
                      <span style={{ color: '#10b981' }}>
                        From the responder ({selectedIncident.responder_media.length})
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {selectedIncident.responder_media.map((item, mIdx) => {
                        const isVid = isVideoProof(item.url, item.type);
                        const isActive = selectedVisualUrl === item.url;
                        return (
                          <div
                            key={item.url + mIdx}
                            className={`grid-thumb-item ${isActive ? 'active' : ''}`}
                            onClick={() => { setSelectedVisualUrl(item.url); setProofPreviewOpen(true); }}
                            title={`Uploaded by ${item.uploader_name || 'Responder'}`}
                            style={{
                              position: 'relative',
                              width: '64px',
                              height: '64px',
                              cursor: 'pointer',
                              border: isActive ? '2px solid #10b981' : '1px solid rgba(16,185,129,0.35)',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              background: '#0a192f',
                            }}
                          >
                            {isVid ? (
                              <>
                                <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                </div>
                              </>
                            ) : (
                              <img src={item.url} alt="Field media" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            )}
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.75)', fontSize: '8px', color: '#fff', textAlign: 'center', padding: '1px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.uploader_name || 'Field'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedIncident.status === 'pending' && !selectedIncident.mdrrmo_dispatched && (
                  <div className="selection-actions escalated-selection-actions">
                    {!isBarangayDashboard && <button type="button" className="selection-dispatch-btn" onClick={() => handleDispatch()} disabled={dispatching}>
                      {dispatching ? 'Dispatching…' : 'Dispatch'}
                    </button>}
                  </div>
                )}

              </div>

              {/* Center Card: Visual Preview Viewport */}
              <div className="panel-preview">
                <div className="preview-header-row">
                  <div className="preview-title-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    <span>Visual Preview</span>
                  </div>
                  <button className="close-x-btn" onClick={closeModal} title="Close">
                    ✕
                  </button>
                </div>

                <div className="preview-display-viewport">
                  {selectedVisualUrl ? (
                    <>
                      {isVideoProof(selectedVisualUrl, selectedIncident.proof_type) ? (
                        <video
                          ref={(element) => { previewMediaRef.current = element; }}
                          key={selectedVisualUrl}
                          src={selectedVisualUrl}
                          controls
                          playsInline
                          className="preview-display-image"
                          style={{ background: '#000' }}
                        />
                      ) : (
                        <img ref={(element) => { previewMediaRef.current = element; }} src={selectedVisualUrl} alt="Visual preview" className="preview-display-image" />
                      )}
                      <button
                        className="preview-fullscreen-btn"
                        onClick={openVisualFullscreen}
                        title="View full screen"
                        aria-label="View full screen"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <polyline points="9 21 3 21 3 15"></polyline>
                          <line x1="21" y1="3" x2="14" y2="10"></line>
                          <line x1="3" y1="21" x2="10" y2="14"></line>
                        </svg>
                      </button>
                    </>
                  ) : (
                    <div className="preview-empty-state">
                      <div className="preview-empty-icon">🖼️</div>
                      <div className="preview-empty-title">Choose Visual to Preview</div>
                      <div className="preview-empty-sub">Select a proof thumbnail to preview it here</div>
                    </div>
                  )}
                </div>

                <div className="preview-action-row">
                  <button className="btn-preview-close" onClick={closeModal}>
                    ✕ CLOSE
                  </button>
                  <button className="btn-preview-dispatch" onClick={() => handleDispatch()}>
                    🚑 DISPATCH
                  </button>
                </div>
              </div>

              {/* Right Card: Team Leader Initial Response */}
              <div className="panel-teamleader">
                <div className="panel-header-user">
                  <div className="user-identity">
                    <div className="user-avatar-circle purple">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg>
                    </div>
                    <div className="user-details-text">
                      <span className="user-title">{selectedIncident.barangay_name || 'Responding Barangay'}</span>
                      <span className="user-title" style={{ fontSize: '11px', color: '#cbd5e1' }}>
                        Responder: {selectedIncident.responder_name || selectedIncident.barangay_responder_name || 'N/A'}
                      </span>
                      {selectedIncident.responder_phone && (
                        <span className="user-phone purple">{selectedIncident.responder_phone}</span>
                      )}
                    </div>
                  </div>
                  {selectedIncident.responder_phone && <button
                    className="copy-btn"
                    title="Copy phone number"
                    onClick={() => copyToClipboard(selectedIncident.responder_phone)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>}
                </div>

                <div className="section-label-row purple">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                  <span>Initial Response Notes</span>
                </div>

                <div className="panel-details-box purple" style={{ marginTop: '8px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                  </svg>
                  <div>
                    {selectedIncident.barangay_response_notes || 'No initial response notes available.'}
                  </div>
                </div>
              </div>
              <EscalatedResponsePanel
                incident={selectedIncident}
                assistanceRequests={assistanceRequests}
                assistanceRequestLoading={assistanceRequestsLoading}
                tab={escalatedResponseTab}
                onTabChange={setEscalatedResponseTab}
                responderView={responderInfoTab}
                onResponderViewChange={setResponderInfoTab}
                onPreview={(url) => { setSelectedVisualUrl(url); setProofPreviewOpen(true); }}
              />
            </div>
          </div>
        )}

        {invalidReviewStep && selectedIncident && (
          <div className="invalid-review-overlay" onClick={closeInvalidReview}>
            <section className="invalid-review-dialog" role="dialog" aria-modal="true" aria-labelledby="invalid-review-title" onClick={(event) => event.stopPropagation()}>
              <button className="selection-close-btn invalid-review-close" onClick={closeInvalidReview} aria-label="Close review"><X size={20} /></button>
              <h2 id="invalid-review-title">
                {invalidReviewStep === 'choice'
                  ? `Why is ${selectedIncident.reporter_name || 'the resident'}’s Report Invalid?`
                  : 'Why is this report inconclusive?'}
              </h2>
              {invalidReviewStep === 'choice' ? (
                <>
                  <p>Choose how MDRRMO should record this review.</p>
                  <div className="invalid-review-options">
                    <button className="inconclusive-option" onClick={() => setInvalidReviewStep('reason')}>Inconclusive</button>
                    <button className="false-reporter-option" onClick={() => void submitInvalidReview('false_report')} disabled={reviewSubmitting}>
                      {reviewSubmitting ? 'Saving…' : 'False Reporter'}
                      <small>{selectedIncident.reporter_id
                        ? `${selectedIncident.reporter_false_report_count || 0} of 3 marks${(selectedIncident.reporter_false_report_count || 0) >= 2 ? ' · next mark deactivates account' : ''}`
                        : 'No linked resident account'}</small>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>The resident will receive this reason with the report status.</p>
                  <textarea autoFocus className="invalid-review-reason" value={invalidReason} onChange={(event) => setInvalidReason(event.target.value)} placeholder="Explain what could not be confirmed…" maxLength={1000} />
                  <div className="invalid-review-actions">
                    <button onClick={closeInvalidReview} disabled={reviewSubmitting}>Cancel</button>
                    <button onClick={() => void submitInvalidReview('inconclusive')} disabled={reviewSubmitting || !invalidReason.trim()}>{reviewSubmitting ? 'Saving…' : 'Notify Resident'}</button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {proofPreviewOpen && selectedVisualUrl && selectedIncident && (
          <div className="proof-lightbox" onClick={() => setProofPreviewOpen(false)}>
            <button className="selection-close-btn" onClick={() => setProofPreviewOpen(false)} aria-label="Close preview"><X size={22} /></button>
            {isVideoProof(selectedVisualUrl, selectedIncident.proof_type)
              ? <video ref={(element) => { previewMediaRef.current = element; }} src={selectedVisualUrl} controls autoPlay playsInline onClick={(event) => event.stopPropagation()} />
              : <img ref={(element) => { previewMediaRef.current = element; }} src={selectedVisualUrl} alt="Report evidence" onClick={(event) => event.stopPropagation()} />}
          </div>
        )}

        {/* 3. CYAN DISPATCH UNIT PIN CLICK: Respond Unit Preview Modal (User request Image 2) */}
        {activeModalType === 'unit' && selectedUnit && (
          <div className="pin-modal-backdrop" onClick={closeModal}>
            <div className="panel-respond-unit" onClick={(e) => e.stopPropagation()}>
              <div className="preview-header-row">
                <div className="preview-title-wrap">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  <span>Respond Unit Preview</span>
                </div>
                <button className="close-x-btn" onClick={closeModal} title="Close">
                  ✕
                </button>
              </div>

              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#fff' }}>{selectedUnit.name}</h3>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{selectedUnit.specialization}</div>
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0' }}>{selectedUnit.leader_name}</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginTop: '8px', marginBottom: '6px' }}>
                  Member/Officers:
                </div>

                <div className="unit-members-box">
                  {selectedUnit.members.map((member, idx) => (
                    <div key={idx} className="unit-member-item">
                      <span style={{ color: '#38bdf8' }}>•</span> {member}
                    </div>
                  ))}
                </div>
              </div>

              <div className="unit-location-box">
                <span className="unit-location-label">Responding to:</span>
                <span className="unit-location-val">{selectedUnit.target_location || 'Location'}</span>
              </div>
            </div>
          </div>
        )}

        {mdrrmoDispatchIncident && (
          <div className="mdrrmo-dispatch-overlay" onClick={closeMdrrmoDispatch}>
            <section
              className="mdrrmo-dispatch-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mdrrmo-dispatch-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="mdrrmo-dispatch-header">
                <div>
                  <h2 id="mdrrmo-dispatch-title">Dispatch MDRRMO Responders</h2>
                  <p>Classify the incident and assign active responders to the report.</p>
                </div>
                <button type="button" className="selection-close-btn" aria-label="Close dispatch" onClick={closeMdrrmoDispatch} disabled={dispatching}>
                  <X size={18} />
                </button>
              </header>

              <div className="mdrrmo-dispatch-summary">
                <strong>{mdrrmoDispatchIncident.title}</strong>
                <span>{mdrrmoDispatchIncident.barangay_name || 'Barangay not listed'}</span>
              </div>

              <div className="mdrrmo-dispatch-classification">
                <label>
                  Incident type
                  <select value={mdrrmoDispatchIncidentType} onChange={(event) => setMdrrmoDispatchIncidentType(event.target.value)}>
                    <option value="">Select incident type</option>
                    {MDRRMO_DISPATCH_INCIDENT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  Severity
                  <select value={mdrrmoDispatchSeverity} onChange={(event) => setMdrrmoDispatchSeverity(event.target.value)}>
                    <option value="">Select severity</option>
                    {MDRRMO_DISPATCH_SEVERITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <label className="mdrrmo-dispatch-notes">
                Dispatcher notes <span>(optional · sent to responders; separate from escalation notes)</span>
                <textarea
                  value={mdrrmoDispatchNotes}
                  onChange={(event) => setMdrrmoDispatchNotes(event.target.value)}
                  maxLength={1000}
                  placeholder="Add instructions or response details…"
                />
              </label>

              <section className="mdrrmo-dispatch-team">
                <div className="mdrrmo-dispatch-team-heading">
                  <h3>Active responders</h3>
                  {mdrrmoDispatchResponders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedMdrrmoResponderIds(
                        selectedMdrrmoResponderIds.length === mdrrmoDispatchResponders.length
                          ? []
                          : mdrrmoDispatchResponders.map((responder) => responder.id),
                      )}
                      disabled={mdrrmoDispatchLoading || dispatching}
                    >
                      {selectedMdrrmoResponderIds.length === mdrrmoDispatchResponders.length ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                </div>

                {mdrrmoDispatchLoading ? (
                  <div className="mdrrmo-dispatch-empty">Loading responder team…</div>
                ) : mdrrmoDispatchError ? (
                  <div className="mdrrmo-dispatch-error">{mdrrmoDispatchError}</div>
                ) : mdrrmoDispatchResponders.length === 0 ? (
                  <div className="mdrrmo-dispatch-empty">No active MDRRMO responders are available.</div>
                ) : (
                  <div className="mdrrmo-dispatch-responder-list">
                    {mdrrmoDispatchResponders.map((responder) => (
                      <label key={responder.id} className={`mdrrmo-dispatch-responder ${selectedMdrrmoResponderIds.includes(responder.id) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedMdrrmoResponderIds.includes(responder.id)}
                          onChange={(event) => setSelectedMdrrmoResponderIds((current) => event.target.checked
                            ? [...current, responder.id]
                            : current.filter((id) => id !== responder.id))}
                          disabled={dispatching}
                        />
                        <span>
                          <strong>{responder.officer_name || responder.full_name}</strong>
                          <small>{responder.unit_name || 'Response unit'}{responder.officer_name && responder.officer_name !== responder.full_name ? ` · Mobile account: ${responder.full_name}` : ''}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <footer className="mdrrmo-dispatch-actions">
                <button type="button" className="mdrrmo-dispatch-cancel" onClick={closeMdrrmoDispatch} disabled={dispatching}>Cancel</button>
                <button
                  type="button"
                  className="mdrrmo-dispatch-submit"
                  onClick={() => void submitMdrrmoDispatch()}
                  disabled={dispatching || mdrrmoDispatchLoading || mdrrmoDispatchResponders.length === 0 || selectedMdrrmoResponderIds.length === 0 || !mdrrmoDispatchIncidentType || !mdrrmoDispatchSeverity}
                >
                  {dispatching ? 'Dispatching…' : `Dispatch${selectedMdrrmoResponderIds.length ? ` · ${selectedMdrrmoResponderIds.length}` : ''}`}
                </button>
              </footer>
            </section>
          </div>
        )}

        {/* 4. CO-RESPONSE CONFIRMATION MODAL */}
        {coResponseConfirmModal && coResponseConfirmModal.incident && (
          <div className="pin-modal-backdrop" style={{ zIndex: 9999 }} onClick={() => setCoResponseConfirmModal(null)}>
            <div
              className="pin-modal-container"
              style={{
                maxWidth: '460px',
                padding: '24px',
                background: '#1e293b',
                borderRadius: '16px',
                border: '1px solid #334155',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    flexShrink: 0
                  }}
                >
                  <AlertTriangle size={22} strokeWidth={2} color="#f59e0b" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 'bold', color: '#ffffff' }}>
                    Active Barangay Response
                  </h3>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                    Coordinated Emergency Response
                  </span>
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.6)',
                  padding: '16px',
                  borderRadius: '10px',
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  fontSize: '14px',
                  lineHeight: '1.6'
                }}
              >
                Barangay{' '}
                <strong style={{ color: '#38bdf8' }}>
                  {coResponseConfirmModal.incident.barangay_name || 'Partida'}
                </strong>{' '}
                is currently responding to this incident.
                <br /><br />
                Do you want to also respond to this incident?
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
                <button
                  type="button"
                  style={{
                    padding: '10px 18px',
                    borderRadius: '8px',
                    background: 'transparent',
                    border: '1px solid #475569',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '13px'
                  }}
                  onClick={() => setCoResponseConfirmModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    border: 'none',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '13px',
                    boxShadow: '0 4px 12px rgba(2, 132, 199, 0.4)'
                  }}
                  onClick={() => {
                    const inc = coResponseConfirmModal.incident;
                    setCoResponseConfirmModal(null);
                    if (inc) executeMdrrmoDispatch(inc);
                  }}
                >
                  🚑 Yes, Also Respond & Dispatch
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
