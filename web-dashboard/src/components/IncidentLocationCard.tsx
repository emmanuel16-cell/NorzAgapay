import { MapPin } from 'lucide-react';
import type { IncidentLocationPreview } from '../lib/incidentLocation';

type Props = {
  location?: IncidentLocationPreview | null;
  fallbackLabel?: string | null;
  loading?: boolean;
  error?: string;
  coordinates?: string | null;
  mapHref?: string | null;
};

export default function IncidentLocationCard({
  location,
  fallbackLabel,
  loading = false,
  error = '',
  coordinates,
  mapHref,
}: Props) {
  const primary = location?.road || location?.landmark || fallbackLabel || 'Pinned incident location';
  const hasNearbyLandmark = Boolean(location?.landmark && location.landmark !== primary);
  const landmarkText = hasNearbyLandmark
    ? `Near ${location!.landmark}${location!.landmark_distance_meters != null ? ` · ${location!.landmark_distance_meters} m` : ''}`
    : '';
  const nearestBarangay = location?.nearest_response_barangay_name?.replace(/^(?:barangay|brgy\.?)\s*/i, '');

  return (
    <div className="panel-details-box incident-location-card">
      <MapPin size={18} aria-hidden="true" />
      <div className="reporter-note-content">
        <strong>Incident location</strong>
        <p>{loading ? 'Looking up the road and nearby places…' : primary}</p>
        {!loading && landmarkText && <small>{landmarkText}</small>}
        {!loading && nearestBarangay && <small>Closest response barangay: {nearestBarangay}</small>}
        {!loading && error && <small className="incident-location-message">{error}{coordinates ? ` · ${coordinates}` : ''}</small>}
        {!loading && !error && !location?.road && !location?.landmark && !fallbackLabel && coordinates &&
          <small className="incident-location-message">{coordinates}</small>}
        {mapHref && <a className="incident-location-map-link" href={mapHref} target="_blank" rel="noreferrer">Open map</a>}
      </div>
    </div>
  );
}
