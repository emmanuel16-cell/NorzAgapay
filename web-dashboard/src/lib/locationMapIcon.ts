import L from 'leaflet';

function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function createLocationMapIcon(imageUrl?: string | null, type: 'office' | 'barangay' = 'barangay', fallback?: L.DivIcon) {
  if (!imageUrl) return fallback || L.divIcon({ className: `location-map-pin-fallback ${type}`, html: `<span>${type === 'office' ? 'MDRRMO' : 'BARANGAY'}</span>`, iconSize: [82, 38], iconAnchor: [41, 19] });
  const safeUrl = escapeAttribute(imageUrl);
  return L.divIcon({
    className: `location-map-image-icon ${type}`,
    html: `<span><img src="${safeUrl}" alt="" /></span>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}
