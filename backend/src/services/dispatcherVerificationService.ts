import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { supabaseAdmin } from '../config/supabase';

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
  status: 'pending_document' | 'under_review' | 'verified' | 'rejected' | 'needs_correction';
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
      rejection_reason: null,
      submitted_at: null,
      reviewed_at: null,
      reviewed_by: null,
      verification_history: [
        {
          action: 'Dispatcher Account Request Started',
          timestamp: now,
          note: 'Barangay administrator started a request to add a dispatcher account. Authorization verification is pending.',
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
      } else if (res.data) {
        record.id = res.data.id;
        console.log('[DispatcherVerification] Successfully saved to Supabase barangay_dispatcher_verifications, id:', res.data.id);
      }
    } catch (e: any) {
      console.error('[DispatcherVerification] Supabase insert exception:', e?.message || e);
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
      const { data, error } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .select('*, barangays(name)')
        .or(`user_id.eq.${userId},id.eq.${userId}`)
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
        const idx = items.findIndex((i) => i.user_id === userId || i.id === userId);
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
    return items.find((i) => i.user_id === userId || i.id === userId) || null;
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
      rejection_reason: null,
      submitted_at: now,
      updated_at: now,
      verification_history: updatedHistory,
    };

    // Try Supabase update
    try {
      await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .update({
          document_url: documentUrl,
          status: 'under_review',
          rejection_reason: null,
          submitted_at: now,
          updated_at: now,
          verification_history: updatedHistory,
        })
        .eq('user_id', userId);
    } catch (_) {}

    // Save to local store
    const items = ensureStorage();
    const idx = items.findIndex((i) => i.user_id === userId);
    if (idx >= 0) items[idx] = { ...updated, _password_hash: items[idx]._password_hash };
    else items.push(updated);
    saveLocalStorage(items);

    // Notify command center via socket
    try {
      getIO()?.to('dashboard_staff').emit('verification:dispatcher_submitted', {
        id: updated.id,
        applicant: updated.full_name,
        barangay: updated.barangay_name,
        reference_no: updated.reference_no,
      });
    } catch (_) {}

    return updated;
  }

  static async updateAuthorizationDetails(
    userId: string,
    officialName: string,
    officialPosition: string,
  ): Promise<DispatcherVerification> {
    const existing = await this.getByUserId(userId);
    if (!existing) throw new Error('Coordination request has not been initialized.');
    const now = new Date().toISOString();
    const updated: DispatcherVerification = {
      ...existing,
      punong_barangay_name: officialName,
      punong_barangay_position: officialPosition,
      updated_at: now,
      verification_history: [
        ...existing.verification_history,
        {
          action: 'Authorization details updated',
          timestamp: now,
          note: `Authorized by ${officialName}, ${officialPosition}.`,
          actor: existing.full_name,
        },
      ],
    };
    const { error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({
        punong_barangay_name: officialName,
        punong_barangay_position: officialPosition,
        updated_at: now,
        verification_history: updated.verification_history,
      })
      .eq('user_id', userId);
    if (error) throw error;
    const items = ensureStorage();
    const index = items.findIndex((item) => item.user_id === userId);
    if (index >= 0) items[index] = updated;
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
      updated_at: now,
      verification_history: updatedHistory,
    };

    try {
      await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .update({
          status: 'pending_document',
          updated_at: now,
          verification_history: updatedHistory,
        })
        .eq('user_id', userId);
    } catch (_) {}

    const items = ensureStorage();
    const idx = items.findIndex((i) => i.user_id === userId);
    if (idx >= 0) items[idx] = { ...updated, _password_hash: items[idx]._password_hash };
    saveLocalStorage(items);

    return updated;
  }

  /**
   * Fetch all pending dispatcher verifications (under_review or pending_document)
   */
  static async getPending(): Promise<DispatcherVerification[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .select('*, barangays(name)')
        .in('status', ['under_review', 'pending_document', 'needs_correction'])
        .order('submitted_at', { ascending: false, nullsFirst: false });

      if (!error && data && data.length > 0) {
        return data.map((d: any) => ({
          ...d,
          barangay_name: d.barangays?.name || d.barangay_name || 'Barangay',
        }));
      }
    } catch (_) {}

    const items = ensureStorage();
    return items.filter((i) => ['under_review', 'pending_document', 'needs_correction'].includes(i.status));
  }

  /**
   * Fetch all archived / rejected dispatcher verifications
   */
  static async getArchived(): Promise<DispatcherVerification[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .select('*, barangays(name)')
        .eq('status', 'rejected')
        .order('reviewed_at', { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map((d: any) => ({
          ...d,
          barangay_name: d.barangays?.name || d.barangay_name || 'Barangay',
        }));
      }
    } catch (_) {}

    const items = ensureStorage();
    return items.filter((i) => i.status === 'rejected');
  }

  static async getApproved(): Promise<DispatcherVerification[]> {
    const { data, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .select('*, barangays(name)')
      .eq('status', 'verified')
      .order('reviewed_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((record: any) => ({
      ...record,
      barangay_name: record.barangays?.name || record.barangay_name || 'Barangay',
      is_active: record.is_active !== false,
    }));
  }

  static async setActive(idOrRef: string, isActive: boolean, adminUserId?: string): Promise<DispatcherVerification> {
    const record = await this.getById(idOrRef);
    if (!record) throw new Error('Verification record not found');
    if (record.status !== 'verified') throw new Error('Only approved barangays can be activated or deactivated.');

    const now = new Date().toISOString();
    const action = isActive ? 'Barangay Access Activated' : 'Barangay Access Deactivated';
    const updated: DispatcherVerification = {
      ...record,
      is_active: isActive,
      updated_at: now,
      verification_history: [
        ...record.verification_history,
        { action, timestamp: now, note: `MDRRMO ${isActive ? 'activated' : 'deactivated'} dispatcher access for the barangay.`, actor: adminUserId || 'MDRRMO Command Center' },
      ],
    };
    const { error: activationError } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({ is_active: isActive, updated_at: now })
      .eq('barangay_id', record.barangay_id)
      .eq('status', 'verified');
    if (activationError) throw activationError;
    const { error: historyError } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .update({ verification_history: updated.verification_history })
      .eq('id', record.id);
    if (historyError) throw historyError;
    const items = ensureStorage();
    const index = items.findIndex((item) => item.user_id === record.user_id);
    if (index >= 0) items[index] = { ...updated, _password_hash: items[index]._password_hash };
    saveLocalStorage(items);
    getIO()?.to(`barangay:${record.barangay_id}`).emit('dispatcher:barangay_access_changed', { barangayId: record.barangay_id, isActive });
    return updated;
  }

  static async isBarangayActive(barangayId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('barangay_dispatcher_verifications')
      .select('status, is_active')
      .eq('barangay_id', barangayId)
      .eq('status', 'verified')
      .order('reviewed_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return Boolean(data?.length) && data!.every((record: any) => record.is_active !== false);
  }

  /**
   * MDRRMO approves dispatcher verification.
   * Creates a barangay_users entry so the dispatcher gets full app access.
   */
  static async approve(idOrRef: string, adminUserId?: string, note?: string): Promise<DispatcherVerification> {
    const record = await this.getById(idOrRef);
    if (!record) throw new Error('Verification record not found');
    if (!record.document_url) throw new Error('A signed authorization document must be submitted before approval.');

    const now = new Date().toISOString();
    const updatedHistory: VerificationHistoryEntry[] = [
      ...record.verification_history,
      {
        action: 'Barangay Approved & Activated',
        timestamp: now,
        note: note || 'MDRRMO verified the signed authorization and activated the barangay.',
        actor: 'MDRRMO Command Center',
      },
    ];

    const updated: DispatcherVerification = {
      ...record,
      status: 'verified',
      rejection_reason: null,
      reviewed_at: now,
      reviewed_by: adminUserId || null,
      updated_at: now,
      verification_history: updatedHistory,
    };

    // 1. Update verification record status in Supabase
    try {
      const { error: verificationUpdateError } = await supabaseAdmin
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
        .or(`id.eq.${record.id},user_id.eq.${record.user_id}`);
      if (verificationUpdateError) throw verificationUpdateError;
    } catch (e: any) {
      console.error('[DispatcherVerification] Error updating verification status on approval:', e?.message);
      throw new Error('Could not save the approval. Confirm the barangay activation migration has been applied.');
    }

    // 2. Create (or activate) the barangay_users entry — this gives full app access
    //    The user_id from the verification becomes the barangay_users.id
    const localItems = ensureStorage();
    const localRecord = localItems.find((i) => i.user_id === record.user_id || i.id === record.id);
    const passwordHash = localRecord?._password_hash;

    try {
      // First check if the user already exists in barangay_users
      const { data: existingUser } = await supabaseAdmin
        .from('barangay_users')
        .select('id, is_active')
        .eq('id', record.user_id)
        .maybeSingle();

      if (existingUser) {
        // User already exists (e.g., was created before this flow) — just activate
        await supabaseAdmin
          .from('barangay_users')
          .update({ is_active: true })
          .eq('id', record.user_id);
        console.log('[DispatcherVerification] Activated existing barangay_user:', record.user_id);
      } else {
        // Create a new barangay_users entry using the same user_id UUID
        const insertPayload: any = {
          full_name: record.full_name,
          email: record.email,
          phone: record.phone || null,
          barangay_id: record.barangay_id,
          role: 'dispatcher',
          is_active: true,
        };
        // Include password_hash if available from local store
        if (passwordHash) {
          insertPayload.password_hash = passwordHash;
        }
        // Try to use the same UUID — Supabase allows explicit id if not auto-generated
        try {
          insertPayload.id = record.user_id;
          const { error: insertErr } = await supabaseAdmin
            .from('barangay_users')
            .insert(insertPayload);
          if (insertErr) {
            // If explicit ID fails, try without (let Supabase generate a new one)
            console.warn('[DispatcherVerification] Insert with explicit id failed, retrying:', insertErr.message);
            delete insertPayload.id;
            const { data: newUser, error: insertErr2 } = await supabaseAdmin
              .from('barangay_users')
              .insert(insertPayload)
              .select('id')
              .single();
            if (insertErr2) {
              console.error('[DispatcherVerification] Failed to create barangay_user:', insertErr2.message);
            } else {
              console.log('[DispatcherVerification] Created barangay_user with new id:', newUser?.id);
            }
          } else {
            console.log('[DispatcherVerification] Created barangay_user with matching id:', record.user_id);
          }
        } catch (e2: any) {
          console.error('[DispatcherVerification] Exception creating barangay_user:', e2?.message);
        }
      }
    } catch (err: any) {
      console.error('[DispatcherVerification] Error creating barangay_users entry on approval:', err?.message);
    }

    // 3. Update local store
    const idx = localItems.findIndex((i) => i.id === record.id || i.user_id === record.user_id);
    if (idx >= 0) localItems[idx] = { ...updated, _password_hash: localItems[idx]._password_hash };
    saveLocalStorage(localItems);

    // 4. Real-time broadcast to mobile app & dashboard
    try {
      getIO()?.to(`barangay:${record.barangay_id}`).emit('dispatcher:verified', {
        userId: record.user_id,
        status: 'verified',
        message: 'Your account has been verified and activated by MDRRMO.',
      });
      getIO()?.emit('dispatcher:status_changed', {
        userId: record.user_id,
        status: 'verified',
      });
    } catch (_) {}

    return updated;
  }

  /**
   * MDRRMO rejects dispatcher verification -> account stays restricted
   */
  static async reject(idOrRef: string, adminUserId?: string, reason?: string): Promise<DispatcherVerification> {
    const record = await this.getById(idOrRef);
    if (!record) throw new Error('Verification record not found');

    const defaultReason = 'Submitted certification could not be verified.';
    const finalReason = reason?.trim() || defaultReason;
    const now = new Date().toISOString();

    const updatedHistory: VerificationHistoryEntry[] = [
      ...record.verification_history,
      {
        action: 'Verification Rejected',
        timestamp: now,
        note: `Rejected: ${finalReason}`,
        actor: 'MDRRMO Command Center',
      },
    ];

    const updated: DispatcherVerification = {
      ...record,
      status: 'rejected',
      rejection_reason: finalReason,
      reviewed_at: now,
      reviewed_by: adminUserId || null,
      updated_at: now,
      verification_history: updatedHistory,
    };

    try {
      await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .update({
          status: 'rejected',
          rejection_reason: finalReason,
          reviewed_at: now,
          reviewed_by: adminUserId || null,
          updated_at: now,
          verification_history: updatedHistory,
        })
        .or(`id.eq.${record.id},user_id.eq.${record.user_id}`);
    } catch (_) {}

    // Save local store
    const items = ensureStorage();
    const idx = items.findIndex((i) => i.id === record.id || i.user_id === record.user_id);
    if (idx >= 0) items[idx] = { ...updated, _password_hash: items[idx]._password_hash };
    saveLocalStorage(items);

    // Real-time broadcast to mobile app
    try {
      getIO()?.to(`barangay:${record.barangay_id}`).emit('dispatcher:rejected', {
        userId: record.user_id,
        status: 'rejected',
        reason: finalReason,
      });
      getIO()?.emit('dispatcher:status_changed', {
        userId: record.user_id,
        status: 'rejected',
        reason: finalReason,
      });
    } catch (_) {}

    return updated;
  }

  /**
   * MDRRMO requests correction on the submitted certification
   */
  static async requestCorrection(idOrRef: string, adminUserId?: string, note?: string): Promise<DispatcherVerification> {
    const record = await this.getById(idOrRef);
    if (!record) throw new Error('Verification record not found');

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
      rejection_reason: correctionReason,
      reviewed_at: now,
      reviewed_by: adminUserId || null,
      updated_at: now,
      verification_history: updatedHistory,
    };

    try {
      await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .update({
          status: 'needs_correction',
          rejection_reason: correctionReason,
          reviewed_at: now,
          reviewed_by: adminUserId || null,
          updated_at: now,
          verification_history: updatedHistory,
        })
        .or(`id.eq.${record.id},user_id.eq.${record.user_id}`);
    } catch (_) {}

    const items = ensureStorage();
    const idx = items.findIndex((i) => i.id === record.id || i.user_id === record.user_id);
    if (idx >= 0) items[idx] = { ...updated, _password_hash: items[idx]._password_hash };
    saveLocalStorage(items);

    try {
      getIO()?.to(`barangay:${record.barangay_id}`).emit('dispatcher:correction', {
        userId: record.user_id,
        status: 'needs_correction',
        reason: correctionReason,
      });
      getIO()?.emit('dispatcher:status_changed', {
        userId: record.user_id,
        status: 'needs_correction',
        reason: correctionReason,
      });
    } catch (_) {}

    return updated;
  }

  /**
   * Generate the prefilled Barangay Dispatcher Account Authorization Request PDF
   * Standard A4, Times-Roman 12pt, justified text, official signature block & blank MDRRMO Ref No.
   */
  static generateAuthorizationPDF(params: {
    dispatcherName: string;
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
            Title: 'Barangay Dispatcher Account Authorization Request',
            Author: 'NorzAgapay Crisis Management System',
            Subject: 'Barangay Dispatcher Account Authorization Request',
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
        const fullName = (params.dispatcherName || '').trim();
        const position = normalizePositionDesignation(params.positionDesignation) || '';
        const officialName = (params.officialName || '').trim();

        // 1. Title (Centered, Bold)
        doc.moveDown(1.5);
        doc
          .font('Times-Bold')
          .fontSize(13)
          .text('BARANGAY DISPATCHER ACCOUNT AUTHORIZATION REQUEST', {
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
              ? `This is to certify that ${fullName}, serving as ${position} at Barangay ${barangay}, is authorized by Barangay ${barangay}, Municipality of Norzagaray, Bulacan, to submit this request to add a designated Barangay Dispatcher account to the barangay team in the NorzAgapay Emergency Response and Crisis Management Coordination Application. The dispatcher will coordinate incident reports and official emergency information with the MDRRMO.`
              : `This is to certify that ${fullName} is an authorized representative of Barangay ${barangay}, Municipality of Norzagaray, Bulacan, and is authorized to submit this request to add a designated Barangay Dispatcher account to the barangay team in the NorzAgapay Emergency Response and Crisis Management Coordination Application. The dispatcher will coordinate incident reports and official emergency information with the MDRRMO.`,
            { align: 'justify' }
          );

        doc.moveDown(1.2);

        doc.text(
          `The requested dispatcher account is for use by a person designated by the barangay to relay incident reports, receive official alerts, and communicate with the MDRRMO. The barangay administrator is responsible for ensuring the account is assigned to an authorized team member and used only for official emergency preparedness and response coordination.`,
          { align: 'justify' }
        );

        doc.moveDown(1.2);

        doc.text(
          `This signed authorization supports the barangay's request to add a dispatcher account. The account may be created and activated only after the MDRRMO verifies this document.`,
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
