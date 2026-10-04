import { Polygon, Polyline, useMap } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import { useEffect } from 'react';
import { boundaryRings, type MunicipalityBoundary } from '../lib/municipalityBoundary';

const WORLD_RING: LatLngExpression[] = [
  [-85, -180], [-85, 180], [85, 180], [85, -180], [-85, -180],
];

export default function MunicipalityBoundaryMapLayer({
  boundary,
  maskColor = '#ffffff',
  showOutline = true,
}: {
  boundary: MunicipalityBoundary;
  maskColor?: string;
  showOutline?: boolean;
}) {
  const rings = boundaryRings(boundary.geometry);
  if (!boundary.enabled || rings.length === 0) return null;

  const maskRings = rings.map((ring) => ring.map(([longitude, latitude]) => [latitude, longitude] as LatLngExpression));
  const maskPositions: LatLngExpression[][] = [WORLD_RING, ...maskRings];
  return <>
    <Polygon
      positions={maskPositions}
      pathOptions={{
        stroke: false,
        fillColor: maskColor,
        fillOpacity: 1,
        fillRule: 'evenodd',
        interactive: false,
      }}
    />
    {showOutline && rings.map((ring, index) => (
      <Polyline
        key={`boundary-outline-${index}`}
        positions={ring.map(([longitude, latitude]) => [latitude, longitude] as LatLngExpression)}
        pathOptions={{ color: '#d6f5c8', weight: 2.5, opacity: 0.98, interactive: false }}
      />
    ))}
  </>;
}

export function MunicipalityBoundaryViewport({ boundary }: { boundary: MunicipalityBoundary }) {
  const map = useMap();
  useEffect(() => {
    if (!boundary.enabled || !boundary.geometry) return;
    const points = boundaryRings(boundary.geometry)
      .flat()
      .map(([longitude, latitude]) => L.latLng(latitude, longitude));
    if (points.length > 0) map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 13 });
  }, [boundary.enabled, boundary.geometry, boundary.revision, map]);
  return null;
}
