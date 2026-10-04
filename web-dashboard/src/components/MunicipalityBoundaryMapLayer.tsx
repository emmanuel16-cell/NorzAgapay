import { Polyline, useMap } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import { useEffect } from 'react';
import { boundaryPolygons, boundaryRings, type MunicipalityBoundary } from '../lib/municipalityBoundary';

export default function MunicipalityBoundaryMapLayer({
  boundary,
  showOutline = true,
}: {
  boundary: MunicipalityBoundary;
  showOutline?: boolean;
}) {
  const rings = boundaryRings(boundary.geometry);
  if (!boundary.enabled || rings.length === 0) return null;

  return <>
    <MunicipalityBoundaryOutsideBlur boundary={boundary} />
    {showOutline && rings.map((ring, index) => (
      <Polyline
        key={`boundary-outline-${index}`}
        positions={ring.map(([longitude, latitude]) => [latitude, longitude] as LatLngExpression)}
        pathOptions={{ color: '#d6f5c8', weight: 2.5, opacity: 0.98, interactive: false }}
      />
    ))}
  </>;
}

function MunicipalityBoundaryOutsideBlur({ boundary }: { boundary: MunicipalityBoundary }) {
  const map = useMap();

  useEffect(() => {
    if (!boundary.enabled || !boundary.geometry) return;

    const exteriorRings = boundaryPolygons(boundary.geometry)
      .map((polygon) => polygon[0])
      .filter((ring) => ring && ring.length >= 3);
    if (exteriorRings.length === 0) return;

    const blurLayer = document.createElement('div');
    blurLayer.setAttribute('aria-hidden', 'true');
    Object.assign(blurLayer.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '350',
      pointerEvents: 'none',
      backdropFilter: 'blur(4px)',
      backgroundColor: 'rgba(11, 17, 32, 0.12)',
    });
    blurLayer.style.setProperty('-webkit-backdrop-filter', 'blur(4px)');
    map.getContainer().appendChild(blurLayer);

    let frame = 0;
    const updateMask = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const size = map.getSize();
        const paths = exteriorRings.map((ring) => {
          const commands = ring.map(([longitude, latitude], index) => {
            const point = map.latLngToContainerPoint([latitude, longitude]);
            return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
          }).join(' ');
          return `<path d="${commands} Z" fill="black"/>`;
        }).join('');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.x}" height="${size.y}" viewBox="0 0 ${size.x} ${size.y}"><mask id="municipality" style="mask-type:luminance"><rect width="100%" height="100%" fill="white"/>${paths}</mask><rect width="100%" height="100%" fill="white" mask="url(#municipality)"/></svg>`;
        const maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
        blurLayer.style.setProperty('mask-image', maskImage);
        blurLayer.style.setProperty('-webkit-mask-image', maskImage);
        blurLayer.style.setProperty('mask-size', '100% 100%');
        blurLayer.style.setProperty('-webkit-mask-size', '100% 100%');
        blurLayer.style.setProperty('mask-repeat', 'no-repeat');
        blurLayer.style.setProperty('-webkit-mask-repeat', 'no-repeat');
      });
    };

    map.on('move zoom resize', updateMask);
    updateMask();
    return () => {
      map.off('move zoom resize', updateMask);
      window.cancelAnimationFrame(frame);
      blurLayer.remove();
    };
  }, [map, boundary.enabled, boundary.geometry, boundary.revision]);

  return null;
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
