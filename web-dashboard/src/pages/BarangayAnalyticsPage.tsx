import { useCallback, useEffect, useState } from 'react';
import { Activity, BarChart3, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { barangayAPI } from '../lib/api';

type MonthlyRow = { label: string; community: number; emergency: number };
type Distribution = { label: string; count: number };
type Stats = {
  report_count?: number;
  type?: string;
  report_volume_by_month?: MonthlyRow[];
  category_distribution?: Distribution[];
  status_distribution?: { pending?: number; responding?: number; resolved?: number };
  activity_heatmap?: { weekdays?: string[]; counts?: number[][]; timezone?: string };
  reports?: Array<{ id: string; title?: string; incident_type?: string; description?: string; created_at?: string; resolved_at?: string; resolved_notes?: string; barangay_resolved_at?: string }>;
};
const COLORS = ['#36c5db', '#fb923c', '#a78bfa', '#4ade80', '#f472b6', '#facc15', '#60a5fa', '#a3e635'];

export default function BarangayAnalyticsPage() {
  const { user } = useAuth();
  const [type, setType] = useState<'all' | 'community' | 'emergency'>('all');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data } = await barangayAPI.statistics(type === 'all' ? undefined : type);
      setStats(data || null);
    } catch (loadError: any) { setError(loadError?.response?.data?.error || 'Barangay analytics could not be loaded.'); }
    finally { setLoading(false); }
  }, [type]);

  useEffect(() => { void load(); }, [load]);
  const status = stats?.status_distribution || {};
  const statusRows = [
    { label: 'Pending', count: status.pending || 0 },
    { label: 'Responding', count: status.responding || 0 },
    { label: 'Resolved', count: status.resolved || 0 },
  ];
  const maxHeat = Math.max(1, ...(stats?.activity_heatmap?.counts || []).flat());

  return (
    <div className="barangay-console-page">
      <header className="barangay-console-header"><div><span className="workspace-eyebrow">BARANGAY PERFORMANCE · {user?.barangay_name || 'YOUR BARANGAY'}</span><h1>Barangay analytics</h1><p>Barangay-scoped incident outcomes and activity. Charts cover the periods described below.</p></div><div className="barangay-analytics-controls"><select aria-label="Report category" value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="all">All report types</option><option value="emergency">Emergency</option><option value="community">Community</option></select><button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button></div></header>
      {error && <div className="workspace-message workspace-message-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
      {loading ? <p className="barangay-console-muted">Loading barangay analytics…</p> : <>
        <section className="barangay-console-stat-grid" aria-label="Barangay report analytics"><article><span>Resolved reports · selected type</span><strong>{stats?.report_count ?? 0}</strong><BarChart3 size={20} /></article><article><span>Pending · recent activity</span><strong>{status.pending || 0}</strong><Activity size={20} /></article><article><span>Responding · recent activity</span><strong>{status.responding || 0}</strong><Activity size={20} /></article><article><span>Resolved · recent activity</span><strong>{status.resolved || 0}</strong><BarChart3 size={20} /></article></section>

        <div className="barangay-analytics-grid">
          <section className="barangay-console-panel barangay-chart-card"><header><div><h2>Report volume by month</h2><p>Six most recent calendar months · Asia/Manila municipality reporting data.</p></div></header><div className="barangay-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={stats?.report_volume_by_month || []} margin={{ top: 8, right: 12, left: -16, bottom: 2 }}><CartesianGrid strokeDasharray="3 3" stroke="#31415e" /><XAxis dataKey="label" stroke="#94a8c8" /><YAxis allowDecimals={false} stroke="#94a8c8" /><Tooltip /><Bar dataKey="emergency" name="Emergency" fill="#fb7185" radius={[4, 4, 0, 0]} /><Bar dataKey="community" name="Community" fill="#38bdf8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
          <section className="barangay-console-panel barangay-chart-card"><header><div><h2>Incident categories</h2><p>Most frequent categories across recent barangay reports.</p></div></header><div className="barangay-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={stats?.category_distribution || []} layout="vertical" margin={{ top: 5, right: 14, left: 28, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#31415e" /><XAxis type="number" allowDecimals={false} stroke="#94a8c8" /><YAxis type="category" dataKey="label" width={115} stroke="#94a8c8" /><Tooltip /><Bar dataKey="count" name="Reports" radius={[0, 5, 5, 0]}>{(stats?.category_distribution || []).map((entry, index) => <Cell key={`${entry.label}-${index}`} fill={COLORS[index % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div></section>
        </div>

        <section className="barangay-console-panel"><header><div><h2>Activity by day and hour</h2><p>Reports created during the last 90 days · timezone {stats?.activity_heatmap?.timezone || 'Asia/Manila'}.</p></div></header><div className="barangay-heatmap" role="img" aria-label="Incident activity by day and hour"><div className="barangay-heatmap-hours"><span />{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>)}</div>{(stats?.activity_heatmap?.weekdays || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day, dayIndex) => <div className="barangay-heatmap-row" key={day}><span>{day}</span>{Array.from({ length: 24 }, (_, hour) => { const count = stats?.activity_heatmap?.counts?.[dayIndex]?.[hour] || 0; const intensity = count ? Math.max(.16, count / maxHeat) : 0; return <span key={hour} title={`${day} ${String(hour).padStart(2, '0')}:00 · ${count} reports`} style={{ opacity: count ? 0.28 + intensity * 0.72 : 0.08 }} />; })}</div>)}</div></section>

        <section className="barangay-console-panel"><header><div><h2>Resolved incident history</h2><p>{stats?.report_count ?? 0} reports match the selected type.</p></div></header>{(stats?.reports || []).length === 0 ? <p className="barangay-console-muted">No resolved reports match this view.</p> : <div className="barangay-analytics-report-list">{(stats?.reports || []).slice(0, 12).map((report) => <article key={report.id}><span>{report.incident_type?.replaceAll('_', ' ') || report.title || 'Incident'}</span><p>{report.description || report.resolved_notes || 'No incident summary was stored.'}</p><time>{report.barangay_resolved_at || report.resolved_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(report.barangay_resolved_at || report.resolved_at!)) : 'Resolution date unavailable'}</time></article>)}</div>}</section>
      </>}
    </div>
  );
}
