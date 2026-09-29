import { supabaseAdmin } from '../config/supabase';

/** Barangays with an MDRRMO-approved coordination authorization. */
export async function getVerifiedBarangayIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('barangay_dispatcher_verifications')
    .select('barangay_id')
    .eq('status', 'verified');

  if (error) throw error;
  return [...new Set((data || []).map((row: any) => row.barangay_id).filter(Boolean))];
}

export async function isBarangayVerified(barangayId: string): Promise<boolean> {
  const ids = await getVerifiedBarangayIds();
  return ids.includes(barangayId);
}
