import React, { useEffect, useState } from 'react';
import { verificationAPI } from '../lib/api';
import toast from 'react-hot-toast';

interface PendingUser {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  role: string;
  unit_type?: string;
  created_at: string;
  certifications: { id: string; cert_type: string; cert_number?: string; file_url?: string }[];
}

interface DispatcherVerification {
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
  verification_history: { action: string; timestamp: string; note?: string; actor?: string }[];
  created_at: string;
  updated_at: string;
}

export default function VerificationPage() {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [archived, setArchived] = useState<PendingUser[]>([]);
  const [pendingDispatchers, setPendingDispatchers] = useState<DispatcherVerification[]>([]);
  const [archivedDispatchers, setArchivedDispatchers] = useState<DispatcherVerification[]>([]);

  const [loading, setLoading] = useState(true);
  const [queueCategory, setQueueCategory] = useState<'officers' | 'dispatchers'>('officers');
  const [viewMode, setViewMode] = useState<'pending' | 'archived'>('pending');

  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null);
  const [selectedDispatcher, setSelectedDispatcher] = useState<DispatcherVerification | null>(null);

  // Rejection & Correction Modals
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('Submitted certification could not be verified.');
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState(
    'Missing official signature or dry seal. Please re-upload with complete official credentials.'
  );

  // Multi-select state (for officers)
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  const fetchVerifications = async () => {
    setLoading(true);
    try {
      const [pendingRes, archivedRes, dispPendingRes, dispArchivedRes] = await Promise.allSettled([
        verificationAPI.pending(),
        verificationAPI.archived(),
        verificationAPI.dispatcherPending(),
        verificationAPI.dispatcherArchived(),
      ]);

      if (pendingRes.status === 'fulfilled') {
        setPending(pendingRes.value.data.pending_verifications || []);
      }
      if (archivedRes.status === 'fulfilled') {
        setArchived(archivedRes.value.data.archived_verifications || []);
      }
      if (dispPendingRes.status === 'fulfilled') {
        setPendingDispatchers(dispPendingRes.value.data.pending_dispatchers || []);
      }
      if (dispArchivedRes.status === 'fulfilled') {
        setArchivedDispatchers(dispArchivedRes.value.data.archived_dispatchers || []);
      }
    } catch {
      toast.error('Failed to load verifications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVerifications();
  }, []);

  // Officer list
  const currentOfficerList = viewMode === 'pending' ? pending : archived;
  const officerCount = currentOfficerList.length;

  // Dispatcher list
  const currentDispatcherList = viewMode === 'pending' ? pendingDispatchers : archivedDispatchers;
  const dispatcherPendingCount = pendingDispatchers.length;

  // Officer handlers
  const handleApprove = async (userId: string) => {
    setActionLoading(true);
    try {
      await verificationAPI.approve(userId);
      toast.success('Officer approved and added to active personnel');
      setSelectedUser(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      fetchVerifications();
    } catch {
      toast.error('Approval failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (userId: string) => {
    setActionLoading(true);
    try {
      await verificationAPI.reject(userId);
      toast.success('Officer application rejected and archived');
      setSelectedUser(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      fetchVerifications();
    } catch {
      toast.error('Rejection failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async (userId: string) => {
    setActionLoading(true);
    try {
      await verificationAPI.restore(userId);
      toast.success('Officer restored to verification queue');
      setSelectedUser(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      fetchVerifications();
    } catch {
      toast.error('Restore failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Bulk actions for officers
  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setActionLoading(true);
    try {
      const ids = Array.from(selectedIds);
      await verificationAPI.bulkApprove(ids);
      toast.success(`Successfully approved ${ids.length} officer(s)`);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      fetchVerifications();
    } catch {
      toast.error('Bulk approval failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return;
    setActionLoading(true);
    try {
      const ids = Array.from(selectedIds);
      await verificationAPI.bulkReject(ids);
      toast.success(`Successfully archived ${ids.length} officer(s)`);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      fetchVerifications();
    } catch {
      toast.error('Bulk rejection failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkRestore = async () => {
    if (selectedIds.size === 0) return;
    setActionLoading(true);
    try {
      const ids = Array.from(selectedIds);
      await verificationAPI.bulkRestore(ids);
      toast.success(`Successfully restored ${ids.length} officer(s) to queue`);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      fetchVerifications();
    } catch {
      toast.error('Bulk restore failed');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleSelectCard = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllToggle = () => {
    if (selectedIds.size === currentOfficerList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentOfficerList.map((u) => u.id)));
    }
  };

  // Dispatcher handlers
  const handleApproveDispatcher = async (id: string) => {
    setActionLoading(true);
    try {
      await verificationAPI.approveDispatcher(id);
      toast.success('Barangay Dispatcher approved and activated!');
      setSelectedDispatcher(null);
      fetchVerifications();
    } catch {
      toast.error('Dispatcher approval failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectDispatcher = async (id: string, reason: string) => {
    setActionLoading(true);
    try {
      await verificationAPI.rejectDispatcher(id, reason);
      toast.success('Dispatcher verification rejected and restricted');
      setRejectModalOpen(false);
      setSelectedDispatcher(null);
      fetchVerifications();
    } catch {
      toast.error('Dispatcher rejection failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCorrectionDispatcher = async (id: string, reason: string) => {
    setActionLoading(true);
    try {
      await verificationAPI.requestCorrectionDispatcher(id, reason);
      toast.success('Correction requested for Dispatcher certification');
      setCorrectionModalOpen(false);
      setSelectedDispatcher(null);
      fetchVerifications();
    } catch {
      toast.error('Correction request failed');
    } finally {
      setActionLoading(false);
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'professional_unit':
        return 'MDRRMO OFFICER';
      default:
        return role.replace(/_/g, ' ').toUpperCase();
    }
  };

  const formatDateTime = (dateStr?: string | null) => {
    if (!dateStr) return 'Not yet submitted';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'under_review':
        return <span className="status-pill status-review">● Under Review</span>;
      case 'pending_document':
        return <span className="status-pill status-pending">○ Awaiting Document</span>;
      case 'verified':
        return <span className="status-pill status-verified">✓ Verified / Active</span>;
      case 'needs_correction':
        return <span className="status-pill status-correction">⚠ Needs Correction</span>;
      case 'rejected':
        return <span className="status-pill status-rejected">✕ Rejected</span>;
      default:
        return <span className="status-pill status-pending">Pending</span>;
    }
  };

  return (
    <div className="oq-container">
      <style>{`
        .oq-container {
          padding: 24px 32px;
          min-height: 100vh;
          background-color: #0b111e;
          color: #f8fafc;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        .oq-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 16px;
        }

        .oq-title {
          font-size: 26px;
          font-weight: 800;
          color: #f8fafc;
          margin: 0;
          letter-spacing: -0.5px;
        }

        .oq-header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .oq-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background-color: #0e2238;
          border: 1.5px solid #1e3a8a;
          color: #38bdf8;
          font-size: 12px;
          font-weight: 700;
          padding: 7px 14px;
          border-radius: 8px;
          letter-spacing: 0.5px;
          user-select: none;
          transition: all 0.2s ease;
        }

        .oq-badge:hover {
          border-color: #38bdf8;
          background-color: #122b47;
        }

        .oq-badge.active-queue {
          background: linear-gradient(135deg, #0e3056, #0c2340);
          border-color: #38bdf8;
          box-shadow: 0 0 14px rgba(56, 189, 248, 0.35);
          color: #ffffff;
        }

        .oq-badge-dispatcher {
          background-color: #132238;
          border-color: #1e3a5f;
          color: #60a5fa;
        }

        .oq-badge-dispatcher.active-queue {
          background: linear-gradient(135deg, #1e3a8a, #0f2b48);
          border-color: #60a5fa;
          box-shadow: 0 0 14px rgba(96, 165, 250, 0.35);
          color: #ffffff;
        }

        .oq-archive-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background-color: #0e2238;
          border: 1.5px solid #1e3a8a;
          color: #94a3b8;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .oq-archive-btn:hover {
          color: #f8fafc;
          border-color: #38bdf8;
          background-color: #162e4a;
        }

        .oq-archive-btn.active {
          background-color: #0284c7;
          border-color: #38bdf8;
          color: #ffffff;
        }

        /* Queue Selector Tabs */
        .oq-tabs-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
          border-bottom: 1px solid #1e293b;
          padding-bottom: 12px;
        }

        .oq-tab-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 14px;
          font-weight: 600;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .oq-tab-btn:hover {
          color: #f8fafc;
          background-color: #1e293b;
        }

        .oq-tab-btn.active {
          color: #ffffff;
          background-color: #0284c7;
          box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
        }

        .oq-tab-count {
          background: rgba(255, 255, 255, 0.2);
          padding: 2px 7px;
          border-radius: 12px;
          font-size: 11px;
        }

        /* Action Bar */
        .oq-action-bar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          margin-bottom: 20px;
          min-height: 40px;
        }

        .oq-action-bar.is-multi {
          justify-content: space-between;
          background-color: #121c2d;
          border: 1px solid #1e2d42;
          padding: 8px 16px;
          border-radius: 8px;
        }

        .oq-multi-btn {
          background-color: #ffffff;
          color: #0f172a;
          border: none;
          padding: 8px 18px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.15s ease;
        }

        .oq-multi-btn:hover {
          background-color: #f1f5f9;
        }

        .oq-cancel-btn {
          background-color: transparent;
          color: #94a3b8;
          border: 1px solid #334155;
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .oq-cancel-btn:hover {
          color: #ffffff;
          border-color: #64748b;
        }

        .oq-btn-reject {
          background-color: #ef4444;
          color: #ffffff;
          border: none;
          padding: 7px 16px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s ease;
        }

        .oq-btn-reject:hover:not(:disabled) {
          opacity: 0.9;
        }

        .oq-btn-accept {
          background-color: #10b981;
          color: #ffffff;
          border: none;
          padding: 7px 16px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s ease;
        }

        .oq-btn-accept:hover:not(:disabled) {
          opacity: 0.9;
        }

        .oq-btn-restore {
          background-color: #0284c7;
          color: #ffffff;
          border: none;
          padding: 7px 16px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s ease;
        }

        .oq-btn-restore:hover:not(:disabled) {
          opacity: 0.9;
        }

        .oq-btn-review {
          background: linear-gradient(135deg, #0284c7, #0ea5e9);
          color: #ffffff;
          border: none;
          padding: 6px 16px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 2px 6px rgba(2, 132, 199, 0.35);
        }

        .oq-btn-review:hover {
          background: linear-gradient(135deg, #0369a1, #0284c7);
          box-shadow: 0 3px 10px rgba(2, 132, 199, 0.5);
          transform: translateY(-1px);
        }

        /* Officer Card Grid */
        .oq-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
        }

        .oq-card {
          background-color: #121c2d;
          border: 1px solid #1e2d42;
          border-radius: 12px;
          padding: 20px;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .oq-card:hover {
          border-color: #38bdf8;
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
        }

        .oq-card.selected {
          border-color: #38bdf8;
          background-color: #0e2238;
        }

        .oq-card-name {
          font-size: 16px;
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 6px;
        }

        .oq-card-role {
          font-size: 12px;
          color: #38bdf8;
          font-weight: 600;
          text-transform: uppercase;
          margin-bottom: 14px;
        }

        .oq-card-meta {
          font-size: 12px;
          color: #64748b;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        /* Dispatcher Table (Image 2 style) */
        .disp-table-wrapper {
          background-color: #111a2e;
          border: 1px solid #1e293b;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .disp-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        .disp-table th {
          background-color: #0b1322;
          color: #94a3b8;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 14px 20px;
          border-bottom: 1px solid #1e293b;
        }

        .disp-table td {
          padding: 16px 20px;
          font-size: 14px;
          color: #f8fafc;
          border-bottom: 1px solid #162338;
          vertical-align: middle;
        }

        .disp-table tr:hover td {
          background-color: #15223c;
        }

        .disp-applicant-name {
          font-weight: 700;
          color: #ffffff;
        }

        .disp-applicant-meta {
          font-size: 12px;
          color: #64748b;
          margin-top: 2px;
        }

        .disp-barangay-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #e2e8f0;
          font-weight: 600;
        }

        .disp-doc-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #0f2744;
          border: 1px solid #1e3a8a;
          color: #38bdf8;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
        }

        /* Status Pills */
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 20px;
        }

        .status-review {
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.35);
        }

        .status-pending {
          background: rgba(148, 163, 184, 0.15);
          color: #94a3b8;
          border: 1px solid rgba(148, 163, 184, 0.35);
        }

        .status-verified {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.35);
        }

        .status-rejected {
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.35);
        }

        .status-correction {
          background: rgba(168, 85, 247, 0.15);
          color: #c084fc;
          border: 1px solid rgba(168, 85, 247, 0.35);
        }

        /* Modals */
        .oq-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(4, 9, 20, 0.85);
          backdrop-filter: blur(5px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }

        .oq-modal {
          background: #0b1626;
          border: 1.5px solid #38bdf8;
          border-radius: 16px;
          width: 100%;
          max-width: 440px;
          padding: 24px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 25px rgba(56, 189, 248, 0.2);
          animation: oqPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .disp-modal {
          max-width: 680px;
          max-height: 90vh;
          overflow-y: auto;
        }

        @keyframes oqPopIn {
          0% { transform: scale(0.95); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        .review-section {
          background: #0e1d33;
          border: 1px solid #1a2f4c;
          border-radius: 10px;
          padding: 16px;
          margin-bottom: 16px;
        }

        .review-section-title {
          font-size: 13px;
          font-weight: 700;
          color: #38bdf8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .review-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .review-field-label {
          font-size: 11px;
          color: #64748b;
          text-transform: uppercase;
          font-weight: 600;
          margin-bottom: 2px;
        }

        .review-field-value {
          font-size: 14px;
          color: #f8fafc;
          font-weight: 600;
        }

        .doc-preview-box {
          background: #060e1a;
          border: 1px dashed #1e3a8a;
          border-radius: 8px;
          padding: 16px;
          text-align: center;
          margin-top: 8px;
        }

        .timeline-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 8px;
        }

        .timeline-item {
          display: flex;
          gap: 10px;
          font-size: 12px;
          border-left: 2px solid #0284c7;
          padding-left: 10px;
        }

        .timeline-action {
          color: #38bdf8;
          font-weight: 700;
        }

        .timeline-time {
          color: #64748b;
          font-size: 11px;
        }

        .timeline-note {
          color: #94a3b8;
          margin-top: 2px;
        }

        .oq-empty {
          text-align: center;
          padding: 60px 20px;
          color: #64748b;
        }

        .oq-empty-icon {
          font-size: 40px;
          margin-bottom: 12px;
        }
      `}</style>

      {/* Page Header */}
      <div className="oq-header">
        <h1 className="oq-title">
          {queueCategory === 'officers'
            ? viewMode === 'pending'
              ? 'Officer Verification Queue'
              : 'Officer Archive'
            : viewMode === 'pending'
            ? 'Pending Dispatcher Verifications'
            : 'Archived Dispatchers'}
        </h1>

        <div className="oq-header-right">
          {/* Officer badge */}
          <div
            className={`oq-badge ${queueCategory === 'officers' ? 'active-queue' : ''}`}
            onClick={() => {
              setQueueCategory('officers');
              setIsMultiSelect(false);
              setSelectedIds(new Set());
            }}
            style={{ cursor: 'pointer' }}
            title="Switch to Officer Verification Queue"
          >
            {viewMode === 'pending' ? '🥇' : '📦'}{' '}
            {officerCount} {viewMode === 'pending' ? 'PENDING OFFICER' : 'ARCHIVED OFFICER'}
            {officerCount === 1 ? '' : 'S'}
          </div>

          {/* Barangay Dispatcher badge beside the officer badge (matching Image 3) */}
          <div
            className={`oq-badge oq-badge-dispatcher ${queueCategory === 'dispatchers' ? 'active-queue' : ''}`}
            onClick={() => {
              setQueueCategory('dispatchers');
              setIsMultiSelect(false);
              setSelectedIds(new Set());
            }}
            style={{ cursor: 'pointer' }}
            title="Switch to Barangay Dispatcher Verifications"
          >
            📋 {dispatcherPendingCount} PENDING DISPATCHER
            {dispatcherPendingCount === 1 ? '' : 'S'}
          </div>

          {/* Archive Icon Button */}
          <button
            className={`oq-archive-btn ${viewMode === 'archived' ? 'active' : ''}`}
            onClick={() => {
              setViewMode((v) => (v === 'pending' ? 'archived' : 'pending'));
              setIsMultiSelect(false);
              setSelectedIds(new Set());
            }}
            title={viewMode === 'pending' ? 'View Archive' : 'Back to Verification Queue'}
            aria-label="Toggle archive view"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Queue Category Tabs */}
      <div className="oq-tabs-bar">
        <button
          className={`oq-tab-btn ${queueCategory === 'officers' ? 'active' : ''}`}
          onClick={() => {
            setQueueCategory('officers');
            setIsMultiSelect(false);
            setSelectedIds(new Set());
          }}
        >
          <span>MDRRMO Officers</span>
          <span className="oq-tab-count">{pending.length}</span>
        </button>

        <button
          className={`oq-tab-btn ${queueCategory === 'dispatchers' ? 'active' : ''}`}
          onClick={() => {
            setQueueCategory('dispatchers');
            setIsMultiSelect(false);
            setSelectedIds(new Set());
          }}
        >
          <span>Barangay Dispatchers</span>
          <span className="oq-tab-count">{pendingDispatchers.length}</span>
        </button>
      </div>

      {/* Main Content Area */}
      {queueCategory === 'officers' ? (
        /* ========================================================================= */
        /* OFFICER VERIFICATION QUEUE                                                */
        /* ========================================================================= */
        <>
          {/* Action Bar */}
          <div className={`oq-action-bar ${isMultiSelect ? 'is-multi' : ''}`}>
            {isMultiSelect ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <label
                    className="oq-select-all-control"
                    onClick={handleSelectAllToggle}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        border: '1.5px solid #38bdf8',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor:
                          selectedIds.size > 0 && selectedIds.size === currentOfficerList.length
                            ? '#0284c7'
                            : 'transparent',
                      }}
                    >
                      {selectedIds.size > 0 && selectedIds.size === currentOfficerList.length && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <span>Select all ({selectedIds.size} selected)</span>
                  </label>

                  <button
                    className="oq-cancel-btn"
                    onClick={() => {
                      setIsMultiSelect(false);
                      setSelectedIds(new Set());
                    }}
                  >
                    Cancel
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {viewMode === 'pending' ? (
                    <>
                      <button
                        className="oq-btn-reject"
                        disabled={selectedIds.size === 0 || actionLoading}
                        onClick={handleBulkReject}
                      >
                        Reject
                      </button>
                      <button
                        className="oq-btn-accept"
                        disabled={selectedIds.size === 0 || actionLoading}
                        onClick={handleBulkApprove}
                      >
                        Accept
                      </button>
                    </>
                  ) : (
                    <button
                      className="oq-btn-restore"
                      disabled={selectedIds.size === 0 || actionLoading}
                      onClick={handleBulkRestore}
                    >
                      Restore
                    </button>
                  )}
                </div>
              </>
            ) : (
              <button
                className="oq-multi-btn"
                onClick={() => setIsMultiSelect(true)}
                disabled={currentOfficerList.length === 0}
              >
                Select multiple
              </button>
            )}
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <div className="spinner" />
            </div>
          ) : currentOfficerList.length === 0 ? (
            <div className="oq-empty">
              <div className="oq-empty-icon">{viewMode === 'pending' ? '✅' : '📦'}</div>
              <p style={{ fontSize: '16px', fontWeight: 600, color: '#94a3b8' }}>
                {viewMode === 'pending' ? 'No pending officer verifications' : 'No archived officers'}
              </p>
              <p style={{ fontSize: '13px', marginTop: '6px' }}>
                {viewMode === 'pending'
                  ? 'All officer registrations have been reviewed.'
                  : 'Rejected applications will appear here and can be restored at any time.'}
              </p>
            </div>
          ) : (
            <div className="oq-card-grid">
              {currentOfficerList.map((user) => {
                const isSelected = selectedIds.has(user.id);
                return (
                  <div
                    key={user.id}
                    className={`oq-card ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => {
                      if (isMultiSelect) {
                        toggleSelectCard(user.id, e);
                      } else {
                        setSelectedUser(user);
                      }
                    }}
                  >
                    <div className="oq-card-name">{user.full_name}</div>
                    <div className="oq-card-role">{getRoleLabel(user.role)}</div>
                    <div className="oq-card-meta">
                      <span>applied at: {formatDateTime(user.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ========================================================================= */
        /* BARANGAY DISPATCHER VERIFICATION QUEUE (IMAGE 2)                          */
        /* ========================================================================= */
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 14, color: '#94a3b8' }}>
              {viewMode === 'pending'
                ? 'Review submitted certifications from Barangay Dispatchers for system activation.'
                : 'Archived and rejected Barangay Dispatcher applications.'}
            </div>
            <button
              className="oq-cancel-btn"
              onClick={fetchVerifications}
              disabled={loading}
              title="Refresh queue"
            >
              ↻ Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <div className="spinner" />
            </div>
          ) : currentDispatcherList.length === 0 ? (
            <div className="oq-empty">
              <div className="oq-empty-icon">{viewMode === 'pending' ? '✅' : '📦'}</div>
              <p style={{ fontSize: '16px', fontWeight: 600, color: '#94a3b8' }}>
                {viewMode === 'pending'
                  ? 'No pending dispatcher verifications'
                  : 'No archived dispatcher records'}
              </p>
              <p style={{ fontSize: '13px', marginTop: '6px' }}>
                {viewMode === 'pending'
                  ? 'All Barangay Dispatcher registration requests have been reviewed.'
                  : 'Rejected or archived dispatchers will appear here.'}
              </p>
            </div>
          ) : (
            <div className="disp-table-wrapper">
              <table className="disp-table">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Barangay</th>
                    <th>Document</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {currentDispatcherList.map((disp) => (
                    <tr key={disp.id}>
                      <td>
                        <div className="disp-applicant-name">{disp.full_name}</div>
                        <div className="disp-applicant-meta">
                          {disp.email} {disp.phone ? `• ${disp.phone}` : ''}
                        </div>
                      </td>
                      <td>
                        <div className="disp-barangay-pill">
                          <span>📍</span>
                          <span>{disp.barangay_name || 'Barangay'}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {disp.position_designation || 'Barangay Dispatcher'}
                        </div>
                      </td>
                      <td>
                        <div className="disp-doc-badge">
                          <span>📄</span>
                          <span>Authorization</span>
                        </div>
                        {disp.document_url && (
                          <div style={{ fontSize: 11, color: '#10b981', marginTop: 3 }}>
                            ✓ Signed & Sealed Uploaded
                          </div>
                        )}
                      </td>
                      <td>{getStatusBadge(disp.status)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="oq-btn-review"
                          onClick={() => setSelectedDispatcher(disp)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* OFFICER DETAIL MODAL                                                      */}
      {/* ========================================================================= */}
      {selectedUser && (
        <div className="oq-modal-backdrop" onClick={() => setSelectedUser(null)}>
          <div className="oq-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>Officer Details</div>
              <button
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer' }}
                onClick={() => setSelectedUser(null)}
              >
                ✕
              </button>
            </div>
            <div className="oq-card-name" style={{ fontSize: 20 }}>{selectedUser.full_name}</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>{selectedUser.email}</div>
            <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600, marginBottom: 16 }}>
              {getRoleLabel(selectedUser.role)}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20 }}>
              Applied: {formatDateTime(selectedUser.created_at)}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              {viewMode === 'pending' ? (
                <>
                  <button
                    className="oq-btn-reject"
                    style={{ flex: 1 }}
                    disabled={actionLoading}
                    onClick={() => handleReject(selectedUser.id)}
                  >
                    Reject
                  </button>
                  <button
                    className="oq-btn-accept"
                    style={{ flex: 1 }}
                    disabled={actionLoading}
                    onClick={() => handleApprove(selectedUser.id)}
                  >
                    Accept
                  </button>
                </>
              ) : (
                <button
                  className="oq-btn-restore"
                  style={{ flex: 1 }}
                  disabled={actionLoading}
                  onClick={() => handleRestore(selectedUser.id)}
                >
                  Restore
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DISPATCHER REVIEW MODAL (IMAGE 2)                                         */}
      {/* ========================================================================= */}
      {selectedDispatcher && (
        <div className="oq-modal-backdrop" onClick={() => setSelectedDispatcher(null)}>
          <div className="oq-modal disp-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#ffffff', letterSpacing: -0.3 }}>
                  Dispatcher Verification Review
                </div>
                <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600, marginTop: 2 }}>
                  Ref No: {selectedDispatcher.reference_no}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {getStatusBadge(selectedDispatcher.status)}
                <button
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', padding: 4 }}
                  onClick={() => setSelectedDispatcher(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Section 1: Dispatcher Information & Barangay */}
            <div className="review-section">
              <div className="review-section-title">
                <span>👤</span>
                <span>Dispatcher & Barangay Information</span>
              </div>
              <div className="review-grid">
                <div>
                  <div className="review-field-label">Full Name</div>
                  <div className="review-field-value">{selectedDispatcher.full_name}</div>
                </div>
                <div>
                  <div className="review-field-label">Position / Designation</div>
                  <div className="review-field-value">{selectedDispatcher.position_designation}</div>
                </div>
                <div>
                  <div className="review-field-label">Barangay</div>
                  <div className="review-field-value">{selectedDispatcher.barangay_name || 'Norzagaray'}</div>
                </div>
                <div>
                  <div className="review-field-label">Authorized Official</div>
                  <div className="review-field-value">
                    {selectedDispatcher.punong_barangay_name}
                    <div style={{ fontSize: 11, color: '#64748b' }}>({selectedDispatcher.punong_barangay_position})</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Contact Information & Submission Date */}
            <div className="review-section">
              <div className="review-section-title">
                <span>📞</span>
                <span>Contact & Submission Details</span>
              </div>
              <div className="review-grid">
                <div>
                  <div className="review-field-label">Email Address</div>
                  <div className="review-field-value">{selectedDispatcher.email}</div>
                </div>
                <div>
                  <div className="review-field-label">Contact Number</div>
                  <div className="review-field-value">{selectedDispatcher.phone || 'Not provided'}</div>
                </div>
                <div>
                  <div className="review-field-label">Date Submitted</div>
                  <div className="review-field-value">{formatDateTime(selectedDispatcher.submitted_at)}</div>
                </div>
                <div>
                  <div className="review-field-label">Registration Date</div>
                  <div className="review-field-value">{formatDateTime(selectedDispatcher.created_at)}</div>
                </div>
              </div>
            </div>

            {/* Section 3: Submitted Certification Document */}
            <div className="review-section">
              <div className="review-section-title">
                <span>📑</span>
                <span>Submitted Certification</span>
              </div>

              {selectedDispatcher.document_url ? (
                <div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                    <a
                      href={selectedDispatcher.document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="oq-btn-review"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span>🔍</span>
                      <span>View Full Document</span>
                    </a>

                    <a
                      href={`http://localhost:3001/api/barangay/dispatcher/authorization-pdf?userId=${selectedDispatcher.user_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="oq-cancel-btn"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span>🖨️</span>
                      <span>View System-Generated PDF</span>
                    </a>
                  </div>

                  {/* Document preview container */}
                  <div className="doc-preview-box">
                    {selectedDispatcher.document_url.toLowerCase().endsWith('.pdf') ? (
                      <div style={{ padding: 20 }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                        <div style={{ color: '#ffffff', fontWeight: 600 }}>PDF Certification Document</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                          Click "View Full Document" above to inspect the signed & sealed PDF.
                        </div>
                      </div>
                    ) : (
                      <img
                        src={selectedDispatcher.document_url}
                        alt="Submitted Certification"
                        style={{
                          maxWidth: '100%',
                          maxHeight: 280,
                          objectFit: 'contain',
                          borderRadius: 6,
                          border: '1px solid #1e3a8a',
                        }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="doc-preview-box" style={{ color: '#94a3b8' }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>⏳</div>
                  <div>Dispatcher has not yet uploaded the signed certification.</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    Waiting for the applicant to print, get signature/seal, and submit.
                  </div>
                </div>
              )}
            </div>

            {/* Section 4: Verification History */}
            <div className="review-section">
              <div className="review-section-title">
                <span>🕒</span>
                <span>Verification History</span>
              </div>
              <div className="timeline-list">
                {selectedDispatcher.verification_history && selectedDispatcher.verification_history.length > 0 ? (
                  selectedDispatcher.verification_history.map((h, i) => (
                    <div key={i} className="timeline-item">
                      <div>
                        <span className="timeline-action">{h.action}</span>{' '}
                        <span className="timeline-time">({formatDateTime(h.timestamp)})</span>
                        {h.note && <div className="timeline-note">{h.note}</div>}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b' }}>No history entries available.</div>
                )}
              </div>
            </div>

            {/* Modal Bottom Actions (Approve, Reject, Request Correction) */}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                className="oq-btn-accept"
                style={{ flex: 1.2, padding: '10px 0' }}
                disabled={actionLoading}
                onClick={() => handleApproveDispatcher(selectedDispatcher.id)}
              >
                ✓ Approve & Activate
              </button>

              <button
                className="oq-btn-reject"
                style={{ flex: 1, padding: '10px 0' }}
                disabled={actionLoading}
                onClick={() => setRejectModalOpen(true)}
              >
                ✕ Reject
              </button>

              <button
                style={{
                  flex: 1.2,
                  padding: '10px 0',
                  backgroundColor: '#7c3aed',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
                disabled={actionLoading}
                onClick={() => setCorrectionModalOpen(true)}
              >
                ✎ Request Correction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* REJECTION REASON MODAL                                                    */}
      {/* ========================================================================= */}
      {rejectModalOpen && selectedDispatcher && (
        <div className="oq-modal-backdrop" style={{ zIndex: 1100 }}>
          <div className="oq-modal" style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444', marginBottom: 8 }}>
              Reject Dispatcher Verification
            </div>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>
              The dispatcher's account will remain restricted. Provide a reason so they can resubmit the correct documents.
            </p>

            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                color: '#ffffff',
                borderRadius: 8,
                padding: 10,
                fontSize: 13,
                marginBottom: 16,
                resize: 'none',
              }}
              placeholder="Enter rejection reason..."
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="oq-cancel-btn"
                style={{ flex: 1 }}
                onClick={() => setRejectModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="oq-btn-reject"
                style={{ flex: 1 }}
                disabled={actionLoading || !rejectReason.trim()}
                onClick={() => handleRejectDispatcher(selectedDispatcher.id, rejectReason)}
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CORRECTION REQUEST MODAL                                                  */}
      {/* ========================================================================= */}
      {correctionModalOpen && selectedDispatcher && (
        <div className="oq-modal-backdrop" style={{ zIndex: 1100 }}>
          <div className="oq-modal" style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#a855f7', marginBottom: 8 }}>
              Request Document Correction
            </div>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>
              Explain to the applicant what needs to be fixed before their account can be approved.
            </p>

            <textarea
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                color: '#ffffff',
                borderRadius: 8,
                padding: 10,
                fontSize: 13,
                marginBottom: 16,
                resize: 'none',
              }}
              placeholder="Specify required corrections..."
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="oq-cancel-btn"
                style={{ flex: 1 }}
                onClick={() => setCorrectionModalOpen(false)}
              >
                Cancel
              </button>
              <button
                style={{
                  flex: 1,
                  backgroundColor: '#7c3aed',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: 8,
                }}
                disabled={actionLoading || !correctionReason.trim()}
                onClick={() => handleCorrectionDispatcher(selectedDispatcher.id, correctionReason)}
              >
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
