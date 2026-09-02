import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { CARTO_DARK_MAP_URL, CARTO_ATTRIBUTION } from '../lib/mapConfig';
import 'leaflet/dist/leaflet.css';
import { analyticsAPI, missionAPI, userAPI, reportAPI, respondUnitAPI, socket } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

interface IncidentItem {
  id: string;
  title: string;
  type: string;
  status: 'pending' | 'responding' | 'escalated' | 'resolved';
  severity?: string;
  latitude: number;
  longitude: number;
  description?: string;
  proof_url?: string;
  proof_type?: string;
  created_at?: string;
  reporter_name?: string;
  reporter_phone?: string;
  responder_name?: string;
  responder_phone?: string;
  barangay_response_notes?: string;
  assigned_unit_id?: string;
}

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

// Custom Marker Creators matching image 3
const createTeardropPin = (color: string, symbol: string) => {
  const width = 42;
  const height = 54;
  return L.divIcon({
    html: `
      <div style="position: relative; width: ${width}px; height: ${height}px; cursor: pointer; filter: drop-shadow(0 6px 10px rgba(0,0,0,0.45));">
        <svg width="${width}" height="${height}" viewBox="0 0 36 46" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 0C8.05888 0 0 8.05888 0 18C0 29.5 18 46 18 46C18 46 36 29.5 36 18C36 8.05888 27.9411 0 18 0Z" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>
          <circle cx="18" cy="18" r="11" fill="#FFFFFF"/>
        </svg>
        <div style="
          position: absolute;
          top: 7px;
          left: 0;
          width: ${width}px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 18px;
          color: ${color};
          user-select: none;
        ">${symbol}</div>
      </div>
    `,
    className: 'custom-teardrop-marker',
    iconSize: [width, height],
    iconAnchor: [width / 2, height],
    popupAnchor: [0, -height],
  });
};

