import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { reportAPI } from '../lib/api';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

interface IncidentReport {
  id: string;
  type: 'emergency';
  title: string;
  specifics?: string;
  description: string;
  status: string;
  latitude: number;
  longitude: number;
  proof_url?: string;
  proof_type?: 'image' | 'video';
  reporter_type?: string;
  reporter_name?: string;
  reporter_phone?: string;
  reporter_photo_url?: string;
  created_at: string;
  reporter?: {
    id: string;
    full_name: string;
    role: string;
    volunteer_type?: 'specialist' | 'general';
  };
}

const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export default function ReportsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<IncidentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [reverseGeocodedAddress, setReverseGeocodedAddress] = useState<string | null>(null);

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

  useEffect(() => {
    if (selectedReport) {
      setReverseGeocodedAddress(null); // Clear previous address
      reverseGeocode(selectedReport.latitude, selectedReport.longitude);
    }
  }, [selectedReport]);

  const reverseGeocode = async (lat: number, lon: number) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);
      const data = await res.json();
      if (data && data.display_name) {
        // Get the first 4 parts of the address (Sitio, Barangay, Municipality, Province)
        const parts = data.display_name.split(',').map((p: string) => p.trim());
        const simplifiedAddress = parts.slice(0, 4).join(', ');
        setReverseGeocodedAddress(simplifiedAddress);
      }
    } catch (err) {
      console.error('Reverse geocoding failed:', err);
    }
  };

  const fetchReports = async () => {
    try {
      // Community reports are handled by the assigned barangay and must not
      // appear in the MDRRMO web dashboard.
      const res = await reportAPI.list({ type: 'emergency' });
      setReports(res.data);
    } catch (err) {
      console.error('Failed to fetch reports', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (id: string) => {
    try {
      setVerifying(true);
      const res = await reportAPI.verify(id, reverseGeocodedAddress || undefined);
      const incidentId = res.data.incidentId;
      toast.success('Report verified! Mission created and volunteers notified.');
      setSelectedReport(null);
      
      // Redirect to missions page and open dispatch modal
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
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1 className="page-title">Incident Reports</h1>
          <p className="page-subtitle">View and manage emergency reports</p>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center p-10"><div className="spinner" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {reports.map(report => (
            <div 
              key={report.id} 
              className="card report-card border-emergency"
              onClick={() => setSelectedReport(report)}
              style={{ 
                padding: '16px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              <div className="flex items-center gap-4">
                <span className="badge badge-critical" style={{ padding: '4px 12px' }}>
                  🚨 EMERGENCY
                </span>
                <span className="text-xs text-muted font-medium">
                  {format(new Date(report.created_at), 'MMM d, h:mm a')}
                </span>
              </div>
              
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr 1.5fr 120px', 
                gap: '24px',
                alignItems: 'start'
              }}>
                <div>
                  <div className="text-[10px] text-muted uppercase tracking-widest mb-1 font-bold">Category</div>
                  <h3 className="font-bold text-sm text-white">{report.title}</h3>
                </div>

                <div>
                  <div className="text-[10px] text-muted uppercase tracking-widest mb-1 font-bold">Specifics</div>
                  <div className="text-sm font-medium text-secondary">{report.specifics || '—'}</div>
                </div>

                <div>
                  <div className="text-[10px] text-muted uppercase tracking-widest mb-1 font-bold">Description</div>
                  <p className="text-sm text-secondary line-clamp-1">{report.description}</p>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div className="text-[10px] text-muted uppercase tracking-widest mb-1 font-bold">Reporter</div>
                  <div className="text-sm font-bold text-primary-light">
                    {report.reporter ? report.reporter.full_name : (report.reporter_name || 'Resident')}
                  </div>
                  {report.reporter_phone && (
                    <div className="text-[10px] text-muted">{report.reporter_phone}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedReport && (
        <div className="modal-backdrop" onClick={() => setSelectedReport(null)}>
          <div className="modal report-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px', width: '90%' }}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Incident Detail</h2>
                <div className="text-xs text-muted mt-1">ID: {selectedReport.id.slice(0, 8)} • {format(new Date(selectedReport.created_at), 'MMMM d, yyyy h:mm a')}</div>
              </div>
              <button className="modal-close" onClick={() => setSelectedReport(null)}>&times;</button>
            </div>
            
            <div className="modal-body" style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '32px', alignItems: 'start' }}>
                {/* Left Side: Information & Proof */}
                <div className="space-y-6">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div className="report-info-section">
                      <label>Incident Type</label>
                      <div className="badge badge-critical">
                        🔥 Emergency
                      </div>
                    </div>

                    <div className="report-info-section">
                      <label>Reported By</label>
                      <div className="font-bold text-primary-light uppercase tracking-wider" style={{ fontSize: '14px' }}>
                        {selectedReport.reporter ? selectedReport.reporter.full_name : (selectedReport.reporter_name || 'Resident')}
                      </div>
                      <div className="text-[10px] text-muted uppercase">
                        {selectedReport.reporter_phone || (selectedReport.reporter?.role || selectedReport.reporter_type || 'resident').replace('_', ' ')}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div className="report-info-section">
                      <label>Category</label>
                      <h3 className="font-bold text-base text-white">{selectedReport.title}</h3>
                    </div>
                    {selectedReport.specifics && (
                      <div className="report-info-section">
                        <label>Specifics</label>
                        <h3 className="font-bold text-base text-white">{selectedReport.specifics}</h3>
                      </div>
                    )}
                  </div>

                  <div className="report-info-section">
                    <label>Description</label>
                    <p className="text-secondary text-sm bg-primary-50 p-4 rounded-lg border border-border-color">{selectedReport.description}</p>
                  </div>

                  <div className="report-info-section">
                    <label>Visual Proof</label>
                    <div className="proof-container mt-2 rounded-lg overflow-hidden border border-border-color bg-black flex justify-center">
                      {selectedReport.proof_url ? (
                        selectedReport.proof_type === 'video' ? (
                          <video src={selectedReport.proof_url} controls style={{ width: '100%', maxHeight: '450px', objectFit: 'contain' }} />
                        ) : (
                          <img src={selectedReport.proof_url} alt="Proof" style={{ width: '100%', maxHeight: '450px', objectFit: 'contain' }} />
                        )
                      ) : (
                        <div className="p-12 text-center text-muted italic">No visual proof provided</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Side: Map & Verification */}
                <div className="space-y-6">
                  <div className="report-info-section">
                    <label>Location Tracking</label>
                    <div className="mb-4 p-4 bg-secondary rounded-lg border border-border-color font-mono">
                      <div className="text-[10px] text-primary-light font-bold mb-1">COORDINATES</div>
                      <div className="text-xs text-white tracking-wider">{selectedReport.latitude.toFixed(6)}, {selectedReport.longitude.toFixed(6)}</div>
                      <div className="h-px bg-border-color my-3"></div>
                      <div className="text-[10px] text-primary-light font-bold mb-1">LOCATION</div>
                      <div className="text-xs text-white flex items-center gap-2">
                        {!reverseGeocodedAddress && <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }} />}
                        {reverseGeocodedAddress || 'Determining precise location...'}
                      </div>
                    </div>
                    <div className="map-mini-container rounded-lg overflow-hidden border border-border-color shadow-lg" style={{ height: '400px' }}>
                      <MapContainer 
                        center={[selectedReport.latitude, selectedReport.longitude]} 
                        zoom={15} 
                        style={{ height: '100%', width: '100%' }}
                        zoomControl={false}
                      >
                        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                        <Marker position={[selectedReport.latitude, selectedReport.longitude]} icon={DefaultIcon} />
                      </MapContainer>
                    </div>
                  </div>

                  {selectedReport.status === 'pending' && (
                    <div className="pt-4 border-t border-border-color">
                      <button 
                        className="btn btn-primary w-full py-4 rounded-lg flex items-center justify-center gap-2 text-sm font-bold shadow-lg"
                        onClick={() => handleVerify(selectedReport.id)}
                        disabled={verifying}
                      >
                        {verifying ? (
                          <><div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} /> Processing...</>
                        ) : (
                          <><span style={{ fontSize: '16px' }}>🛡️</span> VERIFY INCIDENT</>
                        )}
                      </button>
                      <p className="text-[10px] text-muted text-center mt-3 px-2 leading-relaxed">
                        Verifying will create a Mission and notify all active volunteers for onsite confirmation.
                      </p>
                    </div>
                  )}
                  
                  {selectedReport.status === 'verified' && (
                    <div className="p-4 bg-success/10 border border-success/20 rounded-lg text-center">
                      <div className="text-success font-bold text-xs uppercase tracking-widest">✅ Report Verified</div>
                      <div className="text-[10px] text-success/70 mt-1">Mission created and volunteers notified.</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
