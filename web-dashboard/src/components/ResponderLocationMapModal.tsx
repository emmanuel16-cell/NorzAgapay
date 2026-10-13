import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L, { type LatLngTuple } from 'leaflet';
import { Crosshair, LocateFixed, MapPin, X } from 'lucide-react';
import { MAP_ATTRIBUTION, MAP_TILE_URL } from '../lib/mapConfig';
import 'leaflet/dist/leaflet.css';

type Props = { latitude: number; longitude: number; locationName: string; onClose: () => void };
type CurrentLocation = { latitude: number; longitude: number; accuracy: number; updatedAt: Date };

const incidentIcon = L.divIcon({
  className: 'responder-live-map-marker incident',
  html: '<span aria-hidden="true"></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});
const responderIcon = L.divIcon({
  className: 'responder-live-map-marker responder',
  html: '<span aria-hidden="true"></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function MapFocus({ incident, responder }: { incident: LatLngTuple; responder: LatLngTuple | null }) {
  const map = useMap();
  const hasFitResponder = useRef(false);
  useEffect(() => {
    if (responder && !hasFitResponder.current) {
      map.fitBounds([incident, responder], { padding: [68, 68], maxZoom: 15 });
      hasFitResponder.current = true;
    } else if (!responder && !hasFitResponder.current) {
      map.setView(incident, 15);
    }
  }, [incident, map, responder]);
  return null;
}

export default function ResponderLocationMapModal({ latitude, longitude, locationName, onClose }: Props) {
  const [currentLocation, setCurrentLocation] = useState<CurrentLocation | null>(null);
  const [locationError, setLocationError] = useState('');
  const incident = useMemo<LatLngTuple>(() => [latitude, longitude], [latitude, longitude]);
  const responder = currentLocation ? [currentLocation.latitude, currentLocation.longitude] as LatLngTuple : null;
  const distance = responder ? L.latLng(responder).distanceTo(L.latLng(incident)) : null;

  useEffect(() => {
    document.body.classList.add('responder-map-open');
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    if (!navigator.geolocation) {
      setLocationError('This browser does not provide device location.');
    } else {
      const watchId = navigator.geolocation.watchPosition((position) => {
        setCurrentLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          updatedAt: new Date(position.timestamp),
        });
        setLocationError('');
      }, (error) => {
        setLocationError(error.code === error.PERMISSION_DENIED
          ? 'Location access is blocked. Allow location access in your browser to show your moving pin.'
          : error.code === error.TIMEOUT
            ? 'Still waiting for a GPS fix. Keep this map open while your device finds your location.'
            : 'Your current location is unavailable. Check your device location settings and try again.');
      }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
      return () => {
        navigator.geolocation.clearWatch(watchId);
        document.body.classList.remove('responder-map-open');
        window.removeEventListener('keydown', closeOnEscape);
      };
    }
    return () => {
      document.body.classList.remove('responder-map-open');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return <div className="responder-live-map-backdrop" role="dialog" aria-modal="true" aria-label="Live incident location" onClick={onClose}>
    <section className="responder-live-map-modal" onClick={(event) => event.stopPropagation()}>
      <header className="responder-live-map-header">
        <div><span><Crosshair size={16} /> Live location</span><h2>{locationName}</h2><p>{responder && distance != null ? `${distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`} between you and the incident` : 'Your location will update as your device moves.'}</p></div>
        <button type="button" onClick={onClose} aria-label="Close map"><X size={21} /></button>
      </header>
      <div className="responder-live-map-status" aria-live="polite">
        <span><i className={responder ? 'live' : ''} />{responder ? `Your location · ±${Math.round(currentLocation!.accuracy)} m accuracy` : locationError || 'Waiting for your device location…'}</span>
        {currentLocation && <small>Updated {currentLocation.updatedAt.toLocaleTimeString()}</small>}
      </div>
      <div className="responder-live-map-canvas">
        <MapContainer center={incident} zoom={15} scrollWheelZoom zoomControl className="responder-live-map-leaflet">
          <TileLayer url={MAP_TILE_URL} attribution={MAP_ATTRIBUTION} />
          <MapFocus incident={incident} responder={responder} />
          <Marker position={incident} icon={incidentIcon} zIndexOffset={1000}><Popup><strong>Incident location</strong><br />{locationName}</Popup></Marker>
          {responder && <>
            <Polyline positions={[responder, incident]} pathOptions={{ color: '#20c4df', weight: 4, opacity: 0.85, dashArray: '8 8' }} />
            <Marker position={responder} icon={responderIcon} zIndexOffset={1500}><Popup><strong>Your live location</strong><br />±{Math.round(currentLocation!.accuracy)} m accuracy</Popup></Marker>
          </>}
        </MapContainer>
        <div className="responder-live-map-legend"><span><i className="incident" /><MapPin size={14} /> Incident</span><span><i className="responder" /><LocateFixed size={14} /> You</span></div>
      </div>
      <footer className="responder-live-map-footer">Your device location is shown only while this map is open and is not shared or saved.</footer>
    </section>
  </div>;
}
