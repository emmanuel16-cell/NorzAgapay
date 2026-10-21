type ReverseGeocodeResult = {
  address?: Record<string, unknown>;
  display_name?: string;
  name?: string;
  featureLatitude?: number;
  featureLongitude?: number;
};
type PhotonReverseGeocodePayload = {
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: { coordinates?: unknown };
  }>;
};

export type ResolvedIncidentLocation = {
  label: string;
  barangayName: string | null;
  road: string | null;
  landmark: string | null;
  landmarkDistanceMeters: number | null;
};

type NearbyLandmark = { name: string; distanceMeters: number };
type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

export interface HospitalLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distance_meters: number;
}

const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1000;
const overpassEndpoints = [...new Set([
  process.env.OVERPASS_API_URL,
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
].filter((endpoint): endpoint is string => Boolean(endpoint)))];
const resultCache = new Map<string, { value: ReverseGeocodeResult | null; expiresAt: number }>();
const pendingLookups = new Map<string, Promise<ReverseGeocodeResult | null>>();
const landmarkCache = new Map<string, { value: NearbyLandmark | null; expiresAt: number }>();
const pendingLandmarkLookups = new Map<string, Promise<NearbyLandmark | null>>();
const hospitalCache = new Map<string, { value: HospitalLocation[]; expiresAt: number }>();
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
      if (!response.ok) {
        console.warn(`Nominatim reverse geocode returned HTTP ${response.status}.`);
        return null;
      }
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

async function fetchPhotonReverseGeocode(latitude: number, longitude: number, key: string): Promise<ReverseGeocodeResult | null> {
  const cacheKey = `photon:${key}`;
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = pendingLookups.get(cacheKey);
  if (pending) return pending;

  const lookup = requestQueue.then(async () => {
    const waitMs = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const url = new URL('https://photon.komoot.io/reverse');
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    url.searchParams.set('lang', 'en');
    url.searchParams.set('limit', '1');
    lastRequestAt = Date.now();

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NorzAgapay/1.0 (incident location lookup)',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        console.warn(`Photon reverse geocode returned HTTP ${response.status}.`);
        return null;
      }

      const payload = await response.json() as PhotonReverseGeocodePayload;
      const feature = payload.features?.[0];
      if (!feature?.properties) return null;
      const properties = feature.properties;
      const name = locationPart(properties.name);
      const street = locationPart(properties.street);
      const coordinates = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : [];
      const featureLongitude = Number(coordinates[0]);
      const featureLatitude = Number(coordinates[1]);
      const osmKey = locationPart(properties.osm_key);
      const address: Record<string, unknown> = {
        road: street,
        neighbourhood: properties.locality,
        quarter: properties.district,
        town: properties.city,
        province: properties.state,
      };
      if (name && osmKey) address[osmKey] = name;

      return {
        name: name || undefined,
        display_name: [name, street, properties.locality, properties.city, properties.state]
          .map(locationPart).filter(Boolean).join(', '),
        address,
        featureLatitude: Number.isFinite(featureLatitude) ? featureLatitude : undefined,
        featureLongitude: Number.isFinite(featureLongitude) ? featureLongitude : undefined,
      };
    } catch (error) {
      console.warn('Could not use Photon as a reverse-geocoding fallback:', error);
      return null;
    }
  });

  requestQueue = lookup.then(() => undefined, () => undefined);
  pendingLookups.set(cacheKey, lookup);
  try {
    const result = await lookup;
    resultCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + (result ? RESULT_TTL_MS : FAILURE_TTL_MS),
    });
    return result;
  } finally {
    pendingLookups.delete(cacheKey);
  }
}

