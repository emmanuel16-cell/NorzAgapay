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
  certifications: { id: string; cert_type: string; cert_number?: string; file_url?: string; }[];
}

export default function VerificationPage() {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [archived, setArchived] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'pending' | 'archived'>('pending');
  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null);

  // Multi-select state
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  const fetchVerifications = async () => {
    setLoading(true);
    try {
      const [pendingRes, archivedRes] = await Promise.allSettled([
        verificationAPI.pending(),
        verificationAPI.archived(),
      ]);

      if (pendingRes.status === 'fulfilled') {
        setPending(pendingRes.value.data.pending_verifications || []);
      }
      if (archivedRes.status === 'fulfilled') {
        setArchived(archivedRes.value.data.archived_verifications || []);
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

  // Current list based on active tab
  const currentList = viewMode === 'pending' ? pending : archived;

  const handleApprove = async (userId: string) => {
    setActionLoading(true);
    try {
      await verificationAPI.approve(userId);
      toast.success('Officer approved and added to active personnel');
      setSelectedUser(null);
      setSelectedIds(prev => {
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
      setSelectedIds(prev => {
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
      setSelectedIds(prev => {
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

  // Bulk actions
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
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllToggle = () => {
    if (selectedIds.size === currentList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentList.map(u => u.id)));
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

  const formatDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const officerCount = currentList.length;

  return (
    <div className="officer-queue-container">
      {/* Scoped CSS to match design screenshots precisely */}
      <style>{`
        .officer-queue-container {
          padding: 24px 32px;
          min-height: 100vh;
          background: #080e1a;
          color: #f8fafc;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .oq-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .oq-title {
          font-size: 24px;
          font-weight: 700;
          color: #ffffff;
          letter-spacing: -0.02em;
          margin: 0;
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
          background: #0c2340;
          border: 1px solid #1e3a8a;
          color: #38bdf8;
          font-size: 13px;
          font-weight: 700;
          padding: 6px 14px;
          border-radius: 8px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .oq-archive-btn {
          background: transparent;
          border: 1.5px solid #475569;
          color: #f8fafc;
          border-radius: 8px;
          width: 38px;
          height: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .oq-archive-btn:hover {
          border-color: #38bdf8;
          color: #38bdf8;
          background: rgba(56, 189, 248, 0.1);
        }

        .oq-archive-btn.active {
          border-color: #38bdf8;
          background: #0f2744;
          color: #38bdf8;
        }

        /* Subheader Action Bar */
        .oq-action-bar {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          min-height: 42px;
          margin-bottom: 20px;
          gap: 12px;
        }

        .oq-action-bar.is-multi {
          justify-content: space-between;
        }

        .oq-multi-btn {
          background: #ffffff;
          color: #0f172a;
          font-size: 14px;
          font-weight: 600;
          padding: 8px 18px;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.1s ease;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }

        .oq-multi-btn:hover {
          background: #f1f5f9;
        }

        .oq-multi-btn:active {
          transform: scale(0.98);
        }

        .oq-select-all-control {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #cbd5e1;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          user-select: none;
        }

        .oq-cancel-btn {
          background: transparent;
          border: 1px solid #475569;
          color: #94a3b8;
          font-size: 13px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .oq-cancel-btn:hover {
          color: #f8fafc;
          border-color: #94a3b8;
        }

        .oq-btn-reject {
          background: rgba(239, 68, 68, 0.08);
          border: 1.5px solid #ef4444;
          color: #ef4444;
          font-size: 14px;
          font-weight: 600;
          padding: 7px 22px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .oq-btn-reject:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.2);
        }

        .oq-btn-reject:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .oq-btn-accept {
          background: #22c55e;
          border: none;
          color: #ffffff;
          font-size: 14px;
          font-weight: 600;
          padding: 8px 24px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.1s ease;
        }

        .oq-btn-accept:hover:not(:disabled) {
          background: #16a34a;
        }

        .oq-btn-accept:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .oq-btn-restore {
          background: #22c55e;
          border: none;
          color: #ffffff;
          font-size: 14px;
          font-weight: 600;
          padding: 8px 24px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .oq-btn-restore:hover:not(:disabled) {
          background: #16a34a;
        }

        .oq-btn-restore:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* 2-Column Grid of Officer Cards */
        .oq-card-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }

        @media (max-width: 900px) {
          .oq-card-grid {
            grid-template-columns: 1fr;
          }
        }

        .oq-card {
          background: #0b1523;
          border: 1.5px solid #1e40af;
          border-radius: 10px;
          padding: 16px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.2s ease;
          user-select: none;
        }

        .oq-card:hover {
          border-color: #38bdf8;
          background: #0d1b2e;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        }

        .oq-card.selected {
          border-color: #38bdf8;
          background: #0f243d;
          box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
        }

        .oq-card-name {
          font-size: 15px;
          font-weight: 700;
          color: #f8fafc;
          flex: 1;
        }

        .oq-card-role {
          font-size: 14px;
          font-weight: 600;
          color: #cbd5e1;
          flex: 1;
          text-align: center;
        }

        .oq-card-meta {
          font-size: 13px;
          color: #94a3b8;
          flex: 1;
          text-align: right;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
        }

        /* Custom Checkbox */
        .oq-checkbox {
          width: 18px;
          height: 18px;
          border: 1.5px solid #64748b;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.15s ease;
        }

        .oq-checkbox.checked {
          background: #2563eb;
          border-color: #38bdf8;
        }

        /* Officer Detail Modal */
        .oq-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(4, 9, 20, 0.75);
          backdrop-filter: blur(4px);
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
          max-width: 400px;
          padding: 24px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 25px rgba(56, 189, 248, 0.2);
          animation: oqPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes oqPopIn {
          0% { transform: scale(0.95); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        .oq-modal-header {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 18px;
        }

        .oq-avatar {
          width: 46px;
          height: 46px;
          border-radius: 50%;
          background: linear-gradient(135deg, #0284c7, #0ea5e9);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
          color: #ffffff;
          flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
        }

        .oq-modal-userinfo {
          flex: 1;
        }

        .oq-modal-name {
          font-size: 18px;
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 2px;
        }

        .oq-modal-email {
          font-size: 13px;
          color: #94a3b8;
          margin-bottom: 4px;
          word-break: break-all;
        }

        .oq-modal-phone {
          font-size: 13px;
          color: #94a3b8;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .oq-modal-phone-icon {
          color: #f87171;
          font-size: 12px;
        }

        .oq-modal-role-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
          font-size: 13px;
          color: #94a3b8;
        }

        .oq-role-pill {
          background: #0f2744;
          border: 1px solid #1e3a8a;
          color: #38bdf8;
          font-size: 12px;
          font-weight: 700;
          padding: 3px 12px;
          border-radius: 12px;
          text-transform: uppercase;
        }

        .oq-modal-specs-section {
          margin-bottom: 16px;
        }

        .oq-specs-label {
          font-size: 13px;
          color: #94a3b8;
          margin-bottom: 8px;
        }

        .oq-specs-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .oq-spec-pill {
          background: #0f2744;
          border: 1px solid #1e3a8a;
          color: #38bdf8;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 14px;
          border-radius: 12px;
          text-transform: uppercase;
          display: inline-block;
          width: fit-content;
        }

        .oq-modal-date {
          font-size: 12px;
          color: #64748b;
          margin-bottom: 20px;
        }

        .oq-modal-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .oq-modal-actions .oq-btn-reject {
          flex: 1;
          padding: 10px 0;
          text-align: center;
        }

        .oq-modal-actions .oq-btn-accept {
          flex: 1;
          padding: 10px 0;
          text-align: center;
        }

        .oq-modal-actions .oq-btn-restore {
          flex: 1;
          padding: 10px 0;
          text-align: center;
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
          {viewMode === 'pending' ? 'Officer Verification Queue' : 'Officer Archive'}
        </h1>

        <div className="oq-header-right">
          <div className="oq-badge">
            {viewMode === 'pending' ? '🥇' : '📦'}{' '}
            {officerCount} {viewMode === 'pending' ? 'PENDING OFFICER' : 'ARCHIVED OFFICER'}{officerCount === 1 ? '' : 'S'}
          </div>

          {/* Archive Icon Button */}
          <button
            className={`oq-archive-btn ${viewMode === 'archived' ? 'active' : ''}`}
            onClick={() => {
              setViewMode(v => (v === 'pending' ? 'archived' : 'pending'));
              setIsMultiSelect(false);
              setSelectedIds(new Set());
            }}
            title={viewMode === 'pending' ? 'View Officer Archive' : 'Back to Verification Queue'}
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

      {/* Action Bar */}
      <div className={`oq-action-bar ${isMultiSelect ? 'is-multi' : ''}`}>
        {isMultiSelect ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <label className="oq-select-all-control" onClick={handleSelectAllToggle}>
                <div className={`oq-checkbox ${selectedIds.size > 0 && selectedIds.size === currentList.length ? 'checked' : ''}`}>
                  {selectedIds.size > 0 && selectedIds.size === currentList.length && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span>Select all ({selectedIds.size} selected)</span>
              </label>

              <button className="oq-cancel-btn" onClick={() => { setIsMultiSelect(false); setSelectedIds(new Set()); }}>
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
            disabled={currentList.length === 0}
          >
            Select multiple
          </button>
        )}
      </div>

      {/* Main Content / Officer Cards Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <div className="spinner" />
        </div>
      ) : currentList.length === 0 ? (
        <div className="oq-empty">
          <div className="oq-empty-icon">
            {viewMode === 'pending' ? '✅' : '📦'}
          </div>
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
          {currentList.map(user => {
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
                  <span>
                    applied at: {formatDateTime(user.created_at)}
                  </span>
                  {isMultiSelect && (
                    <div
                      className={`oq-checkbox ${isSelected ? 'checked' : ''}`}
                      onClick={(e) => toggleSelectCard(user.id, e)}
                    >
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Officer Detail Modal */}
      {selectedUser && (
        <div className="oq-modal-backdrop" onClick={() => setSelectedUser(null)}>
          <div className="oq-modal" onClick={e => e.stopPropagation()}>
            <div className="oq-modal-header">
              <div className="oq-avatar">
                {selectedUser.full_name?.trim() ? selectedUser.full_name.trim()[0].toUpperCase() : 'O'}
              </div>
              <div className="oq-modal-userinfo">
                <div className="oq-modal-name">{selectedUser.full_name}</div>
                <div className="oq-modal-email">{selectedUser.email}</div>
                {selectedUser.phone ? (
                  <div className="oq-modal-phone">
                    <span className="oq-modal-phone-icon">📞</span>
                    <span>{selectedUser.phone}</span>
                  </div>
                ) : (
                  <div className="oq-modal-phone" style={{ color: '#64748b' }}>
                    <span className="oq-modal-phone-icon">📞</span>
                    <span>No phone provided</span>
                  </div>
                )}
              </div>
            </div>

            <div className="oq-modal-role-row">
              <span>Role:</span>
              <span className="oq-role-pill">{getRoleLabel(selectedUser.role)}</span>
            </div>

            <div className="oq-modal-specs-section">
              <div className="oq-specs-label">Specialization(s):</div>
              <div className="oq-specs-list">
                {selectedUser.unit_type && selectedUser.unit_type.trim() ? (
                  selectedUser.unit_type.split(',').map((spec, idx) => (
                    <span key={idx} className="oq-spec-pill">
                      {spec.trim().toUpperCase()}
                    </span>
                  ))
                ) : (
                  <span className="oq-spec-pill">RESCUE OFFICER</span>
                )}
              </div>
            </div>

            {selectedUser.certifications && selectedUser.certifications.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div className="oq-specs-label">Documents & Certifications:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {selectedUser.certifications.map(cert => (
                    <div
                      key={cert.id}
                      style={{
                        background: '#071220',
                        border: '1px solid #1e3a8a',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '12px',
                      }}
                    >
                      <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{cert.cert_type}</span>
                      {cert.file_url && (
                        <a
                          href={cert.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#38bdf8', textDecoration: 'underline' }}
                        >
                          View Document
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="oq-modal-date">
              Applied: {formatDateTime(selectedUser.created_at)}
            </div>

            <div className="oq-modal-actions">
              {viewMode === 'pending' ? (
                <>
                  <button
                    className="oq-btn-reject"
                    disabled={actionLoading}
                    onClick={() => handleReject(selectedUser.id)}
                  >
                    Reject
                  </button>
                  <button
                    className="oq-btn-accept"
                    disabled={actionLoading}
                    onClick={() => handleApprove(selectedUser.id)}
                  >
                    Accept
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="oq-cancel-btn"
                    style={{ flex: 1, padding: '10px 0', textAlign: 'center' }}
                    onClick={() => setSelectedUser(null)}
                  >
                    Close
                  </button>
                  <button
                    className="oq-btn-restore"
                    disabled={actionLoading}
                    onClick={() => handleRestore(selectedUser.id)}
                  >
                    Restore
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
