import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Building2, MapPin, Plus, RotateCcw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { evacuationAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { CARTO_DARK_MAP_URL, CARTO_ATTRIBUTION } from '../lib/mapConfig';

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
  barangay_id?: string;
  barangays?: { id?: string; name?: string; municipality?: string } | null;
}

const DEFAULT_CENTER: [number, number] = [14.9133, 121.0436];

function stationPoint(station: EvacuationStation): [number, number] | null {
  const latitude = Number(station.latitude);
  const longitude = Number(station.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null;
}

function LocationPicker({ onPick }: { onPick: (point: [number, number]) => void }) {
  useMapEvents({
    click(event) {
      onPick([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
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

function BarangayStationForm() {
  const { user } = useAuth();
  const barangayId = user?.barangay_id || '';
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<[number, number]>(DEFAULT_CENTER);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName('');
    setAddress('');
    setPoint(DEFAULT_CENTER);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !barangayId) {
      toast.error('Enter a station name and select its barangay');
      return;
    }

    setSaving(true);
    try {
      await evacuationAPI.addBarangay({
        name: name.trim(),
        address: address.trim(),
        latitude: point[0],
        longitude: point[1],
      });
      toast.success('Evacuation station added');
      resetForm();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not add evacuation station');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">Field infrastructure</div>
          <h1 className="page-title">Add Evacuation Station</h1>
          <p className="page-subtitle">Register a station and pin its location for your barangay.</p>
        </div>
      </div>

      <div className="page-content" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 0.85fr) minmax(360px, 1.15fr)', gap: 20, alignItems: 'start' }}>
        <form className="card" onSubmit={handleSubmit} style={{ padding: 24 }}>
          <div className="card-title" style={{ marginBottom: 6 }}>Station details</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 20px' }}>Residents and MDRRMO can view this station after it is added.</p>

          <label className="form-label" htmlFor="station-name">Station name</label>
          <input id="station-name" className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Norzagaray Central School" required />

          <div className="field-help" style={{ marginTop: 8 }}>This station will be registered under {user?.barangay_name || 'your barangay'}.</div>

          <label className="form-label" htmlFor="station-address" style={{ marginTop: 16 }}>Address or landmark</label>
          <input id="station-address" className="form-input" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street, sitio, or nearby landmark" />

          <div style={{ marginTop: 20, padding: 14, borderRadius: 12, background: 'rgba(14,165,233,.08)', border: '1px solid rgba(14,165,233,.2)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
              <MapPin size={18} color="#38bdf8" />
              <strong>Map pin</strong>
            </div>
            <div className="field-help">Click the map to place the station marker.</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 8, color: 'var(--text-secondary)' }}>
              {point[0].toFixed(6)}, {point[1].toFixed(6)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
            <button type="button" className="btn btn-outline" onClick={resetForm}><RotateCcw size={16} /> Clear</button>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 1 }}><Plus size={17} /> {saving ? 'Adding station…' : 'Add station'}</button>
          </div>
        </form>

        <div className="card" style={{ padding: 0, overflow: 'hidden', minHeight: 560 }}>
          <MapContainer center={point} zoom={13} style={{ width: '100%', height: 560 }}>
            <TileLayer attribution={CARTO_ATTRIBUTION} url={CARTO_DARK_MAP_URL} />
            <LocationPicker onPick={setPoint} />
            <Marker position={point} />
          </MapContainer>
        </div>
      </div>
    </>
  );
}

function MdrrmoStationMap() {
  const [stations, setStations] = useState<EvacuationStation[]>([]);
  const [search, setSearch] = useState('');
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
    const query = search.trim().toLocaleLowerCase();
    return stations.filter((station) => {
      const barangayName = station.barangays?.name || '';
      const matchesBarangay = barangayFilter === 'all' || barangayName === barangayFilter;
      const matchesSearch = !query || [station.name, station.address || '', barangayName]
        .some((value) => value.toLocaleLowerCase().includes(query));
      return matchesBarangay && matchesSearch;
    });
  }, [barangayFilter, search, stations]);

  const clearFilters = () => {
    setSearch('');
    setBarangayFilter('all');
    setSelectedId(null);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">Field infrastructure</div>
          <h1 className="page-title">Evacuation Centers</h1>
          <p className="page-subtitle">View and locate evacuation stations registered by barangays.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={loadStations} disabled={loading}><RotateCcw size={16} /> Refresh</button>
      </div>

      <div className="page-content">
        <div className="card evacuation-center-browser">
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <div>
                <div className="card-title">Stations</div>
                <div className="field-help">{loading ? 'Loading locations…' : `${filteredStations.length} of ${stations.length} locations`}</div>
              </div>
              <Building2 size={22} color="var(--accent, #38bdf8)" />
            </div>

            <label className="form-label" htmlFor="station-search">Search stations</label>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search size={17} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
              <input id="station-search" className="form-input" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId(null); }} placeholder="Name, address, or barangay" style={{ paddingLeft: 38 }} />
            </div>

            <label className="form-label" htmlFor="station-barangay-filter">Filter by barangay</label>
            <select id="station-barangay-filter" className="form-select" value={barangayFilter} onChange={(event) => { setBarangayFilter(event.target.value); setSelectedId(null); }}>
              <option value="all">All barangays</option>
              {barangayOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>

            <div style={{ maxHeight: 410, overflowY: 'auto', marginTop: 14, display: 'grid', gap: 8 }}>
              {loading && <div className="field-help" style={{ padding: 18, textAlign: 'center' }}>Loading evacuation stations…</div>}
              {!loading && loadError && <div className="field-help" style={{ padding: 18, textAlign: 'center' }}>Unable to load stations. Refresh to try again.</div>}
              {!loading && !loadError && filteredStations.length === 0 && <div className="field-help" style={{ padding: 18, textAlign: 'center' }}>No stations match these filters.</div>}
              {!loading && filteredStations.map((station) => {
                const selected = station.id === selectedId;
                return (
                  <button
                    type="button"
                    key={station.id}
                    onClick={() => setSelectedId(station.id)}
                    aria-pressed={selected}
                    style={{ textAlign: 'left', padding: 12, borderRadius: 10, border: `1px solid ${selected ? 'rgba(56,189,248,.65)' : 'var(--border-color, rgba(255,255,255,.1))'}`, background: selected ? 'rgba(14,165,233,.1)' : 'var(--surface-secondary, rgba(255,255,255,.025))', color: 'var(--text-primary)', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                      <MapPin size={17} color="#38bdf8" style={{ flex: '0 0 auto', marginTop: 2 }} />
                      <div>
                        <strong style={{ display: 'block', fontSize: 13 }}>{station.name}</strong>
                        <span className="field-help">{station.barangays?.name || 'Barangay not listed'}{station.address ? ` · ${station.address}` : ''}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <button type="button" className="btn btn-outline" onClick={clearFilters} style={{ width: '100%', marginTop: 12 }}><RotateCcw size={15} /> Clear search and filter</button>
          </section>

          <div className="evacuation-center-map">
            <MapContainer center={DEFAULT_CENTER} zoom={12} style={{ width: '100%', height: '100%' }}>
              <TileLayer attribution={CARTO_ATTRIBUTION} url={CARTO_DARK_MAP_URL} />
              <MapViewport stations={filteredStations} selectedId={selectedId} />
              {filteredStations.map((station) => {
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
            </MapContainer>
          </div>
        </div>
      </div>
    </>
  );
}

export default function EvacuationCentersPage() {
  const { isBarangayAccount } = useAuth();
  return isBarangayAccount ? <BarangayStationForm /> : <MdrrmoStationMap />;
}
