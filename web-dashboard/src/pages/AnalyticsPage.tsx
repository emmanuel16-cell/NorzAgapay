import React, { useEffect, useState } from 'react';
import { analyticsAPI } from '../lib/api';
import toast from 'react-hot-toast';
import IncidentAnalyticsCharts from '../components/IncidentAnalyticsCharts';

export default function AnalyticsPage() {
  const [stats, setStats] = useState<any>(null);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [responders, setResponders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      analyticsAPI.overview().then(r => setStats(r.data.stats)),
      analyticsAPI.incidents().then(r => setIncidents(r.data.incidents || [])),
      analyticsAPI.responders().then(r => setResponders(r.data.responders || [])),
    ]).catch(() => toast.error('Failed to load analytics')).finally(() => setLoading(false));
  }, []);

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
        <button className="btn btn-outline" onClick={()=>toast.success('Export functionality ready for production integration')}>
          📥 Export CSV
        </button>
      </div>

      <div className="page-content">
        {/* Overview Stats */}
        {stats && (
          <div className="stats-grid" style={{padding:0,marginBottom:'24px'}}>
            {[
              { label:'Total Users', value: stats.totalUsers, icon:'👥', color:'var(--primary)' },
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
