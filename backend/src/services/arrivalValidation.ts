export const ARRIVAL_RADIUS_METERS = 100;
export const MAX_ARRIVAL_ACCURACY_METERS = 50;
export const MAX_ARRIVAL_FIX_AGE_MS = 30_000;
export const MAX_FUTURE_FIX_SKEW_MS = 5_000;

export function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) *
    Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type ArrivalFix = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  fixAt: Date;
};

export function validateRecentGpsFix(
  fix: ArrivalFix,
  now = new Date(),
): { valid: true } | { valid: false; error: string } {
  if (!Number.isFinite(fix.accuracyM) || fix.accuracyM < 0 || fix.accuracyM > MAX_ARRIVAL_ACCURACY_METERS) {
    return { valid: false, error: 'GPS accuracy must be 50 meters or better.' };
  }
  if (!Number.isFinite(fix.fixAt.getTime())) {
    return { valid: false, error: 'GPS fix time is invalid.' };
  }
  const ageMs = now.getTime() - fix.fixAt.getTime();
  if (ageMs < -MAX_FUTURE_FIX_SKEW_MS || ageMs > MAX_ARRIVAL_FIX_AGE_MS) {
    return { valid: false, error: 'The GPS reading is stale.' };
  }
  return { valid: true };
}

export function validateArrivalFix(
  incidentLatitude: number,
  incidentLongitude: number,
  fix: ArrivalFix,
  now = new Date(),
): { valid: true; distanceM: number } | { valid: false; distanceM: number; error: string } {
  const distanceM = distanceMeters(
    incidentLatitude,
    incidentLongitude,
    fix.latitude,
    fix.longitude,
  );
  const recentFix = validateRecentGpsFix(fix, now);
  if (!recentFix.valid) {
    return {
      valid: false,
      distanceM,
      error: `${recentFix.error} Refresh your location or mark arrival manually.`,
    };
  }
  if (distanceM > ARRIVAL_RADIUS_METERS) {
    return { valid: false, distanceM, error: 'GPS does not confirm arrival within the 100-meter incident area. Refresh your location or mark arrival manually.' };
  }
  return { valid: true, distanceM };
}
