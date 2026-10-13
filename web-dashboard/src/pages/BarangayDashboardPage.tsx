import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, Bell, CheckCircle2, ClipboardList, MapPin, Users, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { barangayAPI, reportAPI, socket } from '../lib/api';

type ReportRow = {
  id: string;
  title?: string;
  incident_type?: string;
  description?: string;
  status?: string;
  response_status?: string;
  barangay_response_status?: string;
  mdrrmo_response_status?: string;
  resolved_at?: string | null;
  barangay_resolved_at?: string | null;
  mdrrmo_resolved_at?: string | null;
  barangay_assignments?: Array<{ assignment_status?: string; response_status?: string }>;
  created_at?: string;
};
type AssistanceRow = { id: string; status?: string; explanation?: string; incident_title?: string; created_at?: string };

function statusOf(report: ReportRow) {
  const assignment = report.barangay_assignments?.[0];
  if (assignment?.assignment_status === 'completed' || assignment?.response_status === 'resolved') return 'resolved';
  return String(report.barangay_response_status || report.mdrrmo_response_status || report.response_status || report.status || 'pending').toLowerCase();
}

function isResolved(report: ReportRow) {
  return Boolean(report.resolved_at || report.barangay_resolved_at || report.mdrrmo_resolved_at)
    || ['resolved', 'closed'].includes(statusOf(report));
}

export default function BarangayDashboardPage() {
  const { user } = useAuth();
  const isDispatcher = user?.role === 'dispatcher';
  const canViewIncidents = user?.role === 'admin' || isDispatcher;
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [requests, setRequests] = useState<AssistanceRow[]>([]);
  const [activeMembers, setActiveMembers] = useState(0);
  const [postsCount, setPostsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [reportResult, requestResult, teamResult, boardResult] = await Promise.all([
        canViewIncidents ? reportAPI.barangayReports() : Promise.resolve(null),
        isDispatcher ? barangayAPI.assistanceRequests() : Promise.resolve(null),
        barangayAPI.team(),
        barangayAPI.barangayBroadcasts(),
      ]);
      setReports(reportResult && Array.isArray(reportResult.data) ? reportResult.data : []);
      setRequests(Array.isArray(requestResult?.data?.requests) ? requestResult.data.requests : []);
      const team = Array.isArray(teamResult.data) ? teamResult.data : [];
      setActiveMembers(team.filter((member: any) => member.is_active === true).length);
      setPostsCount(Array.isArray(boardResult.data) ? boardResult.data.length : 0);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || 'Barangay overview could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [canViewIncidents, isDispatcher]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    socket.on('barangay:report_updated', load);
    socket.on('barangay:report_escalated', load);
    socket.on('assistance:new_request', load);
    socket.on('assistance:decision', load);
    socket.on('team:member_added', load);
    socket.on('team:member_updated', load);
    socket.on('broadcast:new', load);
    return () => {
      socket.off('barangay:report_updated', load);
      socket.off('barangay:report_escalated', load);
      socket.off('assistance:new_request', load);
      socket.off('assistance:decision', load);
      socket.off('team:member_added', load);
      socket.off('team:member_updated', load);
      socket.off('broadcast:new', load);
    };
  }, [load]);

  const activeReports = reports.filter((report) => !isResolved(report) && !['rejected', 'dismissed', 'cancelled'].includes(statusOf(report)));
  const resolvedReports = reports.filter(isResolved);
  const pendingRequests = requests.filter((request) => String(request.status || '').toLowerCase() === 'pending');
  const latestReports = [...reports].sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || '')).slice(0, 5);

  return (
    <div className="barangay-console-page">
      <header className="barangay-console-header">
        <div>
          <span className="workspace-eyebrow">BARANGAY COMMAND · {user?.barangay_name || 'YOUR BARANGAY'}</span>
          <h1>Barangay overview</h1>
          <p>{isDispatcher ? 'Local incident activity, assistance requests, and community updates.' : 'Barangay team, local analytics, and community updates.'}</p>
        </div>
        <button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button>
      </header>

      {error && <div className="workspace-message workspace-message-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
      <section className="barangay-console-stat-grid" aria-label="Barangay summary">
        {canViewIncidents && <Link to={isDispatcher ? '/reports' : '/barangay-workspace'} aria-label="Open barangay incidents"><span>Active incidents</span><strong>{loading ? '—' : activeReports.length}</strong><AlertTriangle size={20} /></Link>}
        {user?.role === 'admin' && <article><span>Resolved incidents</span><strong>{loading ? '—' : resolvedReports.length}</strong><CheckCircle2 size={20} /></article>}
        {isDispatcher && <article><span>Pending assistance</span><strong>{loading ? '—' : pendingRequests.length}</strong><ClipboardList size={20} /></article>}
        <article><span>Active team members</span><strong>{loading ? '—' : activeMembers}</strong><Users size={20} /></article>
        <article><span>Barangay posts</span><strong>{loading ? '—' : postsCount}</strong><Bell size={20} /></article>
      </section>

      <section className="barangay-console-shortcuts" aria-label="Barangay workspaces">
        {isDispatcher && <Link to="/command-center"><MapPin /><span><strong>Incident command</strong><small>View the barangay-scoped incident queue and map.</small></span><ArrowRight /></Link>}
        {isDispatcher && <Link to="/barangay-assistance"><ClipboardList /><span><strong>Assistance requests</strong><small>Review requests or track the ones you submitted.</small></span><ArrowRight /></Link>}
        {user?.role === 'admin' && <Link to="/barangay-workspace"><AlertTriangle /><span><strong>Incidents</strong><small>Review incidents and download resolution documents.</small></span><ArrowRight /></Link>}
        <Link to="/barangay-board"><Bell /><span><strong>Barangay board</strong><small>Publish local advisories and read MDRRMO alerts.</small></span><ArrowRight /></Link>
        {user?.role === 'admin' && <Link to="/barangay-team"><Users /><span><strong>Team roster</strong><small>Manage active barangay responders and staff.</small></span><ArrowRight /></Link>}
        {user?.role === 'admin' && <Link to="/barangay-analytics"><Activity /><span><strong>Barangay analytics</strong><small>Review local report volume and outcomes.</small></span><ArrowRight /></Link>}
      </section>

      {isDispatcher && <section className="barangay-console-panel">
        <header><div><h2>Recent incident activity</h2><p>Reports currently visible to your barangay role.</p></div><Link to="/reports">Open incidents <ArrowRight size={15} /></Link></header>
        {loading ? <p className="barangay-console-muted">Loading barangay activity…</p> : latestReports.length === 0 ? <p className="barangay-console-muted">No incident history is available yet.</p> : (
          <div className="barangay-console-list">
            {latestReports.map((report) => <article key={report.id}>
              <span className={`barangay-console-status ${statusOf(report)}`}>{statusOf(report).replaceAll('_', ' ')}</span>
              <div><strong>{report.incident_type?.replaceAll('_', ' ') || report.title || 'Incident report'}</strong><p>{report.description || 'No additional details.'}</p></div>
              <time>{report.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.created_at)) : 'Time unavailable'}</time>
            </article>)}
          </div>
        )}
      </section>}
    </div>
  );
}
