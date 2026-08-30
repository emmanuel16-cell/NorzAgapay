import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { inventoryAPI, missionAPI, storageAPI } from '../lib/api';
import toast from 'react-hot-toast';

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

interface InventoryItem {
  id: string; item_name: string; quantity: number; unit: string;
  location?: string; donated_by?: string; mission_id?: string;
  mission?: { title: string; status: string; };
  created_at: string;
}

interface Mission {
  id: string;
  title: string;
  status: string;
}

interface Storage {
  id: string;
  name: string;
  address?: string;
  capacity?: string;
  latitude?: number;
  longitude?: number;
}

// Map components for the modal
function LocationPicker({ onLocationSelect, position }: { onLocationSelect: (lat: number, lng: number) => void, position: [number, number] | null }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });

  return position ? <Marker position={position} /> : null;
}

function MapSearch({ onSearchResult }: { onSearchResult: (lat: number, lng: number, address: string) => void }) {
  const [query, setQuery] = useState('');

  const handleSearch = async () => {
    if (!query) return;

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
      const data = await response.json();
      if (data && data.length > 0) {
        const { lat, lon, display_name } = data[0];
        const newLat = parseFloat(lat);
        const newLon = parseFloat(lon);
        onSearchResult(newLat, newLon, display_name);
      } else {
        toast.error('Location not found');
      }
    } catch (err) {
      toast.error('Search failed');
    }
  };

  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input 
          className="form-input" 
          placeholder="Search for a location..." 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              handleSearch();
            }
          }}
        />
        <button 
          type="button" 
          className="btn btn-primary" 
          style={{ padding: '8px 16px' }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSearch();
          }}
        >
          Search
        </button>
      </div>
    </div>
  );
}

