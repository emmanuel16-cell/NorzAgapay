import { useEffect, useState } from 'react';
import { verificationAPI } from '../lib/api';
import toast from 'react-hot-toast';

interface PendingUser {
  id: string; full_name: string; email: string; phone?: string;
  role: string;
  unit_type?: string;
  created_at: string;
  certifications: { id: string; cert_type: string; cert_number?: string; file_url?: string; }[];
}

export default function VerificationPage() {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null);

  const fetchPending = () => {
    setLoading(true);
    verificationAPI.pending()
      .then(r => setPending(r.data.pending_verifications || []))
      .catch(() => toast.error('Failed to load verifications'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPending(); }, []);

  const handleApprove = async (userId: string) => {
    try {
      await verificationAPI.approve(userId);
      toast.success('Officer approved and added to active personnel');
      setSelectedUser(null);
      fetchPending();
    } catch { toast.error('Approval failed'); }
  };

  const handleReject = async (userId: string) => {
    const reason = prompt('Rejection reason (optional):');
    try {
      await verificationAPI.reject(userId, reason || undefined);
      toast.success('Verification rejected');
      setSelectedUser(null);
      fetchPending();
    } catch { toast.error('Rejection failed'); }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'professional_unit': return 'MDRRMO Officer';
      default: return role.replace(/_/g, ' ');
    }
  };

  const officerCount = pending.length;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Officer Verification Queue</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span className="badge badge-open" style={{ fontSize: '12px', padding: '6px 12px' }}>
            🎖️ {officerCount} Pending Officer{officerCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner"/></div>
        ) : pending.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✅</div>
            <p>No pending verifications</p>
            <p style={{fontSize:'13px',marginTop:'8px',color:'var(--text-muted)'}}>
              All officer registrations have been reviewed.
            </p>
          </div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:'16px'}}>
            {pending.map(user => {
              const isOfficer = user.role === 'professional_unit';
              return (
                <div key={user.id} className="card" style={{cursor:'pointer',borderLeft: isOfficer ? '4px solid var(--accent)' : undefined}} onClick={()=>setSelectedUser(user)}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'8px'}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:'16px',color:'var(--text-primary)'}}>{user.full_name}</div>
                      <div style={{fontSize:'12px',color:'var(--text-muted)'}}>{user.email}</div>
                      {user.phone && <div style={{fontSize:'12px',color:'var(--text-muted)'}}>📞 {user.phone}</div>}
                    </div>
                    <div
                      className="user-avatar"
                      style={{
                        background: isOfficer ? 'linear-gradient(135deg, #0284c7, #0369a1)' : undefined,
                      }}
                    >
                      {user.full_name.split(' ').map(n=>n[0]).join('').slice(0,2)}
                    </div>
                    <div>
                      <div style={{fontWeight:600,fontSize:'15px'}}>{user.full_name}</div>
                      <div style={{fontSize:'12px',color:'var(--text-muted)'}}>{user.email}</div>
                    </div>
                  </div>
                  <div style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'8px'}}>
                    Role: <span className={`badge ${isOfficer ? 'badge-open' : 'badge-pending'}`} style={{ fontWeight: 600 }}>{getRoleLabel(user.role)}</span>
                  </div>
                  {user.unit_type && (
                    <div style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'8px'}}>
                      <div style={{fontWeight:500,marginBottom:'4px'}}>Specialization(s):</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>
                        {user.unit_type.split(',').map((s, idx) => (
                          <span key={idx} className="badge badge-open" style={{fontSize:'11px',padding:'2px 8px'}}>
                            {s.trim()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {user.certifications.length > 0 && (
                    <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
                      {user.certifications.map(c => (
                        <span key={c.id} className="badge badge-pending">{c.cert_type}</span>
                      ))}
                    </div>
                  )}
                  <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'10px'}}>
                    Applied: {new Date(user.created_at).toLocaleDateString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedUser && (
        <div className="modal-backdrop" onClick={()=>setSelectedUser(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:'600px'}}>
            <div className="modal-header">
              <h2 className="modal-title">Review: {selectedUser.full_name}</h2>
              <button className="modal-close" onClick={()=>setSelectedUser(null)}>✕</button>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px',marginBottom:'24px'}}>
              <div>
                <div className="form-label">Contact Details</div>
                <p style={{fontSize:'14px', margin: '4px 0'}}>📧 {selectedUser.email}</p>
                <p style={{fontSize:'14px', margin: '4px 0'}}>📞 {selectedUser.phone || 'No phone provided'}</p>
              </div>
              <div>
                <div className="form-label">Role Category</div>
                <span className={`badge ${selectedUser.role === 'professional_unit' ? 'badge-open' : 'badge-pending'}`}>
                  {getRoleLabel(selectedUser.role)}
                </span>
                {selectedUser.unit_type && (
                  <div style={{marginTop:'8px'}}>
                    <div className="form-label">Officer Specialization(s)</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:'4px',marginTop:'4px'}}>
                      {selectedUser.unit_type.split(',').map((s, idx) => (
                        <span key={idx} className="badge badge-success">{s.trim()}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {selectedUser.certifications.length > 0 ? (
              <>
                <div className="form-label">Certifications / Proof Documents</div>
                <div style={{display:'flex', flexDirection:'column', gap:'12px'}}>
                  {selectedUser.certifications.map(cert => (
                    <div key={cert.id} className="card" style={{padding:'14px', background:'var(--bg-secondary)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start', marginBottom: cert.file_url ? '12px' : '0'}}>
                        <div>
                          <div style={{fontWeight:600,fontSize:'14px'}}>{cert.cert_type}</div>
                          {cert.cert_number && <div style={{fontSize:'12px',color:'var(--text-muted)'}}>#{cert.cert_number}</div>}
                        </div>
                        {cert.file_url && (
                          <a href={cert.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                            Open Full Size
                          </a>
                        )}
                      </div>
                      
                      {cert.file_url && (
                        <div style={{
                          width: '100%',
                          maxHeight: '300px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid var(--border-color)',
                          background: '#000'
                        }}>
                          <img 
                            src={cert.file_url} 
                            alt={cert.cert_type}
                            style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain', maxHeight: '300px' }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              const parent = (e.target as HTMLImageElement).parentElement;
                              if (parent) {
                                parent.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">Preview not available (PDF or invalid image)</div>';
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state" style={{padding:'20px',background:'var(--bg-secondary)',borderRadius:'8px'}}>
                <p style={{fontSize:'13px',color:'var(--text-muted)'}}>
                  {selectedUser.role === 'professional_unit'
                    ? 'Direct officer registration submitted via MDRRMO mobile app.'
                    : 'No certifications uploaded for this role.'}
                </p>
              </div>
            )}

            <div className="modal-footer" style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-danger" onClick={()=>handleReject(selectedUser.id)}>Reject</button>
              <button 
                className="btn btn-success" 
                onClick={()=>handleApprove(selectedUser.id)}
              >
                ✓ Approve Officer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
