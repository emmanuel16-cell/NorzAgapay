import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { weatherAPI } from '../lib/api';

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

interface WeatherData {
  temperature: number;
  humidity: number;
  wind_speed: number;
  wind_direction: number;
  rainfall: number;
  pressure: number;
  visibility: number;
  uv_index: number;
  location: string;
  last_updated: string;
  units: {
    temperature: string;
    humidity: string;
    wind_speed: string;
    pressure: string;
    visibility: string;
  };
}

interface Advisory {
  id: string;
  type: 'weather' | 'flood' | 'earthquake' | 'dam';
  level: 'normal' | 'warning' | 'critical';
  title: string;
  message: string;
  source: string;
  external_url?: string;
  created_at: string;
  updated_at: string;
}



interface Earthquake {
  id: string;
  magnitude: number;
  depth: number;
  latitude: number;
  longitude: number;
  location: string;
  intensity?: string;
  occurred_at: string;
  felt: boolean;
}

interface RiverStation {
  id: string;
  station_name: string;
  station_code: string;
  river_name: string;
  latitude: number;
  longitude: number;
  warning_level: number;
  critical_level: number;
  status: 'normal' | 'warning' | 'critical';
  latest_level: {
    id: string;
    water_level: number;
    trend: string;
    level: 'normal' | 'warning' | 'critical';
    recorded_at: string;
  };
}

interface DamStation {
  id: string;
  dam_name: string;
  dam_code: string;
  latitude: number;
  longitude: number;
  warning_level: number;
  critical_level: number;
  normal_water_level: number;
  status: 'normal' | 'warning' | 'critical';
  latest_level: {
    id: string;
    water_level: number;
    discharge_rate: number;
    trend: string;
    level: 'normal' | 'warning' | 'critical';
    recorded_at: string;
  };
}

