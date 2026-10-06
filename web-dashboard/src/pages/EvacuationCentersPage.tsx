import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { evacuationAPI } from '../lib/api';
import { CARTO_DARK_MAP_URL, CARTO_ATTRIBUTION } from '../lib/mapConfig';
import { useMunicipalityBoundary } from '../context/MunicipalityBoundaryContext';
import { isCoordinateInsideBoundary } from '../lib/municipalityBoundary';
import MunicipalityBoundaryMapLayer, { MunicipalityBoundaryViewport } from '../components/MunicipalityBoundaryMapLayer';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface EvacuationStation {
  id: string;
  name: string;
  address?: string | null;
  latitude: number | string;
  longitude: number | string;
  barangays?: { id?: string; name?: string; municipality?: string } | null;
}

const DEFAULT_CENTER: [number, number] = [14.9133, 121.0436];

function stationPoint(station: EvacuationStation): [number, number] | null {
  const latitude = Number(station.latitude);
  const longitude = Number(station.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return [latitude, longitude];
}

function MapViewport({ stations, selectedId }: { stations: EvacuationStation[]; selectedId: string | null }) {
  const map = useMap();

  useEffect(() => {
    const selected = stations.find((station) => station.id === selectedId);
    const selectedPoint = selected ? stationPoint(selected) : null;
    if (selectedPoint) {
      map.flyTo(selectedPoint, 15, { duration: 0.6 });
      return;
    }

    const points = stations.map(stationPoint).filter((point): point is [number, number] => point !== null);
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 14 });
    else if (points.length === 1) map.setView(points[0], 13);
    else map.setView(DEFAULT_CENTER, 12);
  }, [map, selectedId, stations]);

  return null;
}

export default function EvacuationCentersPage() {
  const { boundary } = useMunicipalityBoundary();
  const [stations, setStations] = useState<EvacuationStation[]>([]);
  const [barangayFilter, setBarangayFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadStations = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    evacuationAPI.list({ barangay_added: true })
      .then((response) => setStations(response.data || []))
      .catch(() => {
        setLoadError(true);
        toast.error('Could not load evacuation stations');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadStations();
  }, [loadStations]);

  const barangayOptions = useMemo(() => Array.from(new Set(
    stations.map((station) => station.barangays?.name).filter((name): name is string => Boolean(name)),
  )).sort((a, b) => a.localeCompare(b)), [stations]);

  const filteredStations = useMemo(() => {
    return stations.filter((station) => {
      const barangayName = station.barangays?.name || '';
      const matchesBarangay = barangayFilter === 'all' || barangayName === barangayFilter;
      return matchesBarangay;
    });
  }, [barangayFilter, stations]);

  const mapStations = useMemo(() => boundary.enabled
    ? filteredStations.filter((station) => {
        const point = stationPoint(station);
        return point !== null && isCoordinateInsideBoundary(point[0], point[1], boundary.geometry);
      })
    : filteredStations,
  [boundary, filteredStations]);

  return (
    <>
      <div className="page-header evacuation-page-header">
        <h1 className="page-title">Evacuation Centers</h1>
        <button type="button" className="btn btn-outline" onClick={loadStations} disabled={loading}><RotateCcw size={16} /> Refresh</button>
      </div>

      <div className="page-content evacuation-page-content">
        <div className="card evacuation-center-browser">
          <section className="evacuation-station-panel">
            <div className="evacuation-station-summary">
              <div className="card-title">Stations</div>
              <div className="field-help">{loading ? 'Loading locations…' : `${filteredStations.length} of ${stations.length} locations`}</div>
            </div>

            <label className="form-label" htmlFor="station-barangay-filter">Filter by barangay</label>
            <select id="station-barangay-filter" className="form-select evacuation-barangay-select" value={barangayFilter} onChange={(event) => { setBarangayFilter(event.target.value); setSelectedId(null); }}>
              <option value="all">All barangays</option>
              {barangayOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>

            <div className="evacuation-station-list">
              {loading && <div className="field-help evacuation-station-empty">Loading evacuation stations…</div>}
              {!loading && loadError && <div className="field-help evacuation-station-empty">Unable to load stations. Refresh to try again.</div>}
              {!loading && !loadError && filteredStations.length === 0 && <div className="field-help evacuation-station-empty">No stations match this barangay.</div>}
              {!loading && filteredStations.map((station) => {
                const selected = station.id === selectedId;
                return (
                  <button
                    type="button"
                    key={station.id}
                    onClick={() => setSelectedId(station.id)}
                    aria-pressed={selected}
                    className={`evacuation-station-card ${selected ? 'selected' : ''}`}
                  >
                    <MapPin size={17} aria-hidden="true" />
                    <div className="evacuation-station-card-copy">
                      <strong>{station.name}</strong>
                      <span>{station.barangays?.name || 'Barangay not listed'}</span>
                      {station.address && <small>{station.address}</small>}
                    </div>
                  </button>
                );
              })}
            </div>

          </section>

          <div className="evacuation-center-map">
            <MapContainer center={DEFAULT_CENTER} zoom={12} style={{ width: '100%', height: '100%', background: '#ffffff' }}>
              <TileLayer attribution={CARTO_ATTRIBUTION} url={CARTO_DARK_MAP_URL} />
              <MunicipalityBoundaryViewport boundary={boundary} />
              <MapViewport stations={mapStations} selectedId={selectedId} />
              {mapStations.map((station) => {
                const point = stationPoint(station);
                if (!point) return null;
                return (
                  <Marker key={station.id} position={point} eventHandlers={{ click: () => setSelectedId(station.id) }}>
                    <Popup>
                      <strong>{station.name}</strong><br />
                      {station.barangays?.name || 'Barangay not listed'}
                      {station.address ? <><br />{station.address}</> : null}
                    </Popup>
                  </Marker>
                );
              })}
              <MunicipalityBoundaryMapLayer boundary={boundary} />
            </MapContainer>
          </div>
        </div>
      </div>
    </>
  );
}
