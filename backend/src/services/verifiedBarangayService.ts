import { supabaseAdmin } from '../config/supabase';

const APPROVED_ACCOUNT_STATUSES = new Set(['verified', 'activation_pending']);

async function getApprovedAdminAccounts(): Promise<Array<{ userId: string; barangayId: string }>> {
  const { data: admins, error: adminError } = await supabaseAdmin
    .from('barangay_users')
    .select('id, barangay_id')
    .eq('role', 'admin');
  if (adminError) throw adminError;

  const adminIds = (admins || []).map((admin: any) => admin.id).filter(Boolean);
  if (adminIds.length === 0) return [];

  const { data: requests, error } = await supabaseAdmin
    .from('barangay_dispatcher_verifications')
    .select('user_id, barangay_id, status, updated_at, created_at, id')
    .in('user_id', adminIds)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;

  const latestRequestByAdmin = new Map<string, any>();
  for (const request of requests || []) {
    if (request.user_id && !latestRequestByAdmin.has(request.user_id)) {
      latestRequestByAdmin.set(request.user_id, request);
    }
  }

  return (admins || [])
    .filter((admin: any) => {
      const request = latestRequestByAdmin.get(admin.id);
      return request?.barangay_id === admin.barangay_id && APPROVED_ACCOUNT_STATUSES.has(request.status);
    })
    .filter((admin: any) => admin.id && admin.barangay_id)
    .map((admin: any) => ({ userId: admin.id, barangayId: admin.barangay_id }));
}

/** Barangays with an administrator account MDRRMO has approved, including deactivated accounts. */
export async function getBarangayIdsWithApprovedAdmins(): Promise<string[]> {
  const accounts = await getApprovedAdminAccounts();
  return [...new Set(accounts.map((account) => account.barangayId))];
}

/** Prevent another account from being approved for a barangay that already has an approved administrator. */
export async function hasOtherApprovedBarangayAdmin(
  barangayId: string,
  excludedUserId: string,
): Promise<boolean> {
  const accounts = await getApprovedAdminAccounts();
  return accounts.some((account) => account.barangayId === barangayId && account.userId !== excludedUserId);
}

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
