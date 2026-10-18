import { useEffect, useState, type FormEvent } from 'react';
import { LocateFixed, MapPin, Phone, Siren, Upload, X } from 'lucide-react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';
import { reportAPI } from '../lib/api';
import { INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';
import { CARTO_ATTRIBUTION, CARTO_DARK_MAP_URL } from '../lib/mapConfig';
import { useAuth } from '../context/AuthContext';
import IncidentTimeInput, { createInitialIncidentTime, type IncidentTimeValue } from '../components/IncidentTimeInput';
import MobileNumberInput from '../components/MobileNumberInput';
import { formatMobileNumber, isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';

function createGuestRequestId() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

type HotlineGroup = {
  barangay_name: string;
  entries: Array<{ label?: string; name?: string; phone?: string; number?: string; numbers?: string[]; purpose?: string }>;
};
type PublicHotlines = {
  national: Array<{ label: string; phone: string }>;
  mdrrmo: Array<{ label: string; phone: string }>;
  barangays: HotlineGroup[];
};
type PublicHotlineRow = {
  id: string;
  label: string;
  detail: string;
  phone: string;
};
type PublicBarangayOption = { id: string; name: string };
const emptyHotlines: PublicHotlines = { national: [], mdrrmo: [], barangays: [] };
const localEmergencyHotlines = [
  { id: 'pnp-norzagaray', label: 'Philippine National Police (PNP)', detail: 'Norzagaray Municipal Police Station', phone: '0998-598-5389' },
  { id: 'bfp-norzagaray', label: 'Bureau of Fire Protection (BFP)', detail: 'Norzagaray Fire Station', phone: '0943-348-1854' },
];
const incidentPinIcon = L.divIcon({ className: 'public-incident-pin', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] });
const defaultMapCenter: [number, number] = [14.9133, 121.0436];
const communityCategories = [
  'Minor Flooding', 'Drainage Blockage', 'Small Fire Incident', 'Fallen Tree Report', 'Road Damage Report',
  'Damaged House Report', 'Cracked Road Report', 'Unsafe Electrical Wiring', 'River Water Level Report',
  'Illegal Dumping', 'River Pollution Report', 'Smoke Pollution', 'Animal Carcass Disposal', 'Flood-Prone Area Report',
  'Heavy Rain Monitoring', 'Strong Wind Monitoring', 'Rising Water Level Monitoring', 'Landslide-Prone Area Report',
  'Earthquake Damage Observation',
];
function normalizePhilippineMobile(value?: string | null) {
  return normalizeMobileNumberInput(value);
}

function IncidentMapClickPicker({ onPick }: { onPick: (point: { latitude: number; longitude: number }) => void }) {
  useMapEvents({ click: ({ latlng }) => onPick({ latitude: latlng.lat, longitude: latlng.lng }) });
  return null;
}

function IncidentMapRecenter({ point }: { point: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(point, Math.max(map.getZoom(), 14), { animate: true });
  }, [map, point]);
  return null;
}

