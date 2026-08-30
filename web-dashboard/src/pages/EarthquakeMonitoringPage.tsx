import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import { weatherAPI } from '../lib/api';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet marker icon issues
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

const getMagnitudeColor = (mag: number) => {
  if (mag >= 5) return '#e74c3c';
  if (mag >= 4) return '#f39c12';
  if (mag >= 3) return '#2ecc71';
  return '#3498db';
};

export default function EarthquakeMonitoringPage() {
  const [earthquakes, setEarthquakes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const response = await weatherAPI.getEarthquakes();
      if (response.data.success) {
        setEarthquakes(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching earthquake data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 300000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Earthquake Monitoring</h1>
        <div className="header-actions">
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {earthquakes.length} earthquakes recorded
          </span>
        </div>
      </div>

      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '24px', minHeight: '600px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 384px', gap: '24px', flex: 1 }}>
          {/* Map Section */}
          <div>
            <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%' }}>
              <MapContainer
                center={[14.9042, 121.0430]}
                zoom={11}
                style={{ width: '100%', height: '100%', background: '#111827' }}
              >
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; OpenStreetMap contributors & CARTO'
                />

                {/* Earthquake Markers */}
                {earthquakes.map((quake) => (
                  <div key={quake.id}>
                    <Circle
                      center={[quake.latitude, quake.longitude]}
                      radius={quake.magnitude * 1000}
                      fillColor={getMagnitudeColor(quake.magnitude)}
                      fillOpacity={0.3}
                      color={getMagnitudeColor(quake.magnitude)}
                      weight={2}
                    />
                    <Marker position={[quake.latitude, quake.longitude]}>
                      <Popup>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '36px', fontWeight: '800', color: getMagnitudeColor(quake.magnitude) }}>
                            {quake.magnitude.toFixed(1)}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>Magnitude</div>
                          <hr style={{ margin: '12px 0', borderColor: 'var(--border-color)' }} />
                          <div style={{ fontSize: '13px', fontWeight: '600' }}>{quake.location}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                            Depth: {quake.depth} km<br />
                            Intensity: {quake.intensity || 'N/A'}<br />
                            {new Date(quake.occurred_at).toLocaleString()}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  </div>
                ))}
              </MapContainer>
            </div>
          </div>

          {/* Earthquake List */}
          <div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="card-header">
                <span className="card-title">Recent Earthquakes</span>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {earthquakes.length > 0 ? (
                  earthquakes.map((quake) => (
                    <div
                      key={quake.id}
                      style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                        <div
                          style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '24px',
                            fontWeight: '800',
                            color: 'white',
                            backgroundColor: getMagnitudeColor(quake.magnitude)
                          }}
                        >
                          {quake.magnitude.toFixed(1)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
                            {quake.location}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                            {new Date(quake.occurred_at).toLocaleString()}
                          </div>
                          <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                            <span>Depth: {quake.depth} km</span>
                            <span>Intensity: {quake.intensity || 'N/A'}</span>
                            {quake.felt && <span style={{ color: 'var(--severity-critical)' }}>Felt</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <p style={{ color: 'var(--text-muted)' }}>No recent earthquakes</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
