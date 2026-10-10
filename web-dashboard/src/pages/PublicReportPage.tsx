import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LocateFixed, MapPin, Phone, Siren, Upload, X } from 'lucide-react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';
import { reportAPI } from '../lib/api';
import { CARTO_ATTRIBUTION, CARTO_DARK_MAP_URL } from '../lib/mapConfig';

type HotlineGroup = {
  barangay_name: string;
  entries: Array<{ label?: string; name?: string; phone?: string; number?: string; numbers?: string[]; purpose?: string }>;
};
type PublicHotlines = {
  national: Array<{ label: string; phone: string }>;
  mdrrmo: Array<{ label: string; phone: string; email?: string }>;
  barangays: HotlineGroup[];
};
type BarangayLocation = {
  id: string;
  name: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  location_latitude?: number | string | null;
  location_longitude?: number | string | null;
};

function validCoordinates(latitude: unknown, longitude: unknown) {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (latitude == null || longitude == null || !Number.isFinite(parsedLatitude) ||
      parsedLatitude < -90 || parsedLatitude > 90 || !Number.isFinite(parsedLongitude) ||
      parsedLongitude < -180 || parsedLongitude > 180) return null;
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

function distanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const latitudeDelta = (to.latitude - from.latitude) * radians;
  const longitudeDelta = (to.longitude - from.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(from.latitude * radians) *
    Math.cos(to.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

const emptyHotlines: PublicHotlines = { national: [], mdrrmo: [], barangays: [] };
const incidentPinIcon = L.divIcon({ className: 'public-incident-pin', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] });
const defaultMapCenter: [number, number] = [14.9133, 121.0436];

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
  const [hotlines, setHotlines] = useState<PublicHotlines>(emptyHotlines);
  const [barangays, setBarangays] = useState<BarangayLocation[]>([]);
  const [selectedBarangayId, setSelectedBarangayId] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [sendTo, setSendTo] = useState<'barangay' | 'mdrrmo'>('mdrrmo');
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

  const closestBarangay = useMemo(() => {
    if (!location) return null;
    let nearest: BarangayLocation | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const barangay of barangays) {
      const coordinates = validCoordinates(barangay.location_latitude, barangay.location_longitude) ??
        validCoordinates(barangay.latitude, barangay.longitude);
      if (!coordinates) continue;
      const distance = distanceMeters(location, coordinates);
      if (distance < nearestDistance) {
        nearest = barangay;
        nearestDistance = distance;
      }
    }
    return nearest;
  }, [barangays, location]);
  const recipientBarangayId = selectedBarangayId || closestBarangay?.id || '';
  const recipientBarangayName = barangays.find((barangay) => barangay.id === recipientBarangayId)?.name;
  const orderedBarangays = useMemo(() => {
    return [...barangays].sort((first, second) => {
      if (first.id === closestBarangay?.id) return -1;
      if (second.id === closestBarangay?.id) return 1;
      return first.name.localeCompare(second.name);
    });
  }, [barangays, closestBarangay?.id]);

  useEffect(() => {
    reportAPI.verifiedBarangays()
      .then((response) => setBarangays(Array.isArray(response.data) ? response.data : []))
      .catch(() => setBarangays([]));
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

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setSubmitted(false);
    const phone = guestPhone.replace(/\D/g, '');
    if (!/^09\d{9}$/.test(phone)) { setMessage('Enter an 11-digit mobile number starting with 09.'); return; }
    if (!location) { setMessage('Add the incident location before submitting.'); return; }
    if (description.trim().length < 8) { setMessage('Describe the incident in at least 8 characters.'); return; }
    setBusy(true);
    try {
      await reportAPI.guestReport({
        type: 'emergency', title: 'Resident Incident Report', description: description.trim(),
        latitude: location.latitude, longitude: location.longitude, contact_number: phone, send_to: sendTo,
        recipient_barangay_id: sendTo === 'barangay' ? recipientBarangayId : undefined,
      }, evidence);
      setDescription('');
      setGuestPhone('');
      setLocation(null);
      setLocationSource(null);
      setSelectedBarangayId('');
      setEvidence(null);
      const input = document.getElementById('public-report-evidence') as HTMLInputElement | null;
      if (input) input.value = '';
      setSubmitted(true);
      setMessage(sendTo === 'barangay'
        ? `Report sent to ${recipientBarangayName || 'the selected active barangay'}. It can be escalated to MDRRMO if more support is needed.`
        : 'Report sent to MDRRMO for review. A dispatcher can assign it to a nearby active barangay.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error || 'The report could not be submitted. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-report-page">
      <PublicHeader />
      <main className="public-report-layout">
        <div className="public-report-intro">
          <span className="public-home-eyebrow">PUBLIC INCIDENT REPORTING</span>
          <h1>Tell us what is happening.</h1>
          <p>Share a mobile number, incident location, and clear details. Choose whether the closest active barangay or MDRRMO should receive the report.</p>
          <p className="public-report-login-note">Already have an operations account? <Link to="/login">Log in to the command center</Link>.</p>
        </div>
        <div className="public-report-content-grid">
          <section className="public-intake-panel" aria-labelledby="public-report-title">
            <div className="public-intake-heading"><span><Siren size={19} /></span><div><h2 id="public-report-title">Report an incident</h2><p>No account is needed to submit a report.</p></div></div>
            <form className="public-report-form" onSubmit={(event) => void submitReport(event)}>
              <label htmlFor="public-report-phone">Mobile number <b>Required</b></label>
              <input id="public-report-phone" type="tel" inputMode="numeric" autoComplete="tel" pattern="09[0-9]{9}" title="Enter an 11-digit mobile number starting with 09." maxLength={11} placeholder="09XXXXXXXXX" value={guestPhone} onChange={(event) => setGuestPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} required />
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
              <fieldset className="public-report-routing" disabled={busy}>
                <legend>Send report to</legend>
                <div className="public-report-barangay-select"><label htmlFor="public-report-barangay">Barangay destination · closest recommended</label><select id="public-report-barangay" value={recipientBarangayId} onChange={(event) => { setSelectedBarangayId(event.target.value); setSendTo('barangay'); }}><option value="" disabled>Select a verified barangay</option>{orderedBarangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}{barangay.id === closestBarangay?.id ? ' · Recommended' : ''}</option>)}</select><small>All verified barangays are listed. The closest to the incident pin is listed first and selected by default. This destination is used when barangay routing is selected below.</small></div>
                <label><input type="radio" name="public-report-recipient" value="barangay" checked={sendTo === 'barangay'} onChange={() => setSendTo('barangay')} /><span><strong>{closestBarangay?.name ? `Closest Barangay (${closestBarangay.name})` : 'Closest Barangay'}</strong><small>Based on the incident location. The barangay can escalate to MDRRMO.</small></span></label>
                <label><input type="radio" name="public-report-recipient" value="mdrrmo" checked={sendTo === 'mdrrmo'} onChange={() => setSendTo('mdrrmo')} /><span><strong>MDRRMO</strong><small>A dispatcher can assign the report to a nearby active barangay.</small></span></label>
              </fieldset>
              <label className="public-evidence-label" htmlFor="public-report-evidence"><Upload size={15} aria-hidden="true" /> Add photo or video <span>(optional)</span></label>
              <input id="public-report-evidence" type="file" accept="image/*,video/*" onChange={(event) => setEvidence(event.target.files?.[0] || null)} />
              {message && <p className={submitted ? 'public-report-success' : 'public-report-error'} role="status">{message}</p>}
              <button type="submit" className="btn btn-primary btn-lg public-report-submit" disabled={busy}>{busy ? 'Sending report…' : `Send report to ${sendTo === 'barangay' ? recipientBarangayName || 'barangay' : 'MDRRMO'}`}</button>
            </form>
          </section>
          <aside className="public-hotlines-panel" aria-labelledby="public-hotlines-title">
            <div className="public-hotlines-heading"><span><Phone size={18} aria-hidden="true" /></span><div><h2 id="public-hotlines-title">Emergency hotlines</h2><p>Call directly if you need immediate assistance.</p></div></div>
            <div className="public-hotline-list">
              {[...(hotlines.national || []), ...(hotlines.mdrrmo || [])].map((line, index) => <a key={`${line.phone}-${index}`} href={`tel:${line.phone}`}><span>{line.label}</span><strong>{line.phone}</strong></a>)}
              {(hotlines.barangays || []).map((group) => group.entries.flatMap((line, index) => {
                const phones = [line.phone, line.number, ...(line.numbers || [])].filter((phone): phone is string => Boolean(phone));
                return phones.map((phone, numberIndex) => <a key={`${group.barangay_name}-${phone}-${index}-${numberIndex}`} href={`tel:${phone}`}><span>{line.label || line.name || line.purpose || group.barangay_name} · Brgy. {group.barangay_name}</span><strong>{phone}</strong></a>);
              }))}
              {hotlines.national.length === 0 && hotlines.mdrrmo.length === 0 && hotlines.barangays.length === 0 && <p className="public-hotlines-empty">Hotline information is not available right now.</p>}
            </div>
            {hotlines.mdrrmo?.[0]?.email && <a className="public-hotline-email" href={`mailto:${hotlines.mdrrmo[0].email}`}>{hotlines.mdrrmo[0].email}</a>}
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
