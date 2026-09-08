import { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { CARTO_DARK_MAP_URL, CARTO_ATTRIBUTION } from '../lib/mapConfig';
import 'leaflet/dist/leaflet.css';
import { reportAPI, respondUnitAPI, socket } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { AlertTriangle, Siren, Users, CheckCircle2 } from 'lucide-react';

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
  barangay_name?: string;
  barangay_response_status?: string;
  barangay_responder_name?: string;
  mdrrmo_response_status?: string;
  mdrrmo_responder_name?: string;
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

// Helper to detect video from URL or proof_type
const isVideoProof = (url?: string | null, proof_type?: string | null): boolean => {
  if (proof_type === 'video') return true;
  if (!url) return false;
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm') ||
    lower.endsWith('.3gp') || lower.endsWith('.mkv') || lower.endsWith('.avi');
};

// Custom Marker Creators matching image 3
const createTeardropPin = (color: string, symbol: string, isUnread = false) => {
  const width = 42;
  const height = 54;
  const unreadDot = isUnread ? `
    <div style="
      position: absolute;
      top: -4px;
      right: -4px;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: #EF4444;
      border: 2px solid #0b1120;
      box-shadow: 0 0 6px rgba(239,68,68,0.8);
      z-index: 10;
      animation: unread-pulse 1.5s ease-in-out infinite;
    "></div>
  ` : '';
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
        ${unreadDot}
      </div>
      <style>
        @keyframes unread-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.75; }
        }
      </style>
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

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const timer = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

