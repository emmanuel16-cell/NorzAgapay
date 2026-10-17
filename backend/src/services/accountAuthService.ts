import { randomUUID, createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';

export type AccountTable = 'users' | 'barangay_users' | 'resident_user';
export type AccountRef = { table: AccountTable; id: string };
export type PhoneAccount = AccountRef & {
  id: string;
  phone: string;
  password_hash: string;
  [key: string]: any;
};

const accountTables: AccountTable[] = ['users', 'barangay_users', 'resident_user'];
const releaseLockScript = redis?.createScript<number>(
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
) ?? null;
const localLockTails = new Map<string, Promise<void>>();

export class PasswordReuseError extends Error {
  constructor() {
    super('Choose a password different from the password used by your other account with this mobile number.');
    this.name = 'PasswordReuseError';
  }
}

export class PhoneAccountLockError extends Error {
  constructor() {
    super('Account update is temporarily busy. Please try again.');
    this.name = 'PhoneAccountLockError';
  }
}

export async function getAccountsForPhone(phone: string): Promise<PhoneAccount[]> {
  const results = await Promise.all(accountTables.map(async (table) => {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('id, phone, password_hash')
      .eq('phone', phone)
      .maybeSingle();
    if (error) throw error;
    return data ? [{ ...data, id: String(data.id), table } as PhoneAccount] : [];
  }));
  return results.flat();
}

export async function hasPasswordReuseForPhone(
  phone: string,
  password: string,
  targetTable: AccountTable,
  exclude?: AccountRef,
): Promise<boolean> {
  const candidates = await getAccountsForPhone(phone);
  for (const candidate of candidates) {
    if (candidate.table === targetTable) continue;
    if (exclude && candidate.table === exclude.table && candidate.id === exclude.id) continue;
    if (await bcrypt.compare(password, candidate.password_hash)) return true;
  }
  return false;
}

export async function countPasswordMatchesForPhone(phone: string, password: string): Promise<number> {
  const candidates = await getAccountsForPhone(phone);
  let matches = 0;
  for (const candidate of candidates) {
    if (await bcrypt.compare(password, candidate.password_hash)) matches += 1;
  }
  return matches;
}

export async function withPhoneAccountLock<T>(phone: string, action: () => Promise<T>): Promise<T> {
  const digest = createHash('sha256').update(phone).digest('hex');
  const key = `account-phone-write:${digest}`;

  if (redis && releaseLockScript) {
    const token = randomUUID();
    let acquired = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const result = await redis.set(key, token, { nx: true, ex: 300 });
        if (result === 'OK') { acquired = true; break; }
      } catch {
        throw new PhoneAccountLockError();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!acquired) throw new PhoneAccountLockError();

    try {
      return await action();
    } finally {
      try {
        await releaseLockScript.exec([key], [token]);
      } catch {
        // The lock expires automatically; never replace the operation result
        // with a release failure or delete a lock owned by another request.
      }
    }
  }

  if (process.env.NODE_ENV === 'production') throw new PhoneAccountLockError();
  const previous = localLockTails.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  localLockTails.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (localLockTails.get(key) === tail) localLockTails.delete(key);
  }
}

export async function hasPhoneInAccountType(
  phone: string,
  table: AccountTable,
  excludeAccountId?: string,
): Promise<boolean> {
  let query = supabaseAdmin.from(table).select('id').eq('phone', phone).limit(1);
  if (excludeAccountId) query = query.neq('id', excludeAccountId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

