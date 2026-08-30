import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { evacuationAPI, barangayListAPI } from '../lib/api';
import toast from 'react-hot-toast';

// Fix leaflet default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createEvacIcon = (pct: number) => {
  const color = pct >= 90 ? '#E74C3C' : pct >= 70 ? '#F39C12' : '#27AE60';
  return L.divIcon({
    html: `<div style="
      width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
    "><span style="transform:rotate(45deg);font-size:14px;">🏕️</span></div>`,
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
};

interface EvacCenter {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  max_capacity: number;
  barangay_id: string;
  barangays?: { id: string; name: string; municipality: string };
  total_persons: number;
  registration_count: number;
  occupancy_percent: number;
  with_infants: number;
  with_elderly: number;
  with_pwd: number;
  with_pregnant: number;
}

interface Barangay {
  id: string;
  name: string;
  municipality: string;
}

// Component to fly map to selected center
function MapFlyTo({ center }: { center: EvacCenter | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo([center.latitude, center.longitude], 16, { duration: 1 });
    }
  }, [center, map]);
  return null;
}

export default function EvacuationCentersPage() {
  const [centers, setCenters] = useState<EvacCenter[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [selectedBarangay, setSelectedBarangay] = useState<string>('all');
  const [selectedCenter, setSelectedCenter] = useState<EvacCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCenter, setDetailCenter] = useState<any>(null);

  const fetchCenters = async (barangayId?: string) => {
    setLoading(true);
    try {
      const params = barangayId && barangayId !== 'all' ? { barangay_id: barangayId } : undefined;
      const res = await evacuationAPI.list(params);
      setCenters(res.data || []);
    } catch {
      toast.error('Failed to load evacuation centers');
    } finally {
      setLoading(false);
    }
  };

  const fetchBarangays = async () => {
    try {
      const res = await barangayListAPI.list();
      setBarangays(res.data || []);
    } catch {
      // silently fail
    }
  };

  const fetchCenterDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await evacuationAPI.get(id);
      setDetailCenter(res.data);
    } catch {
      toast.error('Failed to load center details');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    fetchBarangays();
    fetchCenters();
  }, []);

  const handleBarangayChange = (val: string) => {
    setSelectedBarangay(val);
    setSelectedCenter(null);
    setDetailCenter(null);
    fetchCenters(val !== 'all' ? val : undefined);
  };

  const handleSelectCenter = (c: EvacCenter) => {
    setSelectedCenter(c);
    fetchCenterDetail(c.id);
  };

  const getOccupancyColor = (pct: number) =>
    pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--success)';

  const mapCenter: [number, number] = centers.length > 0
    ? [centers.reduce((s, c) => s + c.latitude, 0) / centers.length,
       centers.reduce((s, c) => s + c.longitude, 0) / centers.length]
    : [14.9133, 121.0436]; // Norzagaray default

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Evacuation Centers</h1>
        <div className="header-actions">
          <select
            className="form-select"
            value={selectedBarangay}
            onChange={(e) => handleBarangayChange(e.target.value)}
            style={{ width: 'auto', minWidth: '200px' }}
          >
            <option value="all">All Barangays</option>
            {barangays.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button className="btn btn-outline btn-sm" onClick={() => fetchCenters(selectedBarangay !== 'all' ? selectedBarangay : undefined)}>
            🔄 Refresh
          </button>
        </div>
      </div>

      <div className="page-content" style={{ padding: 0, display: 'flex', height: 'calc(100vh - 140px)', gap: 0, overflow: 'hidden' }}>

        {/* ── Left Panel: List ─────────────────────────────── */}
        <div style={{
          width: '340px', minWidth: '280px', overflowY: 'auto',
          background: 'var(--bg-card)', borderRight: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {loading ? 'Loading...' : `${centers.length} center${centers.length !== 1 ? 's' : ''} found`}
            </div>
          </div>

          {loading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : centers.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏕️</div>
              <p>No evacuation centers found</p>
            </div>
          ) : (
            centers.map((c) => (
              <div
                key={c.id}
                onClick={() => handleSelectCenter(c)}
                style={{
                  padding: '16px',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  background: selectedCenter?.id === c.id ? 'rgba(255,255,255,0.06)' : 'transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = selectedCenter?.id === c.id ? 'rgba(255,255,255,0.06)' : 'transparent')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{c.name}</div>
                  <span style={{
                    fontSize: '11px', fontWeight: 700, padding: '2px 8px',
                    borderRadius: '12px', background: `${getOccupancyColor(c.occupancy_percent)}22`,
                    color: getOccupancyColor(c.occupancy_percent), whiteSpace: 'nowrap', marginLeft: 8,
                  }}>
                    {c.occupancy_percent}%
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 6 }}>
                  🏘️ {c.barangays?.name || 'Unknown Barangay'}
                </div>
                {c.address && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 8 }}>
                    📍 {c.address}
                  </div>
                )}
                {/* Occupancy bar */}
                <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{
                    width: `${c.occupancy_percent}%`, height: '100%',
                    background: getOccupancyColor(c.occupancy_percent),
                    borderRadius: 4, transition: 'width 0.3s',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: '11px', color: 'var(--text-muted)' }}>
                  <span>{c.total_persons} / {c.max_capacity} persons</span>
                  <span>{c.registration_count} groups</span>
                </div>
                {/* Special needs badges */}
                {(c.with_infants > 0 || c.with_elderly > 0 || c.with_pwd > 0 || c.with_pregnant > 0) && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    {c.with_infants > 0 && <span style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(52,152,219,0.2)', color: '#3498DB', borderRadius: 8 }}>👶 {c.with_infants}</span>}
                    {c.with_elderly > 0 && <span style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(155,89,182,0.2)', color: '#9B59B6', borderRadius: 8 }}>👴 {c.with_elderly}</span>}
                    {c.with_pwd > 0 && <span style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(241,196,15,0.2)', color: '#F1C40F', borderRadius: 8 }}>♿ {c.with_pwd}</span>}
                    {c.with_pregnant > 0 && <span style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(231,76,60,0.2)', color: '#E74C3C', borderRadius: 8 }}>🤰 {c.with_pregnant}</span>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* ── Center: Map ──────────────────────────────────── */}
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer
            center={mapCenter}
            zoom={13}
            style={{ width: '100%', height: '100%' }}
            zoomControl={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapFlyTo center={selectedCenter} />
            {centers.map((c) => (
              <Marker
                key={c.id}
                position={[c.latitude, c.longitude]}
                icon={createEvacIcon(c.occupancy_percent)}
                eventHandlers={{ click: () => handleSelectCenter(c) }}
              >
                <Popup>
                  <div style={{ minWidth: 180 }}>
                    <strong style={{ fontSize: '13px' }}>{c.name}</strong><br />
                    <span style={{ fontSize: '11px', color: '#666' }}>{c.barangays?.name}</span><br />
                    <div style={{ marginTop: 6, fontSize: '12px' }}>
                      👥 {c.total_persons} / {c.max_capacity} persons ({c.occupancy_percent}%)
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {/* Legend */}
          <div style={{
            position: 'absolute', bottom: 24, right: 16, zIndex: 1000,
            background: 'rgba(26,35,50,0.95)', borderRadius: 10,
            padding: '12px 16px', border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(8px)', fontSize: '12px', color: 'var(--text-primary)',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Occupancy</div>
            {[['#27AE60', '< 70%', 'Available'], ['#F39C12', '70–89%', 'Filling Up'], ['#E74C3C', '≥ 90%', 'Near Full']].map(([color, range, label]) => (
              <div key={range} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />
                <span style={{ color: 'var(--text-muted)' }}>{range}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right Panel: Detail ──────────────────────────── */}
        {selectedCenter && (
          <div style={{
            width: '320px', minWidth: '280px', overflowY: 'auto',
            background: 'var(--bg-card)', borderLeft: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                    {selectedCenter.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    🏘️ {selectedCenter.barangays?.name}, {selectedCenter.barangays?.municipality}
                  </div>
                </div>
                <button
                  onClick={() => { setSelectedCenter(null); setDetailCenter(null); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px', padding: 0 }}
                >×</button>
              </div>
            </div>

            {detailLoading ? (
              <div style={{ padding: 20 }}><div className="spinner" /></div>
            ) : detailCenter ? (
              <div style={{ padding: '16px' }}>
                {/* Key Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: 'Max Capacity', value: detailCenter.max_capacity, icon: '🏠' },
                    { label: 'Total Persons', value: detailCenter.total_persons, icon: '👥' },
                    { label: 'Occupancy', value: `${detailCenter.occupancy_percent}%`, icon: '📊' },
                    { label: 'Groups Registered', value: detailCenter.registration_count, icon: '📋' },
                  ].map(({ label, value, icon }) => (
                    <div key={label} style={{
                      background: 'rgba(255,255,255,0.04)', borderRadius: 10,
                      padding: '12px', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '20px', marginBottom: 4 }}>{icon}</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Occupancy Bar */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>Occupancy</span>
                    <span style={{ color: getOccupancyColor(detailCenter.occupancy_percent), fontWeight: 600 }}>
                      {detailCenter.occupancy_percent}%
                    </span>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                    <div style={{
                      width: `${detailCenter.occupancy_percent}%`, height: '100%',
                      background: getOccupancyColor(detailCenter.occupancy_percent), borderRadius: 6,
                    }} />
                  </div>
                </div>

                {/* Special Needs */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                    Special Needs Groups
                  </div>
                  {[
                    { label: 'Groups with Infants', value: detailCenter.with_infants || 0, icon: '👶', color: '#3498DB' },
                    { label: 'Groups with Elderly', value: detailCenter.with_elderly || 0, icon: '👴', color: '#9B59B6' },
                    { label: 'Groups with PWD', value: detailCenter.with_pwd || 0, icon: '♿', color: '#F1C40F' },
                    { label: 'Groups with Pregnant', value: detailCenter.with_pregnant || 0, icon: '🤰', color: '#E74C3C' },
                  ].map(({ label, value, icon, color }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px' }}>
                        <span>{icon}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                      </div>
                      <span style={{ fontWeight: 700, color, fontSize: '14px' }}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Location */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    Location
                  </div>
                  {detailCenter.address && (
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: 6 }}>
                      📍 {detailCenter.address}
                    </div>
                  )}
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {detailCenter.latitude?.toFixed(6)}, {detailCenter.longitude?.toFixed(6)}
                  </div>
                </div>

                {/* Recent Registrations */}
                {detailCenter.registrations?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                      Recent Registrations
                    </div>
                    {detailCenter.registrations.slice(0, 10).map((r: any) => (
                      <div key={r.id} style={{
                        background: 'rgba(255,255,255,0.03)', borderRadius: 8,
                        padding: '10px 12px', marginBottom: 8,
                        border: '1px solid rgba(255,255,255,0.05)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: '13px', fontWeight: 600 }}>📞 {r.contact_number}</span>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{r.person_count} person{r.person_count !== 1 ? 's' : ''}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.has_infants && <span style={{ fontSize: '10px' }}>👶 Infants</span>}
                          {r.has_elderly && <span style={{ fontSize: '10px' }}>👴 Elderly</span>}
                          {r.has_pwd && <span style={{ fontSize: '10px' }}>♿ PWD</span>}
                          {r.has_pregnant && <span style={{ fontSize: '10px' }}>🤰 Pregnant</span>}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>
                          {new Date(r.registered_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                    {detailCenter.registrations.length > 10 && (
                      <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', marginTop: 8 }}>
                        +{detailCenter.registrations.length - 10} more registrations
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
