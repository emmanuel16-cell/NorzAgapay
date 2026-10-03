import boundaryFeature from '../data/norzagaray_boundary.json';
import { supabaseAdmin } from '../config/supabase';

type Coordinate = [number, number];
type Ring = Coordinate[];
type PolygonCoordinates = Ring[];
export type BoundaryGeometry =
  | { type: 'Polygon'; coordinates: PolygonCoordinates }
  | { type: 'MultiPolygon'; coordinates: PolygonCoordinates[] };

const defaultGeometry = (boundaryFeature as any).geometry as BoundaryGeometry;

export interface MunicipalityBoundaryConfiguration {
  geometry: BoundaryGeometry;
  enabled: boolean;
  revision: number;
  updated_by: string | null;
  updated_at: string | null;
}

export async function getMunicipalityBoundaryConfiguration(): Promise<MunicipalityBoundaryConfiguration> {
  const { data, error } = await supabaseAdmin
    .from('municipality_boundary_config')
    .select('geometry, is_enabled, revision, updated_by, updated_at')
    .eq('municipality_key', 'norzagaray')
    .maybeSingle();
  if (error) throw error;

  return {
    // The existing shape is supplied as an editable starting point only. A
    // missing/disabled saved boundary never restricts maps or reports.
    geometry: (data?.geometry as BoundaryGeometry | null) ?? defaultGeometry,
    enabled: data?.is_enabled === true && data?.geometry != null,
    revision: Number(data?.revision ?? 0),
    updated_by: data?.updated_by ?? null,
    updated_at: data?.updated_at ?? null,
  };
}

export function normalizeBoundaryGeometry(value: unknown): BoundaryGeometry {
  const input = value as any;
  const geometry = input?.type === 'Feature' ? input.geometry : input;
  if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
    return geometry as BoundaryGeometry;
  }
  throw new Error('Boundary must be a GeoJSON Polygon or MultiPolygon.');
}

export function validateBoundaryGeometry(geometry: BoundaryGeometry): string | null {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) {
    return 'Add at least one boundary polygon.';
  }

  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      return 'Each boundary polygon needs an outer ring.';
    }
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) {
        return 'Every ring must have at least three points and be closed.';
      }
      if (ring.some((coordinate) =>
        !Array.isArray(coordinate) || coordinate.length < 2 ||
        !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]) ||
        Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90)) {
        return 'Boundary coordinates must be valid longitude/latitude values.';
      }
      const firstCoordinate = ring[0];
      const last = ring[ring.length - 1];
      if (firstCoordinate[0] !== last[0] || firstCoordinate[1] !== last[1]) {
        return 'Each boundary ring must connect its final point back to its first.';
      }
      const distinct = new Set(ring.slice(0, -1).map(([lng, lat]) => `${lng},${lat}`));
      if (distinct.size < 3) return 'Add at least three distinct boundary points.';
      const vertices = ring.slice(0, -1);
      const [firstVertex, secondVertex] = vertices;
      if (vertices.every(([lng, lat]) => Math.abs(
        (secondVertex[0] - firstVertex[0]) * (lat - firstVertex[1]) -
        (secondVertex[1] - firstVertex[1]) * (lng - firstVertex[0]),
      ) < 1e-12)) return 'Boundary points must enclose an area.';
      if (hasSelfIntersection(ring)) return 'Boundary rings cannot cross themselves.';
    }
  }
  return null;
}

export function isPointInBoundary(latitude: number, longitude: number, geometry: BoundaryGeometry): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.coordinates;
  return polygons.some((rings) => {
    const inOuter = isInsideRing(latitude, longitude, rings[0] ?? []);
    const inHole = rings.slice(1).some((ring) => isInsideRing(latitude, longitude, ring));
    return inOuter && !inHole;
  });
}

function isInsideRing(latitude: number, longitude: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [longitudeA, latitudeA] = ring[i];
    const [longitudeB, latitudeB] = ring[j];
    const crossesLatitude = (latitudeA > latitude) !== (latitudeB > latitude);
    if (!crossesLatitude) continue;
    const crossingLongitude = ((longitudeB - longitudeA) * (latitude - latitudeA)) /
      (latitudeB - latitudeA) + longitudeA;
    if (longitude < crossingLongitude) inside = !inside;
  }
  return inside;
}

function hasSelfIntersection(ring: Ring): boolean {
  const segmentCount = ring.length - 1;
  for (let first = 0; first < segmentCount; first++) {
    for (let second = first + 1; second < segmentCount; second++) {
      if (second === first + 1 || (first === 0 && second === segmentCount - 1)) continue;
      if (segmentsIntersect(ring[first], ring[first + 1], ring[second], ring[second + 1])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  // Compare orientation signs, not their raw magnitudes. Raw `!==` checks
  // treat a zero orientation and any non-zero orientation as a crossing even
  // when the point lies only on the infinite extension of the segment. That
  // rejected valid rings in the bundled Norzagaray geometry.
  const epsilon = 1e-12;
  const orientation = (p: Coordinate, q: Coordinate, r: Coordinate) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const sign = (value: number) =>
    Math.abs(value) <= epsilon ? 0 : value > 0 ? 1 : -1;
  const onSegment = (p: Coordinate, q: Coordinate, r: Coordinate) =>
    q[0] <= Math.max(p[0], r[0]) + epsilon && q[0] >= Math.min(p[0], r[0]) - epsilon &&
    q[1] <= Math.max(p[1], r[1]) + epsilon && q[1] >= Math.min(p[1], r[1]) - epsilon;
  const o1 = sign(orientation(a, b, c));
  const o2 = sign(orientation(a, b, d));
  const o3 = sign(orientation(c, d, a));
  const o4 = sign(orientation(c, d, b));
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (o1 === 0 && onSegment(a, c, b)) || (o2 === 0 && onSegment(a, d, b)) ||
    (o3 === 0 && onSegment(c, a, d)) || (o4 === 0 && onSegment(c, b, d));
}
