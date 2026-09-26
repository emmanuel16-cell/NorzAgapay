import { Redis } from '@upstash/redis';
import { config } from '../config';

// Initialize Redis client only if credentials look somewhat valid
let redisClient: Redis | null = null;
if (config.upstashRedisUrl && config.upstashRedisToken) {
  try {
    redisClient = new Redis({
      url: config.upstashRedisUrl,
      token: config.upstashRedisToken,
    });
  } catch (err: any) {
    console.warn('[Redis] Failed to initialize Redis client; falling back to in-memory storage:', err.message);
    redisClient = null;
  }
}

function disableRedis(reason: string) {
  if (redisClient) {
    console.warn(`[Redis] Connection failed (${reason}). Disabling Redis for this process and switching to fast in-memory store.`);
    redisClient = null;
  }
}

// Fallback in-memory stores (used if Redis is offline, expired, or unconfigured)
const memoryOtpStore = new Map<string, { data: ResidentOtpRecord; expiresAt: number }>();
const memoryGpsStore = new Map<string, { data: GPSLocation; expiresAt: number }>();

export const redis = redisClient;

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

  if (redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(data), { ex: GPS_TTL_SECONDS });
      return;
    } catch (err: any) {
      disableRedis(err.message);
    }
  }

  memoryGpsStore.set(key, {
    data,
    expiresAt: Date.now() + GPS_TTL_SECONDS * 1000,
  });
}

export async function getUserGPS(userId: string): Promise<GPSLocation | null> {
  const key = `${GPS_KEY_PREFIX}${userId}`;

  if (redisClient) {
    try {
      const data = await redisClient.get<string>(key);
      if (data) {
        return typeof data === 'string' ? JSON.parse(data) : (data as unknown as GPSLocation);
      }
    } catch (err: any) {
      disableRedis(err.message);
    }
  }

  const entry = memoryGpsStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryGpsStore.delete(key);
    return null;
  }
  return entry.data;
}

export async function getAllActiveGPS(): Promise<GPSLocation[]> {
  if (redisClient) {
    try {
      const keys = await redisClient.keys(`${GPS_KEY_PREFIX}*`);
      if (keys.length > 0) {
        const pipeline = redisClient.pipeline();
        for (const key of keys) {
          pipeline.get(key);
        }
        const results = await pipeline.exec();
        return results
          .filter((r): r is string => r !== null)
          .map((r) => (typeof r === 'string' ? JSON.parse(r) : (r as unknown as GPSLocation)));
      }
      return [];
    } catch (err: any) {
      disableRedis(err.message);
    }
  }

  const now = Date.now();
  const list: GPSLocation[] = [];
  for (const [key, entry] of memoryGpsStore.entries()) {
    if (now > entry.expiresAt) {
      memoryGpsStore.delete(key);
    } else {
      list.push(entry.data);
    }
  }
  return list;
}

// ── OTP Helpers ───────────────────────────────────────────────────────────────
// Key pattern: otp:<email>
// TTL: 10 minutes (600 seconds)

export const OTP_KEY_PREFIX = 'otp:';
export const OTP_TTL_SECONDS = 600; // 10 minutes

export interface ResidentOtpRecord {
  otp: string;
  fullName?: string;
  contactNumber?: string;
  barangayName?: string;
  barangayId?: string;
  purpose: 'registration' | 'password_change';
}

/**
 * Store an OTP record. Tries Redis first; automatically falls back to in-memory store.
 */
export async function setOtp(email: string, record: ResidentOtpRecord): Promise<void> {
  const key = `${OTP_KEY_PREFIX}${email.toLowerCase().trim()}`;

  if (redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(record), { ex: OTP_TTL_SECONDS });
      return;
    } catch (err: any) {
      disableRedis(err.message);
    }
  }

  memoryOtpStore.set(key, {
    data: record,
    expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
  });
}

/**
 * Retrieve an OTP record. Tries Redis first; falls back to in-memory store.
 */
export async function getOtp(email: string): Promise<ResidentOtpRecord | null> {
  const key = `${OTP_KEY_PREFIX}${email.toLowerCase().trim()}`;

  if (redisClient) {
    try {
      const raw = await redisClient.get<string>(key);
      if (raw) {
        return typeof raw === 'string' ? JSON.parse(raw) : (raw as unknown as ResidentOtpRecord);
      }
    } catch (err: any) {
      disableRedis(err.message);
    }
  }

  const entry = memoryOtpStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryOtpStore.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Delete an OTP record after verification.
 */
export async function deleteOtp(email: string): Promise<void> {
  const key = `${OTP_KEY_PREFIX}${email.toLowerCase().trim()}`;

  if (redisClient) {
    try {
      await redisClient.del(key);
    } catch (err: any) {
      disableRedis(err.message);
    }
  }

  memoryOtpStore.delete(key);
}
