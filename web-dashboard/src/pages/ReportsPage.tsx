import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { reportAPI } from '../lib/api';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

interface IncidentReport {
  id: string;
  type: string;
  title: string;
  specifics?: string;
  description: string;
  status: string;
  severity?: string;
  latitude: number;
  longitude: number;
  proof_url?: string;
  proof_type?: 'image' | 'video';
  reporter_type?: string;
  reporter_name?: string;
  reporter_phone?: string;
  reporter_photo_url?: string;
  barangay_responder_name?: string;
  barangay_response_notes?: string;
  mdrrmo_coordination_notes?: string;
  created_at: string;
  reporter?: {
    id: string;
    full_name: string;
    role: string;
  };
}

type TabType = 'incidents' | 'escalated' | 'responding' | 'resolved';

export default function ReportsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<IncidentReport | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('incidents');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    fetchReports();
  }, []);

  useEffect(() => {
    const reportId = searchParams.get('id');
    if (reportId && reports.length > 0) {
      const report = reports.find(r => r.id === reportId);
      if (report) {
        setSelectedReport(report);
      }
    }
  }, [searchParams, reports]);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const res = await reportAPI.list();
      let data: IncidentReport[] = [];
      if (Array.isArray(res.data)) {
        data = res.data;
      }
      // Demo fallback if backend is empty
      if (data.length === 0) {
        data = [
          {
            id: 'demo-1',
            type: 'emergency',
            title: 'Flash Flood & Road Blockage',
            specifics: 'Road Inundated',
            description: 'Put here the response details of the emergency report of the resident. Water rising rapidly near the river bank.',
            status: 'pending',
            severity: 'high',
            latitude: 14.9085,
            longitude: 121.0375,
            proof_url: 'https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=600&q=80',
            proof_type: 'image',
            reporter_name: 'Resident',
            reporter_phone: '09510173028',
            created_at: new Date().toISOString(),
          },
          {
            id: 'demo-2',
            type: 'emergency',
            title: 'Critical Bridge Scour & Landslide',
            specifics: 'Severe Riverbank Collapse',
            description: 'Severe erosion along riverbank threatening residential houses. Requesting heavy rescue truck and evacuation team.',
            status: 'escalated',
            severity: 'critical',
            latitude: 14.9095,
            longitude: 121.0505,
            proof_url: 'https://images.unsplash.com/photo-1584467735815-f778f274e296?auto=format&fit=crop&w=600&q=80',
            proof_type: 'image',
            reporter_name: 'Resident',
            reporter_phone: '09510173028',
            barangay_responder_name: 'Matic Tic (Team Leader)',
            barangay_response_notes: 'Initial response completed. Beyond barangay equipment capacity. Escalated to MDRRMO.',
            created_at: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            id: 'demo-3',
            type: 'emergency',
            title: 'Fallen High-Voltage Tree Obstruction',
            specifics: 'Fallen Tree & Downed Wires',
            description: 'Large acacia tree fell across two lanes. Team Leader and 5 responders actively on scene diverting traffic.',
            status: 'responding',
            severity: 'moderate',
            latitude: 14.9045,
            longitude: 121.0420,
            proof_url: 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?auto=format&fit=crop&w=600&q=80',
            proof_type: 'image',
            reporter_name: 'Resident',
            reporter_phone: '09123456789',
            barangay_responder_name: 'Team Leader 1',
            barangay_response_notes: 'Dispatched 5 responders with chainsaws.',
            created_at: new Date(Date.now() - 7200000).toISOString(),
          },
          {
            id: 'demo-4',
            type: 'emergency',
            title: 'Cleared Drainage & Downed Wire',
            specifics: 'Drainage Cleared',
            description: 'Tree branches removed from electrical poles and road opened for light vehicles.',
            status: 'resolved',
            severity: 'low',
            latitude: 14.9055,
            longitude: 121.0440,
            proof_url: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=600&q=80',
            proof_type: 'image',
            reporter_name: 'Resident',
            reporter_phone: '09123456789',
            barangay_responder_name: 'Team Leader 1',
            barangay_response_notes: 'Repaired by barangay engineering personnel and resolved.',
            created_at: new Date(Date.now() - 86400000).toISOString(),
          },
        ];
      }
      setReports(data);
    } catch (err) {
      console.error('Failed to fetch reports', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredReports = reports.filter(r => {
    const status = (r.status || 'pending').toLowerCase();
    if (activeTab === 'incidents') {
      return status === 'pending' || status === 'open' || status === 'unverified';
    }
    if (activeTab === 'escalated') {
      return status === 'escalated' || r.severity === 'critical';
    }
    if (activeTab === 'responding') {
      return status === 'responding' || status === 'in_progress';
    }
    if (activeTab === 'resolved') {
      return status === 'resolved' || status === 'closed';
    }
    return true;
  });

  const handleVerify = async (id: string) => {
    try {
      setVerifying(true);
      const res = await reportAPI.verify(id);
      const incidentId = res.data?.incidentId;
      toast.success('Report verified! Mission initiated.');
      setSelectedReport(null);
      if (incidentId) {
        navigate(`/missions?dispatch=${incidentId}`);
      } else {
        fetchReports();
      }
    } catch (err) {
      console.error('Verification failed', err);
      toast.error('Failed to verify report');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="incidents-reports-container">
      {/* Header with 4 Status Pill Buttons (Image 4) */}
      <div className="incidents-header-row">
        <h1 className="incidents-title">Incidents Reports</h1>

        <div className="incidents-tab-pills">
          <button
            className={`incident-pill-btn pill-btn-incidents ${activeTab === 'incidents' ? 'active' : ''}`}
            onClick={() => setActiveTab('incidents')}
          >
            Incidents
          </button>

          <button
            className={`incident-pill-btn pill-btn-escalated ${activeTab === 'escalated' ? 'active' : ''}`}
            onClick={() => setActiveTab('escalated')}
          >
            Escalated
          </button>

          <button
            className={`incident-pill-btn pill-btn-responding ${activeTab === 'responding' ? 'active' : ''}`}
            onClick={() => setActiveTab('responding')}
          >
            Responding
          </button>

          <button
            className={`incident-pill-btn pill-btn-resolved ${activeTab === 'resolved' ? 'active' : ''}`}
            onClick={() => setActiveTab('resolved')}
          >
            Resolved
          </button>
        </div>
      </div>

      {/* Reports List */}
      {loading ? (
        <div className="flex justify-center p-12">
          <div className="spinner" />
        </div>
      ) : filteredReports.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 20px',
            background: '#0d1322',
            borderRadius: '18px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            color: '#64748b',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📋</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#94a3b8' }}>No reports in this status</div>
          <div style={{ fontSize: '13px', marginTop: '4px' }}>All incidents under "{activeTab}" have been attended to.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {filteredReports.map((report) => {
            const isEscalated = report.status === 'escalated' || report.severity === 'critical';
            const isResponding = report.status === 'responding';
            const isResolved = report.status === 'resolved';

            let accentColor = '#ea580c';
            if (isEscalated) accentColor = '#dc2626';
            else if (isResponding) accentColor = '#0891b2';
            else if (isResolved) accentColor = '#16a34a';

            return (
              <div
                key={report.id}
                style={{
                  background: '#0f172a',
                  border: `1.5px solid ${accentColor}40`,
                  borderRadius: '16px',
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
                  transition: 'transform 0.2s, border-color 0.2s',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Accent Top Border */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: accentColor }} />

                {/* Top Meta Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        background: `${accentColor}25`,
                        color: accentColor,
                        border: `1px solid ${accentColor}60`,
                      }}
                    >
                      {report.status?.toUpperCase() || 'INCIDENT'}
                    </span>
                    {report.severity && (
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '10px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: '#cbd5e1',
                        }}
                      >
                        {report.severity}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {report.created_at ? format(new Date(report.created_at), 'MMM d, h:mm a') : 'Recent'}
                  </span>
                </div>

                {/* Title & Specifics */}
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#fff' }}>{report.title}</h3>
                  {report.specifics && (
                    <div style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600, marginTop: '2px' }}>
                      {report.specifics}
                    </div>
                  )}
                </div>

                {/* Description */}
                <p
                  style={{
                    margin: 0,
                    fontSize: '13px',
                    color: '#94a3b8',
                    lineHeight: 1.4,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {report.description}
                </p>

                {/* Proof thumbnail preview if present */}
                {report.proof_url && (
                  <div
                    style={{
                      height: '140px',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      position: 'relative',
                      cursor: 'pointer',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                    onClick={() => setPreviewImage(report.proof_url!)}
                  >
                    <img
                      src={report.proof_url}
                      alt="Proof"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '8px',
                        right: '8px',
                        background: 'rgba(0, 0, 0, 0.7)',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                      Tap to enlarge
                    </div>
                  </div>
                )}

                {/* Resident & Responder Info Row */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: '10px',
                    padding: '8px 12px',
                    fontSize: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>Reporter:</span>
                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                      {report.reporter_name || 'Resident'} ({report.reporter_phone || 'No phone'})
                    </span>
                  </div>
                  {report.barangay_responder_name && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Barangay Unit:</span>
                      <span style={{ color: '#c084fc', fontWeight: 600 }}>{report.barangay_responder_name}</span>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '6px' }}>
                  <button
                    className="btn btn-outline btn-sm"
                    style={{ flex: 1, borderColor: 'rgba(255,255,255,0.15)', color: '#fff' }}
                    onClick={() => setSelectedReport(report)}
                  >
                    View Details
                  </button>

                  {!isResolved && (
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1.2, background: '#0284c7', borderColor: '#0284c7' }}
                      onClick={() => handleVerify(report.id)}
                      disabled={verifying}
                    >
                      {isResponding ? 'Update Dispatch' : 'Dispatch Responders'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="pin-modal-backdrop"
          onClick={() => setPreviewImage(null)}
          style={{ zIndex: 3000 }}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '85vh',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
              background: '#0f172a',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '16px',
              }}
              onClick={() => setPreviewImage(null)}
            >
              ✕
            </button>
            <img
              src={previewImage}
              alt="Visual Preview Enlarged"
              style={{ maxWidth: '85vw', maxHeight: '80vh', objectFit: 'contain', display: 'block' }}
            />
          </div>
        </div>
      )}

      {/* Full Details Modal */}
      {selectedReport && (
        <div className="pin-modal-backdrop" onClick={() => setSelectedReport(null)}>
          <div
            style={{
              width: '560px',
              maxWidth: '92vw',
              background: '#0d172e',
              border: '1.5px solid #1e3a8a',
              borderRadius: '20px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
              color: '#fff',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '24px' }}>🚨</span>
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>{selectedReport.title}</h2>
                  <span style={{ fontSize: '12px', color: '#38bdf8' }}>{selectedReport.specifics || 'Incident Report'}</span>
                </div>
              </div>
              <button
                className="close-x-btn"
                onClick={() => setSelectedReport(null)}
                style={{ fontSize: '20px', color: '#94a3b8' }}
              >
                ✕
              </button>
            </div>

            {selectedReport.proof_url && (
              <div
                style={{
                  width: '100%',
                  height: '240px',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <img
                  src={selectedReport.proof_url}
                  alt="Incident Proof"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
            )}

            <div>
              <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700, marginBottom: '4px' }}>
                INCIDENT DESCRIPTION
              </div>
              <div
                style={{
                  background: '#081023',
                  borderRadius: '10px',
                  padding: '12px',
                  border: '1px solid rgba(255,255,255,0.06)',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  color: '#e2e8f0',
                }}
              >
                {selectedReport.description}
              </div>
            </div>

            {selectedReport.barangay_response_notes && (
              <div>
                <div style={{ fontSize: '12px', color: '#a78bfa', fontWeight: 700, marginBottom: '4px' }}>
                  BARANGAY RESPONSE LOG
                </div>
                <div
                  style={{
                    background: '#13112a',
                    borderRadius: '10px',
                    padding: '12px',
                    border: '1px solid rgba(168,85,247,0.2)',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    color: '#e2e8f0',
                  }}
                >
                  {selectedReport.barangay_response_notes}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                className="btn btn-outline"
                style={{ flex: 1, borderColor: 'rgba(255,255,255,0.2)', color: '#fff' }}
                onClick={() => setSelectedReport(null)}
              >
                Close
              </button>
              {selectedReport.status !== 'resolved' && (
                <button
                  className="btn btn-primary"
                  style={{ flex: 1.2, background: '#0284c7', borderColor: '#0284c7' }}
                  onClick={() => handleVerify(selectedReport.id)}
                  disabled={verifying}
                >
                  Dispatch Units
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
