import React, { useEffect, useState } from 'react';
import { analyticsAPI } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import toast from 'react-hot-toast';

const COLORS = ['#1B4F72','#E74C3C','#27AE60','#F39C12','#3498DB','#9B59B6'];

export default function AnalyticsPage() {
  const [stats, setStats] = useState<any>(null);
  const [missions, setMissions] = useState<any[]>([]);
  const [volunteers, setVolunteers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      analyticsAPI.overview().then(r => setStats(r.data.stats)),
      analyticsAPI.missions().then(r => setMissions(r.data.incidents || [])),
      analyticsAPI.volunteers().then(r => setVolunteers(r.data.volunteers || [])),
    ]).catch(() => toast.error('Failed to load analytics')).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-overlay"><div className="spinner"/></div>;

  // Chart data
  const typeCounts: Record<string,number> = {};
  missions.forEach(inc => { typeCounts[inc.type] = (typeCounts[inc.type]||0)+1; });
  const typeData = Object.entries(typeCounts).map(([name,value])=>({ name: name.replace(/_/g,' '), value }));

  const severityCounts: Record<string,number> = {};
  missions.forEach(inc => { severityCounts[inc.severity] = (severityCounts[inc.severity]||0)+1; });
  const severityData = Object.entries(severityCounts).map(([name,value])=>({ name, value }));

  const topVolunteers = [...volunteers].sort((a,b) => b.completedTasks - a.completedTasks).slice(0,10);

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
              { label:'Active Volunteers', value: stats.activeVolunteers, icon:'🟢', color:'var(--success)' },
              { label:'Total Missions', value: missions.length, icon:'🚨', color:'var(--accent)' },
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

        {/* Charts */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px',marginBottom:'24px'}}>
          <div className="card">
            <div className="card-title" style={{marginBottom:'16px'}}>Missions by Type</div>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {typeData.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                </Pie>
                <Tooltip contentStyle={{background:'#1A2332',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'8px',color:'#F4F6F7'}}/>
                <Legend/>
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="card-title" style={{marginBottom:'16px'}}>Missions by Severity</div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={severityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis dataKey="name" tick={{fill:'#94A3B8',fontSize:12}}/>
                <YAxis tick={{fill:'#94A3B8',fontSize:12}}/>
                <Tooltip contentStyle={{background:'#1A2332',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'8px',color:'#F4F6F7'}}/>
                <Bar dataKey="value" fill="#1B4F72" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>


        {/* Top Volunteers */}
        <div className="card">
          <div className="card-title" style={{marginBottom:'16px'}}>Top Volunteer Deployments</div>
          {topVolunteers.length === 0 ? (
            <div className="empty-state" style={{padding:'20px'}}><p>No volunteer data yet</p></div>
          ) : (
            <div className="table-container" style={{border:'none'}}>
              <table>
                <thead><tr><th>Name</th><th>Role</th><th>Total Tasks</th><th>Completed</th><th>Completion Rate</th></tr></thead>
                <tbody>
                  {topVolunteers.map(v => (
                    <tr key={v.id}>
                      <td style={{fontWeight:600,color:'var(--text-primary)'}}>{v.full_name}</td>
                      <td><span className="badge badge-low">{v.role.replace(/_/g,' ')}</span></td>
                      <td>{v.totalTasks}</td>
                      <td>{v.completedTasks}</td>
                      <td>
                        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                          <div style={{flex:1,height:'6px',background:'var(--bg-primary)',borderRadius:'3px',overflow:'hidden'}}>
                            <div style={{width:`${v.totalTasks ? (v.completedTasks/v.totalTasks)*100 : 0}%`,height:'100%',background:'var(--success)',borderRadius:'3px',transition:'width 0.5s ease'}}/>
                          </div>
                          <span style={{fontSize:'12px',color:'var(--text-muted)'}}>
                            {v.totalTasks ? Math.round((v.completedTasks/v.totalTasks)*100) : 0}%
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
