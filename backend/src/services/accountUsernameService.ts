import { supabaseAdmin } from '../config/supabase';

export type UsernameAccountTable = 'users' | 'barangay_users' | 'resident_user';

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return /^[a-z0-9_.-]{3,32}$/.test(normalizeUsername(value));
}

export async function isUsernameTaken(
  username: string,
  currentAccount?: { table: UsernameAccountTable; id: string },
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('account_usernames')
    .select('account_table, account_id')
    .eq('username_normalized', normalizeUsername(username))
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return !currentAccount || data.account_table !== currentAccount.table || data.account_id !== currentAccount.id;
}

export function isGlobalUsernameConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string; constraint?: string };
  if (candidate.code !== '23505') return false;
  const description = [candidate.message, candidate.details, candidate.constraint].filter(Boolean).join(' ').toLowerCase();
  return description.includes('account_usernames') || description.includes('username_normalized');
}
