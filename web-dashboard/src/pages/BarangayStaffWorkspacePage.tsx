import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Archive, MapPin, RefreshCw } from 'lucide-react';
import { reportAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';

type ResolvedReport = {
  id: string;
  title?: string | null;
  description?: string | null;
  incident_type?: string | null;
  response_status?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  barangay_name?: string | null;
};

export default function BarangayStaffWorkspacePage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<ResolvedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadReports = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await reportAPI.barangayResolvedReports();
      setReports(Array.isArray(response.data) ? response.data : []);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || 'Resolved incident history could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadReports(); }, [loadReports]);

  return (
    <div className="resident-workspace">
      <header className="resident-workspace-header">
        <div><span className="workspace-eyebrow">BARANGAY WORKSPACE · {user?.barangay_name || 'YOUR BARANGAY'}</span><h1>Resolved incident history</h1><p>Read resolved incidents recorded for your barangay.</p></div>
        <button className="workspace-secondary-action" type="button" disabled={refreshing} onClick={() => void loadReports(true)}><RefreshCw size={16} className={refreshing ? 'workspace-spinning' : ''} /> Refresh</button>
      </header>
      <section className="resident-summary-grid" aria-label="Resolved report summary"><article><span>Resolved incidents</span><strong>{reports.length}</strong></article><article><span>Workspace access</span><strong>Read</strong></article><article><span>Jurisdiction</span><strong>Barangay</strong></article></section>
      {error && <div className="workspace-message workspace-message-error" role="alert"><AlertCircle size={17} />{error}<button type="button" onClick={() => void loadReports()}>Try again</button></div>}
      <section className="resident-reports-panel">
        <header className="resident-reports-heading"><div><h2><Archive size={18} /> Resolved reports</h2><p>Operational updates are reserved for assigned responders and dispatchers.</p></div></header>
        {loading ? <p className="resident-reports-state">Loading resolved incidents…</p> : reports.length === 0 && !error ? <div className="resident-reports-empty"><Archive size={23} /><strong>No resolved reports yet</strong><span>Completed incidents will appear here for your barangay team.</span></div> : <div className="resident-report-list">{reports.map((report) => <article className="resident-report-card" key={report.id}><div className="resident-report-card-heading"><strong>{report.incident_type?.replaceAll('_', ' ') || report.title || 'Incident report'}</strong><span className="resident-status resolved">Resolved</span></div><p>{report.description || 'No incident details were provided.'}</p><div className="resident-report-meta"><span><Archive size={14} /> {report.resolved_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.resolved_at)) : 'Resolution time unavailable'}</span><span><MapPin size={14} /> {report.barangay_name || user?.barangay_name || 'Your barangay'}</span></div></article>)}</div>}
      </section>
    </div>
  );
}