function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [storages, setStorages] = useState<Storage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddStorage, setShowAddStorage] = useState(false);
  const [showMapInStorage, setShowMapInStorage] = useState(false);
  const [showShipment, setShowShipment] = useState(false);
  const [form, setForm] = useState({ item_name:'', quantity:0, unit:'units', location:'', donated_by:'' });
  const [storageForm, setStorageForm] = useState({ name: '', address: '', capacity: '', latitude: undefined as number | undefined, longitude: undefined as number | undefined });
  const [shipForm, setShipForm] = useState({ inventory_id:'', quantity_sent:1, origin:'', destination:'' });
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([14.904246495288923, 121.0430072345187]);
  const [sortConfig, setSortConfig] = useState<{ key: keyof InventoryItem | 'location'; direction: 'asc' | 'desc' } | null>(null);

  const sortedItems = useMemo(() => {
    let sortableItems = [...items];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const aValue = a[sortConfig.key] || '';
        const bValue = b[sortConfig.key] || '';
        
        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [items, sortConfig]);

  const requestSort = (key: keyof InventoryItem | 'location') => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const fetchInventory = () => {
    setLoading(true);
    inventoryAPI.list()
      .then(r => {
        const mapped = (r.data.inventory || []).map((item: any) => ({
          ...item,
          mission: item.incident,
          mission_id: item.incident_id
        }));
        setItems(mapped);
      })
      .catch(() => toast.error('Failed to load equipment list'))
      .finally(() => setLoading(false));
  };

  const fetchMissions = () => {
    missionAPI.list()
      .then(r => {
        const unresolved = (r.data.incidents || []).filter((m: Mission) => m.status !== 'resolved');
        setMissions(unresolved);
      })
      .catch(() => toast.error('Failed to load incidents'));
  };

  const fetchStorages = () => {
    storageAPI.list()
      .then(r => setStorages(r.data.storages || []))
      .catch(() => toast.error('Failed to load MDRRMO stations'));
  };

  useEffect(() => { 
    fetchInventory();
    fetchMissions();
    fetchStorages();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await inventoryAPI.create({ ...form, quantity: Number(form.quantity) });
      toast.success('Equipment added to MDRRMO inventory');
      setShowAdd(false);
      setForm({ item_name:'', quantity:0, unit:'units', location:'', donated_by:'' });
      fetchInventory();
    } catch { toast.error('Failed to add equipment'); }
  };

  const handleAddStorage = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await storageAPI.create(storageForm);
      toast.success('MDRRMO Station added');
      setShowAddStorage(false);
      setShowMapInStorage(false);
      setStorageForm({ name: '', address: '', capacity: '', latitude: undefined, longitude: undefined });
      fetchStorages();
    } catch { toast.error('Failed to add station'); }
  };

  const handleLocationSelect = async (lat: number, lng: number) => {
    setStorageForm(prev => ({ ...prev, latitude: lat, longitude: lng }));
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await res.json();
      if (data && data.display_name) {
        setStorageForm(prev => ({ ...prev, address: data.display_name }));
      }
    } catch (err) {
      console.error('Reverse geocoding failed', err);
    }
  };

  const handleMapSearchResult = (lat: number, lng: number, address: string) => {
    setStorageForm(prev => ({ ...prev, latitude: lat, longitude: lng, address }));
    setMapCenter([lat, lng]);
  };

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await inventoryAPI.createShipment({ ...shipForm, quantity_sent: Number(shipForm.quantity_sent) });
      toast.success('Equipment mobilization created');
      setQrImage(r.data.qr_code_image);
      fetchInventory();
    } catch { toast.error('Failed to mobilize equipment'); }
  };

  const openShipment = (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    setShipForm({ 
      ...shipForm, 
      inventory_id: itemId,
      origin: item?.location || '',
      destination: ''
    });
    setShowShipment(true);
    setQrImage(null);
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">MDRRMO Equipment & Assets</h1>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={()=>setShowAddStorage(true)}>+ Add Station</button>
          <button className="btn btn-primary" onClick={()=>setShowAdd(true)}>+ Add Equipment</button>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner"/></div>
        ) : (
          <div className="table-container">
            <table>
              <thead><tr>
                <th 
                  onClick={() => requestSort('item_name')} 
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  className={sortConfig?.key === 'item_name' ? 'sorted-header' : ''}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    Equipment Name
                    {sortConfig?.key === 'item_name' && (
                      <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th>Quantity</th><th>Unit</th>
                <th 
                  onClick={() => requestSort('location')} 
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  className={sortConfig?.key === 'location' ? 'sorted-header' : ''}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    Current Location (Station)
                    {sortConfig?.key === 'location' && (
                      <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th>Status / Mission</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {sortedItems.map(item => (
                  <tr key={item.id}>
                    <td>
                      <div style={{fontWeight:600,color:'var(--text-primary)'}}>{item.item_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ID: {item.id.slice(0,8)}</div>
                    </td>
                    <td>
                      <span style={{fontWeight:700,fontSize:'16px',color: item.quantity > 0 ? 'var(--success)' : 'var(--accent)'}}>
                        {item.quantity}
                      </span>
                    </td>
                    <td>{item.unit}</td>
                    <td>{item.location || 'Central Depot'}</td>
                    <td>
                      {item.mission ? (
                        <div className="badge badge-accent">Deployed: {item.mission.title}</div>
                      ) : (
                        <div className="badge badge-success">Ready for Deployment</div>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={()=>openShipment(item.id)} disabled={item.quantity<=0}>
                        Mobilize
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Station Modal */}
      {showAddStorage && (
        <div className="modal-backdrop" onClick={()=>setShowAddStorage(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{ maxWidth: showMapInStorage ? '900px' : '500px', width: '95%' }}>
            <div className="modal-header">
              <h2 className="modal-title">Add MDRRMO Station / Depot</h2>
              <button className="modal-close" onClick={()=>setShowAddStorage(false)}>✕</button>
            </div>
            <form onSubmit={handleAddStorage}>
              <div style={{ display: 'grid', gridTemplateColumns: showMapInStorage ? '1fr 1.2fr' : '1fr', gap: '24px' }}>
                <div className="form-column">
                  <div className="form-group">
                    <label className="form-label">Station Name</label>
                    <input className="form-input" required value={storageForm.name} onChange={e=>setStorageForm({...storageForm,name:e.target.value})} placeholder="e.g. Station 1 - Poblacion, Rescue Sub-base"/>
                  </div>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>Address / Exact Location</label>
                      <button 
                        type="button" 
                        className={`btn btn-sm ${showMapInStorage ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => setShowMapInStorage(!showMapInStorage)}
                      >
                        {showMapInStorage ? 'Hide Map' : '📍 Use Map'}
                      </button>
                    </div>
                    <input className="form-input" value={storageForm.address} onChange={e=>setStorageForm({...storageForm,address:e.target.value})} placeholder="Full address or click 'Use Map'"/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Equipment Capacity Description</label>
                    <input className="form-input" value={storageForm.capacity} onChange={e=>setStorageForm({...storageForm,capacity:e.target.value})} placeholder="e.g. Can house 2 boats and 3 trucks"/>
                  </div>
                </div>

                {showMapInStorage && (
                  <div className="map-column">
                    <MapSearch onSearchResult={handleMapSearchResult} />
                    <div style={{ height: '350px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative' }}>
                      <MapContainer 
                        center={mapCenter} 
                        zoom={13} 
                        style={{ width: '100%', height: '100%' }}
                      >
                        <TileLayer
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        />
                        <ChangeView center={mapCenter} />
                        <LocationPicker 
                          onLocationSelect={handleLocationSelect} 
                          position={storageForm.latitude ? [storageForm.latitude, storageForm.longitude!] : null} 
                        />
                      </MapContainer>
                      <div style={{ position: 'absolute', bottom: '10px', left: '10px', zIndex: 1000, background: 'rgba(0,0,0,0.7)', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', color: 'white' }}>
                        Click map to pick exact station coordinates
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer" style={{ marginTop: '16px' }}>
                <button type="button" className="btn btn-outline" onClick={()=>setShowAddStorage(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Station</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register Equipment Modal */}
      {showAdd && (
        <div className="modal-backdrop" onClick={()=>setShowAdd(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Register New Equipment</h2>
              <button className="modal-close" onClick={()=>setShowAdd(false)}>✕</button>
            </div>
            <form onSubmit={handleAdd}>
              <div className="form-group">
                <label className="form-label">Equipment Name</label>
                <input className="form-input" required value={form.item_name} onChange={e=>setForm({...form,item_name:e.target.value})} placeholder="e.g. Aluminum Rescue Boat, 4x4 Rescue Truck"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                <div className="form-group">
                  <label className="form-label">Quantity</label>
                  <input className="form-input" type="number" min="1" required value={form.quantity} onChange={e=>setForm({...form,quantity:parseInt(e.target.value)})}/>
                </div>
                <div className="form-group">
                  <label className="form-label">Unit Type</label>
                  <select className="form-select" value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})}>
                    <option value="units">Units</option>
                    <option value="sets">Sets</option>
                    <option value="packs">Packs (Kits)</option>
                    <option value="vehicles">Vehicles</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Assigned Station / Location</label>
                <select 
                  className="form-select" 
                  required 
                  value={form.location} 
                  onChange={e=>setForm({...form,location:e.target.value})}
                >
                  <option value="">Select a station...</option>
                  <option value="MDRRMO Central HQ">MDRRMO Central HQ</option>
                  {storages.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Funding Source / Provider (Optional)</label>
                <input className="form-input" value={form.donated_by} onChange={e=>setForm({...form,donated_by:e.target.value})} placeholder="e.g. LGU-Norzagaray, OCD Region 3"/>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={()=>setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Register Equipment</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mobilization Modal with QR */}
      {showShipment && (
        <div className="modal-backdrop" onClick={()=>{setShowShipment(false);setQrImage(null);}}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{qrImage ? 'Mobilization QR Code' : 'Mobilize Equipment'}</h2>
              <button className="modal-close" onClick={()=>{setShowShipment(false);setQrImage(null);}}>✕</button>
            </div>
            {qrImage ? (
              <div style={{textAlign:'center'}}>
                <img src={qrImage} alt="QR Code" style={{maxWidth:'250px',margin:'0 auto 16px',display:'block',borderRadius:'var(--radius-md)'}}/>
                <p style={{fontSize:'13px',color:'var(--text-muted)'}}>Scan this QR code at destination to confirm mobilization</p>
                <div className="modal-footer" style={{justifyContent:'center'}}>
                  <button className="btn btn-primary" onClick={()=>{setShowShipment(false);setQrImage(null);}}>Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateShipment}>
                <div className="form-group">
                  <label className="form-label">Quantity to Mobilize</label>
                  <input className="form-input" type="number" min="1" required value={shipForm.quantity_sent} onChange={e=>setShipForm({...shipForm,quantity_sent:parseInt(e.target.value)})}/>
                </div>
                <div className="form-group">
                  <label className="form-label">Origin Station</label>
                  <select 
                    className="form-select" 
                    required 
                    value={shipForm.origin} 
                    onChange={e=>setShipForm({...shipForm,origin:e.target.value})}
                  >
                    <option value="">Select origin...</option>
                    {storages.map(s => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Deployment Destination (Mission / Incident)</label>
                  <select 
                    className="form-select" 
                    required 
                    value={shipForm.destination} 
                    onChange={e=>setShipForm({...shipForm,destination:e.target.value})}
                  >
                    <option value="" disabled>Select a mission</option>
                    {missions.map(m => (
                      <option key={m.id} value={m.title}>{m.title}</option>
                    ))}
                  </select>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline" onClick={()=>setShowShipment(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Create Mobilization Order</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
