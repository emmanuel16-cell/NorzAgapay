import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { CARTO_DARK_MAP_URL, CARTO_ATTRIBUTION } from '../lib/mapConfig';
import 'leaflet/dist/leaflet.css';
import { volunteerDispatchAPI, userAPI, missionAPI } from '../lib/api';
import toast from 'react-hot-toast';

// Fix for default marker icons
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

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#C0392B',
  high: '#E67E22',
  moderate: '#F1C40F',
  low: '#2ECC71',
};

const TYPE_ICONS: Record<string, string> = {
  incident: '🚨',
  rescue: '🚁',
  accident: '🚗',
  flash_flood: '🌊',
  earthquake: '🌋',
  medical_emergency: '🚑',
  typhoon: '🌀',
  other: '📍',
};

const createPinIcon = (color: string, icon: string) => {
  const size = 32;
  return L.divIcon({
    html: `
      <div style="position: relative; width: ${size}px; height: ${size}px;">
        <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
          <path d="M12 21C16.5 16.5 20 12.9167 20 9.16667C20 4.65633 16.4183 1 12 1C7.58172 1 4 4.65633 4 9.16667C4 12.9167 7.5 16.5 12 21Z" fill="${color}" stroke="white" stroke-width="1.5"/>
          <circle cx="12" cy="9" r="6" fill="white"/>
        </svg>
        <div style="
          position: absolute; 
          top: 3px; 
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

interface VolunteerDispatch {
  id: string;
  team_name: string;
  dispatch_date: string;
  dispatch_time: string;
  meetup_location: string;
  meetup_latitude?: number;
  meetup_longitude?: number;
  destination: string;
  mission_id?: string;
  volunteer_ids: string[];
  created_at: string;
}

interface User {
  id: string;
  full_name: string;
  role: string;
  unit_type?: string;
  status: string;
  specialization?: string;
}

interface Mission {
  id: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export default function VolunteerDispatchPage() {
  const [dispatches, setDispatches] = useState<VolunteerDispatch[]>([]);
  const [volunteers, setVolunteers] = useState<User[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [customPin, setCustomPin] = useState<{lat: number, lng: number} | null>(null);
  const [showViewModal, setShowViewModal] = useState<VolunteerDispatch | null>(null);
  const [volunteerFilter, setVolunteerFilter] = useState<'all' | 'specialist' | 'general'>('all');
  const [form, setForm] = useState({
    team_name: '',
    dispatch_date: '',
    dispatch_time: '',
    meetup_location: '',
    meetup_latitude: undefined as number | undefined,
    meetup_longitude: undefined as number | undefined,
    destination: '',
    mission_id: '',
    type: '',
    severity: '',
    volunteer_ids: [] as string[]
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [dispatchesRes, usersRes, missionsRes] = await Promise.all([
        volunteerDispatchAPI.list(),
        userAPI.list(),
        missionAPI.list()
      ]);
      setDispatches(dispatchesRes.data.dispatches || []);
      const activeVolunteers = (usersRes.data.users || []).filter((u: User) =>
        ['volunteer_specialist', 'volunteer_general'].includes(u.role) && u.status === 'active'
      );
      setVolunteers(activeVolunteers);
      setMissions(missionsRes.data.incidents || []);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.volunteer_ids.length === 0) {
      toast.error('Please select at least one volunteer');
      return;
    }
    try {
      await volunteerDispatchAPI.create(form);
      toast.success('Volunteer Dispatch team created');
      toast.success(`${form.volunteer_ids.length} volunteer(s) will be notified via their task detail screen.`);
      setShowAdd(false);
      setShowMap(false);
      setForm({ 
        team_name: '', 
        dispatch_date: '', 
        dispatch_time: '', 
        meetup_location: '', 
        meetup_latitude: undefined,
        meetup_longitude: undefined,
        destination: '', 
        mission_id: '', 
        type: '', 
        severity: '', 
        volunteer_ids: [] 
      });
      fetchData();
    } catch {
      toast.error('Failed to create dispatch team');
    }
  };

  const toggleVolunteer = (userId: string) => {
    setForm(prev => ({
      ...prev,
      volunteer_ids: prev.volunteer_ids.includes(userId)
        ? prev.volunteer_ids.filter(id => id !== userId)
        : [...prev.volunteer_ids, userId]
    }));
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this dispatch team?')) return;
    try {
      await volunteerDispatchAPI.delete(id);
      toast.success('Dispatch team deleted');
      fetchData();
    } catch {
      toast.error('Failed to delete dispatch team');
    }
  };

  const filteredVolunteers = volunteers.filter(v => {
    if (volunteerFilter === 'all') return true;
    if (volunteerFilter === 'specialist') return v.role === 'volunteer_specialist';
    if (volunteerFilter === 'general') return v.role === 'volunteer_general';
    return true;
  });

  const getMissionTitle = (missionId: string) => {
    const mission = missions.find(m => m.id === missionId);
    return mission ? mission.title : missionId;
  };

  const handleSelectMission = (missionId: string) => {
    if (!missionId) {
      setForm({ ...form, mission_id: '', destination: '', type: '', severity: '' });
      return;
    }
    const mission = missions.find(m => m.id === missionId);
    if (mission) {
      setForm({
        ...form,
        mission_id: mission.id,
        destination: mission.title,
        type: mission.type,
        severity: mission.severity
      });
    }
  };

  const handleManualLocation = (value: string) => {
    setForm({
      ...form,
      destination: value,
      mission_id: '',
      type: 'general',
      severity: 'low'
    });
  };

  const activeMissions = missions.filter(m => m.status !== 'resolved');

  function MapClickHandler() {
    useMapEvents({
      click: async (e) => {
        const { lat, lng } = e.latlng;
        setCustomPin({ lat, lng });
        
        // Try to get address via reverse geocoding
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
          const data = await res.json();
          const address = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          setForm(prev => ({ 
            ...prev, 
            meetup_location: address,
            meetup_latitude: lat,
            meetup_longitude: lng
          }));
          toast.success('Meet-up location set to pin');
        } catch {
          setForm(prev => ({ 
            ...prev, 
            meetup_location: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            meetup_latitude: lat,
            meetup_longitude: lng
          }));
          toast.success('Meet-up location set to coordinates');
        }
      },
    });
    return null;
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Volunteer Dispatch</h1>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ New Volunteer Dispatch</button>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner" /></div>
        ) : dispatches.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚚</div>
            <p>No volunteer dispatch teams found</p>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: '16px' }}>Create First Dispatch</button>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Team Name</th>
                  <th>Dispatch Date & Time</th>
                  <th>Meet-up Location</th>
                  <th>Destination / Mission</th>
                  <th>Volunteers</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dispatches.map(dispatch => (
                  <tr key={dispatch.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{dispatch.team_name}</td>
                    <td>
                      <div style={{ fontSize: '13px' }}>
                        <div>{dispatch.dispatch_date}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>{dispatch.dispatch_time}</div>
                      </div>
                    </td>
                    <td style={{ fontSize: '13px', maxWidth: '200px' }}>{dispatch.meetup_location}</td>
                    <td style={{ fontSize: '13px' }}>
                      {dispatch.mission_id ? (
                        <span className="badge badge-open" style={{ fontSize: '10px' }}>{getMissionTitle(dispatch.mission_id)}</span>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>{dispatch.destination}</span>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-open" style={{ fontSize: '11px' }}>
                        {dispatch.volunteer_ids?.length || 0} volunteer(s)
                      </span>
                    </td>
                    <td style={{ fontSize: '12px' }}>{new Date(dispatch.created_at).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => setShowViewModal(dispatch)}>View</button>
                        <button className="btn btn-outline btn-sm" style={{ color: '#ff4d4f' }} onClick={() => handleDelete(dispatch.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <div className="modal-backdrop" onClick={() => { setShowAdd(false); setShowMap(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: showMap ? '1200px' : '600px', transition: 'max-width 0.3s ease' }}>
            <div className="modal-header">
              <h2 className="modal-title">Volunteer Dispatch: {form.team_name || 'New Team'}</h2>
              <button className="modal-close" onClick={() => { setShowAdd(false); setShowMap(false); }}>✕</button>
            </div>
            
            <div style={{ display: 'flex', gap: '24px' }}>
              <form onSubmit={handleAdd} style={{ flex: 1 }}>
                <div className="form-group">
                  <label className="form-label">Team Name</label>
                  <input
                    className="form-input"
                    required
                    placeholder="e.g. Relief Team Alpha"
                    value={form.team_name}
                    onChange={e => setForm({ ...form, team_name: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label">Dispatch Date</label>
                    <input
                      className="form-input"
                      type="date"
                      required
                      value={form.dispatch_date}
                      onChange={e => setForm({ ...form, dispatch_date: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Dispatch Time</label>
                    <input
                      className="form-input"
                      type="time"
                      required
                      value={form.dispatch_time}
                      onChange={e => setForm({ ...form, dispatch_time: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>Reporting Point / Meet-up</label>
                    <button 
                      type="button" 
                      className={`btn btn-sm ${showMap ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setShowMap(!showMap)}
                      style={{ padding: '4px 10px', fontSize: '11px' }}
                    >
                      {showMap ? 'Hide Map' : '📍 Pick on Map'}
                    </button>
                  </div>
                  <input
                    className="form-input"
                    required
                    placeholder="e.g. MDRRMO Headquarters, Norzagaray"
                    value={form.meetup_location}
                    onChange={e => setForm({ ...form, meetup_location: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Mission Target / Destination</label>
                  <select
                    className="form-select"
                    value={form.mission_id}
                    onChange={e => handleSelectMission(e.target.value)}
                  >
                    <option value="">Select a mission (optional)</option>
                    {activeMissions.map(m => (
                      <option key={m.id} value={m.id}>{m.title} ({m.severity})</option>
                    ))}
                  </select>
                  <input
                    className="form-input"
                    style={{ marginTop: '8px' }}
                    placeholder="Or enter target destination directly"
                    value={form.destination}
                    onChange={e => handleManualLocation(e.target.value)}
                  />
                  {form.destination && !form.mission_id && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <span className="badge badge-low" style={{ fontSize: '10px' }}>Type: General</span>
                      <span className="badge badge-low" style={{ fontSize: '10px' }}>Severity: Low</span>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Filter Volunteers by Type</label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button
                      type="button"
                      className={`btn ${volunteerFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                      style={{ flex: 1 }}
                      onClick={() => setVolunteerFilter('all')}
                    >
                      All ({volunteers.length})
                    </button>
                    <button
                      type="button"
                      className={`btn ${volunteerFilter === 'specialist' ? 'btn-primary' : 'btn-outline'}`}
                      style={{ flex: 1 }}
                      onClick={() => setVolunteerFilter('specialist')}
                    >
                      Specialist ({volunteers.filter(v => v.role === 'volunteer_specialist').length})
                    </button>
                    <button
                      type="button"
                      className={`btn ${volunteerFilter === 'general' ? 'btn-primary' : 'btn-outline'}`}
                      style={{ flex: 1 }}
                      onClick={() => setVolunteerFilter('general')}
                    >
                      General ({volunteers.filter(v => v.role === 'volunteer_general').length})
                    </button>
                  </div>

                  <label className="form-label">Select Volunteers (Active Only)</label>
                  <div style={{
                    maxHeight: '180px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px',
                    background: 'rgba(0,0,0,0.2)'
                  }}>
                    {filteredVolunteers.length === 0 ? (
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px' }}>
                        No {volunteerFilter === 'all' ? '' : volunteerFilter} active volunteers found.
                      </p>
                    ) : (
                      filteredVolunteers.map(volunteer => (
                        <div
                          key={volunteer.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '6px',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            cursor: 'pointer'
                          }}
                          onClick={() => toggleVolunteer(volunteer.id)}
                        >
                          <input
                            type="checkbox"
                            checked={form.volunteer_ids.includes(volunteer.id)}
                            onChange={() => {}}
                            style={{ cursor: 'pointer' }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '14px', fontWeight: 500 }}>{volunteer.full_name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              {volunteer.role === 'volunteer_specialist' ? '🔧 Specialist' : '👷 General'}
                              {volunteer.unit_type && ` • ${volunteer.unit_type}`}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {form.volunteer_ids.length} volunteer(s) selected
                  </p>
                </div>

                <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button type="button" className="btn btn-outline" onClick={() => { setShowAdd(false); setShowMap(false); }}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={form.volunteer_ids.length === 0}>
                    Create Dispatch Team
                  </button>
                </div>
              </form>

              {showMap && (
                <div style={{ flex: 1.2, height: '600px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 1000, background: 'rgba(0,0,0,0.7)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}>
                    Click a mission marker to auto-fill location details
                  </div>
                  <MapContainer 
                    center={[14.904246495288923, 121.0430072345187]} 
                    zoom={14} 
                    style={{ width: '100%', height: '100%', background: '#111827' }}
                  >
                    <TileLayer
                      url={CARTO_DARK_MAP_URL}
                      attribution={CARTO_ATTRIBUTION}
                    />
                    <MapClickHandler />
                    {customPin && (
                      <Marker position={[customPin.lat, customPin.lng]} icon={createPinIcon('var(--primary-light)', '📍')}>
                        <Popup>
                          <div style={{ color: '#1a1a2e' }}>
                            <strong>Custom Pin</strong><br/>
                            <span style={{ fontSize: '12px' }}>{form.meetup_location}</span>
                          </div>
                        </Popup>
                      </Marker>
                    )}
                    {activeMissions.map(m => {
                      if (!m.latitude || !m.longitude) return null;
                      return (
                        <Marker 
                          key={m.id} 
                          position={[m.latitude, m.longitude]}
                          icon={createPinIcon(SEVERITY_COLORS[m.severity] || '#E67E22', TYPE_ICONS[m.type] || '🚨')}
                          eventHandlers={{
                            click: () => {
                              setCustomPin(null);
                              setForm(prev => ({ 
                                ...prev, 
                                meetup_location: m.address || prev.meetup_location,
                                meetup_latitude: m.latitude,
                                meetup_longitude: m.longitude
                              }));
                              toast.success(`Meet-up set to: ${m.title}`);
                            }
                          }}
                        >
                          <Popup>
                            <div style={{ color: '#1a1a2e' }}>
                              <strong>{m.title}</strong><br/>
                              <span style={{ fontSize: '12px' }}>{m.address}</span><br/>
                              <button 
                                className="btn btn-sm btn-primary" 
                                style={{ marginTop: '8px', width: '100%' }}
                                onClick={() => {
                                  setCustomPin(null);
                                  setForm(prev => ({ 
                                    ...prev, 
                                    meetup_location: m.address || prev.meetup_location,
                                    meetup_latitude: m.latitude,
                                    meetup_longitude: m.longitude
                                  }));
                                  toast.success(`Meet-up set to: ${m.title}`);
                                }}
                              >
                                Set as Meet-up
                              </button>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                  </MapContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showViewModal && (
        <div className="modal-backdrop" onClick={() => setShowViewModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Volunteer Dispatch Team</h2>
              <button className="modal-close" onClick={() => setShowViewModal(null)}>✕</button>
            </div>
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>MISSION TARGET / DESTINATION</div>
                <div style={{ fontSize: '16px', fontWeight: 600 }}>
                  {showViewModal.mission_id ? getMissionTitle(showViewModal.mission_id) : showViewModal.destination}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>DISPATCH DATE</div>
                  <div style={{ fontWeight: 500 }}>{showViewModal.dispatch_date}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>DISPATCH TIME</div>
                  <div style={{ fontWeight: 500 }}>{showViewModal.dispatch_time}</div>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>REPORTING POINT / MEET-UP</div>
                <div style={{ fontWeight: 500 }}>{showViewModal.meetup_location}</div>
                {(showViewModal.meetup_latitude && showViewModal.meetup_longitude) && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    📍 Coordinates: {showViewModal.meetup_latitude.toFixed(4)}, {showViewModal.meetup_longitude.toFixed(4)}
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>ASSIGNED VOLUNTEERS ({showViewModal.volunteer_ids?.length || 0})</div>
                <div style={{
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}>
                  {showViewModal.volunteer_ids && showViewModal.volunteer_ids.length > 0 ? (
                    showViewModal.volunteer_ids.map(id => {
                      const volunteer = volunteers.find(v => v.id === id);
                      return volunteer ? (
                        <div key={id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '6px 0',
                          borderBottom: '1px solid rgba(255,255,255,0.05)'
                        }}>
                          <span style={{ fontSize: '20px' }}>{volunteer.role === 'volunteer_specialist' ? '🔧' : '👷'}</span>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: '14px' }}>{volunteer.full_name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              {volunteer.role === 'volunteer_specialist' ? 'Specialist' : 'General'}
                              {volunteer.unit_type && ` • ${volunteer.unit_type}`}
                            </div>
                          </div>
                        </div>
                      ) : null;
                    })
                  ) : (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No volunteers assigned</p>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowViewModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}