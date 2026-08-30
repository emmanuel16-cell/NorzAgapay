import { useEffect, useState } from 'react';
import { weatherAPI } from '../lib/api';

export default function WeatherMonitoringV2() {
  const [currentWeather, setCurrentWeather] = useState<any>(null);
  const [forecast, setForecast] = useState<any>({ hourly: [], daily: [] });
  const [riverStations, setRiverStations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [weatherRes, forecastRes, riverRes] = await Promise.all([
        weatherAPI.getCurrent(),
        weatherAPI.getForecast(),
        weatherAPI.getRiverStations()
      ]);

      if (weatherRes.data.success) setCurrentWeather(weatherRes.data.data);
      if (forecastRes.data.success) {
        // Deduplicate hourly forecast by time
        const hourlyMap = new Map();
        forecastRes.data.data.hourly.forEach((item: any) => {
          const timeKey = new Date(item.forecast_time).getTime();
          if (!hourlyMap.has(timeKey)) {
            hourlyMap.set(timeKey, item);
          }
        });
        // Deduplicate daily forecast by date
        const dailyMap = new Map();
        forecastRes.data.data.daily.forEach((item: any) => {
          const dateKey = new Date(item.forecast_time).toDateString();
          if (!dailyMap.has(dateKey)) {
            dailyMap.set(dateKey, item);
          }
        });
        setForecast({
          hourly: Array.from(hourlyMap.values()).reverse().slice(0, 24), // Reverse to newest first, limit 24
          daily: Array.from(dailyMap.values()).reverse().slice(0, 7) // Reverse to newest first, limit 7
        });
      }
      if (riverRes.data.success) {
        // Deduplicate river stations: keep only the latest entry for each station name
        const stationMap = new Map();
        riverRes.data.data.forEach((station: any) => {
          if (!stationMap.has(station.station_name)) {
            stationMap.set(station.station_name, station);
          }
        });
        // Filter to only the 3 stations we want
        const targetStations = ['Angat River - Norzagaray', 'Ipo Dam Tailwater', 'Bustos Dam Tailwater'];
        const filtered = Array.from(stationMap.values()).filter((station: any) => 
          targetStations.includes(station.station_name)
        );
        setRiverStations(filtered);
      }
    } catch (error) {
      console.error('Error fetching weather data:', error);
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

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'critical': return 'var(--severity-critical)';
      case 'warning': return 'var(--severity-high)';
      default: return 'var(--severity-low)';
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Weather Monitoring</h1>
      </div>

      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Current Weather Card */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">Current Weather</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Source: {currentWeather?.source || 'N/A'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <div style={{ fontSize: '80px' }}>
                {currentWeather?.weather_condition?.includes('Rain') ? '🌧️' :
                 currentWeather?.weather_condition?.includes('Cloud') ? '☁️' :
                 currentWeather?.weather_condition?.includes('Clear') ? '☀️' : '🌤️'}
              </div>
              <div>
                <div style={{ fontSize: '56px', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '8px' }}>
                  {currentWeather?.temperature?.toFixed(1) || '--'}°C
                </div>
                <div style={{ fontSize: '24px', color: 'var(--text-secondary)' }}>
                  {currentWeather?.weather_condition || 'N/A'}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '24px', width: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>💧</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {currentWeather?.humidity?.toFixed(0) || '--'}%
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Humidity</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>💨</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {currentWeather?.wind_speed?.toFixed(1) || '--'} km/h
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Wind Speed</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🌡️</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {currentWeather?.pressure?.toFixed(0) || '--'} hPa
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Pressure</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>☀️</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {currentWeather?.uv_index?.toFixed(1) || '--'}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>UV Index</div>
              </div>
            </div>
          </div>
        </div>

        {/* Hourly Forecast */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">Hourly Forecast (Predictive)</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Source: Open-Meteo
            </span>
          </div>
          <div style={{ overflowX: 'auto', paddingBottom: '8px' }}>
            <div style={{ display: 'flex', gap: '16px', minWidth: 'max-content' }}>
              {forecast?.hourly?.slice(0, 24)?.map((hour: any, index: number) => {
                const time = new Date(hour.forecast_time);
                return (
                  <div
                    key={hour.id || index}
                    className="card"
                    style={{ textAlign: 'center', padding: '16px', minWidth: '100px' }}
                  >
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>
                      {hour.weather_condition?.includes('Rain') ? '🌧️' :
                       hour.weather_condition?.includes('Cloud') ? '☁️' : '☀️'}
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '4px' }}>
                      {hour.temperature?.toFixed(1) || '--'}°C
                    </div>
                    {hour.rainfall_probability !== undefined && (
                      <div style={{ fontSize: '13px', color: 'var(--info)' }}>
                        💧 {hour.rainfall_probability?.toFixed(0) || 0}%
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Daily Forecast */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">7-Day Forecast (Predictive)</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Source: Open-Meteo
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', padding: '0' }}>
            {forecast?.daily?.slice(0, 7)?.map((day: any, index: number) => {
              const date = new Date(day.forecast_time);
              return (
                <div
                  key={day.id || index}
                  className="card"
                  style={{ textAlign: 'center', padding: '16px' }}
                >
                  <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    {date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>
                    {day.weather_condition?.includes('Rain') ? '🌧️' :
                     day.weather_condition?.includes('Cloud') ? '☁️' : '☀️'}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {day.temperature?.toFixed(1) || '--'}°C
                  </div>
                  {day.rainfall_probability !== undefined && (
                    <div style={{ fontSize: '13px', color: 'var(--info)' }}>
                      💧 {day.rainfall_probability?.toFixed(0) || 0}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* River & Dam Levels */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">River & Dam Levels</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Source: PAGASA Hydromet
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
            {riverStations.map((station: any) => {
              const level = station.latest_level;
              const status = station.status;
              return (
                <div
                  key={station.id}
                  className="card"
                  style={{
                    borderLeft: `4px solid ${getLevelColor(status)}`,
                    padding: '16px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ fontWeight: '700', fontSize: '18px', color: 'var(--text-primary)' }}>
                      🌊 {station.station_name}
                    </div>
                    <span className="badge" style={{ backgroundColor: `${getLevelColor(status)}20`, color: getLevelColor(status) }}>
                      {status.toUpperCase()}
                    </span>
                  </div>
                  {level && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ fontSize: '32px', fontWeight: '800', color: 'var(--text-primary)' }}>
                        {level.water_level.toFixed(2)}m
                      </div>
                      <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>
                        <span>⚠️ Warning: {station.warning_level}m</span>
                        <span>🆘 Critical: {station.critical_level}m</span>
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                        Last updated: {new Date(level.recorded_at).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
