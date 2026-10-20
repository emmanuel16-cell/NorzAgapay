import React, { useCallback, useEffect, useState } from 'react';
import { analyticsAPI } from '../lib/api';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import toast from 'react-hot-toast';
import IncidentAnalyticsCharts from '../components/IncidentAnalyticsCharts';

export default function AnalyticsPage() {
  const [stats, setStats] = useState<any>(null);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [responders, setResponders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    try {
      const [overview, incidentResult, responderResult] = await Promise.all([
        analyticsAPI.overview(),
        analyticsAPI.incidents(),
        analyticsAPI.responders(),
      ]);
      setStats(overview.data.stats);
      setIncidents(incidentResult.data.incidents || []);
      setResponders(responderResult.data.responders || []);
    } catch {
      toast.error('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAnalytics(); }, [loadAnalytics]);
  useRealtimeRefresh(loadAnalytics);

  const exportCsv = () => {
    const rows: unknown[][] = [
      ['Norz-Agapay analytics export'],
      ['Generated at', new Date().toISOString()],
      [],
      ['Overview'],
      ['Metric', 'Value'],
      ['MDRRMO staff accounts', stats?.totalUsers ?? 0],
      ['Active MDRRMO responders', stats?.activeResponders ?? 0],
      ['Open incidents', stats?.openIncidents ?? 0],
      ['Total tasks', stats?.totalTasks ?? 0],
      ['Completed tasks', stats?.completedTasks ?? 0],
      ['Incident reports received in the last six months', incidents.length],
      [],
      ['Incident reports · Last six months'],
      ['Report ID', 'Title', 'Category', 'Severity', 'Reporter type', 'Status', 'Barangay', 'Received at', 'Details'],
      ...incidents.map((incident) => [
        incident.id,
        incident.title,
        incident.incident_type || incident.type,
        incident.severity,
        incident.reporter_type,
        incident.status || incident.response_status,
        incident.barangays?.name || incident.barangay_name,
        incident.created_at,
        incident.description || incident.specifics,
      ]),
      [],
      ['MDRRMO responder deployment history'],
      ['Responder ID', 'Name', 'Role', 'Account status', 'Verified', 'Deployments', 'Resolved deployments', 'Resolution rate'],
      ...responders.map((responder) => {
        const deployments = Number(responder.totalDeployments) || 0;
        const resolved = Number(responder.resolvedDeployments) || 0;
        return [
          responder.id,
          responder.full_name,
          responder.role,
          responder.status,
          responder.verified,
          deployments,
          resolved,
          deployments ? `${Math.round((resolved / deployments) * 100)}%` : '0%',
        ];
      }),
    ];
    const csvCell = (value: unknown) => {
      const text = String(value ?? '');
      // Keep untrusted report text from being interpreted as a spreadsheet formula.
      const safeText = typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safeText.replace(/"/g, '""')}"`;
    };
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `norz-agapay-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (loading) return <div className="loading-overlay"><div className="spinner"/></div>;

  const topResponders = [...responders].sort((a, b) =>
    (b.totalDeployments || 0) - (a.totalDeployments || 0) ||
    (b.resolvedDeployments || 0) - (a.resolvedDeployments || 0) ||
    String(a.full_name || '').localeCompare(String(b.full_name || ''))
  ).slice(0, 10);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
        <button className="btn btn-outline" type="button" onClick={exportCsv}>
          📥 Export CSV
        </button>
      </div>

      <div className="page-content">
        {/* Overview Stats */}
        {stats && (
          <div className="stats-grid" style={{padding:0,marginBottom:'24px'}}>
            {[
              { label:'MDRRMO Staff Accounts', value: stats.totalUsers, icon:'👥', color:'var(--primary)' },
              { label:'Active Responders', value: stats.activeResponders ?? 0, icon:'🎖️', color:'var(--success)' },
              { label:'Incident Reports · 6 Months', value: incidents.length, icon:'🚨', color:'var(--accent)' },
              { label:'Tasks Completed', value: stats.completedTasks, icon:'✅', color:'var(--warning)' },
            ].map(s => (
              <div key={s.label} className="stat-card" style={{'--stat-color':s.color} as React.CSSProperties}>
                <div className="stat-icon">{s.icon}</div>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <IncidentAnalyticsCharts incidents={incidents} />


        {/* Top Responders */}
        <div className="card">
          <div className="card-title" style={{marginBottom:'16px'}}>Top Responder Deployments</div>
          {topResponders.length === 0 ? (
            <div className="empty-state" style={{padding:'20px'}}><p>No deployment data yet</p></div>
          ) : (
            <div className="table-container" style={{border:'none'}}>
              <table>
                <thead><tr><th>Name</th><th>Role</th><th>Total Deployments</th><th>Resolved</th><th>Resolution Rate</th></tr></thead>
                <tbody>
                  {topResponders.map(v => (
                    <tr key={v.id}>
                      <td style={{fontWeight:600,color:'var(--text-primary)'}}>{v.full_name}</td>
                      <td><span className="badge badge-low">{String(v.role || '').replace(/_/g,' ')}</span></td>
                      <td>{v.totalDeployments || 0}</td>
                      <td>{v.resolvedDeployments || 0}</td>
                      <td>
                        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                          <div style={{flex:1,height:'6px',background:'var(--bg-primary)',borderRadius:'3px',overflow:'hidden'}}>
                            <div style={{width:`${v.totalDeployments ? (v.resolvedDeployments/v.totalDeployments)*100 : 0}%`,height:'100%',background:'var(--success)',borderRadius:'3px',transition:'width 0.5s ease'}}/>
                          </div>
                          <span style={{fontSize:'12px',color:'var(--text-muted)'}}>
                            {v.totalDeployments ? Math.round((v.resolvedDeployments/v.totalDeployments)*100) : 0}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