// Auto-fits the map to show all visible pins
function FitBoundsController({ points }: { points: [number, number][] }) {
  const map = useMap();
  const prevHashRef = useRef<string>('');

  useEffect(() => {
    if (points.length === 0) return;

    const validPoints = points.filter(([lat, lng]) => lat !== 0 && lng !== 0);
    if (validPoints.length === 0) return;

    const currentHash = validPoints
      .map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
      .sort()
      .join(';');
    if (currentHash === prevHashRef.current) return;
    prevHashRef.current = currentHash;

    if (validPoints.length === 1) {
      map.flyTo(validPoints[0], 14, { animate: true, duration: 1.2 });
    } else {
      const bounds = L.latLngBounds(validPoints.map(([lat, lng]) => L.latLng(lat, lng)));
      map.flyToBounds(bounds, { padding: [60, 60], animate: true, duration: 1.2, maxZoom: 15 });
    }
  }, [map, points]);

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
    responseOngoing: true,
    dispatchUnits: true,
    unitsLine: true,
    resolved: true,
  });

  // Data lists
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [dispatchUnits, setDispatchUnits] = useState<DispatchUnitItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Track which incident IDs the user has already clicked/viewed
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('cc_viewed_incident_ids');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Interactive Modal State
  const [activeModalType, setActiveModalType] = useState<'incident' | 'escalated' | 'unit' | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<IncidentItem | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<DispatchUnitItem | null>(null);
  const [selectedVisualUrl, setSelectedVisualUrl] = useState<string | null>(null);

  // Fetch data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [reportsRes, unitsRes] = await Promise.allSettled([
        reportAPI.list(),
        respondUnitAPI.list(),
      ]);

      const items: IncidentItem[] = [];

      if (reportsRes.status === 'fulfilled' && Array.isArray(reportsRes.value.data)) {
        reportsRes.value.data.forEach((r: any) => {
          const lat = parseFloat(r.latitude);
          const lng = parseFloat(r.longitude);
          if (!lat || !lng) return; // skip if no valid coordinates
          let st: 'pending' | 'responding' | 'escalated' | 'resolved' = 'pending';
          if (r.status === 'resolved' || r.status === 'closed') {
            st = 'resolved';
          } else if (r.beyond_barangay_capability || r.severity === 'critical' || r.status === 'escalated') {
            st = 'escalated';
          } else if (r.status === 'responding' || r.status === 'in_progress' || r.barangay_response_status === 'responding') {
            st = 'responding';
          }

          items.push({
            id: r.id,
            title: r.title || 'Emergency Incident',
            type: r.type || 'emergency',
            status: st,
            severity: r.severity || 'high',
            latitude: lat,
            longitude: lng,
            description: r.description || '',
            proof_url: r.proof_url || null,
            proof_type: r.proof_type || 'image',
            created_at: r.created_at,
            reporter_name: r.reporter_name || r.reporter?.full_name || 'Resident',
            reporter_phone: r.reporter_phone || r.contact_number || '',
            responder_name: r.barangay_responder_name || r.mdrrmo_responder_name || '',
            responder_phone: '',
            barangay_response_notes: r.barangay_response_notes || '',
            assigned_unit_id: r.assigned_unit_id || null,
            barangay_name: r.barangay_name || (r.barangays && r.barangays.name) || '',
            barangay_response_status: r.barangay_response_status || 'pending',
            barangay_responder_name: r.barangay_responder_name,
            mdrrmo_response_status: r.mdrrmo_response_status || 'pending',
            mdrrmo_responder_name: r.mdrrmo_responder_name,
          });
        });
      }

      setIncidents(items);

      // Real dispatch units from API
      const unitItems: DispatchUnitItem[] = [];
      if (unitsRes.status === 'fulfilled' && Array.isArray(unitsRes.value.data)) {
        unitsRes.value.data.forEach((u: any) => {
          const lat = parseFloat(u.latitude);
          const lng = parseFloat(u.longitude);
          if (!lat || !lng) return;
          unitItems.push({
            id: u.id,
            name: u.unit_name || u.name || 'Unit',
            unit_type: u.specialization || u.unit_type || '',
            specialization: u.specialization || '',
            leader_name: u.leader_name || u.team_leader_name || '',
            members: Array.isArray(u.members) ? u.members : [],
            latitude: lat,
            longitude: lng,
            target_incident_id: u.target_incident_id || null,
            target_location: u.target_location || u.address || '',
          });
        });
      }
      setDispatchUnits(unitItems);
    } catch (err) {
      console.error('Failed to load command center data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const handleRefresh = () => fetchData();
    socket.on('barangay:responding', handleRefresh);
    socket.on('incident_report:new', handleRefresh);
    socket.on('incident_report:mdrrmo_responding', handleRefresh);
    socket.on('incident_report:updated', handleRefresh);
    return () => {
      socket.off('barangay:responding', handleRefresh);
      socket.off('incident_report:new', handleRefresh);
      socket.off('incident_report:mdrrmo_responding', handleRefresh);
      socket.off('incident_report:updated', handleRefresh);
    };
  }, []);

  // Stats calculation — real counts, no demo padding
  const stats = useMemo(() => {
    const incCount = incidents.filter(i => i.status === 'pending' || i.status === 'responding').length;
    const escCount = incidents.filter(i => i.status === 'escalated').length;
    const unitCount = dispatchUnits.length;
    const resCount = incidents.filter(i => i.status === 'resolved').length;
    return {
      incident: incCount,
      escalated: escCount,
      dispatch: unitCount,
      resolved: resCount,
    };
  }, [incidents, dispatchUnits]);

  // Compute all visible pin points for auto-fit bounds
  const visiblePinPoints = useMemo((): [number, number][] => {
    const pts: [number, number][] = [];
    incidents.forEach((inc) => {
      if (inc.status === 'pending' && !filters.incidents) return;
      if (inc.status === 'responding' && !filters.responseOngoing) return;
      if (inc.status === 'escalated' && !filters.escalated) return;
      if (inc.status === 'resolved' && !filters.resolved) return;
      pts.push([inc.latitude, inc.longitude]);
    });
    if (filters.dispatchUnits) {
      dispatchUnits.forEach((u) => pts.push([u.latitude, u.longitude]));
    }
    return pts;
  }, [incidents, dispatchUnits, filters]);

  // Click Handlers
  const handleOpenIncidentPin = (item: IncidentItem) => {
    // Mark as viewed
    setViewedIds(prev => {
      const next = new Set(prev);
      next.add(item.id);
      try { localStorage.setItem('cc_viewed_incident_ids', JSON.stringify([...next])); } catch {}
      return next;
    });
    setSelectedIncident(item);
    setSelectedVisualUrl(item.proof_url || null);
    if (item.status === 'escalated' || item.status === 'responding') {
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

  // Co-response confirmation modal state
  const [coResponseConfirmModal, setCoResponseConfirmModal] = useState<{
    open: boolean;
    incident: IncidentItem | null;
  } | null>(null);

  const executeMdrrmoDispatch = async (incident: IncidentItem) => {
    try {
      const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const token = localStorage.getItem('token');
      await fetch(`${baseUrl}/incident-reports/${incident.id}/mdrrmo-respond`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          responder_name: user?.full_name || user?.email || 'MDRRMO Command Unit',
          notes: 'MDRRMO responding from Command Center dispatch'
        })
      });
    } catch (e) {
      console.warn('Could not notify backend of mdrrmo respond:', e);
    }
    toast.success('Dispatch action initiated! MDRRMO responders alerted.');
    setCoResponseConfirmModal(null);
    closeModal();
    fetchData();
  };

  const handleDispatch = (overrideConfirm = false) => {
    if (!selectedIncident) return;

    // Check if Barangay is currently responding
    const isBarangayResponding =
      selectedIncident.barangay_response_status === 'responding' ||
      Boolean(selectedIncident.responder_name && selectedIncident.responder_name !== 'MDRRMO');

    if (isBarangayResponding && !overrideConfirm) {
      // Show confirmation prompt
      setCoResponseConfirmModal({
        open: true,
        incident: selectedIncident
      });
      return;
    }

    executeMdrrmoDispatch(selectedIncident);
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
                  <span className="stat-card-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle size={22} strokeWidth={2} color="#f59e0b" />
                  </span>
                </div>

                <div className="command-stat-card escalated">
                  <div className="stat-info">
                    <span className="stat-val">{stats.escalated}</span>
                    <span className="stat-name">Escalated</span>
                  </div>
                  <span className="stat-card-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Siren size={22} strokeWidth={2} color="#ef4444" />
                  </span>
                </div>

                <div className="command-stat-card dispatch">
                  <div className="stat-info">
                    <span className="stat-val">{stats.dispatch}</span>
                    <span className="stat-name">Dispatch Units</span>
                  </div>
                  <span className="stat-card-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={22} strokeWidth={2} color="#38bdf8" />
                  </span>
                </div>

                <div className="command-stat-card resolved">
                  <div className="stat-info">
                    <span className="stat-val">{stats.resolved}</span>
                    <span className="stat-name">Resolved</span>
                  </div>
                  <span className="stat-card-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CheckCircle2 size={22} strokeWidth={2} color="#10b981" />
                  </span>
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

              <label className="hud-checkbox-label" style={{ color: filters.responseOngoing ? '#3b82f6' : '#64748b' }}>
                <input
                  type="checkbox"
                  checked={filters.responseOngoing}
                  onChange={(e) => setFilters({ ...filters, responseOngoing: e.target.checked })}
                  style={{ accentColor: '#3b82f6' }}
                />
                Response Ongoing
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
          zoom={13}
          zoomControl={false}
          style={{ width: '100%', height: '100%', background: '#0b1120' }}
        >
          <TileLayer url={CARTO_DARK_MAP_URL} attribution={CARTO_ATTRIBUTION} />
          <MapResizer />
          <FitBoundsController points={visiblePinPoints} />

          {/* Incident Markers */}
          {incidents.map((inc) => {
            const isUnread = !viewedIds.has(inc.id);
            if (inc.status === 'pending') {
              if (!filters.incidents) return null;
              return (
                <Marker
                  key={inc.id}
                  position={[inc.latitude, inc.longitude]}
                  icon={createTeardropPin('#F97316', '!', isUnread)}
                  eventHandlers={{ click: () => handleOpenIncidentPin(inc) }}
                />
              );
            }

            if (inc.status === 'responding') {
              if (!filters.responseOngoing) return null;
              return (
                <Marker
                  key={inc.id}
                  position={[inc.latitude, inc.longitude]}
                  icon={createTeardropPin('#3B82F6', '!', isUnread)}
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
                  icon={createTeardropPin('#EF4444', '!', isUnread)}
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
                  icon={createTeardropPin('#10B981', '✓', isUnread)}
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

                {/* Proof thumbnail – only show if we have a real proof_url */}
                {selectedIncident.proof_url ? (
                  <div className="thumbnail-grid-2x3">
                    <div
                      className={`grid-thumb-item ${selectedVisualUrl === selectedIncident.proof_url ? 'active' : ''}`}
                      onClick={() => setSelectedVisualUrl(selectedIncident.proof_url!)}
                      style={{ position: 'relative' }}
                    >
                      {isVideoProof(selectedIncident.proof_url, selectedIncident.proof_type) ? (
                        <>
                          <video src={selectedIncident.proof_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                          </div>
                        </>
                      ) : (
                        <img src={selectedIncident.proof_url} alt="Proof thumbnail" />
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '12px 0', color: '#64748b', fontSize: '12px', textAlign: 'center' }}>
                    No visual proof submitted
                  </div>
                )}

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
                    {selectedIncident.description || 'No description provided.'}
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
                      {isVideoProof(selectedVisualUrl, selectedIncident.proof_type) ? (
                        <video
                          key={selectedVisualUrl}
                          src={selectedVisualUrl}
                          controls
                          playsInline
                          className="preview-display-image"
                          style={{ background: '#000' }}
                        />
                      ) : (
                        <img src={selectedVisualUrl} alt="Visual preview" className="preview-display-image" />
                      )}
                      <button
                        className="preview-fullscreen-btn"
                        onClick={() => window.open(selectedVisualUrl, '_blank')}
                        title="Open in new tab"
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
                      <div className="preview-empty-sub">Select a proof thumbnail to preview it here</div>
                    </div>
                  )}
                </div>

                <div className="preview-action-row">
                  <button className="btn-preview-close" onClick={closeModal}>
                    ✕ CLOSE
                  </button>
                  <button className="btn-preview-dispatch" onClick={() => handleDispatch()}>
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

                {/* Proof thumbnail – only show if we have a real proof_url */}
                {selectedIncident.proof_url ? (
                  <div className="thumbnail-grid-2x3">
                    <div
                      className={`grid-thumb-item ${selectedVisualUrl === selectedIncident.proof_url ? 'active' : ''}`}
                      onClick={() => setSelectedVisualUrl(selectedIncident.proof_url!)}
                      style={{ position: 'relative' }}
                    >
                      {isVideoProof(selectedIncident.proof_url, selectedIncident.proof_type) ? (
                        <>
                          <video src={selectedIncident.proof_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                          </div>
                        </>
                      ) : (
                        <img src={selectedIncident.proof_url} alt="Proof thumbnail" />
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '12px 0', color: '#64748b', fontSize: '12px', textAlign: 'center' }}>
                    No visual proof submitted
                  </div>
                )}

                <div className="panel-details-box">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <div>
                    {selectedIncident.description || 'No description provided.'}
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
                      {isVideoProof(selectedVisualUrl, selectedIncident.proof_type) ? (
                        <video
                          key={selectedVisualUrl}
                          src={selectedVisualUrl}
                          controls
                          playsInline
                          className="preview-display-image"
                          style={{ background: '#000' }}
                        />
                      ) : (
                        <img src={selectedVisualUrl} alt="Visual preview" className="preview-display-image" />
                      )}
                      <button
                        className="preview-fullscreen-btn"
                        onClick={() => window.open(selectedVisualUrl, '_blank')}
                        title="Open in new tab"
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
                      <div className="preview-empty-sub">Select a proof thumbnail to preview it here</div>
                    </div>
                  )}
                </div>

                <div className="preview-action-row">
                  <button className="btn-preview-close" onClick={closeModal}>
                    ✕ CLOSE
                  </button>
                  <button className="btn-preview-dispatch" onClick={() => handleDispatch()}>
                    🚑 DISPATCH
                  </button>
                </div>
              </div>

              {/* Right Card: Team Leader Initial Response */}
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
                        {selectedIncident.responder_name || selectedIncident.barangay_responder_name || 'N/A'}
                      </span>
                      {selectedIncident.responder_phone && (
                        <span className="user-phone purple">{selectedIncident.responder_phone}</span>
                      )}
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

                <div className="panel-details-box purple" style={{ marginTop: '8px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                  </svg>
                  <div>
                    {selectedIncident.barangay_response_notes || 'No initial response notes available.'}
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

        {/* 4. CO-RESPONSE CONFIRMATION MODAL */}
        {coResponseConfirmModal && coResponseConfirmModal.incident && (
          <div className="pin-modal-backdrop" style={{ zIndex: 9999 }} onClick={() => setCoResponseConfirmModal(null)}>
            <div
              className="pin-modal-container"
              style={{
                maxWidth: '460px',
                padding: '24px',
                background: '#1e293b',
                borderRadius: '16px',
                border: '1px solid #334155',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    flexShrink: 0
                  }}
                >
                  <AlertTriangle size={22} strokeWidth={2} color="#f59e0b" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 'bold', color: '#ffffff' }}>
                    Active Barangay Response
                  </h3>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                    Coordinated Emergency Response
                  </span>
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.6)',
                  padding: '16px',
                  borderRadius: '10px',
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  fontSize: '14px',
                  lineHeight: '1.6'
                }}
              >
                Barangay{' '}
                <strong style={{ color: '#38bdf8' }}>
                  {coResponseConfirmModal.incident.barangay_name || 'Partida'}
                </strong>{' '}
                is currently responding to this incident.
                <br /><br />
                Do you want to also respond to this incident?
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
                <button
                  type="button"
                  style={{
                    padding: '10px 18px',
                    borderRadius: '8px',
                    background: 'transparent',
                    border: '1px solid #475569',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '13px'
                  }}
                  onClick={() => setCoResponseConfirmModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    border: 'none',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '13px',
                    boxShadow: '0 4px 12px rgba(2, 132, 199, 0.4)'
                  }}
                  onClick={() => {
                    const inc = coResponseConfirmModal.incident;
                    setCoResponseConfirmModal(null);
                    if (inc) executeMdrrmoDispatch(inc);
                  }}
                >
                  🚑 Yes, Also Respond & Dispatch
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
