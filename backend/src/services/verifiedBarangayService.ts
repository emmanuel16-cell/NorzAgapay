import { supabaseAdmin } from '../config/supabase';

/** Barangays with an MDRRMO-approved coordination authorization. */
export async function getVerifiedBarangayIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('barangay_dispatcher_verifications')
    .select('barangay_id, is_active')
    .eq('status', 'verified');

  if (error) throw error;
  const activeByBarangay = new Map<string, boolean>();
  for (const row of data || []) {
    if (!row.barangay_id) continue;
    activeByBarangay.set(row.barangay_id, (activeByBarangay.get(row.barangay_id) ?? true) && row.is_active !== false);
  }
  return [...activeByBarangay.entries()].filter(([, active]) => active).map(([id]) => id);
}

export async function isBarangayVerified(barangayId: string): Promise<boolean> {
  const ids = await getVerifiedBarangayIds();
  return ids.includes(barangayId);
}
