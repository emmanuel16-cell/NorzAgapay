import { useEffect, useState } from 'react';
import { requestAPI } from '../lib/api';
import toast from 'react-hot-toast';

interface ResourceRequest {
  id: string;
  request_type: 'volunteers' | 'goods';
  sub_type?: string;
  details: string;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  incident_id?: string;
  requested_by: string;
  created_at: string;
  requested_by_user?: {
    full_name: string;
    role: string;
    unit_type?: string;
  };
}

export default function ResourceRequestsPage() {
  const [requests, setRequests] = useState<ResourceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'fulfilled' | 'rejected'>('pending');

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const response = await requestAPI.list();
      setRequests(response.data.requests || []);
    } catch (error) {
      toast.error('Failed to fetch resource requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const handleStatusUpdate = async (id: string, status: ResourceRequest['status']) => {
    try {
      await requestAPI.updateStatus(id, status);
      toast.success(`Request marked as ${status}`);
      fetchRequests();
    } catch (error) {
      toast.error('Failed to update request status');
    }
  };

  const filteredRequests = requests.filter(req => 
    filter === 'all' ? true : req.status === filter
  );

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'pending': return 'badge-pending';
      case 'approved': return 'badge-low'; // Using low as info/success color
      case 'fulfilled': return 'badge-success';
      case 'rejected': return 'badge-critical';
      default: return '';
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Resource Requests</h1>
        <div className="header-actions">
          <select 
            className="form-select" 
            value={filter} 
            onChange={(e) => setFilter(e.target.value as any)}
            style={{ width: 'auto' }}
          >
            <option value="all">All Requests</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner"/></div>
        ) : filteredRequests.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <p>No {filter !== 'all' ? filter : ''} requests found</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Requested By</th>
                  <th>Type</th>
                  <th>Details</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req) => (
                  <tr key={req.id}>
                    <td style={{ fontSize: '13px' }}>
                      {new Date(req.created_at).toLocaleString()}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {req.requested_by_user?.full_name || 'Unknown'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {req.requested_by_user?.unit_type?.toUpperCase() || req.requested_by_user?.role.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td>
                      <div style={{ textTransform: 'capitalize', fontWeight: 500 }}>
                        {req.request_type}
                      </div>
                      {req.sub_type && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {req.sub_type.replace(/_/g, ' ')}
                        </div>
                      )}
                    </td>
                    <td style={{ maxWidth: '300px' }}>
                      <div style={{ fontSize: '13px', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        {req.details}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${getStatusBadgeClass(req.status)}`}>
                        {req.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {req.status === 'pending' && (
                          <>
                            <button 
                              className="btn btn-success btn-sm"
                              onClick={() => handleStatusUpdate(req.id, 'approved')}
                            >
                              Approve
                            </button>
                            <button 
                              className="btn btn-danger btn-sm"
                              onClick={() => handleStatusUpdate(req.id, 'rejected')}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {req.status === 'approved' && (
                          <button 
                            className="btn btn-primary btn-sm"
                            onClick={() => handleStatusUpdate(req.id, 'fulfilled')}
                          >
                            Mark Fulfilled
                          </button>
                        )}
                        {req.status !== 'pending' && req.status !== 'approved' && (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