export default function WeatherMonitoringPage() {
  const [activeTab, setActiveTab] = useState<'weather' | 'earthquakes' | 'rivers' | 'dams'>('weather');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [riverStations, setRiverStations] = useState<RiverStation[]>([]);
  const [damStations, setDamStations] = useState<DamStation[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch all data
  const fetchData = async () => {
    try {
      const [weatherRes, advisoriesRes, quakeRes, riverRes, damRes] = await Promise.all([
        weatherAPI.getCurrent(),
        weatherAPI.getAdvisories(),
        weatherAPI.getEarthquakes(),
        weatherAPI.getRiverStations(),
        weatherAPI.getDamStations(),
      ]);

      if (weatherRes.data.success) setWeather(weatherRes.data.data);
      if (advisoriesRes.data.success) setAdvisories(advisoriesRes.data.data);
      if (quakeRes.data.success) setEarthquakes(quakeRes.data.data);
      if (riverRes.data.success) setRiverStations(riverRes.data.data);
      if (damRes.data.success) setDamStations(damRes.data.data);
    } catch (error) {
      console.error('Error fetching weather data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchData, 300000);
    return () => clearInterval(interval);
  }, []);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'critical': return '#e74c3c';
      case 'warning': return '#f39c12';
      default: return '#2ecc71';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'weather': return '🌤️';
      case 'flood': return '🌊';
      case 'earthquake': return '🌋';
      case 'dam': return '🌊';
      default: return '⚠️';
    }
  };

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Weather Monitoring & Early Warning</h1>
        <div className="header-actions">
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {weather ? `Last updated: ${new Date(weather.last_updated).toLocaleString()}` : ''}
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{ 
        display: 'flex', 
        gap: '8px', 
        marginBottom: '24px', 
        padding: '0 24px',
        flexWrap: 'wrap'
      }}>
        {[
          { id: 'weather', label: 'Weather Data', icon: '🌤️' },
          { id: 'earthquakes', label: 'Earthquakes', icon: '🌋' },
          { id: 'rivers', label: 'River Levels', icon: '🌊' },
          { id: 'dams', label: 'Dam Levels', icon: '🏗️' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              background: activeTab === tab.id ? 'var(--accent)' : 'var(--primary-100)',
              color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease'
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Weather Data Tab */}
      {activeTab === 'weather' && (
        <>
          {/* Stats Grid */}
          <div className="stats-grid">
            {[
              { 
                label: 'Temperature', 
                value: weather ? `${weather.temperature}${weather.units.temperature}` : '--', 
                icon: '🌡️', 
                color: 'var(--accent)' 
              },
              { 
                label: 'Humidity', 
                value: weather ? `${weather.humidity}${weather.units.humidity}` : '--', 
                icon: '💧', 
                color: 'var(--primary)' 
              },
              { 
                label: 'Wind Speed', 
                value: weather ? `${weather.wind_speed} ${weather.units.wind_speed}` : '--', 
                icon: '💨', 
                color: 'var(--info)' 
              },
              { 
                label: 'UV Index', 
                value: weather ? `${weather.uv_index}` : '--', 
                icon: '☀️', 
                color: 'var(--warning)' 
              },
              { 
                label: 'Rainfall', 
                value: weather ? `${weather.rainfall} mm` : '--', 
                icon: '🌧️', 
                color: '#3498db' 
              },
              { 
                label: 'Pressure', 
                value: weather ? `${weather.pressure} hPa` : '--', 
                icon: '📊', 
                color: '#9b59b6' 
              },
            ].map((s) => (
              <div key={s.label} className="stat-card" style={{ '--stat-color': s.color } as React.CSSProperties}>
                <div className="stat-icon">{s.icon}</div>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ 
            padding: '0 24px 24px', 
            display: 'flex', 
            gap: '20px', 
            flex: 1, 
            minHeight: 0 
          }}>
            {/* Map */}
            <div style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
              <div className="card" style={{ 
                padding: 0, 
                overflow: 'hidden', 
                flex: 1, 
                minHeight: '500px' 
              }}>
                <MapContainer
                  center={[14.904246495288923, 121.0430072345187]}
                  zoom={14}
                  style={{ width: '100%', height: '100%', background: '#111827' }}
                >
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                  />
                  {/* Station Markers */}
                  {riverStations.map((station) => (
                    <Marker key={station.id} position={[station.latitude, station.longitude]}>
                      <Popup>
                        <div>
                          <strong>{station.station_name}</strong><br />
                          <small>{station.river_name}</small><br />
                          <div style={{ marginTop: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <span>Current:</span>
                              <span style={{ 
                                color: getLevelColor(station.latest_level?.level || 'normal'),
                                fontWeight: 700 
                              }}>
                                {station.latest_level?.water_level.toFixed(2) || '--'} m
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <span>Warning:</span>
                              <span>{station.warning_level} m</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Critical:</span>
                              <span>{station.critical_level} m</span>
                            </div>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>

              <div className="card" style={{ marginTop: '12px', padding: '16px' }}>
                <div className="card-header" style={{ 
                  padding: '0 0 12px 0', 
                  marginBottom: '12px', 
                  borderBottom: '1px solid var(--border-color)' 
                }}>
                  <span className="card-title">Hazard Zones (Legend)</span>
                </div>
                <div style={{ 
                  color: 'var(--text-muted)', 
                  fontSize: '13px', 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: '24px' 
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ 
                      width: 16, 
                      height: 16, 
                      background: 'rgba(231, 76, 60, 0.3)', 
                      border: '2px solid #e74c3c', 
                      borderRadius: 4 
                    }}></div>
                    High Risk Flood Zone
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ 
                      width: 16, 
                      height: 16, 
                      background: 'rgba(243, 156, 18, 0.3)', 
                      border: '2px solid #f39c12', 
                      borderRadius: 4 
                    }}></div>
                    Moderate Risk Flood Zone
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ 
                      width: 16, 
                      height: 16, 
                      background: 'rgba(192, 57, 43, 0.3)', 
                      border: '2px solid #c0392b', 
                      borderRadius: 4 
                    }}></div>
                    Landslide Prone Area
                  </span>
                </div>
              </div>
            </div>

            {/* Advisories Sidebar */}
            <div style={{ flex: 1, minWidth: '280px' }}>
              <div className="card" style={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column' 
              }}>
                <div className="card-header">
                  <span className="card-title">Advisories & Alerts</span>
                  <span className="badge badge-open">{advisories.length}</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {advisories.length > 0 ? advisories.map((adv) => (
                    <div
                      key={adv.id}
                      className="list-item-hover"
                      style={{
                        padding: '16px',
                        borderBottom: '1px solid var(--border-color)',
                      }}
                    >
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'flex-start', 
                        marginBottom: '8px' 
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '20px' }}>{getTypeIcon(adv.type)}</span>
                          <span style={{ fontWeight: 600, fontSize: '14px' }}>{adv.title}</span>
                        </div>
                        <span
                          className="badge"
                          style={{
                            background: `${getLevelColor(adv.level)}20`,
                            color: getLevelColor(adv.level),
                            border: `1px solid ${getLevelColor(adv.level)}50`
                          }}
                        >
                          {adv.level.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ 
                        fontSize: '12px', 
                        color: 'var(--text-muted)', 
                        marginBottom: '4px' 
                      }}>
                        {adv.message}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Source: {adv.source} • {new Date(adv.created_at).toLocaleString()}
                      </div>
                    </div>
                  )) : (
                    <div className="empty-state" style={{ padding: '30px 10px' }}>
                      <p style={{ fontSize: '13px' }}>No advisories at this time</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Earthquakes Tab */}
      {activeTab === 'earthquakes' && (
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Recent Earthquakes (PHIVOLCS)</span>
              <span className="badge badge-open">{earthquakes.length}</span>
            </div>
            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {earthquakes.length > 0 ? earthquakes.map((quake) => (
                <div
                  key={quake.id}
                  className="list-item-hover"
                  style={{
                    padding: '16px',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '20px'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <span style={{
                        fontSize: '24px',
                        fontWeight: 800,
                        color: quake.magnitude >= 5 ? '#e74c3c' : quake.magnitude >= 4 ? '#f39c12' : '#2ecc71'
                      }}>
                        {quake.magnitude}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '14px' }}>
                          {quake.location}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          Depth: {quake.depth} km • Intensity: {quake.intensity || 'N/A'}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {new Date(quake.occurred_at).toLocaleString()}
                    </div>
                  </div>
                  {quake.felt && (
                    <span className="badge" style={{ background: '#e74c3c20', color: '#e74c3c' }}>
                      FELT
                    </span>
                  )}
                </div>
              )) : (
                <div className="empty-state" style={{ padding: '40px' }}>
                  <p style={{ fontSize: '13px' }}>No recent earthquakes</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* River Levels Tab */}
      {activeTab === 'rivers' && (
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px' }}>
            {riverStations.map((station) => (
              <div key={station.id} className="card">
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  marginBottom: '16px', 
                  paddingBottom: '12px', 
                  borderBottom: '1px solid var(--border-color)' 
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '16px' }}>
                      {station.station_name}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {station.river_name}
                    </div>
                  </div>
                  <span
                    className="badge"
                    style={{
                      background: `${getLevelColor(station.status)}20`,
                      color: getLevelColor(station.status),
                      border: `1px solid ${getLevelColor(station.status)}50`,
                      fontWeight: 700
                    }}
                  >
                    {station.status.toUpperCase()}
                  </span>
                </div>

                {/* Level Bar */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    fontSize: '11px', 
                    color: 'var(--text-muted)', 
                    marginBottom: '4px' 
                  }}>
                    <span>0m</span>
                    <span>Warning: {station.warning_level}m</span>
                    <span>Critical: {station.critical_level}m</span>
                  </div>
                  <div style={{ 
                    height: '16px', 
                    background: 'var(--primary-100)', 
                    borderRadius: '8px', 
                    position: 'relative', 
                    overflow: 'hidden' 
                  }}>
                    {/* Warning zone */}
                    <div style={{
                      position: 'absolute',
                      left: `${(station.warning_level / station.critical_level) * 100}%`,
                      width: `${((station.critical_level - station.warning_level) / station.critical_level) * 100}%`,
                      height: '100%',
                      background: '#f39c1230',
                      borderRight: '2px solid #f39c12'
                    }} />
                    {/* Critical zone */}
                    <div style={{
                      position: 'absolute',
                      left: `${(station.critical_level / (station.critical_level * 1.2)) * 100}%`,
                      width: '100%',
                      height: '100%',
                      background: '#e74c3c30',
                      borderRight: '2px solid #e74c3c'
                    }} />
                    {/* Current level indicator */}
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: '100%',
                      width: `${Math.min(100, (station.latest_level?.water_level || 0) / (station.critical_level * 1.2) * 100)}%`,
                      background: getLevelColor(station.latest_level?.level || 'normal'),
                      borderRadius: '8px'
                    }} />
                  </div>
                  <div style={{ 
                    textAlign: 'center', 
                    marginTop: '8px', 
                    fontSize: '24px', 
                    fontWeight: 800,
                    color: getLevelColor(station.latest_level?.level || 'normal')
                  }}>
                    {station.latest_level?.water_level.toFixed(2) || '--'} m
                  </div>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Last updated: {new Date(station.latest_level?.recorded_at || '').toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dam Levels Tab */}
      {activeTab === 'dams' && (
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px' }}>
            {damStations.map((dam) => (
              <div key={dam.id} className="card">
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  marginBottom: '16px', 
                  paddingBottom: '12px', 
                  borderBottom: '1px solid var(--border-color)' 
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '16px' }}>
                      {dam.dam_name}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Code: {dam.dam_code}
                    </div>
                  </div>
                  <span
                    className="badge"
                    style={{
                      background: `${getLevelColor(dam.status)}20`,
                      color: getLevelColor(dam.status),
                      border: `1px solid ${getLevelColor(dam.status)}50`,
                      fontWeight: 700
                    }}
                  >
                    {dam.status.toUpperCase()}
                  </span>
                </div>

                {/* Level Bar */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    fontSize: '11px', 
                    color: 'var(--text-muted)', 
                    marginBottom: '4px' 
                  }}>
                    <span>Normal: {dam.normal_water_level}m</span>
                    <span>Warning: {dam.warning_level}m</span>
                    <span>Critical: {dam.critical_level}m</span>
                  </div>
                  <div style={{ 
                    height: '16px', 
                    background: 'var(--primary-100)', 
                    borderRadius: '8px', 
                    position: 'relative', 
                    overflow: 'hidden' 
                  }}>
                    {/* Warning zone */}
                    <div style={{
                      position: 'absolute',
                      left: `${((dam.warning_level - (dam.normal_water_level - 5)) / ((dam.critical_level - (dam.normal_water_level - 5)))) * 100}%`,
                      width: `${((dam.critical_level - dam.warning_level) / (dam.critical_level - (dam.normal_water_level - 5))) * 100}%`,
                      height: '100%',
                      background: '#f39c1230',
                      borderRight: '2px solid #f39c12'
                    }} />
                    {/* Critical zone */}
                    <div style={{
                      position: 'absolute',
                      left: `${((dam.critical_level - (dam.normal_water_level - 5)) / ((dam.critical_level - (dam.normal_water_level - 5)))) * 100}%`,
                      width: '100%',
                      height: '100%',
                      background: '#e74c3c30',
                      borderRight: '2px solid #e74c3c'
                    }} />
                    {/* Current level indicator */}
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: '100%',
                      width: `${Math.min(100, ((dam.latest_level?.water_level || 0) - (dam.normal_water_level - 5)) / (dam.critical_level - (dam.normal_water_level - 5)) * 100)}%`,
                      background: getLevelColor(dam.latest_level?.level || 'normal'),
                      borderRadius: '8px'
                    }} />
                  </div>
                  <div style={{ 
                    textAlign: 'center', 
                    marginTop: '8px', 
                    fontSize: '24px', 
                    fontWeight: 800,
                    color: getLevelColor(dam.latest_level?.level || 'normal')
                  }}>
                    {dam.latest_level?.water_level.toFixed(2) || '--'} m
                  </div>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Discharge Rate
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {dam.latest_level?.discharge_rate.toFixed(2) || '--'} m³/s
                  </div>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Last updated: {new Date(dam.latest_level?.recorded_at || '').toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
