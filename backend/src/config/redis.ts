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
const memoryResponderGpsStore = new Map<string, { data: ResponderGpsLocation; expiresAt: number }>();

export const redis = redisClient;

// ── OTP Helpers ───────────────────────────────────────────────────────────────
// Key pattern: otp:<email>
// TTL: 10 minutes (600 seconds)

export const OTP_KEY_PREFIX = 'otp:';
export const OTP_TTL_SECONDS = 600; // 10 minutes

// Responder locations are short-lived operational telemetry, never persisted to users.
export const RESPONDER_GPS_KEY_PREFIX = 'responder-live:';
export const RESPONDER_GPS_TTL_SECONDS = 30;

export interface ResponderGpsLocation {
  latitude: number;
  longitude: number;
  timestamp: string;
}

export async function setResponderGpsLocation(userId: string, location: ResponderGpsLocation): Promise<void> {
  const key = `${RESPONDER_GPS_KEY_PREFIX}${userId}`;
  if (redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(location), { ex: RESPONDER_GPS_TTL_SECONDS });
    } catch (err: any) {
      disableRedis(err.message);
    }
  }
  memoryResponderGpsStore.set(key, {
    data: location,
    expiresAt: Date.now() + RESPONDER_GPS_TTL_SECONDS * 1000,
  });
}

export async function getResponderGpsLocation(userId: string): Promise<ResponderGpsLocation | null> {
  const key = `${RESPONDER_GPS_KEY_PREFIX}${userId}`;
  if (redisClient) {
    try {
      const raw = await redisClient.get<string>(key);
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as ResponderGpsLocation;
    } catch (err: any) {
      disableRedis(err.message);
    }
  }
  const entry = memoryResponderGpsStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryResponderGpsStore.delete(key);
    return null;
  }
  return entry.data;
}

export async function deleteResponderGpsLocation(userId: string): Promise<void> {
  const key = `${RESPONDER_GPS_KEY_PREFIX}${userId}`;
  if (redisClient) {
    try {
      await redisClient.del(key);
    } catch (err: any) {
      disableRedis(err.message);
    }
  }
  memoryResponderGpsStore.delete(key);
}

export interface ResidentOtpRecord {
  otp: string;
  fullName?: string;
  contactNumber?: string;
  barangayName?: string;
  barangayId?: string;
  deliveryMethod?: 'email' | 'sms';
  positionDesignation?: string;
  purpose:
    | 'registration'
    | 'password_change'
    | 'barangay_password_change'
    | 'barangay_registration'
    | 'resident_password_reset'
    | 'barangay_password_reset'
    | 'responder_password_reset';
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