function distanceMeters(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const arc = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(fromLatitude)) * Math.cos(toRadians(toLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

async function fetchNearbyLandmark(latitude: number, longitude: number, key: string, road: string | null): Promise<NearbyLandmark | null> {
  const cached = landmarkCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = pendingLandmarkLookups.get(key);
  if (pending) return pending;

  const lookup = requestQueue.then(async () => {
    const waitMs = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const selectors = ['amenity', 'shop', 'tourism', 'leisure', 'healthcare', 'office', 'historic', 'craft', 'building', 'man_made'];
    const selectorQuery = selectors.map((tag) => `nwr(around:150,${latitude},${longitude})["name"]["${tag}"];`).join('');
    const query = `[out:json][timeout:4];(${selectorQuery});out center tags 50;`;
    const body = new URLSearchParams({ data: query });
    lastRequestAt = Date.now();

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'NorzAgapay/1.0 (incident location lookup)',
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const payload = await response.json() as { elements?: OverpassElement[] };
      const normalizedRoad = normalizePlace(road || '');
      const candidates = (payload.elements || []).flatMap((element) => {
        const name = locationPart(element.tags?.name);
        const featureLatitude = Number(element.lat ?? element.center?.lat);
        const featureLongitude = Number(element.lon ?? element.center?.lon);
        if (!name || normalizePlace(name) === normalizedRoad ||
            !Number.isFinite(featureLatitude) || !Number.isFinite(featureLongitude)) return [];
        const distance = distanceMeters(latitude, longitude, featureLatitude, featureLongitude);
        return distance <= 150 ? [{ name, distanceMeters: Math.round(distance) }] : [];
      });
      candidates.sort((first, second) => first.distanceMeters - second.distanceMeters);
      return candidates[0] || null;
    } catch (error) {
      console.warn('Could not find nearby incident landmarks:', error);
      return null;
    }
  });

  requestQueue = lookup.then(() => undefined, () => undefined);
  pendingLandmarkLookups.set(key, lookup);
  try {
    const landmark = await lookup;
    landmarkCache.set(key, {
      value: landmark,
      expiresAt: Date.now() + (landmark ? RESULT_TTL_MS : FAILURE_TTL_MS),
    });
    return landmark;
  } finally {
    pendingLandmarkLookups.delete(key);
  }
}

export async function resolveIncidentLocation(
  latitude: number,
  longitude: number,
  barangayNames: string[],
  fallbackBarangayName?: string | null,
  includeNearbyLandmark = false,
): Promise<ResolvedIncidentLocation | null> {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  let result = await fetchReverseGeocode(latitude, longitude, key);
  let address = result?.address || {};
  let road = [address.road, address.street, address.residential, address.pedestrian, address.path, address.footway, address.service]
    .map(locationPart)
    .find(Boolean) || null;
  let namedPlace = locationPart(result?.name) || [address.building, address.amenity, address.shop, address.tourism, address.leisure]
    .map(locationPart)
    .find(Boolean) || null;
  let landmark = namedPlace && normalizePlace(namedPlace) !== normalizePlace(road || '') ? namedPlace : null;
  let landmarkDistanceMeters: number | null = null;

  // Nominatim can be temporarily unavailable or return only a road. Photon
  // often has a nearby named business/building for the same OSM coordinates.
  if (!result || !road || (includeNearbyLandmark && !landmark)) {
    const fallback = await fetchPhotonReverseGeocode(latitude, longitude, key);
    if (fallback) {
      const fallbackAddress = fallback.address || {};
      road ||= [fallbackAddress.road, fallbackAddress.street, fallbackAddress.residential,
        fallbackAddress.pedestrian, fallbackAddress.path, fallbackAddress.footway, fallbackAddress.service]
        .map(locationPart).find(Boolean) || null;
      if (!landmark) {
        const fallbackName = locationPart(fallback.name) || [fallbackAddress.building, fallbackAddress.amenity,
          fallbackAddress.shop, fallbackAddress.tourism, fallbackAddress.leisure]
          .map(locationPart).find(Boolean) || null;
        if (fallbackName && normalizePlace(fallbackName) !== normalizePlace(road || '')) {
          const distance = fallback.featureLatitude != null && fallback.featureLongitude != null
            ? distanceMeters(latitude, longitude, fallback.featureLatitude, fallback.featureLongitude)
            : null;
          if (distance == null || distance <= 150) {
            landmark = fallbackName;
            landmarkDistanceMeters = distance == null ? null : Math.round(distance);
          }
        }
      }
      if (!result) result = fallback;
    }
  }

  if (!result && !road && !landmark) return null;
  address = result?.address || {};
  if (!landmark && includeNearbyLandmark) {
    const nearbyLandmark = await fetchNearbyLandmark(latitude, longitude, key, road);
    if (nearbyLandmark) {
      landmark = nearbyLandmark.name;
      landmarkDistanceMeters = nearbyLandmark.distanceMeters;
    }
  }
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
    landmarkDistanceMeters,
  } : null;
}

function validCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && !(latitude === 0 && longitude === 0);
}

function hospitalAddress(tags: Record<string, string> = {}): string {
  const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'] || tags['addr:quarter'],
    tags['addr:city'] || tags['addr:town'] || tags['addr:village'], tags['addr:state']]
    .map(locationPart).filter(Boolean).join(', ');
  return (address || 'Address not listed in OpenStreetMap').slice(0, 300);
}

