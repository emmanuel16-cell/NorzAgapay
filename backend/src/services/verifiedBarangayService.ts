import { supabaseAdmin } from '../config/supabase';

/** Barangays with an MDRRMO-approved, active Barangay Account Request. */
export async function getVerifiedBarangayIds(): Promise<string[]> {
  const { data: admins, error: adminError } = await supabaseAdmin
    .from('barangay_users')
    .select('id, barangay_id')
    .eq('role', 'admin')
    .eq('is_active', true);
  if (adminError) throw adminError;
  const adminIds = (admins || []).map((admin: any) => admin.id).filter(Boolean);
  if (adminIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('barangay_dispatcher_verifications')
    .select('user_id, barangay_id, status, is_active, updated_at, created_at, id')
    .in('user_id', adminIds)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) throw error;
  const latestByBarangay = new Map<string, { status: string; is_active: boolean }>();
  for (const row of data || []) {
    if (!row.barangay_id || latestByBarangay.has(row.barangay_id)) continue;
    latestByBarangay.set(row.barangay_id, { status: row.status, is_active: row.is_active !== false });
  }
  return [...latestByBarangay.entries()]
    .filter(([, request]) => request.status === 'verified' && request.is_active)
    .map(([id]) => id);
}

export async function isBarangayVerified(barangayId: string): Promise<boolean> {
  const ids = await getVerifiedBarangayIds();
  return ids.includes(barangayId);
}
