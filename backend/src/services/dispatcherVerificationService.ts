import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { supabaseAdmin } from '../config/supabase';
import { hasOtherApprovedBarangayAdmin } from './verifiedBarangayService';

// Safe getter for socket.io to avoid circular boot in CLI / test scripts
function getIO() {
  try {
    const serverModule = require('../server');
    return serverModule.io || null;
  } catch (_) {
    return null;
  }
}

export interface VerificationHistoryEntry {
  action: string;
  timestamp: string;
  note?: string;
  actor?: string;
}

export interface DispatcherVerification {
  id: string;
  user_id: string;
  barangay_id: string;
  barangay_name?: string;
  full_name: string;
  email: string;
  phone?: string | null;
  position_designation: string;
  punong_barangay_name: string;
  punong_barangay_position: string;
  reference_no: string;
  document_url?: string | null;
  status: 'pending_document' | 'under_review' | 'verified' | 'rejected' | 'needs_correction' | 'activation_pending';
  rejection_reason?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  verification_history: VerificationHistoryEntry[];
  created_at: string;
  updated_at: string;
  is_active?: boolean;
  // Stored locally only — never pushed to Supabase
  _password_hash?: string;
}

function latestRequestPerBarangay<T extends { barangay_id: string; updated_at?: string; created_at?: string; id?: string }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  const ordered = [...rows].sort((a, b) =>
    (b.updated_at || '').localeCompare(a.updated_at || '') ||
    (b.created_at || '').localeCompare(a.created_at || '') ||
    (b.id || '').localeCompare(a.id || ''),
  );
  for (const row of ordered) {
    if (row.barangay_id && !latest.has(row.barangay_id)) latest.set(row.barangay_id, row);
  }
  return [...latest.values()];
}

const STORAGE_FILE = path.join(__dirname, '../../data/dispatcher_verifications.json');

// Ensure local persistence store exists
function ensureStorage(): DispatcherVerification[] {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(STORAGE_FILE)) {
      fs.writeFileSync(STORAGE_FILE, JSON.stringify([]), 'utf-8');
      return [];
    }
    const content = fs.readFileSync(STORAGE_FILE, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error('Error accessing local dispatcher verification storage:', err);
    return [];
  }
}

function saveLocalStorage(items: DispatcherVerification[]) {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving local dispatcher verification storage:', err);
  }
}

