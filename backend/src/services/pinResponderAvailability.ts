import { RESPONDER_GPS_TTL_SECONDS } from '../config/redis';
import type { ResponderGpsLocation } from '../config/redis';
import { ARRIVAL_RADIUS_METERS, distanceMeters, MAX_FUTURE_FIX_SKEW_MS } from './arrivalValidation';

export interface CommandLocationPoint {
  latitude: number;
  longitude: number;
}

function isValidPoint(point: CommandLocationPoint): boolean {
  return Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 &&
    Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
}

export async function getRespondersWithinCommandLocation<T extends { id: string }>(
  responders: T[],
  location: CommandLocationPoint,
  getLocation: (responderId: string) => Promise<ResponderGpsLocation | null>,
  now = Date.now(),
): Promise<T[]> {
  if (!isValidPoint(location) || responders.length === 0) return [];

  const freshAfter = now - RESPONDER_GPS_TTL_SECONDS * 1000;
  const latestAllowed = now + MAX_FUTURE_FIX_SKEW_MS;
  const locations = await Promise.all(responders.map(async (responder) => {
    try {
      return [responder.id, await getLocation(responder.id)] as const;
    } catch (error) {
      console.error('Could not read responder GPS for command-location availability:', error);
      return [responder.id, null] as const;
    }
  }));

  const locationByResponder = new Map(locations);
  return responders.filter((responder) => {
    const gps = locationByResponder.get(responder.id);
    if (!gps || !isValidPoint(gps)) return false;
    const fixAt = Date.parse(gps.timestamp);
    if (!Number.isFinite(fixAt) || fixAt < freshAfter || fixAt > latestAllowed) return false;
    return distanceMeters(location.latitude, location.longitude, gps.latitude, gps.longitude) <= ARRIVAL_RADIUS_METERS;
  });
}
