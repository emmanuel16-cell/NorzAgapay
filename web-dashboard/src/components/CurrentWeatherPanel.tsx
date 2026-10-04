import { useEffect, useState } from 'react';
import { weatherAPI } from '../lib/api';

interface CurrentWeather {
  temperature?: number;
  humidity?: number;
  wind_speed?: number;
  pressure?: number;
  uv_index?: number;
  weather_condition?: string;
  source?: string;
  last_updated?: string;
}

function formatValue(value: number | undefined, digits = 0): string {
  return value === undefined || value === null || !Number.isFinite(value)
    ? '--'
    : value.toFixed(digits);
}

function getWeatherIcon(condition = ''): string {
  const normalized = condition.toLowerCase();
  if (normalized.includes('thunder')) return '⛈️';
  if (normalized.includes('rain') || normalized.includes('drizzle')) return '🌧️';
  if (normalized.includes('cloud')) return normalized.includes('partly') ? '⛅' : '☁️';
  return '☀️';
}

export default function CurrentWeatherPanel() {
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;

    const refreshWeather = async () => {
      try {
        const response = await weatherAPI.getCurrent();
        if (!response.data?.success || !response.data?.data) {
          throw new Error('Current weather is unavailable');
        }

        if (!active) return;
        setWeather(response.data.data);
        setLastFetchedAt(new Date());
        setHasError(false);
      } catch (error) {
        if (!active) return;
        console.error('Failed to load current weather:', error);
        setHasError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    refreshWeather();
    const interval = window.setInterval(refreshWeather, 300000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const updatedAt = weather?.last_updated || lastFetchedAt?.toISOString();
  const displayDate = updatedAt
    ? new Date(updatedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const condition = weather?.weather_condition || (hasError ? 'Unavailable' : 'N/A');

  return (
    <aside className="command-weather-panel" aria-label="Current weather" aria-live="polite">
      <div className="command-weather-heading">
        <span>Current Weather</span>
        <span className="command-weather-date">{displayDate}</span>
      </div>

      <div className="command-weather-current">
        <span className="command-weather-icon" aria-hidden="true">
          {loading && !weather ? '…' : getWeatherIcon(weather?.weather_condition)}
        </span>
        <div className="command-weather-temperature">
          {formatValue(weather?.temperature, 0)}°C
          <span>{condition}</span>
        </div>
      </div>

      {hasError && !weather && (
        <div className="command-weather-message">Live weather is temporarily unavailable.</div>
      )}

      <div className="command-weather-metrics">
        <div className="command-weather-metric">
          <span aria-hidden="true">💧</span>
          <strong>{formatValue(weather?.humidity)}%</strong>
          <small>Humidity</small>
        </div>
        <div className="command-weather-metric">
          <span aria-hidden="true">💨</span>
          <strong>{formatValue(weather?.wind_speed, 0)} km/h</strong>
          <small>Wind Speed</small>
        </div>
        <div className="command-weather-metric">
          <span aria-hidden="true">🌡️</span>
          <strong>{formatValue(weather?.pressure)} hPa</strong>
          <small>Pressure</small>
        </div>
        <div className="command-weather-metric">
          <span aria-hidden="true">☀️</span>
          <strong>{formatValue(weather?.uv_index, 1)}</strong>
          <small>UV Index</small>
        </div>
      </div>

      <div className="command-weather-source">
        {hasError && weather ? 'Refresh unavailable' : `Source: ${weather?.source || 'N/A'}`}
      </div>
    </aside>
  );
}
