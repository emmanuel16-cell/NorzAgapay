import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Plus, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { barangayListAPI, evacuationAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { CARTO_DARK_MAP_URL, CARTO_ATTRIBUTION } from '../lib/mapConfig';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface BarangayOption {
  id: string;
  name: string;
  municipality?: string;
}

function LocationPicker({ onPick }: { onPick: (point: [number, number]) => void }) {
  useMapEvents({
    click(event) {
      onPick([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

export default function EvacuationCentersPage() {
  const { user, isBarangayAccount } = useAuth();
  const [barangays, setBarangays] = useState<BarangayOption[]>([]);
  const [barangayId, setBarangayId] = useState(user?.barangay_id || '');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<[number, number]>([14.9133, 121.0436]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isBarangayAccount) return;
    barangayListAPI.list()
      .then((response) => setBarangays(response.data || []))
      .catch(() => toast.error('Could not load barangays'));
  }, [isBarangayAccount]);

  const resetForm = () => {
    setName('');
    setAddress('');
    setPoint([14.9133, 121.0436]);
    if (!isBarangayAccount) setBarangayId('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !barangayId) {
      toast.error('Enter a station name and select its barangay');
      return;
    }

    setSaving(true);
    try {
      const station = {
        name: name.trim(),
        address: address.trim(),
        latitude: point[0],
        longitude: point[1],
      };
      if (isBarangayAccount) {
        await evacuationAPI.addBarangay(station);
      } else {
        await evacuationAPI.addMunicipal({ ...station, barangay_id: barangayId });
      }
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
          <p className="page-subtitle">Register a station and pin its location. Station records are added through this form.</p>
        </div>
      </div>

      <div className="page-content" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 0.85fr) minmax(360px, 1.15fr)', gap: 20, alignItems: 'start' }}>
        <form className="card" onSubmit={handleSubmit} style={{ padding: 24 }}>
          <div className="card-title" style={{ marginBottom: 6 }}>Station details</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 20px' }}>Add the station once; residents will see its distance and estimated travel time.</p>

          <label className="form-label" htmlFor="station-name">Station name</label>
          <input id="station-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Norzagaray Central School" required />

          {!isBarangayAccount && (
            <>
              <label className="form-label" htmlFor="station-barangay" style={{ marginTop: 16 }}>Barangay</label>
              <select id="station-barangay" className="form-select" value={barangayId} onChange={(e) => setBarangayId(e.target.value)} required>
                <option value="">Choose a barangay</option>
                {barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}</option>)}
              </select>
            </>
          )}
          {isBarangayAccount && <div className="field-help" style={{ marginTop: 8 }}>This station will be registered under {user?.barangay_name || 'your barangay'}.</div>}

          <label className="form-label" htmlFor="station-address" style={{ marginTop: 16 }}>Address or landmark</label>
          <input id="station-address" className="form-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, sitio, or nearby landmark" />

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
