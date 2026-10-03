export type Coordinate = [number, number]; // GeoJSON longitude, latitude
export type BoundaryGeometry =
  | { type: 'Polygon'; coordinates: Coordinate[][] }
  | { type: 'MultiPolygon'; coordinates: Coordinate[][][] };

export interface MunicipalityBoundary {
  geometry: BoundaryGeometry | null;
  enabled: boolean;
  revision: number;
  updated_by?: string | null;
  updated_at?: string | null;
}

export const EMPTY_BOUNDARY: MunicipalityBoundary = {
  geometry: null,
  enabled: false,
  revision: 0,
};

export function boundaryPolygons(geometry: BoundaryGeometry | null): Coordinate[][][] {
  if (!geometry) return [];
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

export function boundaryRings(geometry: BoundaryGeometry | null): Coordinate[][] {
  return boundaryPolygons(geometry).flatMap((polygon) => polygon);
}

export function isCoordinateInsideBoundary(
  latitude: number,
  longitude: number,
  geometry: BoundaryGeometry | null,
): boolean {
  if (!geometry || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return boundaryPolygons(geometry).some((polygon) => {
    const insideOuter = pointInRing(latitude, longitude, polygon[0] ?? []);
    const insideHole = polygon.slice(1).some((ring) => pointInRing(latitude, longitude, ring));
    return insideOuter && !insideHole;
  });
}

function pointInRing(latitude: number, longitude: number, ring: Coordinate[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngA, latA] = ring[i];
    const [lngB, latB] = ring[j];
    if ((latA > latitude) === (latB > latitude)) continue;
    const crossingLongitude = ((lngB - lngA) * (latitude - latA)) / (latB - latA) + lngA;
    if (longitude < crossingLongitude) inside = !inside;
  }
  return inside;
}

export function configFromUnknown(value: unknown): MunicipalityBoundary {
  if (!value || typeof value !== 'object') return EMPTY_BOUNDARY;
  const config = value as Partial<MunicipalityBoundary>;
  const geometry = config.geometry &&
      (config.geometry.type === 'Polygon' || config.geometry.type === 'MultiPolygon')
    ? config.geometry
    : null;
  return {
    geometry: geometry as BoundaryGeometry | null,
    enabled: config.enabled === true && geometry !== null,
    revision: Number.isFinite(config.revision) ? Number(config.revision) : 0,
    updated_by: config.updated_by ?? null,
    updated_at: config.updated_at ?? null,
  };
}
