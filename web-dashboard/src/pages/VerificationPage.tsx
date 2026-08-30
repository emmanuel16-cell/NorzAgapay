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
      toast.success('Volunteer approved');
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
      case 'volunteer_general': return 'General Labor';
      case 'volunteer_specialist': return 'Certified Specialist';
      case 'professional_unit': return 'MDRRMO Officer';
      default: return role;
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Volunteer Verification Queue</h1>
        <span className="badge badge-pending" style={{fontSize:'13px',padding:'6px 14px'}}>
          {pending.length} Pending
        </span>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner"/></div>
        ) : pending.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✅</div>
            <p>No pending verifications</p>
            <p style={{fontSize:'13px',marginTop:'8px'}}>All volunteer applications have been reviewed.</p>
          </div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:'16px'}}>
            {pending.map(user => (
              <div key={user.id} className="card" style={{cursor:'pointer'}} onClick={()=>setSelectedUser(user)}>
                <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'12px'}}>
                  <div className="user-avatar">{user.full_name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
                  <div>
                    <div style={{fontWeight:600,fontSize:'15px'}}>{user.full_name}</div>
                    <div style={{fontSize:'12px',color:'var(--text-muted)'}}>{user.email}</div>
                  </div>
                </div>
                <div style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'8px'}}>
                  Role: <span style={{fontWeight:500,color:'var(--text-primary)'}}>{getRoleLabel(user.role)}</span>
                </div>
                {user.unit_type && (
                  <div style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'8px'}}>
                    Specialization: <span style={{fontWeight:500,color:'var(--accent)'}}>{user.unit_type}</span>
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
            ))}
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
                <div className="form-label">Contact</div>
                <p style={{fontSize:'14px'}}>{selectedUser.email}</p>
                {selectedUser.phone && <p style={{fontSize:'14px'}}>{selectedUser.phone}</p>}
              </div>
              <div>
                <div className="form-label">Requested Role</div>
                <span className="badge badge-pending">{getRoleLabel(selectedUser.role)}</span>
                {selectedUser.unit_type && (
                  <div style={{marginTop:'8px'}}>
                    <div className="form-label">Specialization</div>
                    <span className="badge badge-success">{selectedUser.unit_type}</span>
                  </div>
                )}
              </div>
            </div>

            {selectedUser.certifications.length > 0 ? (
              <>
                <div className="form-label">Certifications / Documents</div>
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
                <p style={{fontSize:'13px',color:'var(--text-muted)'}}>No certifications uploaded for this role.</p>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-danger" onClick={()=>handleReject(selectedUser.id)}>Reject</button>
              <button className="btn btn-success" onClick={()=>handleApprove(selectedUser.id)}>Approve Volunteer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
