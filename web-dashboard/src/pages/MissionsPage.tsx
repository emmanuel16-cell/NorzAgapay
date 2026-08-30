import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { missionAPI, matchingAPI, respondUnitAPI } from '../lib/api';
import toast from 'react-hot-toast';

// Fix for default marker icons in Leaflet
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

interface Mission {
  id: string; title: string; type: string; severity: string;
  status: string; latitude: number; longitude: number;
  address?: string; created_at: string;
}

const severityClass: Record<string,string> = { critical:'badge-critical', high:'badge-high', moderate:'badge-moderate', low:'badge-low' };
const statusClass: Record<string,string> = { open:'badge-open', in_progress:'badge-pending', resolved:'badge-resolved' };

function MapPicker({ position, onChange }: { position: [number, number], onChange: (lat: number, lng: number) => void }) {
  const map = useMap();

  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });

  useEffect(() => {
    map.setView(position);
  }, [position, map]);

  return <Marker position={position} />;
}

export default function MissionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [respondUnits, setRespondUnits] = useState<any[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ title:'', type:'flash_flood', severity:'moderate', latitude:14.904246495288923, longitude:121.0430072345187, address:'' });

  const fetchMissions = () => {
    setLoading(true);
    missionAPI.list(filter ? { status: filter } : undefined)
      .then(r => setMissions(r.data.incidents || []))
      .catch(() => toast.error('Failed to load missions'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchMissions(); }, [filter]);

  // Handle auto-dispatch from redirect
  useEffect(() => {
    const dispatchId = searchParams.get('dispatch');
    if (dispatchId) {
      handleDispatchClick(dispatchId);
      // Clean up the URL
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('dispatch');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, missions]); // Re-run when missions are loaded or search params change

  const handleLocationChange = async (lat: number, lng: number) => {
    setForm(prev => ({ ...prev, latitude: lat, longitude: lng }));
    
    // Reverse Geocoding
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
      const data = await res.json();
      if (data.display_name) {
        setForm(prev => ({ ...prev, address: data.display_name }));
      }
    } catch (e) {
      console.error('Geocoding error', e);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await missionAPI.create(form);
      toast.success('Mission created');
      setShowCreate(false);
      setShowMap(false);
      setForm({ title:'', type:'flash_flood', severity:'moderate', latitude:14.904246495288923, longitude:121.0430072345187, address:'' });
      fetchMissions();
    } catch { toast.error('Failed to create mission'); }
  };

  const handleDispatchClick = async (id: string) => {
    setSelectedMissionId(id);
    try {
      const r = await respondUnitAPI.list();
      setRespondUnits(r.data.units || []);
      setShowDispatchModal(true);
    } catch {
      toast.error('Failed to load respond units');
    }
  };

  const confirmDispatch = async () => {
    if (!selectedMissionId || !selectedUnitId) {
      toast.error('Please select a respond unit');
      return;
    }
    try {
      const r = await matchingAPI.dispatch(selectedMissionId, selectedUnitId);
      const res = r.data.result;
      toast.success('Dispatch successful');
      if (res && res.dispatchedProfessionalUnits) {
        toast.success(`Dispatched ${res.dispatchedProfessionalUnits.length} units, ${res.matchedSpecialists.length} specialists, ${res.assignedGeneralLabor.length} general`);
      }
      setShowDispatchModal(false);
      setSelectedUnitId('');
      fetchMissions();
    } catch { toast.error('Dispatch failed'); }
  };

  const handleResolve = async (id: string) => {
    try {
      await missionAPI.update(id, { status: 'resolved' });
      toast.success('Mission resolved');
      fetchMissions();
    } catch { toast.error('Failed to resolve'); }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Mission Management</h1>
        <div className="header-actions">
          <select className="form-select" style={{width:'auto'}} value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
          <button className="btn btn-primary" onClick={()=>setShowCreate(true)}>+ New Mission</button>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner"/></div>
        ) : missions.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">🚨</div><p>No missions found</p></div>
        ) : (
          <div className="table-container">
            <table>
              <thead><tr>
                <th>Title</th><th>Type</th><th>Severity</th><th>Status</th><th>Address</th><th>Created</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {missions.map(inc => (
                  <tr key={inc.id}>
                    <td style={{fontWeight:600,color:'var(--text-primary)'}}>{inc.title}</td>
                    <td>{inc.type.replace(/_/g,' ')}</td>
                    <td><span className={`badge ${severityClass[inc.severity]}`}>{inc.severity}</span></td>
                    <td><span className={`badge ${statusClass[inc.status]}`}>{inc.status.replace('_',' ')}</span></td>
                    <td>{inc.address || '—'}</td>
                    <td style={{fontSize:'12px'}}>{new Date(inc.created_at).toLocaleDateString()}</td>
                    <td>
                      <div style={{display:'flex',gap:'6px'}}>
                        {inc.status !== 'resolved' && (
                          <>
                            <button className="btn btn-primary btn-sm" onClick={()=>handleDispatchClick(inc.id)}>Dispatch</button>
                            <button className="btn btn-success btn-sm" onClick={()=>handleResolve(inc.id)}>Resolve</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-backdrop" onClick={()=>{setShowCreate(false); setShowMap(false);}}>
          <div className="modal" style={showMap ? {maxWidth:'1000px', width:'95%'} : {}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Create Mission</h2>
              <button className="modal-close" onClick={()=>{setShowCreate(false); setShowMap(false);}}>✕</button>
            </div>
            <div style={{display:'flex', gap:'24px', flexWrap:'wrap'}}>
              <form onSubmit={handleCreate} style={{flex:1, minWidth:'300px'}}>
                <div className="form-group">
                  <label className="form-label">Title</label>
                  <input className="form-input" required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <select className="form-select" value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
                      <option value="flash_flood">Flash Flood</option>
                      <option value="fire">Fire</option>
                      <option value="earthquake">Earthquake</option>
                      <option value="medical_emergency">Medical Emergency</option>
                      <option value="typhoon">Typhoon</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Severity</label>
                    <select className="form-select" value={form.severity} onChange={e=>setForm({...form,severity:e.target.value})}>
                      <option value="low">Low</option>
                      <option value="moderate">Moderate</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px'}}>
                    <label className="form-label" style={{margin:0}}>Address</label>
                    <div style={{display:'flex', alignItems:'center', gap:'6px'}}>
                      <input 
                        type="checkbox" 
                        id="mapToggle" 
                        checked={showMap} 
                        onChange={e => setShowMap(e.target.checked)}
                        style={{width:'14px', height:'14px', cursor:'pointer'}}
                      />
                      <label htmlFor="mapToggle" style={{fontSize:'12px', cursor:'pointer', color:'var(--primary-light)', fontWeight:600}}>Open Map</label>
                    </div>
                  </div>
                  <input className="form-input" value={form.address} onChange={e=>setForm({...form,address:e.target.value})} placeholder="Mission location address"/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                  <div className="form-group">
                    <label className="form-label">Latitude</label>
                    <input className="form-input" type="number" step="any" value={form.latitude} onChange={e=>setForm({...form,latitude:parseFloat(e.target.value)})}/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Longitude</label>
                    <input className="form-input" type="number" step="any" value={form.longitude} onChange={e=>setForm({...form,longitude:parseFloat(e.target.value)})}/>
                  </div>
                </div>
                <div className="modal-footer" style={{marginTop:'12px'}}>
                  <button type="button" className="btn btn-outline" onClick={()=>{setShowCreate(false); setShowMap(false);}}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Create Mission</button>
                </div>
              </form>

              {showMap && (
                <div style={{flex:1.5, minWidth:'400px', height:'500px', borderRadius:'var(--radius-lg)', overflow:'hidden', border:'1px solid var(--border-color)', position:'relative', zIndex:1}}>
                  <MapContainer 
                    center={[form.latitude, form.longitude]} 
                    zoom={15} 
                    style={{ width: '100%', height: '100%', background:'#0B1120' }}
                  >
                    <TileLayer
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />
                    <MapPicker position={[form.latitude, form.longitude]} onChange={handleLocationChange} />
                  </MapContainer>
                  <div style={{position:'absolute', bottom:'10px', left:'10px', zIndex:1000, background:'rgba(11, 17, 32, 0.8)', padding:'6px 10px', borderRadius:'6px', fontSize:'11px', color:'var(--text-secondary)', border:'1px solid var(--border-color)'}}>
                    Click anywhere on the map to set location
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dispatch Modal */}
      {showDispatchModal && (
        <div className="modal-backdrop" onClick={() => setShowDispatchModal(false)}>
          <div className="modal" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Dispatch Resources</h2>
              <button className="modal-close" onClick={() => setShowDispatchModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '20px', color: 'var(--text-secondary)' }}>
                Select a respond unit to respond to this mission. This will mobilize the unit and coordinate specialized responders.
              </p>
              <div className="form-group">
                <label className="form-label">Available Respond Units</label>
                <select 
                  className="form-select" 
                  value={selectedUnitId} 
                  onChange={e => setSelectedUnitId(e.target.value)}
                >
                  <option value="">Select a unit...</option>
                  {respondUnits.map(unit => (
                    <option key={unit.id} value={unit.id}>
                      {unit.unit_name} ({unit.specialization.replace('_', ' ')})
                    </option>
                  ))}
                </select>
                {respondUnits.length === 0 && (
                  <p style={{ marginTop: '8px', fontSize: '12px', color: '#ff4d4f' }}>
                    No respond units available. Create one in Logistics first.
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer" style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-outline" onClick={() => setShowDispatchModal(false)}>Cancel</button>
              <button 
                className="btn btn-primary" 
                onClick={confirmDispatch}
                disabled={!selectedUnitId}
              >
                Confirm Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
