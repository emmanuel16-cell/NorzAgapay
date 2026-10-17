import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Archive, Download, MapPin, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { reportAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import ReportsPage from './ReportsPage';

type ResolvedReport = {
  id: string;
  title?: string | null;
  description?: string | null;
  type?: string | null;
  incident_type?: string | null;
  severity?: string | null;
  response_status?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  barangay_resolved_at?: string | null;
  barangay_name?: string | null;
  reporter_name?: string | null;
  reporter_phone?: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function BarangayStaffWorkspacePage() {
  const { user } = useAuth();
  if (user?.role === 'admin') return <ReportsPage readOnlyBarangay />;
  return <ResolvedReportHistoryPage />;
}

function ResolvedReportHistoryPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<ResolvedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
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

  const downloadResolution = async (report: ResolvedReport) => {
    setDownloadingId(report.id);
    try {
      const response = await reportAPI.barangayResolutionPdf(report.id);
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Incident_Resolution_${report.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError: any) {
      toast.error(downloadError?.response?.data?.error || 'The incident resolution PDF could not be downloaded.');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="resident-workspace">
      <header className="resident-workspace-header">
        <div><span className="workspace-eyebrow">BARANGAY WORKSPACE · {user?.barangay_name || 'YOUR BARANGAY'}</span><h1>Resolved incident history</h1><p>Review resolved incidents recorded for your barangay and download their resolution reports.</p></div>
        <button className="workspace-secondary-action" type="button" disabled={refreshing} onClick={() => void loadReports(true)}><RefreshCw size={16} className={refreshing ? 'workspace-spinning' : ''} /> Refresh</button>
      </header>
      <section className="resident-summary-grid" aria-label="Resolved report summary"><article><span>Resolved incidents</span><strong>{reports.length}</strong></article><article><span>Workspace access</span><strong>Read</strong></article><article><span>Jurisdiction</span><strong>Barangay</strong></article></section>
      {error && <div className="workspace-message workspace-message-error" role="alert"><AlertCircle size={17} />{error}<button type="button" onClick={() => void loadReports()}>Try again</button></div>}
      <section className="resident-reports-panel">
        <header className="resident-reports-heading"><div><h2><Archive size={18} /> Resolved reports</h2><p>Incident records remain available to the barangay team after closure.</p></div></header>
        {loading ? <p className="resident-reports-state">Loading resolved incidents…</p> : reports.length === 0 && !error ? <div className="resident-reports-empty"><Archive size={23} /><strong>No resolved reports yet</strong><span>Completed incidents will appear here for your barangay team.</span></div> : <div className="resident-report-list">{reports.map((report) => {
          const resolvedAt = report.barangay_resolved_at || report.resolved_at;
          const classification = [report.incident_type?.replaceAll('_', ' '), report.severity].filter(Boolean).join(' · ');
          return <article className="resident-report-card" key={report.id}>
            <div className="resident-report-card-heading"><strong>{report.incident_type?.replaceAll('_', ' ') || report.title || 'Incident report'}</strong><span className="resident-status resolved">Resolved</span></div>
            {report.reporter_name && <small>Reported by {report.reporter_name}</small>}
            {classification && <small>{classification}</small>}
            <p>{report.description || 'No incident details were provided.'}</p>
            <div className="resident-report-meta"><span><Archive size={14} /> Resolved {formatDate(resolvedAt)}</span><span><MapPin size={14} /> {report.barangay_name || user?.barangay_name || 'Your barangay'}</span><span>Received {formatDate(report.created_at)}</span></div>
            <div className="barangay-console-form-actions"><button className="workspace-secondary-action" type="button" disabled={downloadingId === report.id} onClick={() => void downloadResolution(report)}><Download size={15} /> {downloadingId === report.id ? 'Downloading…' : 'Download resolution PDF'}</button></div>
          </article>;
        })}</div>}
      </section>
    </div>
  );
}