export default function PublicReportPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const reportType = searchParams.get('type') === 'community' ? 'community' : 'emergency';
  const [hotlines, setHotlines] = useState<PublicHotlines>(emptyHotlines);
  const [publicBarangays, setPublicBarangays] = useState<PublicBarangayOption[]>([]);
  const [selectedHotlineBarangay, setSelectedHotlineBarangay] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [incidentCategory, setIncidentCategory] = useState('not_sure');
  const [incidentTime, setIncidentTime] = useState<IncidentTimeValue>(createInitialIncidentTime);
  const [otherEmergency, setOtherEmergency] = useState('');
  const [communityCategory, setCommunityCategory] = useState(communityCategories[0]);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationSource, setLocationSource] = useState<'current' | 'map' | null>(null);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapLocation, setMapLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapLocationSource, setMapLocationSource] = useState<'current' | 'map' | null>(null);
  const [mapFocus, setMapFocus] = useState<[number, number]>(defaultMapCenter);
  const [mapLocationLoading, setMapLocationLoading] = useState(false);
  const [mapLocationMessage, setMapLocationMessage] = useState('');
  const [evidence, setEvidence] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [trackingReference, setTrackingReference] = useState('');
  const [submissionRequestId, setSubmissionRequestId] = useState(createGuestRequestId);
  const [submissionFingerprint, setSubmissionFingerprint] = useState('');
  const [submissionStartedAt, setSubmissionStartedAt] = useState('');

  useEffect(() => {
    if (user?.phone) setGuestPhone((current) => current || normalizePhilippineMobile(user.phone));
  }, [user?.phone]);

  useEffect(() => {
    reportAPI.publicHotlines()
      .then((response) => {
        const data = response.data || {};
        setHotlines({
          national: Array.isArray(data.national) ? data.national : [],
          mdrrmo: Array.isArray(data.mdrrmo) ? data.mdrrmo : [],
          barangays: Array.isArray(data.barangays) ? data.barangays : [],
        });
      })
      .catch(() => setHotlines({ ...emptyHotlines, national: [{ label: 'National Emergency Hotline', phone: '911' }] }));
  }, []);

  useEffect(() => {
    reportAPI.verifiedBarangays()
      .then((response) => {
        const rows = Array.isArray(response.data) ? response.data : [];
        setPublicBarangays(rows
          .filter((barangay: any) => typeof barangay?.name === 'string' && barangay.name.trim())
          .map((barangay: any) => ({ id: String(barangay.id || barangay.name), name: barangay.name.trim() })));
      })
      .catch(() => setPublicBarangays([]));
  }, []);

  const requestLocation = () => {
    setMessage('');
    setSubmitted(false);
    if (!navigator.geolocation) { setMessage('This browser cannot read your location.'); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationSource('current');
      },
      () => setMessage('Allow location access or try again from the incident location.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const openMapPicker = () => {
    setMapLocation(location);
    setMapLocationSource(locationSource);
    setMapFocus(location ? [location.latitude, location.longitude] : defaultMapCenter);
    setMapLocationMessage('');
    setMapPickerOpen(true);
  };

  const useCurrentLocationInPicker = () => {
    setMapLocationMessage('');
    if (!navigator.geolocation) {
      setMapLocationMessage('This browser cannot read your current location.');
      return;
    }
    setMapLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = { latitude: coords.latitude, longitude: coords.longitude };
        setMapLocation(point);
        setMapLocationSource('current');
        setMapFocus([point.latitude, point.longitude]);
        setMapLocationMessage('Current location pin placed. Confirm below to use it.');
        setMapLocationLoading(false);
      },
      () => {
        setMapLocationMessage('Could not get your current location. Allow location access and try again.');
        setMapLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const confirmMapLocation = () => {
    if (!mapLocation) return;
    setLocation(mapLocation);
    setLocationSource(mapLocationSource || 'map');
    setMapPickerOpen(false);
  };

  const publicHotlineRows: PublicHotlineRow[] = [
    ...(hotlines.national || []).map((line, index) => ({
      id: `national-${index}-${line.phone}`,
      label: line.label,
      detail: 'National emergency assistance',
      phone: line.phone,
    })),
    ...(hotlines.mdrrmo || []).map((line, index) => ({
      id: `mdrrmo-${index}-${line.phone}`,
      label: line.label,
      detail: 'Municipal disaster response',
      phone: line.phone,
    })),
    ...localEmergencyHotlines,
  ];
  const publicBarangayHotlineGroups = hotlines.barangays || [];
  const publicBarangayNames = [...new Set([
    ...publicBarangays.map((barangay) => barangay.name),
    ...publicBarangayHotlineGroups.map((group) => group.barangay_name).filter(Boolean),
  ])].sort((first, second) => first.localeCompare(second));
  const firstBarangayWithHotlines = publicBarangayNames.find((name) => publicBarangayHotlineGroups.some((group) =>
    group.barangay_name === name && (group.entries || []).some((line) => [line.phone, line.number, ...(line.numbers || [])].some(Boolean))));
  const selectedBarangayName = publicBarangayNames.includes(selectedHotlineBarangay)
    ? selectedHotlineBarangay
    : firstBarangayWithHotlines || publicBarangayNames[0] || '';
  const selectedBarangayHotlineGroup = publicBarangayHotlineGroups.find((group) => group.barangay_name === selectedBarangayName);
  const barangayHotlineRows: PublicHotlineRow[] = (selectedBarangayHotlineGroup?.entries || []).flatMap((line, lineIndex) => {
    const phones = [line.phone, line.number, ...(line.numbers || [])].filter((phone): phone is string => Boolean(phone));
    const label = line.label || line.name || line.purpose || 'Barangay emergency contact';
    return phones.map((phone, phoneIndex) => ({
      id: `barangay-${selectedBarangayHotlineGroup?.barangay_name}-${lineIndex}-${phoneIndex}-${phone}`,
      label,
      detail: `Brgy. ${selectedBarangayHotlineGroup?.barangay_name}`,
      phone,
    }));
  });
  const renderPublicHotlineRow = (line: PublicHotlineRow) => <a key={line.id} href={`tel:${line.phone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${line.label}, ${line.phone}`}>
    <span className="public-hotline-row-icon"><Phone size={16} aria-hidden="true" /></span>
    <span className="public-hotline-row-copy"><strong>{line.label}</strong><small>{line.detail}</small></span>
    <span className="public-hotline-row-action"><strong>{formatMobileNumber(line.phone)}</strong><small>Call</small></span>
  </a>;

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setSubmitted(false);
    const phone = normalizeMobileNumberInput(guestPhone);
    if (!isValidMobileNumber(phone)) { setMessage('Enter exactly 11 digits starting with 09.'); return; }
    if (reportType === 'emergency' && incidentCategory === 'other' && !otherEmergency.trim()) { setMessage('Describe the other emergency.'); return; }
    if (!location) { setMessage('Add the incident location before submitting.'); return; }
    if (description.trim().length < 8) { setMessage('Describe the incident in at least 8 characters.'); return; }
    setBusy(true);
    try {
      const incidentTimeFingerprint = reportType === 'emergency'
        ? [incidentTime.choice, incidentTime.choice === 'earlier' ? incidentTime.occurredAt : null, incidentTime.choice === 'earlier' ? incidentTime.precision : null]
        : null;
      const fingerprint = JSON.stringify([
        phone,
        reportType,
        communityCategory,
        incidentCategory,
        incidentCategory === 'other' ? otherEmergency.trim() : '',
        description.trim(),
        location.latitude,
        location.longitude,
        evidence ? [evidence.name, evidence.size, evidence.lastModified] : null,
        incidentTimeFingerprint,
      ]);
      const requestId = submissionFingerprint === fingerprint ? submissionRequestId : createGuestRequestId();
      const submittedAt = submissionFingerprint === fingerprint && submissionStartedAt ? submissionStartedAt : new Date().toISOString();
      setSubmissionRequestId(requestId);
      setSubmissionFingerprint(fingerprint);
      setSubmissionStartedAt(submittedAt);
      const response = await reportAPI.guestReport({
        type: reportType, title: reportType === 'community' ? communityCategory : 'Resident Incident Report',
        specifics: reportType === 'community' ? communityCategory : incidentCategory === 'other' ? `Other emergency: ${otherEmergency.trim()}` : '', description: description.trim(),
        latitude: location.latitude, longitude: location.longitude, contact_number: phone, send_to: 'mdrrmo',
        incident_type: reportType === 'community' ? communityCategory.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : incidentCategory,
        ...(reportType === 'emergency' ? {
          incident_time_choice: incidentTime.choice,
          incident_occurred_at: incidentTime.choice === 'just_now'
            ? submittedAt
            : incidentTime.choice === 'unknown' ? null : incidentTime.occurredAt,
          incident_time_precision: incidentTime.choice === 'just_now' ? 'exact' : incidentTime.precision,
        } : {}),
        client_request_id: requestId, client_submitted_at: submittedAt,
      }, evidence);
      const reportId = response.data?.report?.id;
      if (typeof reportId === 'string') setTrackingReference(reportId);
      setDescription('');
      setGuestPhone('');
      setIncidentCategory('not_sure');
      setIncidentTime(createInitialIncidentTime());
      setOtherEmergency('');
      setLocation(null);
      setLocationSource(null);
      setEvidence(null);
      setSubmissionRequestId(createGuestRequestId());
      setSubmissionFingerprint('');
      setSubmissionStartedAt('');
      const input = document.getElementById('public-report-evidence') as HTMLInputElement | null;
      if (input) input.value = '';
      setSubmitted(true);
      setMessage(reportType === 'community' ? 'Community concern sent to MDRRMO for review and local coordination.' : 'Report sent to MDRRMO for review. A dispatcher can assign it to a nearby active barangay.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error || 'The report could not be submitted. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (user?.role === 'resident') return <Navigate to={`/resident-new-report?type=${reportType}`} replace />;

  return (
    <div className="public-report-page">
      <PublicHeader showActions={false} />
      <main className="public-report-layout">
        <div className="public-report-intro">
          <span className="public-home-eyebrow">{reportType === 'community' ? 'COMMUNITY INCIDENT REPORTING' : 'EMERGENCY INCIDENT REPORTING'}</span>
          <h1>{reportType === 'community' ? 'Share a local concern.' : 'Tell us what is happening.'}</h1>
          <p>{reportType === 'community' ? 'Report a community hazard so MDRRMO can review it and coordinate a local response.' : 'Share a mobile number, incident category, location, and clear details. Reports are sent to MDRRMO for review.'}</p>
          {user ? <p className="public-report-login-note">Reporting as <strong>{user.full_name}</strong>. <Link to="/resident-home">Back to resident portal</Link>.</p> : <p className="public-report-login-note">Already have an account? <Link to="/login">Sign in to follow your reports or open the command center</Link>.</p>}
        </div>
        <div className="public-report-content-grid">
          <section className="public-intake-panel" aria-labelledby="public-report-title">
            <div className="public-intake-heading"><span><Siren size={19} /></span><div><h2 id="public-report-title">{reportType === 'community' ? 'Community incident' : 'Emergency incident'}</h2><p>{user ? 'Your report will be linked to your resident account.' : 'No account is needed to submit a report.'}</p></div></div>
            <form className="public-report-form" onSubmit={(event) => void submitReport(event)}>
              {reportType === 'community' ? <><label htmlFor="public-report-community-category">Concern category</label><select id="public-report-community-category" value={communityCategory} onChange={(event) => setCommunityCategory(event.target.value)}>{communityCategories.map((item) => <option key={item} value={item}>{item}</option>)}</select></> : <div className="public-incident-time-row"><div className="public-incident-category-column"><label className="public-incident-category-field" htmlFor="public-report-category">Incident category<select id="public-report-category" value={incidentCategory} onChange={(event) => setIncidentCategory(event.target.value)}>{INCIDENT_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{incidentCategory === 'other' && <label className="public-incident-other-field" htmlFor="public-report-other-emergency">What kind of emergency? <b>Required</b><input id="public-report-other-emergency" type="text" maxLength={120} value={otherEmergency} onChange={(event) => setOtherEmergency(event.target.value)} placeholder="Describe the emergency" required /></label>}</div><IncidentTimeInput value={incidentTime} onChange={setIncidentTime} /></div>}
              <label htmlFor="public-report-phone">Mobile number <b>Required</b></label>
              <MobileNumberInput id="public-report-phone" value={guestPhone} onValueChange={setGuestPhone} placeholder="09XXXXXXXXX" required />
              <label htmlFor="public-report-description">Incident details <b>Required</b></label>
              <textarea id="public-report-description" rows={5} minLength={8} maxLength={2000} placeholder="Describe what happened and who needs help…" value={description} onChange={(event) => setDescription(event.target.value)} required />
              <span className="public-report-field-label">Incident location <b>Required</b></span>
              <div className="public-report-location-actions">
                <button className={'public-location-button ' + (locationSource === 'current' ? 'located' : '')} type="button" onClick={requestLocation} aria-describedby="public-report-location-status">
                  <LocateFixed size={16} aria-hidden="true" />{locationSource === 'current' ? 'Update current location' : 'Use current location'}
                </button>
                <button className={'public-location-button ' + (locationSource === 'map' ? 'located' : '')} type="button" onClick={openMapPicker} aria-describedby="public-report-location-status">
                  <MapPin size={16} aria-hidden="true" />{locationSource === 'map' ? 'Change map location' : 'Choose location on map'}
                </button>
              </div>
              <span id="public-report-location-status" className="public-report-location-status" aria-live="polite">{location ? `${locationSource === 'map' ? 'Map location selected' : 'Current location attached'} · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'Use your current location or choose the incident point on the map.'}</span>
              <fieldset className="public-report-routing">
                <legend>Send report to</legend>
                <div className="public-report-routing-choice"><span className="public-report-routing-indicator" aria-hidden="true" /><span><strong>MDRRMO</strong><small>A dispatcher can assign the report to a nearby active barangay.</small></span></div>
              </fieldset>
              <label className="public-evidence-label" htmlFor="public-report-evidence"><Upload size={15} aria-hidden="true" /> Add photo or video <span>(optional)</span></label>
              <input id="public-report-evidence" type="file" accept="image/*,video/*" onChange={(event) => setEvidence(event.target.files?.[0] || null)} />
              {message && <p className={submitted ? 'public-report-success' : 'public-report-error'} role="status">{message}{submitted && trackingReference && <> <span>Keep this report reference: <strong>{trackingReference}</strong>.</span> <Link to={`/track-report?reference=${encodeURIComponent(trackingReference)}`}>Track this report</Link></>}</p>}
              <button type="submit" className="btn btn-primary btn-lg public-report-submit" disabled={busy}>{busy ? 'Sending report…' : 'Send report to MDRRMO'}</button>
            </form>
          </section>
          <aside className="public-hotlines-panel" aria-labelledby="public-hotlines-title">
            <div className="public-hotlines-heading"><span><Phone size={18} aria-hidden="true" /></span><div><h2 id="public-hotlines-title">Emergency hotlines</h2><p>Call directly if you need immediate assistance.</p></div></div>
            <div className="public-hotline-list">
              {publicHotlineRows.map(renderPublicHotlineRow)}
              <section className="public-hotline-group" aria-labelledby="public-barangay-hotlines-title">
                <div className="public-hotline-group-heading">
                  <div><h3 id="public-barangay-hotlines-title">Barangay hotlines</h3><p>Choose a barangay to view its response contacts.</p></div>
                  <label className="public-hotline-barangay-select"><span>Barangay</span><select aria-label="Choose barangay hotline contacts" value={selectedBarangayName} disabled={!publicBarangayNames.length} onChange={(event) => setSelectedHotlineBarangay(event.target.value)}>
                    {!publicBarangayNames.length && <option value="">No verified barangays available</option>}
                    {publicBarangays.length > 0
                      ? publicBarangayNames.map((name) => <option key={name} value={name}>{name}</option>)
                      : publicBarangayHotlineGroups.map((group) => <option key={group.barangay_name} value={group.barangay_name}>{group.barangay_name}</option>)}
                  </select></label>
                </div>
                {barangayHotlineRows.length > 0
                  ? <div className="public-hotline-group-entries">{barangayHotlineRows.map(renderPublicHotlineRow)}</div>
                  : <p className="public-hotlines-empty">{selectedBarangayName ? `No published hotline numbers for Brgy. ${selectedBarangayName} yet.` : 'Barangay choices could not be loaded right now.'}</p>}
              </section>
            </div>
          </aside>
        </div>
      </main>
      {mapPickerOpen && <div className="public-location-modal" role="dialog" aria-modal="true" aria-labelledby="public-location-picker-title">
        <section className="public-location-dialog">
          <header><div><h2 id="public-location-picker-title">Choose incident location</h2><p>Click or tap inside Norzagaray to place the incident pin.</p></div><button type="button" aria-label="Close map picker" onClick={() => setMapPickerOpen(false)}><X size={18} /></button></header>
          <button className="public-map-current-location" type="button" onClick={useCurrentLocationInPicker} disabled={mapLocationLoading}>
            <LocateFixed size={16} aria-hidden="true" />{mapLocationLoading ? 'Finding current location…' : 'Use current location'}
          </button>
          {mapLocationMessage && <p className="public-map-location-message" role="status">{mapLocationMessage}</p>}
          <div className="public-location-picker-map">
            <MapContainer center={mapFocus} zoom={14} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
              <TileLayer url={CARTO_DARK_MAP_URL} attribution={CARTO_ATTRIBUTION} />
              <IncidentMapRecenter point={mapFocus} />
              <IncidentMapClickPicker onPick={(point) => { setMapLocation(point); setMapLocationSource('map'); setMapLocationMessage(''); }} />
              {mapLocation && <Marker position={[mapLocation.latitude, mapLocation.longitude]} icon={incidentPinIcon} />}
            </MapContainer>
          </div>
          <p className="public-location-picker-coordinate">{mapLocation ? `${mapLocation.latitude.toFixed(5)}, ${mapLocation.longitude.toFixed(5)}` : 'No point selected yet'}</p>
          <footer><button type="button" className="public-location-cancel" onClick={() => setMapPickerOpen(false)}>Cancel</button><button type="button" className="public-location-confirm" onClick={confirmMapLocation} disabled={!mapLocation}>Use this location</button></footer>
        </section>
      </div>}
    </div>
  );
}
