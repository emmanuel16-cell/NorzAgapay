import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { ArrowLeft, CheckCircle2, CircleAlert, FileText, LocateFixed, MapPin, Phone, ShieldCheck, Siren, Upload, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { reportAPI } from '../lib/api';
import { INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';
import { CARTO_ATTRIBUTION, CARTO_DARK_MAP_URL } from '../lib/mapConfig';
import MobileNumberInput from '../components/MobileNumberInput';
import { isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';

const incidentTypes = [
  'Minor Flooding', 'Drainage Blockage', 'Small Fire Incident', 'Fallen Tree Report', 'Road Damage Report',
  'Damaged House Report', 'Cracked Road Report', 'Unsafe Electrical Wiring', 'River Water Level Report',
  'Illegal Dumping', 'River Pollution Report', 'Smoke Pollution', 'Animal Carcass Disposal', 'Flood-Prone Area Report',
  'Heavy Rain Monitoring', 'Strong Wind Monitoring', 'Rising Water Level Monitoring', 'Landslide-Prone Area Report',
  'Earthquake Damage Observation',
];
const defaultMapCenter: [number, number] = [14.9133, 121.0436];
const reportPin = L.divIcon({ className: 'resident-map-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
type Point = { latitude: number; longitude: number };

function requestId() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
}
function normalizeMobile(value?: string | null) {
  return normalizeMobileNumberInput(value);
}
function MapPickerEvents({ onPick }: { onPick: (point: Point) => void }) {
  useMapEvents({ click: ({ latlng }) => onPick({ latitude: latlng.lat, longitude: latlng.lng }) });
  return null;
}
function RecenterMap({ point }: { point: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(point, Math.max(map.getZoom(), 14), { animate: true }); }, [map, point]);
  return null;
}

export default function ResidentIncidentReportPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const type = params.get('type') === 'community' ? 'community' : 'emergency';
  const [category, setCategory] = useState<string>(INCIDENT_TYPE_OPTIONS[0]?.value || 'not_sure');
  const [otherEmergency, setOtherEmergency] = useState('');
  const [communityCategory, setCommunityCategory] = useState(incidentTypes[0]);
  const [phone, setPhone] = useState(() => normalizeMobile(user?.phone));
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<Point | null>(null);
  const [locationSource, setLocationSource] = useState<'current' | 'map' | null>(null);
  const [evidence, setEvidence] = useState<File | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapPoint, setMapPoint] = useState<Point | null>(null);
  const [mapFocus, setMapFocus] = useState<[number, number]>(defaultMapCenter);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reference, setReference] = useState('');
  const requestIdRef = useRef(requestId());
  const requestFingerprintRef = useRef('');
  const requestStartedAtRef = useRef('');

  useEffect(() => { if (user?.phone) setPhone((current) => current || normalizeMobile(user.phone)); }, [user?.phone]);

  const useCurrentLocation = (inPicker = false) => {
    setError('');
    if (!navigator.geolocation) { setError('This browser cannot read your location.'); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const point = { latitude: coords.latitude, longitude: coords.longitude };
      if (inPicker) { setMapPoint(point); setMapFocus([point.latitude, point.longitude]); }
      else { setLocation(point); setLocationSource('current'); }
    }, () => setError('Allow location access or place the incident pin on the map.'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  const openMapPicker = () => {
    setMapPoint(location);
    setMapFocus(location ? [location.latitude, location.longitude] : defaultMapCenter);
    setMapOpen(true);
    setError('');
  };
  const confirmMapPoint = () => {
    if (!mapPoint) return;
    setLocation(mapPoint); setLocationSource('map'); setMapOpen(false);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setMessage(''); setSubmitted(false);
    const normalizedPhone = normalizeMobile(phone);
    if (!isValidMobileNumber(normalizedPhone)) { setError('Enter exactly 11 digits starting with 09.'); return; }
    if (type !== 'community' && category === 'other' && !otherEmergency.trim()) { setError('Describe the other emergency.'); return; }
    if (!location) { setError('Add the incident location before submitting.'); return; }
    if (description.trim().length < 8) { setError('Describe what happened in at least 8 characters.'); return; }
    setBusy(true);
    try {
      const title = type === 'community' ? communityCategory : 'Resident Incident Report';
      const fingerprint = JSON.stringify([type, title, type === 'community' ? communityCategory : category, category === 'other' ? otherEmergency.trim() : '', normalizedPhone, description.trim(), location.latitude, location.longitude, evidence ? [evidence.name, evidence.size, evidence.lastModified] : null]);
      if (requestFingerprintRef.current !== fingerprint) {
        requestIdRef.current = requestId();
        requestStartedAtRef.current = new Date().toISOString();
        requestFingerprintRef.current = fingerprint;
      }
      const response = await reportAPI.guestReport({
        type, title, specifics: type === 'community' ? communityCategory : category === 'other' ? `Other emergency: ${otherEmergency.trim()}` : '', description: description.trim(),
        latitude: location.latitude, longitude: location.longitude, contact_number: normalizedPhone,
        send_to: 'mdrrmo', incident_type: type === 'community'
          ? communityCategory.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
          : category,
        client_request_id: requestIdRef.current, client_submitted_at: requestStartedAtRef.current,
      }, evidence);
      const reportId = response.data?.report?.id;
      setReference(typeof reportId === 'string' ? reportId : '');
      setSubmitted(true);
      setMessage(type === 'community' ? 'Your community concern was sent to MDRRMO for review.' : 'Your report was sent to MDRRMO for review and coordination.');
      setDescription(''); setOtherEmergency(''); setLocation(null); setLocationSource(null); setEvidence(null);
      requestIdRef.current = requestId(); requestFingerprintRef.current = ''; requestStartedAtRef.current = '';
      const fileInput = document.getElementById('resident-report-evidence') as HTMLInputElement | null;
      if (fileInput) fileInput.value = '';
    } catch (submitError: any) {
      setError(submitError?.response?.data?.error || 'The report could not be submitted. Please try again.');
    } finally { setBusy(false); }
  };

  if (submitted) return <main className="resident-portal-page"><section className="resident-report-success"><span><CheckCircle2 size={28}/></span><div className="resident-kicker">REPORT RECEIVED</div><h1>Thank you for letting us know.</h1><p>{message}</p>{reference && <div className="resident-report-reference"><small>REPORT REFERENCE</small><strong>{reference}</strong></div>}<div className="resident-report-success-actions"><Link className="resident-button resident-button-danger" to="/my-reports"><FileText size={16}/> Track my report</Link><Link className="resident-button resident-button-outline" to="/resident-home">Back to home</Link><button className="resident-button resident-button-outline" type="button" onClick={() => { setSubmitted(false); setMessage(''); setReference(''); }}>Submit another</button></div></section></main>;

  return <main className="resident-portal-page resident-report-compose">
    <Link className="resident-back-link" to="/resident-report"><ArrowLeft size={15}/> Back to reporting options</Link>
    <header className="resident-page-heading"><div><span className="resident-kicker"><Siren size={15}/> {type === 'community' ? 'COMMUNITY INCIDENT' : 'EMERGENCY INCIDENT'}</span><h1>{type === 'community' ? 'Report a community concern' : 'Report an emergency'}</h1><p>Your report will be sent to MDRRMO and linked to your resident account.</p></div></header>
    <div className="resident-compose-layout"><section className="resident-compose-card">
      <div className="resident-compose-account"><span><ShieldCheck size={18}/></span><div><strong>{user?.full_name || 'Resident account'}</strong><small>{user?.barangay_name ? `Resident · ${user.barangay_name}` : 'Resident report'}</small></div><button type="button" onClick={() => navigate('/my-reports')}>My reports <ArrowLeft size={13}/></button></div>
      <form className="resident-compose-form" onSubmit={(event) => void submit(event)}>
        {type === 'community' ? <label>Concern category<select value={communityCategory} onChange={(event) => setCommunityCategory(event.target.value)}>{incidentTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label> : <><label>Incident category<select value={category} onChange={(event) => setCategory(event.target.value)}>{INCIDENT_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{category === 'other' && <label>What kind of emergency?<input type="text" required maxLength={120} value={otherEmergency} onChange={(event) => setOtherEmergency(event.target.value)} placeholder="Describe the emergency" /></label>}</>}
        <label>Mobile number <MobileNumberInput value={phone} onValueChange={setPhone} placeholder="09XXXXXXXXX" required/><small>Responders may use this number to contact you about the report.</small></label>
        <label>What happened?<textarea rows={5} minLength={8} maxLength={2000} placeholder={type === 'community' ? 'Describe the hazard and where it is affecting the community…' : 'Describe what happened, who needs help, and any immediate danger…'} value={description} onChange={(event) => setDescription(event.target.value)} required/></label>
        <fieldset className="resident-location-field"><legend>Incident location <b>Required</b></legend><p>Place the pin at the incident site. This helps responders find the right location.</p><div className="resident-location-actions"><button type="button" onClick={() => useCurrentLocation()}><LocateFixed size={15}/>{locationSource === 'current' ? 'Update current location' : 'Use current location'}</button><button type="button" onClick={openMapPicker}><MapPin size={15}/>{locationSource === 'map' ? 'Change map location' : 'Choose on map'}</button></div><div className={`resident-picked-location ${location ? 'located' : ''}`}><MapPin size={15}/>{location ? `${locationSource === 'map' ? 'Map pin' : 'Current location'} · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'No location selected yet'}</div></fieldset>
        <label className="resident-evidence-picker" htmlFor="resident-report-evidence"><span><Upload size={17}/></span><strong>Add a photo or video <small>Optional · attach evidence for responders</small></strong><input id="resident-report-evidence" type="file" accept="image/*,video/*" onChange={(event) => setEvidence(event.target.files?.[0] || null)}/></label>
        {evidence && <div className="resident-evidence-selected"><span>{evidence.name} · {(evidence.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" onClick={() => { setEvidence(null); const input = document.getElementById('resident-report-evidence') as HTMLInputElement | null; if (input) input.value = ''; }}>Remove</button></div>}
        {error && <div className="resident-feedback error" role="alert"><CircleAlert size={16}/>{error}</div>}
        <button className="resident-submit-report" type="submit" disabled={busy}><Siren size={17}/>{busy ? 'Sending report…' : type === 'community' ? 'Submit community report' : 'Send emergency report'}</button>
      </form>
    </section>
      <aside className="resident-compose-aside"><section><span className="resident-aside-icon"><ShieldCheck size={19}/></span><h2>What happens next?</h2><ol><li><span>1</span><div><strong>MDRRMO receives your report</strong><small>Your report is added to the review queue.</small></div></li><li><span>2</span><div><strong>A dispatcher reviews it</strong><small>They may coordinate a nearby barangay team.</small></div></li><li><span>3</span><div><strong>Follow updates here</strong><small>View dispatch progress and resolution in My Reports.</small></div></li></ol></section><Link className="resident-compose-emergency" to="/resident-hotlines" aria-label="Go to emergency hotlines"><Phone size={18}/><div><strong>Immediate danger?</strong><p>Call the emergency hotline for urgent help.</p><span className="resident-compose-emergency-link">Go to hotlines</span></div></Link></aside>
    </div>
    {mapOpen && <div className="resident-map-modal" role="dialog" aria-modal="true" aria-labelledby="resident-map-title"><section><header><div><h2 id="resident-map-title">Choose incident location</h2><p>Click or tap the map to place the pin.</p></div><button type="button" aria-label="Close map" onClick={() => setMapOpen(false)}><X size={18}/></button></header><button className="resident-map-use-location" type="button" onClick={() => useCurrentLocation(true)}><LocateFixed size={15}/> Use my current location</button><div className="resident-map-picker"><MapContainer center={mapFocus} zoom={14} scrollWheelZoom style={{ width: '100%', height: '100%' }}><TileLayer url={CARTO_DARK_MAP_URL} attribution={CARTO_ATTRIBUTION}/><RecenterMap point={mapFocus}/><MapPickerEvents onPick={(point) => setMapPoint(point)}/>{mapPoint && <Marker position={[mapPoint.latitude, mapPoint.longitude]} icon={reportPin}/>}</MapContainer></div><p className="resident-map-coordinates">{mapPoint ? `${mapPoint.latitude.toFixed(5)}, ${mapPoint.longitude.toFixed(5)}` : 'No location pin selected'}</p><footer><button type="button" onClick={() => setMapOpen(false)}>Cancel</button><button type="button" onClick={confirmMapPoint} disabled={!mapPoint}>Use this location</button></footer></section></div>}
  </main>;
}
