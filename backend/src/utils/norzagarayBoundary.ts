import boundaryFeature from '../data/norzagaray_boundary.json';

type Coordinate = [number, number];
type Ring = Coordinate[];
type PolygonRings = Ring[];

// geoBoundaries PHL ADM3 (NAMRIA, PSA, OCHA source data; CC BY 3.0 IGO).
const geometry = (boundaryFeature as any).geometry;
const polygons: PolygonRings[] =
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

export function isInsideNorzagaray(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

  return polygons.some((rings) => {
    const insideOuterRing = isInsideRing(latitude, longitude, rings[0] ?? []);
    const insideHole = rings
      .slice(1)
      .some((ring) => isInsideRing(latitude, longitude, ring));
    return insideOuterRing && !insideHole;
  });
}

function isInsideRing(latitude: number, longitude: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [longitudeA, latitudeA] = ring[i];
    const [longitudeB, latitudeB] = ring[j];
    const crossesLatitude = (latitudeA > latitude) !== (latitudeB > latitude);
    if (!crossesLatitude) continue;

    const crossingLongitude =
      ((longitudeB - longitudeA) * (latitude - latitudeA)) /
        (latitudeB - latitudeA) +
      longitudeA;
    if (longitude < crossingLongitude) inside = !inside;
  }
  return inside;
}
