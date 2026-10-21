import { createHmac } from 'crypto';
import { config } from '../config';
import { redis } from '../config/redis';

const RATE_WINDOW_SECONDS = 5 * 60;
const DUPLICATE_COOLDOWN_SECONDS = 2 * 60;
const LIMITS = {
  account: 10,
  phone: 10,
  ip: 40,
} as const;

const checkReportSubmissionScript = redis?.createScript<[number, string, number]>(`
local identityCount = tonumber(ARGV[1])
local cooldownSeconds = tonumber(ARGV[2])
local windowSeconds = tonumber(ARGV[3])

for i = 1, identityCount do
  local ttl = tonumber(redis.call('TTL', KEYS[i]))
  if ttl and ttl > 0 then
    return {0, 'duplicate', ttl}
  end
end

for i = 1, identityCount do
  local bucketKey = KEYS[identityCount + i]
  local currentCount = tonumber(redis.call('GET', bucketKey) or '0')
  local limit = tonumber(ARGV[3 + i])
  if currentCount >= limit then
    local ttl = tonumber(redis.call('TTL', bucketKey)) or 1
    return {0, 'rate_limit', math.max(ttl, 1)}
  end
end

for i = 1, identityCount do
  local bucketKey = KEYS[identityCount + i]
  local count = redis.call('INCR', bucketKey)
  if count == 1 then
    redis.call('EXPIRE', bucketKey, windowSeconds)
  end
  redis.call('SET', KEYS[i], '1', 'EX', cooldownSeconds)
end

return {1, 'allowed', 0}
`);

type IdentityKind = keyof typeof LIMITS;
type RateIdentity = { kind: IdentityKind; value: string; limit: number };
type MemoryEntry = { count: number; expiresAt: number };
type RateLimitResult = {
  allowed: boolean;
  reason?: 'duplicate' | 'rate_limit';
  retryAfterSeconds?: number;
};

const memoryCounterStore = new Map<string, MemoryEntry>();
const memoryCooldownStore = new Map<string, number>();
let redisRateLimitUnavailable = false;
let memoryOperationCount = 0;

function privateHash(value: string): string {
  return createHmac('sha256', config.jwtSecret).update(value).digest('hex');
}

function normalizedText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, maxLength)
    : '';
}

function buildRateIdentities(input: {
  accountId?: string | null;
  phone?: string | null;
  ip: string;
}): RateIdentity[] {
  const identities: RateIdentity[] = [];
  const accountId = input.accountId?.trim();
  const phone = input.phone?.replace(/\D/g, '');
  const ip = input.ip.trim().toLowerCase();

  if (accountId) identities.push({ kind: 'account', value: privateHash(`account:${accountId}`), limit: LIMITS.account });
  if (phone) identities.push({ kind: 'phone', value: privateHash(`phone:${phone}`), limit: LIMITS.phone });
  if (ip) identities.push({ kind: 'ip', value: privateHash(`ip:${ip}`), limit: LIMITS.ip });
  return identities;
}

function checkMemoryLimits(cooldownKeys: string[], identities: RateIdentity[]): RateLimitResult {
  const now = Date.now();
  memoryOperationCount += 1;

  if (memoryOperationCount % 256 === 0 || memoryCounterStore.size + memoryCooldownStore.size > 20_000) {
    for (const [key, entry] of memoryCounterStore) {
      if (entry.expiresAt <= now) memoryCounterStore.delete(key);
    }
    for (const [key, expiresAt] of memoryCooldownStore) {
      if (expiresAt <= now) memoryCooldownStore.delete(key);
    }
  }

  for (const key of cooldownKeys) {
    const expiresAt = memoryCooldownStore.get(key) || 0;
    if (expiresAt > now) {
      return { allowed: false, reason: 'duplicate', retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - now) / 1000)) };
    }
  }

  for (const identity of identities) {
    const key = `report-rate:${identity.kind}:${identity.value}`;
    const entry = memoryCounterStore.get(key);
    const current = entry && entry.expiresAt > now ? entry.count : 0;
    if (current >= identity.limit) {
      return { allowed: false, reason: 'rate_limit', retryAfterSeconds: Math.max(1, Math.ceil(((entry?.expiresAt || now + 1000) - now) / 1000)) };
    }
  }

  for (const identity of identities) {
    const key = `report-rate:${identity.kind}:${identity.value}`;
    const entry = memoryCounterStore.get(key);
    if (!entry || entry.expiresAt <= now) {
      memoryCounterStore.set(key, { count: 1, expiresAt: now + RATE_WINDOW_SECONDS * 1000 });
    } else {
      entry.count += 1;
    }
  }
  for (const key of cooldownKeys) {
    memoryCooldownStore.set(key, now + DUPLICATE_COOLDOWN_SECONDS * 1000);
  }
  return { allowed: true };
}

export async function checkReportSubmissionRateLimit(input: {
  accountId?: string | null;
  phone?: string | null;
  ip: string;
  incident: {
    type: unknown;
    category: unknown;
    title: unknown;
    specifics: unknown;
    description: unknown;
    latitude: number;
    longitude: number;
  };
}): Promise<RateLimitResult> {
  const identities = buildRateIdentities(input);
  const incidentFingerprint = privateHash([
    normalizedText(input.incident.type, 40),
    normalizedText(input.incident.category, 60),
    normalizedText(input.incident.title, 160),
    normalizedText(input.incident.specifics, 300),
    normalizedText(input.incident.description, 600),
    input.incident.latitude.toFixed(4),
    input.incident.longitude.toFixed(4),
  ].join('|'));
  const cooldownKeys = identities.map((identity) =>
    `report-submit:cooldown:${identity.kind}:${identity.value}:${incidentFingerprint}`);

  if (checkReportSubmissionScript && !redisRateLimitUnavailable) {
    const counterKeys = identities.map((identity) => `report-submit:window:${identity.kind}:${identity.value}`);
    try {
      const result = await checkReportSubmissionScript.eval(
        [...cooldownKeys, ...counterKeys],
        [
          String(identities.length),
          String(DUPLICATE_COOLDOWN_SECONDS),
          String(RATE_WINDOW_SECONDS),
          ...identities.map((identity) => String(identity.limit)),
        ],
      );
      const [allowed, reason, retryAfterSeconds] = result;
      if (allowed === 1) return { allowed: true };
      return {
        allowed: false,
        reason: reason === 'duplicate' ? 'duplicate' : 'rate_limit',
        retryAfterSeconds: Math.max(1, Number(retryAfterSeconds) || 1),
      };
    } catch (error) {
      redisRateLimitUnavailable = true;
      console.warn('Report rate-limit Redis is unavailable; using an in-memory fallback for this process.', error);
    }
  }

  return checkMemoryLimits(cooldownKeys, identities);
}
