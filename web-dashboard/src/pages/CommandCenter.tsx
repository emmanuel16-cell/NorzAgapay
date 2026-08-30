import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { analyticsAPI, missionAPI, userAPI, storageAPI, socket } from '../lib/api';
import { useAuth } from '../context/AuthContext';

// Fix for default marker icons in Leaflet with Webpack/Vite
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIconRetina,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface Stats {
  totalUsers: number; activeVolunteers: number; openMissions: number;
  totalTasks: number; completedTasks: number; shipmentsInTransit: number;
}

interface Mission {
  id: string; title: string; type: string; severity: string; status: string;
  latitude: number; longitude: number; address?: string; created_at: string;
}

interface Responder {
  id: string;
  full_name: string;
  role: string;
  unit_type?: string;
  latitude?: number;
  longitude?: number;
}

interface Storage {
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  address?: string;
}

const severityClass: Record<string, string> = { critical: 'badge-critical', high: 'badge-high', moderate: 'badge-moderate', low: 'badge-low' };

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#C0392B',
  high: '#E67E22',
  moderate: '#F1C40F',
  low: '#2ECC71',
};

const DOT_COLORS: Record<string, string> = {
  police: '#3498DB', fire: '#E74C3C', medical: '#27AE60',
  volunteer_specialist: '#F1C40F', volunteer_general: '#ECF0F1',
};

const TYPE_ICONS: Record<string, string> = {
  police: '🚔',
  fire: '🚒',
  medical: '🚑',
  volunteer_specialist: '🛠️',
  volunteer_general: '👤',
  incident: '🚨',
  rescue: '🚁',
  accident: '🚗',
  flash_flood: '🌊',
  earthquake: '🌋',
  medical_emergency: '🚑',
  typhoon: '🌀',
  other: '📍',
};

// Custom Marker Creators
const createDotIcon = (color: string, size = 12, pulse = false, icon?: string) => {
  return L.divIcon({
    html: `<div style="
      width: ${size}px; 
      height: ${size}px; 
      border-radius: 50%; 
      background: ${color}; 
      border: 2px solid rgba(255,255,255,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: ${size * 0.6}px;
      box-shadow: 0 0 10px rgba(0,0,0,0.5);
      ${pulse ? 'animation: pulse 2s infinite;' : ''}
    ">${icon || ''}</div>`,
    className: 'custom-dot-icon',
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
  });
};

const createPinIcon = (color: string, icon: string) => {
  const size = 36;
  return L.divIcon({
    html: `
      <div style="position: relative; width: ${size}px; height: ${size}px;">
        <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
          <path d="M12 21C16.5 16.5 20 12.9167 20 9.16667C20 4.65633 16.4183 1 12 1C7.58172 1 4 4.65633 4 9.16667C4 12.9167 7.5 16.5 12 21Z" fill="${color}" stroke="white" stroke-width="1.5"/>
          <circle cx="12" cy="9" r="6" fill="white"/>
        </svg>
        <div style="
          position: absolute; 
          top: 4px; 
          left: 0; 
          width: ${size}px; 
          height: ${size * 0.7}px; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          font-size: ${size * 0.4}px;
          z-index: 2;
        ">${icon}</div>
      </div>
    `,
    className: 'custom-pin-icon',
    iconSize: [size, size],
    iconAnchor: [size/2, size],
    popupAnchor: [0, -size],
  });
};

