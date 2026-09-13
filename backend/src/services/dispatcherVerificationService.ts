import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { supabaseAdmin } from '../config/supabase';
import { io } from '../server';

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

export class DispatcherVerificationService {
  /**
   * Initialize a new verification record upon dispatcher registration
   */
  static async createVerification(params: {
    userId: string;
    barangayId: string;
    barangayName?: string;
    fullName: string;
    email: string;
    phone?: string | null;
    positionDesignation?: string;
    punongBarangayName?: string;
    punongBarangayPosition?: string;
  }): Promise<DispatcherVerification> {
    const now = new Date().toISOString();
    const referenceNo = generateReferenceNo();

    const record: DispatcherVerification = {
      id: `disp-ver-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      user_id: params.userId,
      barangay_id: params.barangayId,
      barangay_name: params.barangayName || 'Barangay',
      full_name: params.fullName,
      email: params.email,
      phone: params.phone || null,
      position_designation: params.positionDesignation || 'Barangay Dispatcher',
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
          action: 'Account Registered',
          timestamp: now,
          note: 'Dispatcher account created. Pending authorization certification.',
          actor: params.fullName,
        },
      ],
      created_at: now,
      updated_at: now,
    };

    // Attempt to persist to Supabase
    try {
      const { data, error } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .insert({
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
        })
        .select()
        .single();

      if (!error && data) {
        record.id = data.id;
      }
    } catch (e) {
      // Supabase table not migrated yet; fallback to local persistence
    }

    // Always update local persistent fallback
    const items = ensureStorage();
    const idx = items.findIndex((i) => i.user_id === params.userId);
    if (idx >= 0) {
      items[idx] = record;
    } else {
      items.push(record);
    }
    saveLocalStorage(items);

    return record;
  }

  /**
   * Get verification record by user id
   */
  static async getByUserId(userId: string): Promise<DispatcherVerification | null> {
    // Try Supabase first
    try {
      const { data, error } = await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .select('*, barangays(name)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        const item = {
          ...data,
          barangay_name: data.barangays?.name || data.barangay_name || 'Barangay',
        };
        // sync to local store
        const items = ensureStorage();
        const idx = items.findIndex((i) => i.user_id === userId);
        if (idx >= 0) items[idx] = item;
        else items.push(item);
        saveLocalStorage(items);
        return item;
      }
    } catch (_) {}

    // Fallback to local store
    const items = ensureStorage();
    return items.find((i) => i.user_id === userId) || null;
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
      // Find the user to create a record if missing
      const { data: user } = await supabaseAdmin
        .from('barangay_users')
        .select('id, full_name, email, phone, barangay_id, barangays(name)')
        .eq('id', userId)
        .single();

      if (!user) throw new Error('Barangay user not found');

      existing = await this.createVerification({
        userId: user.id,
        barangayId: user.barangay_id,
        barangayName: (user as any).barangays?.name,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
      });
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
    if (idx >= 0) items[idx] = updated;
    else items.push(updated);
    saveLocalStorage(items);

    // Notify command center via socket
    try {
      io.to('commanders').emit('verification:dispatcher_submitted', {
        id: updated.id,
        applicant: updated.full_name,
        barangay: updated.barangay_name,
        reference_no: updated.reference_no,
      });
    } catch (_) {}

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
    if (idx >= 0) items[idx] = updated;
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
        .in('status', ['rejected', 'verified'])
        .order('reviewed_at', { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map((d: any) => ({
          ...d,
          barangay_name: d.barangays?.name || d.barangay_name || 'Barangay',
        }));
      }
    } catch (_) {}

    const items = ensureStorage();
    return items.filter((i) => ['rejected', 'verified'].includes(i.status));
  }

  /**
   * MDRRMO approves dispatcher verification -> activates account
   */
  static async approve(idOrRef: string, adminUserId?: string, note?: string): Promise<DispatcherVerification> {
    const record = await this.getById(idOrRef);
    if (!record) throw new Error('Verification record not found');

    const now = new Date().toISOString();
    const updatedHistory: VerificationHistoryEntry[] = [
      ...record.verification_history,
      {
        action: 'Account Approved & Activated',
        timestamp: now,
        note: note || 'MDRRMO verified signed authorization. Account activated.',
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

    // 1. Update verification table in Supabase
    try {
      await supabaseAdmin
        .from('barangay_dispatcher_verifications')
        .update({
          status: 'verified',
          rejection_reason: null,
          reviewed_at: now,
          reviewed_by: adminUserId || null,
          updated_at: now,
          verification_history: updatedHistory,
        })
        .or(`id.eq.${record.id},user_id.eq.${record.user_id}`);
    } catch (_) {}

    // 2. Activate user in barangay_users
    try {
      await supabaseAdmin
        .from('barangay_users')
        .update({
          is_active: true,
          verification_status: 'verified',
        })
        .eq('id', record.user_id);
    } catch (err) {
      console.error('Error activating barangay user in Supabase:', err);
    }

    // 3. Update local store
    const items = ensureStorage();
    const idx = items.findIndex((i) => i.id === record.id || i.user_id === record.user_id);
    if (idx >= 0) items[idx] = updated;
    saveLocalStorage(items);

    // 4. Real-time broadcast to mobile app & dashboard
    try {
      io.to(`barangay:${record.barangay_id}`).emit('dispatcher:verified', {
        userId: record.user_id,
        status: 'verified',
        message: 'Your account has been verified and activated by MDRRMO.',
      });
      io.emit('dispatcher:status_changed', {
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

    // Update Supabase
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

    // Ensure account remains restricted
    try {
      await supabaseAdmin
        .from('barangay_users')
        .update({
          is_active: false,
          verification_status: 'rejected',
        })
        .eq('id', record.user_id);
    } catch (_) {}

    // Save local store
    const items = ensureStorage();
    const idx = items.findIndex((i) => i.id === record.id || i.user_id === record.user_id);
    if (idx >= 0) items[idx] = updated;
    saveLocalStorage(items);

    // Real-time broadcast to mobile app
    try {
      io.to(`barangay:${record.barangay_id}`).emit('dispatcher:rejected', {
        userId: record.user_id,
        status: 'rejected',
        reason: finalReason,
      });
      io.emit('dispatcher:status_changed', {
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
    if (idx >= 0) items[idx] = updated;
    saveLocalStorage(items);

    try {
      io.to(`barangay:${record.barangay_id}`).emit('dispatcher:correction', {
        userId: record.user_id,
        status: 'needs_correction',
        reason: correctionReason,
      });
      io.emit('dispatcher:status_changed', {
        userId: record.user_id,
        status: 'needs_correction',
        reason: correctionReason,
      });
    } catch (_) {}

    return updated;
  }

  /**
   * Generate the prefilled PDF authorization certification matching Image 1
   */
  static generateAuthorizationPDF(params: {
    dispatcherName: string;
    positionDesignation: string;
    barangayName: string;
    officialName: string;
    officialPosition: string;
    referenceNo: string;
    dateStr?: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'LETTER',
          margins: { top: 60, bottom: 60, left: 65, right: 65 },
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

        const barangay = params.barangayName.replace(/^Brgy\.?\s*/i, '');

        // Title (Centered, Bold)
        doc.moveDown(2);
        doc
          .font('Helvetica-Bold')
          .fontSize(13)
          .text('BARANGAY DISPATCHER AUTHORIZATION AND CERTIFICATION', {
            align: 'center',
          });

        doc.moveDown(3);

        // Date
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(`Date: ${currentDate}`, { align: 'left' });

        doc.moveDown(1.5);

        // Paragraph 1
        doc
          .font('Helvetica')
          .fontSize(11)
          .lineGap(4)
          .text(
            `This is to certify that ${params.dispatcherName}, a ${params.positionDesignation} at Barangay ${barangay}.`,
            { align: 'justify' }
          );

        doc.moveDown(1);

        // Paragraph 2
        doc.text(
          `Is an authorized representative of Barangay ${barangay}, Municipality of Norzagaray, Bulacan, and is hereby authorized to act as a Barangay Dispatcher for the purpose of coordinating and communicating disaster, emergency, and incident-related information through the NorzAgapay Real-Time Crisis Management and Volunteer Logistics Application.`,
          { align: 'justify' }
        );

        doc.moveDown(1);

        // Paragraph 3
        doc.text(
          `This authorization is issued for official barangay disaster risk reduction and management coordination purposes. The dispatcher is expected to use the account responsibly and only for legitimate activities related to emergency preparedness, response, and coordination.`,
          { align: 'justify' }
        );

        doc.moveDown(1);

        // Paragraph 4
        doc.text(
          `This certification is issued upon the request of the above-named individual for the purpose of account verification and activation as a Barangay Dispatcher in the NorzAgapay Application.`,
          { align: 'justify' }
        );

        doc.moveDown(4);

        // Certification & Authorization Section
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .text('CERTIFIED AND AUTHORIZED BY:', { align: 'left' });

        doc.moveDown(4);

        // Signature Line & Official Details (Centered in column or signature block)
        const signatureX = 160;
        doc
          .font('Helvetica')
          .fontSize(11)
          .text('_______________________________________', signatureX, doc.y, {
            align: 'center',
            width: 320,
          });

        doc.moveDown(0.5);
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(params.officialName || 'Punong Barangay / Authorized Barangay Official', signatureX, doc.y, {
            align: 'center',
            width: 320,
          });

        doc.moveDown(0.3);
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(params.officialPosition || 'Punong Barangay / Authorized Barangay Official', signatureX, doc.y, {
            align: 'center',
            width: 320,
          });

        // Bottom Reference
        doc.y = 700;
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(`MDRRMO Verification Reference No.: ${params.referenceNo}`, 65, doc.y);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