async function queuedRequest(url: string, init: RequestInit): Promise<Response> {
  const request = requestQueue.then(async () => {
    const waitMs = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestAt = Date.now();
    return fetch(url, init);
  });
  requestQueue = request.then(() => undefined, () => undefined);
  return request;
}

export async function findNearbyHospitals(latitude: number, longitude: number): Promise<HospitalLocation[]> {
  if (!validCoordinates(latitude, longitude)) return [];
  const cacheKey = `nearby-hospitals:${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = hospitalCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const query = `[out:json][timeout:10];(nwr(around:50000,${latitude},${longitude})["amenity"="hospital"];nwr(around:50000,${latitude},${longitude})["healthcare"="hospital"];);out center tags 250;`;
  const failures: string[] = [];
  for (const endpoint of overpassEndpoints) {
    try {
      const response = await queuedRequest(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'NorzAgapay/1.0 (hospital lookup)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { elements?: OverpassElement[] };
      if (!Array.isArray(payload.elements)) throw new Error('The provider returned an invalid response.');
      const unique = new Map<string, HospitalLocation>();
      for (const element of payload.elements) {
        const tags = element.tags || {};
        const name = (locationPart(tags.name) || locationPart(tags['name:en'])).slice(0, 180);
        const pointLatitude = Number(element.lat ?? element.center?.lat);
        const pointLongitude = Number(element.lon ?? element.center?.lon);
        if (!name || !validCoordinates(pointLatitude, pointLongitude)) continue;
        const distance = Math.round(distanceMeters(latitude, longitude, pointLatitude, pointLongitude));
        const item = { name, address: hospitalAddress(tags), latitude: pointLatitude, longitude: pointLongitude, distance_meters: distance };
        const key = `${normalizePlace(name)}:${pointLatitude.toFixed(4)},${pointLongitude.toFixed(4)}`;
        unique.set(key, item);
      }
      const hospitals = [...unique.values()].sort((first, second) => first.distance_meters - second.distance_meters).slice(0, 10);
      hospitalCache.set(cacheKey, { value: hospitals, expiresAt: Date.now() + 10 * 60 * 1000 });
      return hospitals;
    } catch (error: any) {
      const provider = new URL(endpoint).host;
      failures.push(`${provider}: ${error?.message || 'request failed'}`);
      console.warn(`Could not load nearby hospitals from ${provider}:`, error);
    }
  }
  throw new Error(`All nearby OpenStreetMap hospital providers failed. ${failures.join('; ')}`);
}

export async function searchHospitalsByName(queryValue: string, latitude: number, longitude: number): Promise<HospitalLocation[]> {
  const query = queryValue.trim().slice(0, 120);
  if (!query || !validCoordinates(latitude, longitude)) return [];
  const cacheKey = `hospital-search:${normalizePlace(query)}:${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = hospitalCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', `${query}, Bulacan, Philippines`);
  url.searchParams.set('countrycodes', 'ph');
  url.searchParams.set('limit', '10');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('viewbox', `${longitude - 0.8},${latitude + 0.8},${longitude + 0.8},${latitude - 0.8}`);
  url.searchParams.set('bounded', '0');
  try {
    const response = await queuedRequest(url.toString(), {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'NorzAgapay/1.0 (hospital name search)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`OpenStreetMap name search returned HTTP ${response.status}.`);
    const payload = await response.json() as Array<{ display_name?: string; name?: string; lat?: string; lon?: string; address?: Record<string, string> }>;
    const unique = new Map<string, HospitalLocation>();
    for (const result of payload) {
      const pointLatitude = Number(result.lat);
      const pointLongitude = Number(result.lon);
      if (!validCoordinates(pointLatitude, pointLongitude)) continue;
      const name = (locationPart(result.name) || locationPart(result.display_name).split(',')[0]).slice(0, 180);
      if (!name) continue;
      const address = (locationPart(result.display_name) || hospitalAddress(result.address)).slice(0, 300);
      const distance = Math.round(distanceMeters(latitude, longitude, pointLatitude, pointLongitude));
      const item = { name, address, latitude: pointLatitude, longitude: pointLongitude, distance_meters: distance };
      unique.set(`${normalizePlace(name)}:${pointLatitude.toFixed(4)},${pointLongitude.toFixed(4)}`, item);
    }
    const hospitals = [...unique.values()].sort((first, second) => first.distance_meters - second.distance_meters).slice(0, 10);
    hospitalCache.set(cacheKey, { value: hospitals, expiresAt: Date.now() + 5 * 60 * 1000 });
    return hospitals;
  } catch (error) {
    console.warn('Could not search OpenStreetMap for the entered hospital:', error);
    throw error;
  }
}