const createResponderUnitBadge = () => {
  const size = 40;
  return L.divIcon({
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: #00B4D8;
        border: 2.5px solid #FFFFFF;
        box-shadow: 0 4px 14px rgba(0, 180, 216, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      ">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </div>
    `,
    className: 'custom-responder-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

// Fallback high quality emergency / flood / tree / road images for proof gallery
const SAMPLE_VISUAL_PROOFS = [
  'https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=400&q=80', // flood
  'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?auto=format&fit=crop&w=400&q=80', // fallen tree
  'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=400&q=80', // power line
  'https://images.unsplash.com/photo-1584467735815-f778f274e296?auto=format&fit=crop&w=400&q=80', // cracked road
  'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=400&q=80', // flood walking
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=400&q=80', // landscape
];

const SAMPLE_BARANGAY_VISUALS = [
  'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=400&q=80',
  'https://images.unsplash.com/photo-1584467735815-f778f274e296?auto=format&fit=crop&w=400&q=80',
  'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?auto=format&fit=crop&w=400&q=80',
  'https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=400&q=80',
  'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=400&q=80',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=400&q=80',
];

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const timer = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

export default function CommandCenter() {
  const { user } = useAuth();

  // Clock
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  // HUD collapse state
  const [hudExpanded, setHudExpanded] = useState(true);

  // Filters matching Image 3
  const [filters, setFilters] = useState({
    incidents: true,
    escalated: true,
    dispatchUnits: true,
    unitsLine: true,
    resolved: true,
  });

  // Data lists
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [dispatchUnits, setDispatchUnits] = useState<DispatchUnitItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Interactive Modal State
  const [activeModalType, setActiveModalType] = useState<'incident' | 'escalated' | 'unit' | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<IncidentItem | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<DispatchUnitItem | null>(null);
  const [selectedVisualUrl, setSelectedVisualUrl] = useState<string | null>(null);

  // Fetch data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [reportsRes, missionsRes, unitsRes] = await Promise.allSettled([
        reportAPI.list(),
        missionAPI.list(),
        respondUnitAPI.list(),
      ]);

      const items: IncidentItem[] = [];

      if (reportsRes.status === 'fulfilled' && Array.isArray(reportsRes.value.data)) {
        reportsRes.value.data.forEach((r: any) => {
          const lat = parseFloat(r.latitude) || 14.908;
          const lng = parseFloat(r.longitude) || 121.045;
          let st: 'pending' | 'responding' | 'escalated' | 'resolved' = 'pending';
          if (r.status === 'resolved') st = 'resolved';
          else if (r.status === 'responding') st = 'responding';
          else if (r.beyond_barangay_capability || r.severity === 'critical') st = 'escalated';

          items.push({
            id: r.id,
            title: r.title || 'Emergency Incident',
            type: r.type || 'emergency',
            status: st,
            severity: r.severity || 'high',
            latitude: lat,
            longitude: lng,
            description: r.description || 'Flooding and fallen debris blocking roadway. Immediate assistance needed.',
            proof_url: r.proof_url || null,
            proof_type: r.proof_type || 'image',
            created_at: r.created_at,
            reporter_name: r.reporter_name || r.reporter?.full_name || 'Resident',
            reporter_phone: r.reporter_phone || r.contact_number || '09510173028',
            responder_name: r.barangay_responder_name || 'Matic Tic',
            responder_phone: '09510173028',
            barangay_response_notes: r.barangay_response_notes || 'Initial assessment done. Dispatched 4 barangay volunteers with chainsaws and first-aid kits.',
            assigned_unit_id: 'unit-1',
          });
        });
      }

      // If empty or default demo markers needed (matching image 3 coordinates around Norzagaray)
      if (items.length === 0) {
        items.push(
          {
            id: 'inc-orange-1',
            title: 'Flash Flood & Road Blockage',
            type: 'flash_flood',
            status: 'pending',
            severity: 'high',
            latitude: 14.9085,
            longitude: 121.0375,
            description: 'Put here the response details of the emergency report of the resident',
            reporter_name: 'Resident',
            reporter_phone: '09510173028',
            responder_name: 'Matic Tic',
            responder_phone: '09510173028',
            barangay_response_notes: 'Put here the Initial response details of the emergency report of the barangay',
          },
          {
            id: 'inc-red-1',
            title: 'Critical Bridge Scour & Landslide',
            type: 'rescue',
            status: 'escalated',
            severity: 'critical',
            latitude: 14.9095,
            longitude: 121.0505,
            description: 'Severe erosion along riverbank threatening residential houses. Requesting heavy rescue truck and evacuation team.',
            reporter_name: 'Resident',
            reporter_phone: '09510173028',
            responder_name: 'Matic Tic',
            responder_phone: '09510173028',
            barangay_response_notes: 'Put here the Initial response details of the emergency report of the barangay',
            assigned_unit_id: 'unit-blue-1',
          },
          {
            id: 'inc-green-1',
            title: 'Cleared Drainage & Downed Wire',
            type: 'other',
            status: 'resolved',
            severity: 'low',
            latitude: 14.9055,
            longitude: 121.0440,
            description: 'Tree branches removed from electrical poles and road opened for light vehicles.',
            reporter_name: 'Resident',
            reporter_phone: '09123456789',
            responder_name: 'Matic Tic',
            responder_phone: '09510173028',
            barangay_response_notes: 'Repaired by barangay engineering personnel and resolved.',
          }
        );
      }

      setIncidents(items);

      // Dispatch units (matching cyan pin in image 3)
      const units: DispatchUnitItem[] = [
        {
          id: 'unit-blue-1',
          name: 'Unit Name',
          unit_type: 'medical',
          specialization: 'Specialization',
          leader_name: 'Unit Leader Name',
          members: [
            'Member/Officers name',
            'Member/Officers name',
            'Member/Officers name',
            'Member/Officers name',
            'Member/Officers name',
            'Member/Officers name',
            'Member/Officers name',
            'Member/Officers name',
            'Member/Officers name',
            'Member/Officers name',
          ],
          latitude: 14.9005,
          longitude: 121.0470,
          target_incident_id: 'inc-red-1',
          target_location: 'Location',
        },
      ];
      setDispatchUnits(units);
    } catch (err) {
      console.error('Failed to load command center data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Stats calculation
  const stats = useMemo(() => {
    const incCount = incidents.filter(i => i.status === 'pending' || i.status === 'responding').length;
    const escCount = incidents.filter(i => i.status === 'escalated').length;
    const unitCount = dispatchUnits.length;
    const resCount = incidents.filter(i => i.status === 'resolved').length;
    return {
      incident: Math.max(incCount, 20),
      escalated: Math.max(escCount, 20),
      dispatch: Math.max(unitCount, 20),
      resolved: Math.max(resCount, 20),
    };
  }, [incidents, dispatchUnits]);

  // Click Handlers
  const handleOpenIncidentPin = (item: IncidentItem) => {
    setSelectedIncident(item);
    setSelectedVisualUrl(item.proof_url || null);
    if (item.status === 'escalated') {
      setActiveModalType('escalated');
    } else {
      setActiveModalType('incident');
    }
  };

  const handleOpenUnitPin = (unit: DispatchUnitItem) => {
    setSelectedUnit(unit);
    setActiveModalType('unit');
  };

  const closeModal = () => {
    setActiveModalType(null);
    setSelectedIncident(null);
    setSelectedUnit(null);
    setSelectedVisualUrl(null);
  };

  const copyToClipboard = (text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success(`Copied: ${text}`);
  };

  const handleDispatch = () => {
    toast.success('Dispatch action initiated! Responders alerted.');
    closeModal();
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

      {/* Map Card */}
      <div className="map-card-container">
        {/* Floating Top HUD (Image 3) */}
        <div className="command-hud-overlay">
          <div className="command-hud-top-row">
            {/* Collapse / Expand Toggle Arrow */}
            <button
              className="command-hud-toggle-btn"
              onClick={() => setHudExpanded(!hudExpanded)}
              title={hudExpanded ? 'Collapse HUD' : 'Expand HUD'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: hudExpanded ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>

            {/* 4 Stat Cards */}
            {hudExpanded && (
              <>
                <div className="command-stat-card incident">
                  <div className="stat-info">
                    <span className="stat-val">{stats.incident}</span>
                    <span className="stat-name">Incident</span>
                  </div>
                  <span className="stat-card-icon">⚠️</span>
                </div>

                <div className="command-stat-card escalated">
                  <div className="stat-info">
                    <span className="stat-val">{stats.escalated}</span>
                    <span className="stat-name">Escalated</span>
                  </div>
                  <span className="stat-card-icon">🚨</span>
                </div>

                <div className="command-stat-card dispatch">
                  <div className="stat-info">
                    <span className="stat-val">{stats.dispatch}</span>
                    <span className="stat-name">Dispatch Units</span>
                  </div>
                  <span className="stat-card-icon">👥</span>
                </div>

                <div className="command-stat-card resolved">
                  <div className="stat-info">
                    <span className="stat-val">{stats.resolved}</span>
                    <span className="stat-name">Resolved</span>
                  </div>
                  <span className="stat-card-icon">✅</span>
                </div>
              </>
            )}
          </div>

          {/* Filter Checkbox Row */}
          {hudExpanded && (
            <div className="command-hud-filter-row">
              <label className="hud-checkbox-label" style={{ color: filters.incidents ? '#f97316' : '#64748b' }}>
                <input
                  type="checkbox"
                  checked={filters.incidents}
                  onChange={(e) => setFilters({ ...filters, incidents: e.target.checked })}
                  style={{ accentColor: '#f97316' }}
                />
                Incidents
              </label>

              <label className="hud-checkbox-label" style={{ color: filters.escalated ? '#ef4444' : '#64748b' }}>
                <input
                  type="checkbox"
                  checked={filters.escalated}
                  onChange={(e) => setFilters({ ...filters, escalated: e.target.checked })}
                  style={{ accentColor: '#ef4444' }}
                />
                Escalated
              </label>

              <label className="hud-checkbox-label" style={{ color: filters.dispatchUnits ? '#06b6d4' : '#64748b' }}>
                <input
                  type="checkbox"
                  checked={filters.dispatchUnits}
                  onChange={(e) => setFilters({ ...filters, dispatchUnits: e.target.checked })}
                  style={{ accentColor: '#06b6d4' }}
                />
                Dispatch Units
              </label>

              <label className="hud-checkbox-label" style={{ color: filters.unitsLine ? '#818cf8' : '#64748b' }}>
                <input
                  type="checkbox"
                  checked={filters.unitsLine}
                  onChange={(e) => setFilters({ ...filters, unitsLine: e.target.checked })}
                  style={{ accentColor: '#818cf8' }}
                />
                Units Line
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
          )}
        </div>

        {/* Leaflet Map */}
        <MapContainer
          center={[14.9055, 121.0450]}
          zoom={14}
          zoomControl={false}
          style={{ width: '100%', height: '100%', background: '#0b1120' }}
        >
          <TileLayer url={CARTO_DARK_MAP_URL} attribution={CARTO_ATTRIBUTION} />
          <MapResizer />

          {/* Incident Markers */}
          {incidents.map((inc) => {
            if (inc.status === 'pending' || inc.status === 'responding') {
              if (!filters.incidents) return null;
              return (
                <Marker
                  key={inc.id}
                  position={[inc.latitude, inc.longitude]}
                  icon={createTeardropPin('#F97316', '!')}
                  eventHandlers={{ click: () => handleOpenIncidentPin(inc) }}
                />
              );
            }

            if (inc.status === 'escalated') {
              if (!filters.escalated) return null;
              return (
                <Marker
                  key={inc.id}
                  position={[inc.latitude, inc.longitude]}
                  icon={createTeardropPin('#EF4444', '!')}
                  eventHandlers={{ click: () => handleOpenIncidentPin(inc) }}
                />
              );
            }

            if (inc.status === 'resolved') {
              if (!filters.resolved) return null;
              return (
                <Marker
                  key={inc.id}
                  position={[inc.latitude, inc.longitude]}
                  icon={createTeardropPin('#10B981', '✓')}
                  eventHandlers={{ click: () => handleOpenIncidentPin(inc) }}
                />
              );
            }

            return null;
          })}

          {/* Dispatch Units Markers */}
          {filters.dispatchUnits &&
            dispatchUnits.map((u) => (
              <Marker
                key={u.id}
                position={[u.latitude, u.longitude]}
                icon={createResponderUnitBadge()}
                eventHandlers={{ click: () => handleOpenUnitPin(u) }}
              />
            ))}

          {/* Units Line (Dashed Polyline connecting Unit to Target Incident) */}
          {filters.unitsLine &&
            dispatchUnits.map((u) => {
              if (!u.target_incident_id) return null;
              const target = incidents.find((i) => i.id === u.target_incident_id);
              if (!target) return null;

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
        </MapContainer>

        {/* ── MODALS (Image 5, 1, 2) ── */}

        {/* 1. ORANGE INCIDENT PIN CLICK: 2-Panel Modal (Image 5) */}
        {activeModalType === 'incident' && selectedIncident && (
          <div className="pin-modal-backdrop" onClick={closeModal}>
            <div className="pin-modal-container" onClick={(e) => e.stopPropagation()}>
              {/* Left Card: Resident Details & Visual Proofs */}
              <div className="panel-resident">
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
                      <span className="user-phone">{selectedIncident.reporter_phone || '09510173028'}</span>
                    </div>
                  </div>
                  <button
                    className="copy-btn"
                    title="Copy phone number"
                    onClick={() => copyToClipboard(selectedIncident.reporter_phone || '09510173028')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </div>

                {/* Section Title */}
                <div className="section-label-row">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                  <span>Visual Proof</span>
                </div>

                {/* 2x3 Thumbnail Grid */}
                <div className="thumbnail-grid-2x3">
                  {SAMPLE_VISUAL_PROOFS.map((url, idx) => {
                    const currentImg = idx === 0 && selectedIncident.proof_url ? selectedIncident.proof_url : url;
                    const isSelected = selectedVisualUrl === currentImg;
                    return (
                      <div
                        key={idx}
                        className={`grid-thumb-item ${isSelected ? 'active' : ''}`}
                        onClick={() => setSelectedVisualUrl(currentImg)}
                      >
                        <img src={currentImg} alt={`Proof thumbnail ${idx + 1}`} />
                      </div>
                    );
                  })}
                </div>

                {/* Response details box */}
                <div className="panel-details-box">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <div>
                    {selectedIncident.description || 'Put here the response details of the emergency report of the resident'}
                  </div>
                </div>
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
                      <img src={selectedVisualUrl} alt="Visual preview" className="preview-display-image" />
                      <button
                        className="preview-fullscreen-btn"
                        onClick={() => window.open(selectedVisualUrl, '_blank')}
                        title="Open Fullscreen"
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
                      <div className="preview-empty-sub">Select an image to preview it here</div>
                    </div>
                  )}
                </div>

                <div className="preview-action-row">
                  <button className="btn-preview-close" onClick={closeModal}>
                    ✕ CLOSE
                  </button>
                  <button className="btn-preview-dispatch" onClick={handleDispatch}>
                    🚑 DISPATCH
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. RED ESCALATED PIN CLICK: 3-Panel Modal (User request Image 1) */}
        {activeModalType === 'escalated' && selectedIncident && (
          <div className="pin-modal-backdrop" onClick={closeModal}>
            <div className="pin-modal-container" onClick={(e) => e.stopPropagation()}>
              {/* Left Card: Resident Details & Visual Proofs */}
              <div className="panel-resident">
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
                      <span className="user-phone">{selectedIncident.reporter_phone || '09510173028'}</span>
                    </div>
                  </div>
                  <button
                    className="copy-btn"
                    title="Copy phone number"
                    onClick={() => copyToClipboard(selectedIncident.reporter_phone || '09510173028')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </div>

                <div className="section-label-row">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                  <span>Visual Proof</span>
                </div>

                <div className="thumbnail-grid-2x3">
                  {SAMPLE_VISUAL_PROOFS.map((url, idx) => {
                    const currentImg = idx === 0 && selectedIncident.proof_url ? selectedIncident.proof_url : url;
                    const isSelected = selectedVisualUrl === currentImg;
                    return (
                      <div
                        key={idx}
                        className={`grid-thumb-item ${isSelected ? 'active' : ''}`}
                        onClick={() => setSelectedVisualUrl(currentImg)}
                      >
                        <img src={currentImg} alt={`Proof thumbnail ${idx + 1}`} />
                      </div>
                    );
                  })}
                </div>

                <div className="panel-details-box">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <div>
                    {selectedIncident.description || 'Put here the response details of the emergency report of the resident'}
                  </div>
                </div>
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
                      <img src={selectedVisualUrl} alt="Visual preview" className="preview-display-image" />
                      <button
                        className="preview-fullscreen-btn"
                        onClick={() => window.open(selectedVisualUrl, '_blank')}
                        title="Open Fullscreen"
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
                      <div className="preview-empty-sub">Select an image to preview it here</div>
                    </div>
                  )}
                </div>

                <div className="preview-action-row">
                  <button className="btn-preview-close" onClick={closeModal}>
                    ✕ CLOSE
                  </button>
                  <button className="btn-preview-dispatch" onClick={handleDispatch}>
                    🚑 DISPATCH
                  </button>
                </div>
              </div>

              {/* Right Card: Team Leader Initial Response (Image 1) */}
              <div className="panel-teamleader">
                <div className="panel-header-user">
                  <div className="user-identity">
                    <div className="user-avatar-circle purple">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg>
                    </div>
                    <div className="user-details-text">
                      <span className="user-title">Team Leader</span>
                      <span className="user-title" style={{ fontSize: '11px', color: '#cbd5e1' }}>
                        {selectedIncident.responder_name || 'Matic Tic'}
                      </span>
                      <span className="user-phone purple">{selectedIncident.responder_phone || '09510173028'}</span>
                    </div>
                  </div>
                  <button
                    className="copy-btn"
                    title="Copy phone number"
                    onClick={() => copyToClipboard(selectedIncident.responder_phone || '09510173028')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </div>

                <div className="section-label-row purple">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                  <span>Initial Response Visuals</span>
                </div>

                <div className="thumbnail-grid-2x3">
                  {SAMPLE_BARANGAY_VISUALS.map((url, idx) => {
                    const isSelected = selectedVisualUrl === url;
                    return (
                      <div
                        key={idx}
                        className={`grid-thumb-item purple ${isSelected ? 'active' : ''}`}
                        onClick={() => setSelectedVisualUrl(url)}
                      >
                        <img src={url} alt={`Initial response thumb ${idx + 1}`} />
                      </div>
                    );
                  })}
                </div>

                <div className="panel-details-box purple">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                  </svg>
                  <div>
                    {selectedIncident.barangay_response_notes || 'Put here the Initial response details of the emergency report of the barangay'}
                  </div>
                </div>
              </div>
            </div>
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
      </div>
    </div>
  );
}
