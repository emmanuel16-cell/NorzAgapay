export interface BarangayLocation {
  id: string;
  name?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  location_latitude?: number | string | null;
  location_longitude?: number | string | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function validPair(latitude: unknown, longitude: unknown): Coordinates | null {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined ||
      !Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90 ||
      !Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
    return null;
  }
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

export function getBarangayCoordinates(barangay: BarangayLocation): Coordinates | null {
  return validPair(barangay.location_latitude, barangay.location_longitude) ||
    validPair(barangay.latitude, barangay.longitude);
}

export function distanceMeters(from: Coordinates, to: Coordinates): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (to.latitude - from.latitude) * radians;
  const longitudeDelta = (to.longitude - from.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function getNearestBarangay<T extends BarangayLocation>(
  origin: Coordinates,
  barangays: T[],
): (T & { distance_meters: number }) | null {
  let nearest: (T & { distance_meters: number }) | null = null;
  for (const barangay of barangays) {
    const coordinates = getBarangayCoordinates(barangay);
    if (!coordinates) continue;
    const distance = distanceMeters(origin, coordinates);
    if (!nearest || distance < nearest.distance_meters) {
      nearest = { ...barangay, distance_meters: distance };
    }
  }
  return nearest;
}
