import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { MapPin, Save, LocateFixed, ImagePlus, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { reportAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { CARTO_DARK_MAP_URL, CARTO_ATTRIBUTION } from '../lib/mapConfig';
import { createLocationMapIcon } from '../lib/locationMapIcon';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import LocationIconEditorModal from '../components/LocationIconEditorModal';
import 'leaflet/dist/leaflet.css';

type LocationPin = { id?: string; name?: string; location_key?: string; latitude?: number | string | null; longitude?: number | string | null; location_latitude?: number | string | null; location_longitude?: number | string | null; address?: string | null; location_address?: string | null; icon_url?: string | null; location_icon_url?: string | null };
type DraftPin = { latitude: number; longitude: number } | null;

const officeIcon = L.divIcon({ className: 'command-location-marker office', html: '<span>OFFICE</span>', iconSize: [74, 38], iconAnchor: [37, 19] });
const barangayIcon = L.divIcon({ className: 'command-location-marker barangay', html: '<span>BRGY</span>', iconSize: [68, 36], iconAnchor: [34, 18] });

function PinPicker({ enabled, onPick }: { enabled: boolean; onPick: (pin: DraftPin) => void }) {
  useMapEvents({ click: (event) => { if (enabled) onPick({ latitude: event.latlng.lat, longitude: event.latlng.lng }); } });
  return null;
}

function MapSizeAndFocus({ point }: { point: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.invalidateSize(); map.setView(point, Math.max(map.getZoom(), 13), { animate: false }); }, [map, point]);
  return null;
}

export default function CommandLocationsPage() {
  const { user } = useAuth();
  const isBarangay = user?.account_kind === 'barangay';
  const canEdit = isBarangay ? user?.role === 'admin' || user?.role === 'staff' : user?.role === 'admin' || user?.role === 'logistics';
  const [office, setOffice] = useState<LocationPin | null>(null);
  const [barangay, setBarangay] = useState<LocationPin | null>(null);
  const [barangays, setBarangays] = useState<LocationPin[]>([]);
  const [draft, setDraft] = useState<DraftPin>(null);
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [iconTarget, setIconTarget] = useState<'office' | 'barangay' | null>(null);
  const [iconSaving, setIconSaving] = useState(false);

  const readPin = (pin: LocationPin | null | undefined): DraftPin => {
    if (!pin) return null;
    const latitude = Number(pin.location_latitude ?? pin.latitude);
    const longitude = Number(pin.location_longitude ?? pin.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isBarangay) {
        const response = await reportAPI.barangayLocation();
        const own = response.data.barangay as LocationPin | null;
        setBarangay(own);
        setOffice(response.data.office || null);
        setAddress(own?.location_address || '');
        setDraft(readPin(own));
      } else {
        const response = await reportAPI.commandLocations();
        setOffice(response.data.office || null);
        setBarangays(response.data.barangays || []);
        setAddress(response.data.office?.address || '');
        setDraft(readPin(response.data.office));
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not load command locations.');
    } finally { setLoading(false); }
  }, [isBarangay]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(load, { publicUpdates: true });

  const officePoint = readPin(office);
  const ownBarangayPoint = readPin(barangay);
  const selectedPoint: DraftPin = draft || (isBarangay ? ownBarangayPoint : officePoint) || officePoint || ownBarangayPoint;
  const center: [number, number] = selectedPoint ? [selectedPoint.latitude, selectedPoint.longitude] : [14.9055, 121.045];

  const save = async () => {
    if (!draft) { toast.error('Click the map to choose a location.'); return; }
    setSaving(true);
    try {
      if (isBarangay) await reportAPI.saveBarangayLocation({ ...draft, address: address.trim() || null });
      else await reportAPI.saveOfficeLocation({ ...draft, address: address.trim() || null });
      toast.success(isBarangay ? 'Barangay location saved.' : 'MDRRMO office location saved.');
      await load();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not save this location.');
    } finally { setSaving(false); }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { toast.error('This browser does not support location.'); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setDraft({ latitude: coords.latitude, longitude: coords.longitude }),
      () => toast.error('Could not read your current location. Check browser permission.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const displayedPins = useMemo(() => isBarangay ? [] : barangays, [isBarangay, barangays]);
  const editableMarkerIconUrl = isBarangay ? barangay?.location_icon_url : office?.icon_url;
  const editableMarkerFallback = isBarangay ? barangayIcon : officeIcon;
  const moveDraftMarker = (event: L.LeafletEvent) => {
    const point = (event.target as L.Marker).getLatLng();
    setDraft({ latitude: point.lat, longitude: point.lng });
  };
  const targetPin = iconTarget === 'office' ? office : barangay;
  const targetIconUrl = iconTarget === 'office' ? office?.icon_url : barangay?.location_icon_url;
  const saveIcon = async (file: File) => {
    if (!iconTarget) return;
    setIconSaving(true);
    try {
      if (iconTarget === 'office') await reportAPI.saveOfficeLocationIcon(file);
      else await reportAPI.saveBarangayLocationIcon(file);
      toast.success('Map icon saved.');
      setIconTarget(null);
      await load();
    } catch (error: any) { toast.error(error?.response?.data?.error || 'Could not save the map icon.'); }
    finally { setIconSaving(false); }
  };
  const removeIcon = async () => {
    if (!iconTarget) return;
    setIconSaving(true);
    try {
      if (iconTarget === 'office') await reportAPI.removeOfficeLocationIcon();
      else await reportAPI.removeBarangayLocationIcon();
      toast.success('Map icon removed.');
      setIconTarget(null);
      await load();
    } catch (error: any) { toast.error(error?.response?.data?.error || 'Could not remove the map icon.'); }
    finally { setIconSaving(false); }
  };

  return (
    <main className="command-locations-page">
      <header className="command-locations-heading"><div><span className="command-location-eyebrow">COMMAND CENTER SETUP</span><h1>Official locations</h1><p>Set the pin responders use to determine on-site availability.</p></div></header>
      <div className="command-locations-grid">
        <section className="command-location-editor">
          {loading ? <div className="command-location-loading"><span className="spinner" />Loading locations…</div> : <>
            <div className="command-location-active"><span className="command-location-pin-icon"><MapPin size={18} /></span><div><strong>{isBarangay ? `Barangay ${barangay?.name || user?.barangay_name || ''}` : 'MDRRMO office'}</strong><span>{isBarangay ? 'Used to check this barangay’s responder availability.' : 'Used to check MDRRMO responder availability.'}</span></div></div>
            {canEdit ? <>
              <p className="command-location-instruction">Click the map to place the official pin, or use your device’s current location.</p>
              <button className="command-location-current" type="button" onClick={useCurrentLocation}><LocateFixed size={16} /> Use current location</button>
              <label htmlFor="command-location-address">Address or landmark <span>(optional)</span></label>
              <input id="command-location-address" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={240} placeholder="Office or barangay hall address" />
              <div className="command-location-icon-setting"><div className="command-location-icon-preview">{(isBarangay ? barangay?.location_icon_url : office?.icon_url) ? <img src={(isBarangay ? barangay?.location_icon_url : office?.icon_url) || ''} alt="Current map icon" /> : <ImagePlus size={21} />}</div><div><strong>{(isBarangay ? barangay?.location_icon_url : office?.icon_url) ? 'Map icon set' : 'Location map icon'}</strong><span>{isBarangay ? 'Your badge marks this saved location on response maps.' : 'The MDRRMO badge marks this office; barangay badges mark their saved locations.'}</span></div><button type="button" onClick={() => setIconTarget(isBarangay ? 'barangay' : 'office')} disabled={!readPin(isBarangay ? barangay : office)} title={!readPin(isBarangay ? barangay : office) ? 'Save the map location first' : undefined}><Pencil size={15} />{(isBarangay ? barangay?.location_icon_url : office?.icon_url) ? 'Edit' : 'Add icon'}</button></div>
              {!readPin(isBarangay ? barangay : office) && <p className="command-location-instruction">Save the location pin before adding its map icon.</p>}
              <button className="btn btn-primary command-location-save" type="button" disabled={saving || !draft} onClick={() => void save()}><Save size={16} />{saving ? 'Saving…' : 'Save official location'}</button>
            </> : <div className="command-location-readonly">Only the account administrator can update this location pin.</div>}
            {office && <div className="command-location-reference"><strong>MDRRMO office reference</strong><span>{office.address || (office.latitude != null ? `${Number(office.latitude).toFixed(6)}, ${Number(office.longitude).toFixed(6)}` : 'No office pin saved yet')}</span></div>}
          </>}
        </section>
        <section className="command-location-map-card" aria-label="Official location map">
          <div className="command-location-map-caption"><MapPin size={16} />{canEdit ? 'Select a point on the map' : 'Official locations'}</div>
          <MapContainer center={center} zoom={13} zoomControl style={{ width: '100%', height: '100%' }}>
            <TileLayer url={CARTO_DARK_MAP_URL} attribution={CARTO_ATTRIBUTION} />
            <MapSizeAndFocus point={center} />
            <PinPicker enabled={canEdit} onPick={setDraft} />
            {officePoint && (isBarangay || !canEdit) && <Marker position={[officePoint.latitude, officePoint.longitude]} icon={createLocationMapIcon(office?.icon_url, 'office', officeIcon)}><Popup>MDRRMO office{office?.address ? ` · ${office.address}` : ''}</Popup></Marker>}
            {isBarangay && ownBarangayPoint && !canEdit && <Marker position={[ownBarangayPoint.latitude, ownBarangayPoint.longitude]} icon={createLocationMapIcon(barangay?.location_icon_url, 'barangay', barangayIcon)}><Popup>Barangay {barangay?.name || user?.barangay_name}</Popup></Marker>}
            {displayedPins.map((row) => {
              // Only show a barangay badge when it has an explicitly configured
              // command location; the general barangay centroid is not precise enough.
              const pin = row.location_latitude != null && row.location_longitude != null
                ? readPin({ location_latitude: row.location_latitude, location_longitude: row.location_longitude })
                : null;
              return pin ? <Marker key={row.id} position={[pin.latitude, pin.longitude]} icon={createLocationMapIcon(row.location_icon_url, 'barangay', barangayIcon)}><Popup>Barangay {row.name}{row.location_address ? ` · ${row.location_address}` : ''}</Popup></Marker> : null;
            })}
            {canEdit && draft && <Marker position={[draft.latitude, draft.longitude]} icon={createLocationMapIcon(editableMarkerIconUrl, isBarangay ? 'barangay' : 'office', editableMarkerFallback)} draggable eventHandlers={{ dragend: moveDraftMarker }}><Popup>{isBarangay ? `Barangay ${barangay?.name || user?.barangay_name || ''}` : 'MDRRMO office'} · selected location</Popup></Marker>}
          </MapContainer>
        </section>
      </div>
      {iconTarget && <LocationIconEditorModal title={`Edit ${iconTarget === 'office' ? 'MDRRMO' : 'barangay'} map icon`} currentIconUrl={targetIconUrl} saving={iconSaving} onClose={() => { if (!iconSaving) setIconTarget(null); }} onSave={saveIcon} onRemove={targetPin && targetIconUrl ? removeIcon : undefined} />}
    </main>
  );
}
