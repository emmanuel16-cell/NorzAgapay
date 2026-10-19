type ReverseGeocodeResult = {
  address?: Record<string, unknown>;
  display_name?: string;
  name?: string;
};

export type ResolvedIncidentLocation = {
  label: string;
  barangayName: string | null;
  road: string | null;
  landmark: string | null;
};

const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 15 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1000;
const resultCache = new Map<string, { value: ReverseGeocodeResult | null; expiresAt: number }>();
const pendingLookups = new Map<string, Promise<ReverseGeocodeResult | null>>();
let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

const locationPart = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const normalizePlace = (value: string) => value
  .replace(/^(?:barangay|brgy\.?)\s*/i, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase();

async function fetchReverseGeocode(latitude: number, longitude: number, key: string): Promise<ReverseGeocodeResult | null> {
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = pendingLookups.get(key);
  if (pending) return pending;

  const lookup = requestQueue.then(async () => {
    const waitMs = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    lastRequestAt = Date.now();

    try {
      const response = await fetch(url, {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'NorzAgapay/1.0 (incident location lookup)',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return await response.json() as ReverseGeocodeResult;
    } catch (error) {
      console.warn('Could not reverse geocode incident location:', error);
      return null;
    }
  });

  requestQueue = lookup.then(() => undefined, () => undefined);
  pendingLookups.set(key, lookup);
  try {
    const result = await lookup;
    resultCache.set(key, {
      value: result,
      expiresAt: Date.now() + (result ? RESULT_TTL_MS : FAILURE_TTL_MS),
    });
    return result;
  } finally {
    pendingLookups.delete(key);
  }
}

export async function resolveIncidentLocation(
  latitude: number,
  longitude: number,
  barangayNames: string[],
  fallbackBarangayName?: string | null,
): Promise<ResolvedIncidentLocation | null> {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const result = await fetchReverseGeocode(latitude, longitude, key);
  if (!result) return null;

  const address = result.address || {};
  const road = [address.road, address.residential, address.pedestrian, address.path, address.footway, address.service]
    .map(locationPart)
    .find(Boolean) || null;
  const namedPlace = locationPart(result.name) || [address.building, address.amenity, address.shop, address.tourism, address.leisure]
    .map(locationPart)
    .find(Boolean) || null;
  const landmark = namedPlace && normalizePlace(namedPlace) !== normalizePlace(road || '') ? namedPlace : null;
  const placeCandidates = [
    address.barangay,
    address.quarter,
    address.suburb,
    address.city_district,
    address.village,
    address.neighbourhood,
    address.hamlet,
    address.residential,
  ].map(locationPart).filter(Boolean);
  const knownBarangayByName = new Map(barangayNames
    .filter(Boolean)
    .map((name) => [normalizePlace(name), name]));
  const matchedBarangay = placeCandidates
    .map((candidate) => knownBarangayByName.get(normalizePlace(candidate)))
    .find(Boolean) || null;
  const locality = matchedBarangay || fallbackBarangayName?.trim() || placeCandidates[0] || null;
  const municipality = locationPart(address.municipality) || locationPart(address.town) ||
    locationPart(address.city) || locationPart(address.county) || 'Norzagaray';
  const province = locationPart(address.province) || locationPart(address.state_district) ||
    locationPart(address.state) || 'Bulacan';
  const label = [...new Set([locality, municipality, province].filter(Boolean))].join(', ');

  return label ? {
    label,
    barangayName: matchedBarangay || fallbackBarangayName?.trim() || null,
    road,
    landmark,
  } : null;
}