// Helper to fix map rendering issues when data loads
function MapController({ missions, responders, storages, filters }: { missions: any[], responders: any[], storages: any[], filters: any }) {
  const map = useMap();
  
  useEffect(() => {
    // Small delay to ensure container is stable
    const timer = setTimeout(() => {
      map.invalidateSize();
      
      // Filter data for bounds calculation
      const visibleMissions = missions.filter(m => filters[m.status]);
      const visibleResponders = filters.units ? responders : [];
      const visibleStorages = filters.others ? storages : [];

      // If we have markers, try to fit them in view if they are not visible
      if (visibleMissions.length > 0 || visibleResponders.length > 0 || visibleStorages.length > 0) {
        const bounds = L.latLngBounds([]);
        visibleMissions.forEach(m => {
          if (m.latitude && m.longitude) bounds.extend([m.latitude, m.longitude]);
        });
        visibleResponders.forEach(r => {
          if (r.latitude && r.longitude) bounds.extend([r.latitude, r.longitude]);
        });
        visibleStorages.forEach(s => {
          if (s.latitude && s.longitude) bounds.extend([s.latitude, s.longitude]);
        });
        
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [map, missions.length, responders.length, storages.length, filters]);

  return null;
}

export default function CommandCenter() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [storages, setStorages] = useState<Storage[]>([]);
  
  // Map Filters
  const [filters, setFilters] = useState({
    open: true,
    in_progress: true,
    resolved: false,
    units: true,
    others: true
  });

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [analyticsRes, missionsRes, respondersRes, storagesRes] = await Promise.all([
          analyticsAPI.overview(),
          missionAPI.list(), 
          userAPI.list({ status: 'active' }),
          storageAPI.list()
        ]);

        const s = analyticsRes.data.stats;
        if (s) {
          setStats({
            ...s,
            openMissions: s.openIncidents
          });
        }

        setMissions(missionsRes.data.incidents || []);
        setResponders(respondersRes.data.users || []);
        setStorages(storagesRes.data.storages || []);
      } catch (error) {
        console.error('Failed to fetch Command Center data:', error);
      }
    };

    fetchData();
  }, []);

  // Real-time updates via Socket.io
  useEffect(() => {
    if (!user) return;

    // Join commander room
    socket.emit('join:role', 'commander');

    // Listen for GPS updates
    socket.on('gps:location', (data: { userId: string; latitude: number; longitude: number }) => {
      setResponders(prev => prev.map(r => 
        r.id === data.userId 
          ? { ...r, latitude: data.latitude, longitude: data.longitude } 
          : r
      ));
    });

    // Listen for new incidents
    socket.on('incident:new', (incident: Mission) => {
      setMissions(prev => [incident, ...prev]);
      // Update stats
      setStats(prev => prev ? { ...prev, openMissions: prev.openMissions + 1 } : null);
    });

    // Listen for task status updates (affects mission progress)
    socket.on('task:statusChanged', (data: { taskId: string; status: string; userId: string }) => {
      // We might want to re-fetch missions or stats here if a task change affects them
      // For now, just a placeholder for more complex logic
      console.log('Task status changed:', data);
    });

    return () => {
      socket.off('gps:location');
      socket.off('incident:new');
      socket.off('task:statusChanged');
    };
  }, [user]);

  const statCards = [
    { label: 'Active Volunteers', value: stats?.activeVolunteers ?? '—', icon: '👥', color: 'var(--primary)' },
    { label: 'Open Missions', value: stats?.openMissions ?? '—', icon: '🚨', color: 'var(--accent)' },
    { label: 'Tasks Completed', value: stats?.completedTasks ?? '—', icon: '✅', color: 'var(--success)' },
    { label: 'Shipments In Transit', value: stats?.shipmentsInTransit ?? '—', icon: '🚚', color: 'var(--warning)' },
  ];

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Command Center</h1>
        <div className="header-actions">
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Live • {new Date().toLocaleTimeString()}
          </span>
        </div>
      </div>

      <div className="stats-grid">
        {statCards.map((s) => (
          <div key={s.label} className="stat-card" style={{ '--stat-color': s.color } as React.CSSProperties}>
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '0 24px 24px', display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
        {/* Map */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 1, minHeight: '500px', position: 'relative', zIndex: 1 }}>
            {/* Map Filter HUD */}
            <div style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              zIndex: 1000,
              background: 'rgba(17, 24, 39, 0.85)',
              backdropFilter: 'blur(8px)',
              padding: '10px 20px',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              display: 'flex',
              gap: '24px',
              boxShadow: '0 4px 15px rgba(0,0,0,0.4)',
              pointerEvents: 'auto'
            }}>
              {[
                { key: 'open', label: 'Dispatch', color: 'var(--info)' },
                { key: 'in_progress', label: 'In Progress', color: 'var(--warning)' },
                { key: 'resolved', label: 'Resolved', color: 'var(--success)' },
                { key: 'units', label: 'Units', color: 'var(--primary-light)' },
                { key: 'others', label: 'Others', color: 'var(--accent)' },
              ].map((f) => (
                <label key={f.key} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  color: filters[f.key as keyof typeof filters] ? 'white' : 'var(--text-muted)',
                  transition: 'color 0.2s ease'
                }}>
                  <input 
                    type="checkbox" 
                    checked={filters[f.key as keyof typeof filters]}
                    onChange={(e) => setFilters({ ...filters, [f.key]: e.target.checked })}
                    style={{ 
                      width: '16px', 
                      height: '16px', 
                      accentColor: f.color,
                      cursor: 'pointer'
                    }}
                  />
                  {f.label}
                </label>
              ))}
            </div>

            <MapContainer 
              center={[14.904246495288923, 121.0430072345187]} 
              zoom={15} 
              style={{ width: '100%', height: '100%', background: '#111827' }}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              />

              <MapController missions={missions} responders={responders} storages={storages} filters={filters} />
              
              {/* Mission Markers */}
              {missions
                .filter(m => filters[m.status as keyof typeof filters])
                .map(inc => {
                const lat = Number(inc.latitude);
                const lng = Number(inc.longitude);
                if (isNaN(lat) || isNaN(lng)) return null;
                
                return (
                  <Marker 
                    key={inc.id} 
                    position={[lat, lng]}
                    icon={createPinIcon(SEVERITY_COLORS[inc.severity] || '#E67E22', TYPE_ICONS[inc.type] || '🚨')}
                  >
                    <Popup>
                      <div style={{ color: '#1a1a2e' }}>
                        <strong>{inc.title}</strong><br/>
                        <span style={{ fontSize: '12px' }}>{inc.type.replace('_', ' ')} • {inc.severity}</span>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {/* Storage Markers */}
              {filters.others && storages.map(storage => {
                if (!storage.latitude || !storage.longitude) return null;
                return (
                  <Marker 
                    key={storage.id} 
                    position={[storage.latitude, storage.longitude]}
                    icon={createPinIcon('var(--accent)', '📦')}
                  >
                    <Popup>
                      <div className="popup-content">
                        <div style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 600, marginBottom: '4px' }}>STORAGE / WAREHOUSE</div>
                        <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>{storage.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{storage.address || 'No address provided'}</div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {/* Responder Markers */}
              {filters.units && responders.map(u => {
                const lat = Number(u.latitude);
                const lng = Number(u.longitude);
                if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;

                const color = (u.unit_type && DOT_COLORS[u.unit_type]) ? DOT_COLORS[u.unit_type] : (DOT_COLORS[u.role] || '#888');
                const icon = (u.unit_type && TYPE_ICONS[u.unit_type]) ? TYPE_ICONS[u.unit_type] : (TYPE_ICONS[u.role] || '👤');
                return (
                  <Marker 
                    key={u.id} 
                    position={[lat, lng]}
                    icon={createDotIcon(color, 24, false, icon)}
                  >
                    <Popup>
                      <div style={{ color: '#1a1a2e' }}>
                        <strong>{u.full_name}</strong><br/>
                        <span style={{ fontSize: '12px' }}>{u.role.replace(/_/g, ' ')}</span>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>

          {/* Map Legend */}
          <div className="card" style={{ marginTop: '12px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-muted)', marginRight: '4px' }}>Units:</span>
                {[
                  { color: '#3498DB', label: 'Police', icon: '🚔' },
                  { color: '#E74C3C', label: 'Fire', icon: '🚒' },
                  { color: '#27AE60', label: 'Medical', icon: '🚑' },
                  { color: '#F1C40F', label: 'Specialist', icon: '🛠️' },
                  { color: '#ECF0F1', label: 'General', icon: '👤' },
                ].map((d) => (
                  <span key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ 
                      width: 18, 
                      height: 18, 
                      borderRadius: '50%', 
                      background: d.color, 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      fontSize: '10px',
                      border: '1px solid rgba(255,255,255,0.5)'
                    }}>{d.icon}</span>
                    {d.label}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-muted)', marginRight: '4px' }}>Missions:</span>
                {[
                  { color: '#C0392B', label: 'Critical' },
                  { color: '#E67E22', label: 'High' },
                  { color: '#F1C40F', label: 'Moderate' },
                  { color: '#2ECC71', label: 'Low' },
                ].map((d) => (
                  <span key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ position: 'relative', width: 14, height: 18 }}>
                      <svg width="14" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 21C16.5 16.5 20 12.9167 20 9.16667C20 4.65633 16.4183 1 12 1C7.58172 1 4 4.65633 4 9.16667C4 12.9167 7.5 16.5 12 21Z" fill={d.color}/>
                      </svg>
                    </div>
                    {d.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Mission Sidebar */}
        <div style={{ flex: 1, minWidth: '280px' }}>
          <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <span className="card-title">Missions List</span>
              <span className="badge badge-open">{
                missions.filter(m => filters[m.status as keyof typeof filters]).length
              }</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {missions.filter(m => filters[m.status as keyof typeof filters]).length === 0 ? (
                <div className="empty-state" style={{ padding: '30px 10px' }}>
                  <p style={{ fontSize: '13px' }}>No matching missions</p>
                </div>
              ) : (
                missions
                  .filter(m => filters[m.status as keyof typeof filters])
                  .map((inc) => (
                  <div
                    key={inc.id}
                    className="list-item-hover"
                    style={{
                      padding: '12px',
                      borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{inc.title}</span>
                      <span className={`badge ${severityClass[inc.severity]}`}>{inc.severity}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {inc.type.replace(/_/g, ' ')} • {inc.address || 'No address'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
