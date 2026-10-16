import L from 'leaflet';

export function createLocationMapIcon(imageUrl?: string | null, type: 'office' | 'barangay' = 'barangay', fallback?: L.DivIcon) {
  if (!imageUrl) return fallback || L.divIcon({ className: `location-map-pin-fallback ${type}`, html: `<span>${type === 'office' ? 'MDRRMO' : 'BARANGAY'}</span>`, iconSize: [82, 38], iconAnchor: [41, 19] });
  return L.icon({
    iconUrl: imageUrl,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    className: `location-map-image-icon ${type}`,
  });
}
