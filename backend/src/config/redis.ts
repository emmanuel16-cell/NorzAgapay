import { Redis } from '@upstash/redis';
import { config } from '../config';

export const redis = new Redis({
  url: config.upstashRedisUrl,
  token: config.upstashRedisToken,
});

// GPS location key pattern: gps:<userId>
export const GPS_KEY_PREFIX = 'gps:';
export const GPS_TTL_SECONDS = 1800; // 30 minutes

export interface GPSLocation {
  userId: string;
  latitude: number;
  longitude: number;
  timestamp: number;
}

export async function setUserGPS(userId: string, lat: number, lng: number): Promise<void> {
  const key = `${GPS_KEY_PREFIX}${userId}`;
  const data: GPSLocation = {
    userId,
    latitude: lat,
    longitude: lng,
    timestamp: Date.now(),
  };
  await redis.set(key, JSON.stringify(data), { ex: GPS_TTL_SECONDS });
}

export async function getUserGPS(userId: string): Promise<GPSLocation | null> {
  const key = `${GPS_KEY_PREFIX}${userId}`;
  const data = await redis.get<string>(key);
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data as unknown as GPSLocation;
}

export async function getAllActiveGPS(): Promise<GPSLocation[]> {
  const keys = await redis.keys(`${GPS_KEY_PREFIX}*`);
  if (keys.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.get(key);
  }
  const results = await pipeline.exec();

  return results
    .filter((r): r is string => r !== null)
    .map((r) => (typeof r === 'string' ? JSON.parse(r) : r as unknown as GPSLocation));
}