export function generateReferenceNo(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MDRRMO-VREF-${dateStr}-${randomSuffix}`;
}

export function normalizePositionDesignation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const position = value.trim();
  if (!position || position.toLowerCase() === 'barangay dispatcher') return null;
  return position;
}

/** Generate a UUID v4 compatible string */
function generateUUID(): string {
  return crypto.randomUUID();
}

export class DispatcherVerificationService {
  /**
   * Initialize a new verification record upon dispatcher registration.
   * The user_id is a self-generated UUID that will later become the
   * barangay_users.id when MDRRMO approves the dispatcher.
   */
  static async createVerification(params: {
    userId?: string;      // if provided, use this UUID; otherwise generate one
    barangayId: string;
    barangayName?: string;
    fullName: string;
    email: string;
    phone?: string | null;
    positionDesignation?: string;
    punongBarangayName?: string;
    punongBarangayPosition?: string;
    passwordHash?: string; // stored locally only for login during pending state
  }): Promise<DispatcherVerification> {
    const now = new Date().toISOString();
    const referenceNo = generateReferenceNo();
    // Use provided userId or generate a new UUID that will persist through approval
    const userId = params.userId || generateUUID();

    const record: DispatcherVerification = {
      id: `disp-ver-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      user_id: userId,
      barangay_id: params.barangayId,
      barangay_name: params.barangayName || 'Barangay',
      full_name: params.fullName,
      email: params.email,
      phone: params.phone || null,
      position_designation: normalizePositionDesignation(params.positionDesignation) || '',
      punong_barangay_name: params.punongBarangayName || 'Punong Barangay / Authorized Official',
      punong_barangay_position: params.punongBarangayPosition || 'Punong Barangay',
      reference_no: referenceNo,
      document_url: null,
      status: 'pending_document',
      is_active: false,
      rejection_reason: null,
      submitted_at: null,
      reviewed_at: null,
      reviewed_by: null,
      verification_history: [
        {
          action: 'Barangay Account Request Started',
          timestamp: now,
          note: 'The barangay administrator started a Barangay Account Request. MDRRMO verification is pending.',
          actor: params.fullName,
        },
      ],
      created_at: now,
      updated_at: now,
      _password_hash: params.passwordHash, // local-only, not persisted to Supabase
    };

    // Attempt to persist to Supabase
    try {
      const payload: any = {
        user_id: record.user_id,
        barangay_id: record.barangay_id,
        full_name: record.full_name,
        email: record.email,
        phone: record.phone,
        position_designation: record.position_designation,
        punong_barangay_name: record.punong_barangay_name,
        punong_barangay_position: record.punong_barangay_position,
        reference_no: record.reference_no,
        status: record.status,
        is_active: false,
        verification_history: record.verification_history,
      };

      if (params.passwordHash) {
        payload.password_hash = params.passwordHash;
      }

      let res = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .insert(payload)
        .select()
        .single();

      // If password_hash column doesn't exist yet, retry without it
      if (res.error && res.error.code === 'PGRST204') {
        delete payload.password_hash;
        res = await supabaseAdmin
          .from('barangay_dispatcher_verifications')
          .insert(payload)
          .select()
          .single();
      }

      if (res.error) {
        if (res.error.code === '23503') {
          console.warn('[DispatcherVerification] Foreign key constraint note: Run database/migrations/fix_dispatcher_verification_fk.sql in Supabase to allow storing dispatchers prior to MDRRMO approval.');
        } else {
          console.error('[DispatcherVerification] Supabase insert error:', res.error.message, res.error.details);
        }
        throw new Error('Could not save the Barangay Account Request. Please confirm the account request database migration is applied.');
      } else if (res.data) {
        record.id = res.data.id;
        console.log('[DispatcherVerification] Successfully saved to Supabase barangay_dispatcher_verifications, id:', res.data.id);
      } else {
        throw new Error('The Barangay Account Request was not saved. Please try again.');
      }
    } catch (e: any) {
      console.error('[DispatcherVerification] Supabase insert exception:', e?.message || e);
      throw e;
    }

    // Always persist to local JSON store
    const items = ensureStorage();
    const idx = items.findIndex((i) => i.user_id === userId || i.email === params.email);
    if (idx >= 0) {
      items[idx] = record;
    } else {
      items.push(record);
    }
    saveLocalStorage(items);

    return record;
  }

  /**
   * Find a pending dispatcher verification record by email (for login).
   * Checks Supabase first, then falls back to local storage.
   */
  static async findByEmail(email: string): Promise<DispatcherVerification | null> {
    const cleanEmail = email.trim().toLowerCase();
    try {
      const { data, error } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .select('*, barangays(name)')
        .ilike('email', cleanEmail)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        const item: DispatcherVerification = {
          ...data,
          barangay_name: data.barangays?.name || data.barangay_name || 'Barangay',
          _password_hash: data.password_hash || undefined,
        };

        const items = ensureStorage();
        const idx = items.findIndex((i) => i.email?.toLowerCase() === cleanEmail);
        if (idx >= 0) {
          if (!item._password_hash && items[idx]._password_hash) {
            item._password_hash = items[idx]._password_hash;
          }
          items[idx] = { ...items[idx], ...item };
        } else {
          items.push(item);
        }
        saveLocalStorage(items);
        return item;
      }
    } catch (_) {}

    const items = ensureStorage();
    return items.find((i) => i.email?.toLowerCase() === cleanEmail) || null;
  }

  /**
   * Get verification record by user_id or verification id
   */
  static async getByUserId(userId: string): Promise<DispatcherVerification | null> {
    if (!userId) return null;
    try {
      const item = await this.getPersistedByUserId(userId);
      if (item) return item;
    } catch (_) {}

    const items = ensureStorage();
    return items.find((i) => i.user_id === userId || i.id === userId) || null;
  }

  static async getPersistedByUserId(userId: string): Promise<DispatcherVerification | null> {
    if (!userId) return null;
    const { data, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .select('*, barangays(name)')
      .or(`user_id.eq.${userId},id.eq.${userId}`)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const item: DispatcherVerification = {
      ...data,
      barangay_name: data.barangays?.name || data.barangay_name || 'Barangay',
      _password_hash: data.password_hash || undefined,
    };
    const items = ensureStorage();
    const idx = items.findIndex((i) => i.user_id === userId || i.id === userId);
    if (idx >= 0) {
      if (!item._password_hash && items[idx]._password_hash) item._password_hash = items[idx]._password_hash;
      items[idx] = { ...items[idx], ...item };
    } else {
      items.push(item);
    }
    saveLocalStorage(items);
    return item;
  }

  /**
   * Get verification record by reference number or ID
   */
  static async getById(idOrRef: string): Promise<DispatcherVerification | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .select('*, barangays(name)')
        .or(`id.eq.${idOrRef},reference_no.eq.${idOrRef}`)
        .maybeSingle();

      if (!error && data) {
        return {
          ...data,
          barangay_name: data.barangays?.name || data.barangay_name || 'Barangay',
        };
      }
    } catch (_) {}

    const items = ensureStorage();
    return (
      items.find((i) => i.id === idOrRef || i.reference_no === idOrRef || i.user_id === idOrRef) || null
    );
  }

  /**
   * Dispatcher submits the signed and sealed certification document
   */
  static async submitCertification(userId: string, documentUrl: string): Promise<DispatcherVerification> {
    let existing = await this.getByUserId(userId);
    const now = new Date().toISOString();

    if (!existing) {
      throw new Error('Verification record not found. Please register first.');
    }

    const updatedHistory: VerificationHistoryEntry[] = [
      ...existing.verification_history,
      {
        action: 'Certification Submitted',
        timestamp: now,
        note: 'Signed and sealed document submitted for MDRRMO verification.',
        actor: existing.full_name,
      },
    ];

    const updated: DispatcherVerification = {
      ...existing,
      document_url: documentUrl,
      status: 'under_review',
      is_active: false,
      rejection_reason: null,
      submitted_at: now,
      updated_at: now,
      verification_history: updatedHistory,
    };

    const { data: savedRows, error: updateError } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({
        document_url: documentUrl,
        status: 'under_review',
        is_active: false,
        rejection_reason: null,
        submitted_at: now,
        updated_at: now,
        verification_history: updatedHistory,
      })
      // A barangay administrator may have legacy duplicate rows. Only the
      // current request returned above may transition; updating every row for
      // the user can make an older pending row win the barangay status check.
      .eq('id', existing.id)
      .select('user_id');
    if (updateError) throw updateError;
    if (!savedRows?.length) throw new Error('The signed request could not be saved.');

    // Save to local store
    const items = ensureStorage();
    const idx = items.findIndex((i) => i.id === existing.id);
    if (idx >= 0) items[idx] = { ...updated, _password_hash: items[idx]._password_hash };
    else items.push(updated);
    saveLocalStorage(items);

    await this.removeDispatcherRoomAccess(updated.barangay_id, userId);
    await this.broadcastCoordinationAccessChanged(updated.barangay_id);

    // Notify command center via socket
    try {
      const payload = {
        id: updated.id,
        applicant: updated.full_name,
        barangay: updated.barangay_name,
        reference_no: updated.reference_no,
        request_type: 'new',
      };
      getIO()?.to('dashboard_staff').emit('verification:dispatcher_submitted', payload);
      getIO()?.to('dashboard_staff').emit('verification:barangay_account_request_submitted', payload);
    } catch (_) {}

    return updated;
  }

  static async updateAuthorizationDetails(
    userId: string,
    officialName: string,
    officialPosition: string,
    accountPositionDesignation?: string,
  ): Promise<DispatcherVerification> {
    const existing = await this.getByUserId(userId);
    if (!existing) throw new Error('The Barangay Account Request has not been initialized.');
    const { data: account, error: accountError } = await supabaseAdmin
      .from('barangay_users')
      .select('role, position_designation')
      .eq('id', userId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.role !== 'admin') throw new Error('The barangay administrator account was not found.');

    const nextAccountPosition = accountPositionDesignation !== undefined
      ? (normalizePositionDesignation(accountPositionDesignation) || '')
      : (normalizePositionDesignation(account.position_designation) || '');
    const currentAccountPosition = normalizePositionDesignation(account.position_designation) || '';
    const now = new Date().toISOString();
    const authorizationChanged =
      existing.punong_barangay_name.trim() !== officialName.trim() ||
      existing.punong_barangay_position.trim() !== officialPosition.trim() ||
      currentAccountPosition !== nextAccountPosition;
    const updatedHistory = authorizationChanged
      ? [
          ...existing.verification_history,
          {
            action: 'Barangay Account Request Details Updated',
            timestamp: now,
            note: `Administrator designation: ${nextAccountPosition || 'Not provided'}. Authorized by ${officialName}, ${officialPosition}.${existing.document_url ? ' The previous signed request was invalidated; a new signed and sealed copy is required.' : ''}`,
            actor: existing.full_name,
          },
        ]
      : existing.verification_history;
    const updated: DispatcherVerification = {
      ...existing,
      punong_barangay_name: officialName,
      punong_barangay_position: officialPosition,
      position_designation: nextAccountPosition,
      status: authorizationChanged ? 'pending_document' : existing.status,
      document_url: authorizationChanged ? null : existing.document_url,
      submitted_at: authorizationChanged ? null : existing.submitted_at,
      rejection_reason: authorizationChanged ? null : existing.rejection_reason,
      reviewed_at: authorizationChanged ? null : existing.reviewed_at,
      reviewed_by: authorizationChanged ? null : existing.reviewed_by,
      is_active: authorizationChanged ? false : existing.is_active,
      updated_at: now,
      verification_history: updatedHistory,
    };
    const { data: savedRows, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({
        punong_barangay_name: officialName,
        punong_barangay_position: officialPosition,
        position_designation: nextAccountPosition,
        status: updated.status,
        document_url: updated.document_url,
        submitted_at: updated.submitted_at,
        rejection_reason: updated.rejection_reason,
        reviewed_at: authorizationChanged ? null : existing.reviewed_at,
        reviewed_by: authorizationChanged ? null : existing.reviewed_by,
        is_active: updated.is_active,
        updated_at: now,
        verification_history: updated.verification_history,
      })
      .eq('id', existing.id)
      .select('user_id');
    if (error) throw error;
    if (!savedRows?.length) throw new Error('The authorizing official details could not be saved.');
    await this.broadcastCoordinationAccessChanged(updated.barangay_id);
    if (currentAccountPosition !== nextAccountPosition) {
      const { error: accountUpdateError } = await supabaseAdmin
        .from('barangay_users')
        .update({ position_designation: nextAccountPosition })
        .eq('id', userId)
        .eq('role', 'admin');
      if (accountUpdateError) throw accountUpdateError;
    }
    const items = ensureStorage();
    const index = items.findIndex((item) => item.id === existing.id);
    if (index >= 0) items[index] = { ...updated, _password_hash: items[index]._password_hash };
    else items.push(updated);
    saveLocalStorage(items);
    return updated;
  }

  /**
   * Reset status to allow resubmission if rejected
   */
  static async allowResubmission(userId: string): Promise<DispatcherVerification> {
    const existing = await this.getByUserId(userId);
    if (!existing) throw new Error('Verification record not found');

    const now = new Date().toISOString();
    const updatedHistory: VerificationHistoryEntry[] = [
      ...existing.verification_history,
      {
        action: 'Resubmission Initiated',
        timestamp: now,
        note: 'Dispatcher opened document resubmission.',
        actor: existing.full_name,
      },
    ];

    const updated: DispatcherVerification = {
      ...existing,
      status: 'pending_document',
      rejection_reason: null,
      reviewed_at: null,
      reviewed_by: null,
      updated_at: now,
      verification_history: updatedHistory,
    };

    const { data: savedRows, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({
        status: 'pending_document',
        rejection_reason: null,
        reviewed_at: null,
        reviewed_by: null,
        updated_at: now,
        verification_history: updatedHistory,
      })
      .eq('id', existing.id)
      .select('user_id');
    if (error) throw error;
    if (!savedRows?.length) throw new Error('The resubmission status could not be saved.');

    const items = ensureStorage();
    const idx = items.findIndex((i) => i.id === existing.id);
    if (idx >= 0) items[idx] = { ...updated, _password_hash: items[idx]._password_hash };
    saveLocalStorage(items);

    await this.removeDispatcherRoomAccess(updated.barangay_id, userId);
    await this.broadcastCoordinationAccessChanged(updated.barangay_id);

    return updated;
  }

  /**
   * Fetch all pending Barangay Account Requests and activation requests.
   */
  static async getPending(): Promise<DispatcherVerification[]> {
    try {
      const { data: admins, error: adminError } = await supabaseAdmin
        .from('barangay_users')
        .select('id')
        .eq('role', 'admin')
        .eq('is_active', true);
      if (adminError) throw adminError;
      const adminIds = (admins || []).map((admin: any) => admin.id).filter(Boolean);
      if (adminIds.length === 0) return [];
      const { data, error } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .select('*, barangays(name)')
        .in('user_id', adminIds)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });

      if (!error) {
        return latestRequestPerBarangay(data || [])
          .filter((d: any) => ['under_review', 'pending_document', 'needs_correction', 'activation_pending'].includes(d.status))
          .map((d: any) => ({
          ...d,
          barangay_name: d.barangays?.name || d.barangay_name || 'Barangay',
        }));
      }
    } catch (_) {}

    const items = ensureStorage();
    return items.filter((i) => ['under_review', 'pending_document', 'needs_correction', 'activation_pending'].includes(i.status));
  }

  /**
   * Fetch the latest archived / rejected Barangay Account Requests
   */
  static async getArchived(): Promise<DispatcherVerification[]> {
    try {
      const { data: admins, error: adminError } = await supabaseAdmin
        .from('barangay_users')
        .select('id')
        .eq('role', 'admin')
        .eq('is_active', true);
      if (adminError) throw adminError;
      const adminIds = (admins || []).map((admin: any) => admin.id).filter(Boolean);
      if (adminIds.length === 0) return [];
      const { data, error } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .select('*, barangays(name)')
        .in('user_id', adminIds)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });

      if (!error) {
        return latestRequestPerBarangay(data || []).filter((d: any) => d.status === 'rejected').map((d: any) => ({
          ...d,
          barangay_name: d.barangays?.name || d.barangay_name || 'Barangay',
        }));
      }
    } catch (_) {}

    const items = ensureStorage();
    return items.filter((i) => i.status === 'rejected');
  }

  static async getApproved(): Promise<DispatcherVerification[]> {
    const { data: admins, error: adminError } = await supabaseAdmin
      .from('barangay_users')
      .select('id')
      .eq('role', 'admin')
      .eq('is_active', true);
    if (adminError) throw adminError;
    const adminIds = (admins || []).map((admin: any) => admin.id).filter(Boolean);
    if (adminIds.length === 0) return [];
    const { data, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .select('*, barangays(name)')
      .in('user_id', adminIds)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw error;
    return latestRequestPerBarangay(data || []).filter((record: any) => record.status === 'verified').map((record: any) => ({
      ...record,
      barangay_name: record.barangays?.name || record.barangay_name || 'Barangay',
      is_active: record.is_active !== false,
    }));
  }

  static async setActive(idOrRef: string, isActive: boolean, adminUserId?: string): Promise<DispatcherVerification> {
    const record = await this.getById(idOrRef);
    if (!record) throw new Error('Verification record not found');
    await this.assertLatestAccountRequest(record);
    if (record.status !== 'verified') throw new Error('Only approved barangays can be activated or deactivated.');

    const now = new Date().toISOString();
    const action = isActive ? 'Barangay Account Activated' : 'Barangay Account Deactivated';
    const updated: DispatcherVerification = {
      ...record,
      is_active: isActive,
      updated_at: now,
      verification_history: [
        ...record.verification_history,
        { action, timestamp: now, note: `MDRRMO ${isActive ? 'activated' : 'deactivated'} access for all accounts in the barangay.`, actor: adminUserId || 'MDRRMO Command Center' },
      ],
    };
    const { data: activatedRows, error: activationError } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({ is_active: isActive, updated_at: now, verification_history: updated.verification_history })
      .eq('id', record.id)
      .select('user_id');
    if (activationError) throw activationError;
    if (!activatedRows?.length) throw new Error('The barangay activation status could not be saved.');
    const items = ensureStorage();
    const index = items.findIndex((item) => item.user_id === record.user_id);
    if (index >= 0) items[index] = { ...updated, _password_hash: items[index]._password_hash };
    saveLocalStorage(items);
    if (!isActive) await this.removeBarangayRoomAccess(record.barangay_id);
    await this.broadcastCoordinationAccessChanged(record.barangay_id);
    return updated;
  }

  static async requestActivation(userId: string): Promise<DispatcherVerification> {
    const record = await this.getPersistedByUserId(userId);
    if (!record || record.status !== 'verified' || record.is_active !== false) {
      throw new Error('Only a deactivated, previously approved barangay can request activation.');
    }
    const now = new Date().toISOString();
    const history = [
      ...record.verification_history,
      {
        action: 'Barangay Activation Requested',
        timestamp: now,
        note: 'The barangay administrator requested MDRRMO to restore access for all barangay accounts.',
        actor: record.full_name,
      },
    ];
    const { data, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({
        status: 'activation_pending',
        is_active: false,
        submitted_at: now,
        rejection_reason: null,
        reviewed_at: null,
        reviewed_by: null,
        updated_at: now,
        verification_history: history,
      })
      .eq('id', record.id)
      .select('user_id');
    if (error) throw error;
    if (!data?.length) throw new Error('The activation request could not be saved.');
    const updated: DispatcherVerification = {
      ...record,
      status: 'activation_pending',
      is_active: false,
      submitted_at: now,
      rejection_reason: null,
      reviewed_at: null,
      reviewed_by: null,
      updated_at: now,
      verification_history: history,
    };
    const items = ensureStorage();
    const index = items.findIndex((item) => item.id === record.id || item.user_id === userId);
    if (index >= 0) items[index] = { ...updated, _password_hash: items[index]._password_hash };
    saveLocalStorage(items);
    getIO()?.to('dashboard_staff').emit('verification:barangay_account_request_submitted', {
      id: updated.id,
      applicant: updated.full_name,
      barangay: updated.barangay_name,
      reference_no: updated.reference_no,
      request_type: 'activation',
    });
    await this.broadcastCoordinationAccessChanged(record.barangay_id);
    return updated;
  }

  static async isBarangayActive(barangayId: string): Promise<boolean> {
    const { data: admins, error: adminError } = await supabaseAdmin
      .from('barangay_users')
      .select('id')
      .eq('barangay_id', barangayId)
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (adminError) throw adminError;
    const adminIds = (admins || []).map((admin: any) => admin.id).filter(Boolean);
    if (adminIds.length === 0) return false;

    // The newest request made by a current barangay administrator controls
    // barangay access. Older verified records must not override a newer
    // pending, rejected, or deactivated account request.
    const { data: request, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .select('status, is_active, updated_at, created_at, id')
      .in('user_id', adminIds)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return request?.status === 'verified' && request.is_active !== false;
  }

  private static async assertLatestAccountRequest(record: DispatcherVerification): Promise<void> {
    const { data: admins, error: adminError } = await supabaseAdmin
      .from('barangay_users')
      .select('id')
      .eq('barangay_id', record.barangay_id)
      .eq('role', 'admin')
      .eq('is_active', true);
    if (adminError) throw adminError;
    const adminIds = (admins || []).map((admin: any) => admin.id).filter(Boolean);
    if (adminIds.length === 0) throw new Error('No active barangay administrator account was found.');
    const { data: latest, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .select('id')
      .in('user_id', adminIds)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!latest || latest.id !== record.id) {
      throw new Error('This request has been replaced by a newer Barangay Account Request. Refresh the review queue.');
    }
  }

  static async broadcastCoordinationAccessChanged(barangayId: string): Promise<void> {
    try {
      const coordinationVerified = await this.isBarangayActive(barangayId);
      if (!coordinationVerified) await this.removeBarangayRoomAccess(barangayId);
      getIO()?.to(`barangay:coordination:${barangayId}`).emit('dispatcher:coordination_access_changed', {
        barangayId,
        coordination_verified: coordinationVerified,
      });
      getIO()?.to(`barangay:coordination:${barangayId}`).emit('barangay:account_access_changed', {
        barangayId,
        coordination_verified: coordinationVerified,
      });
    } catch (err) {
      await this.removeBarangayRoomAccess(barangayId);
      console.warn('[DispatcherVerification] Could not broadcast coordination access update:', err);
    }
  }

  static async removeBarangayRoomAccess(barangayId: string): Promise<void> {
    try {
      const io = getIO();
      if (!io) return;
      const room = `barangay:${barangayId}`;
      await io.in(room).socketsLeave(room);
    } catch (err) {
      console.warn('[BarangayAccountRequest] Could not revoke barangay room access:', err);
    }
  }

  static async removeDispatcherRoomAccess(barangayId: string, userId?: string): Promise<void> {
    try {
      const io = getIO();
      if (!io) return;
      const room = `barangay:${barangayId}`;
      const sockets = await io.in(room).fetchSockets();
      await Promise.all(sockets
        .filter((socket: any) => socket.data?.barangayRole === 'dispatcher' && (!userId || socket.data.userId === userId))
        .map((socket: any) => socket.leave(room)));
    } catch (err) {
      console.warn('[DispatcherVerification] Could not remove dispatcher from barangay room:', err);
    }
  }

  /**
   * MDRRMO approves the barangay administrator's account request and enables
   * access for active accounts across the barangay.
   */
  static async approve(idOrRef: string, adminUserId?: string, note?: string): Promise<DispatcherVerification> {
    const record = await this.getById(idOrRef);
    if (!record) throw new Error('Verification record not found');
    await this.assertLatestAccountRequest(record);
    const activationRequest = record.status === 'activation_pending';
    if (!activationRequest && !record.document_url) throw new Error('A signed Barangay Account Request document must be submitted before approval.');

    const { data: account, error: accountError } = await supabaseAdmin
      .from('barangay_users')
      .select('id, role')
      .eq('id', record.user_id)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.role !== 'admin') {
      throw new Error('The Barangay Account Request must belong to an existing barangay administrator account.');
    }
    if (await hasOtherApprovedBarangayAdmin(record.barangay_id, record.user_id)) {
      const conflict = new Error('Another MDRRMO-approved administrator already exists for this barangay.');
      conflict.name = 'BarangayAdminAlreadyApprovedError';
      throw conflict;
    }

    const now = new Date().toISOString();
    const updatedHistory: VerificationHistoryEntry[] = [
      ...record.verification_history,
      {
        action: activationRequest ? 'Barangay Access Reactivated' : 'Barangay Account Request Approved',
        timestamp: now,
        note: note || (activationRequest
          ? 'MDRRMO approved the administrator’s activation request and restored access for all barangay accounts.'
          : 'MDRRMO verified the signed Barangay Account Request and activated all barangay accounts.'),
        actor: 'MDRRMO Command Center',
      },
    ];

    const updated: DispatcherVerification = {
      ...record,
      status: 'verified',
      is_active: true,
      rejection_reason: null,
      reviewed_at: now,
      reviewed_by: adminUserId || null,
      updated_at: now,
      verification_history: updatedHistory,
    };

    // Restore the existing administrator before changing the request row to
    // active. If the request update fails, the barangay-wide access check stays
    // closed because the persisted request is still inactive.
    const userUpdates: Record<string, unknown> = { is_active: true };
    const positionDesignation = normalizePositionDesignation(record.position_designation);
    if (positionDesignation) userUpdates.position_designation = positionDesignation;
    const { error: userUpdateError } = await supabaseAdmin
      .from('barangay_users')
      .update(userUpdates)
      .eq('id', record.user_id)
      .eq('role', 'admin');
    if (userUpdateError) throw userUpdateError;

    // 1. Update verification record status in Supabase
    try {
      const { data: updatedRows, error: verificationUpdateError } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .update({
          status: 'verified',
          is_active: true,
          rejection_reason: null,
          reviewed_at: now,
          reviewed_by: adminUserId || null,
          updated_at: now,
          verification_history: updatedHistory,
        })
        .eq('id', record.id)
        .select('user_id');
      if (verificationUpdateError) throw verificationUpdateError;
      if (!updatedRows?.length) throw new Error('The approval did not match a saved verification record.');
    } catch (e: any) {
      console.error('[DispatcherVerification] Error updating verification status on approval:', e?.message);
      throw new Error('Could not save the approval. Confirm the barangay activation migration has been applied.');
    }

    // The admin account already exists; approving the barangay request restores
    // that account and, through the barangay-wide gate, every active team member.
    const localItems = ensureStorage();
    const localRecord = localItems.find((i) => i.user_id === record.user_id || i.id === record.id);
    // 3. Update local store
    const idx = localItems.findIndex((i) => i.id === record.id || i.user_id === record.user_id);
    if (idx >= 0) localItems[idx] = { ...updated, _password_hash: localItems[idx]._password_hash };
    saveLocalStorage(localItems);

    // 4. Real-time broadcast to mobile app & dashboard
    try {
      getIO()?.to(`user:${record.user_id}`).emit('dispatcher:verified', {
        userId: record.user_id,
        status: 'verified',
        message: 'Your account has been verified and activated by MDRRMO.',
      });
      getIO()?.emit('dispatcher:status_changed', {
        userId: record.user_id,
        status: 'verified',
      });
      await this.broadcastCoordinationAccessChanged(record.barangay_id);
    } catch (_) {}

    return updated;
  }

  /**
   * MDRRMO rejects a new Barangay Account Request; an activation request
   * rejection keeps the previously approved barangay deactivated.
   */
  static async reject(idOrRef: string, adminUserId?: string, reason?: string): Promise<DispatcherVerification> {
    const record = await this.getById(idOrRef);
    if (!record) throw new Error('Verification record not found');
    await this.assertLatestAccountRequest(record);

    const activationRequest = record.status === 'activation_pending';
    const defaultReason = activationRequest
      ? 'The activation request could not be approved.'
      : 'The submitted Barangay Account Request could not be verified.';
    const finalReason = reason?.trim() || defaultReason;
    const now = new Date().toISOString();

    const updatedHistory: VerificationHistoryEntry[] = [
      ...record.verification_history,
      {
        action: activationRequest ? 'Barangay Activation Request Rejected' : 'Verification Rejected',
        timestamp: now,
        note: activationRequest
          ? `Activation request rejected: ${finalReason}`
          : `Rejected: ${finalReason}`,
        actor: 'MDRRMO Command Center',
      },
    ];

    const updated: DispatcherVerification = {
      ...record,
      // Keep an already approved request in the approved/deactivated state so
      // its administrator can request activation again without reapplying.
      status: activationRequest ? 'verified' : 'rejected',
      is_active: false,
      rejection_reason: finalReason,
      reviewed_at: now,
      reviewed_by: adminUserId || null,
      updated_at: now,
      verification_history: updatedHistory,
    };

    const { data: savedRows, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({
        status: updated.status,
        is_active: false,
        rejection_reason: finalReason,
        reviewed_at: now,
        reviewed_by: adminUserId || null,
        updated_at: now,
        verification_history: updatedHistory,
      })
      .eq('id', record.id)
      .select('user_id');
    if (error) throw error;
    if (!savedRows?.length) throw new Error('The rejection could not be saved to the verification record.');

    // Save local store
    const items = ensureStorage();
    const idx = items.findIndex((i) => i.id === record.id);
    if (idx >= 0) items[idx] = { ...updated, _password_hash: items[idx]._password_hash };
    saveLocalStorage(items);
    await this.removeDispatcherRoomAccess(record.barangay_id, record.user_id);

    // Real-time broadcast to mobile app
    try {
      getIO()?.to(`user:${record.user_id}`).emit('dispatcher:rejected', {
        userId: record.user_id,
        status: updated.status,
        reason: finalReason,
      });
      getIO()?.emit('dispatcher:status_changed', {
        userId: record.user_id,
        status: updated.status,
        reason: finalReason,
      });
      await this.broadcastCoordinationAccessChanged(record.barangay_id);
    } catch (_) {}

    return updated;
  }

  /**
   * MDRRMO requests a correction to the submitted account request document.
   */
  static async requestCorrection(idOrRef: string, adminUserId?: string, note?: string): Promise<DispatcherVerification> {
    const record = await this.getById(idOrRef);
    if (!record) throw new Error('Verification record not found');
    await this.assertLatestAccountRequest(record);

    const correctionReason = note?.trim() || 'Document correction requested. Please re-upload with clear signature and seal.';
    const now = new Date().toISOString();

    const updatedHistory: VerificationHistoryEntry[] = [
      ...record.verification_history,
      {
        action: 'Correction Requested',
        timestamp: now,
        note: correctionReason,
        actor: 'MDRRMO Command Center',
      },
    ];

    const updated: DispatcherVerification = {
      ...record,
      status: 'needs_correction',
      is_active: false,
      rejection_reason: correctionReason,
      reviewed_at: now,
      reviewed_by: adminUserId || null,
      updated_at: now,
      verification_history: updatedHistory,
    };

    const { data: savedRows, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({
        status: 'needs_correction',
        is_active: false,
        rejection_reason: correctionReason,
        reviewed_at: now,
        reviewed_by: adminUserId || null,
        updated_at: now,
        verification_history: updatedHistory,
      })
      .eq('id', record.id)
      .select('user_id');
    if (error) throw error;
    if (!savedRows?.length) throw new Error('The correction request could not be saved to the verification record.');

    const items = ensureStorage();
    const idx = items.findIndex((i) => i.id === record.id);
    if (idx >= 0) items[idx] = { ...updated, _password_hash: items[idx]._password_hash };
    saveLocalStorage(items);
    await this.removeDispatcherRoomAccess(record.barangay_id, record.user_id);

    try {
      getIO()?.to(`user:${record.user_id}`).emit('dispatcher:correction', {
        userId: record.user_id,
        status: 'needs_correction',
        reason: correctionReason,
      });
      getIO()?.emit('dispatcher:status_changed', {
        userId: record.user_id,
        status: 'needs_correction',
        reason: correctionReason,
      });
      await this.broadcastCoordinationAccessChanged(record.barangay_id);
    } catch (_) {}

    return updated;
  }

  /**
   * Generate the prefilled Barangay Account Request PDF
   * Standard A4, Times-Roman 12pt, justified text, official signature block & blank MDRRMO Ref No.
   */
  static generateAuthorizationPDF(params: {
    adminName: string;
    positionDesignation: string;
    barangayName: string;
    officialName?: string | null;
    officialPosition?: string | null;
    referenceNo?: string | null;
    dateStr?: string | null;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 60, bottom: 60, left: 60, right: 60 },
          info: {
            Title: 'Barangay Account Request',
            Author: 'Norz-Agapay Crisis Management System',
            Subject: 'Barangay Account Request',
          },
        });

        const buffers: Buffer[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        const currentDate =
          params.dateStr ||
          new Date().toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          });

        const barangay = (params.barangayName || 'Barangay').replace(/^Brgy\.?\s*/i, '').trim();
        const fullName = (params.adminName || '').trim();
        const position = normalizePositionDesignation(params.positionDesignation) || '';
        const officialName = (params.officialName || '').trim();

        // 1. Title (Centered, Bold)
        doc.moveDown(1.5);
        doc
          .font('Times-Bold')
          .fontSize(13)
          .text('BARANGAY ACCOUNT REQUEST', {
            align: 'center',
          });

        doc.moveDown(2.5);

        // 2. Date: [automatically generated current date] - aligned left bold
        doc
          .font('Times-Bold')
          .fontSize(12)
          .text(`Date: ${currentDate}`, { align: 'left' });

        doc.moveDown(1.8);

        // 3. Body paragraphs (Times-Roman 12pt, justified)
        doc
          .font('Times-Roman')
          .fontSize(12)
          .lineGap(5)
          .text(
            position
              ? `This is to certify that ${fullName}, serving as ${position} at Barangay ${barangay}, Municipality of Norzagaray, Bulacan, is the barangay administrator and authorized representative submitting a Barangay Account Request to the Norz-Agapay Emergency Response and Crisis Management Coordination Application. The request seeks MDRRMO verification and activation of access for authorized accounts belonging to Barangay ${barangay}.`
              : `This is to certify that ${fullName} is the barangay administrator and an authorized representative of Barangay ${barangay}, Municipality of Norzagaray, Bulacan, submitting a Barangay Account Request to the Norz-Agapay Emergency Response and Crisis Management Coordination Application. The request seeks MDRRMO verification and activation of access for authorized accounts belonging to Barangay ${barangay}.`,
            { align: 'justify' }
          );

        doc.moveDown(1.2);

        doc.text(
          `The barangay administrator is responsible for managing authorized team accounts and ensuring they are used only for official emergency preparedness, incident reporting, and response coordination.`,
          { align: 'justify' }
        );

        doc.moveDown(1.2);

        doc.text(
          `All accounts belonging to the barangay will remain restricted until the MDRRMO verifies and activates this request. MDRRMO may deactivate barangay access at any time; the administrator may then submit a request to restore access.`,
          { align: 'justify' }
        );

        doc.moveDown(3);

        // 4. CERTIFIED AND AUTHORIZED BY: - aligned left bold
        doc
          .font('Times-Bold')
          .fontSize(12)
          .text('CERTIFIED AND AUTHORIZED BY:', { align: 'left' });

        // Signature will be put directly over the NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL
        doc.moveDown(3.5);

        // 5. Official signature line & name/position (centered)
        const pageWidth = 595.28;
        const sigBlockWidth = 360;
        const sigBlockX = (pageWidth - sigBlockWidth) / 2;

        const displayedOfficialName = officialName.length > 0
          ? officialName
          : '[NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL]';

        doc
          .font('Times-Bold')
          .fontSize(12)
          .text(displayedOfficialName, sigBlockX, doc.y, {
            align: 'center',
            width: sigBlockWidth,
          });

        doc.moveDown(0.5);

        doc
          .font('Times-Roman')
          .fontSize(12)
          .text('________________________________________________', sigBlockX, doc.y, {
            align: 'center',
            width: sigBlockWidth,
          });

        doc.moveDown(0.5);

        doc
          .font('Times-Roman')
          .fontSize(11)
          .text((params.officialPosition || 'Punong Barangay / Authorized Barangay Official').trim(), sigBlockX, doc.y, {
            align: 'center',
            width: sigBlockWidth,
          });

        // 6. Display the tracking reference assigned when the request was created.
        doc.y = 720;
        doc
          .font('Times-Bold')
          .fontSize(12)
          .text(`Reference No: ${params.referenceNo || ''}`, 60, doc.y, { align: 'left' });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
