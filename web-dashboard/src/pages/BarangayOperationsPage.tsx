import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import { AlertTriangle, Check, ChevronRight, CircleHelp, ClipboardList, MapPin, Megaphone, Phone, Plus, RefreshCw, Send, ShieldAlert, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import 'leaflet/dist/leaflet.css';
import IncidentAnalyticsCharts from '../components/IncidentAnalyticsCharts';
import { INCIDENT_SEVERITY_OPTIONS, INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';
import { barangayAPI, evacuationAPI, socket } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { CARTO_DARK_MAP_URL, CARTO_ATTRIBUTION } from '../lib/mapConfig';

type Section = 'command-center' | 'reports' | 'team' | 'assistance' | 'community' | 'hotlines' | 'analytics';
type Row = Record<string, any>;

const asRows = (value: any): Row[] => Array.isArray(value) ? value : [];
const statusColor = (status = '') => {
  const key = status.toLowerCase();
  if (key.includes('resolved') || key.includes('closed') || key.includes('actioned')) return '#10b981';
  if (key.includes('escalat') || key.includes('critical')) return '#ef4444';
  if (key.includes('respond') || key.includes('progress') || key.includes('pending')) return '#f59e0b';
  return '#38bdf8';
};

export default function BarangayOperationsPage({ section }: { section: Section }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Row[]>([]);
  const [team, setTeam] = useState<Row[]>([]);
  const [requests, setRequests] = useState<Row[]>([]);
  const [broadcasts, setBroadcasts] = useState<Row[]>([]);
  const [hotlines, setHotlines] = useState<Row[]>([]);
  const [stations, setStations] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedResponder, setSelectedResponder] = useState('');
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [dispatchType, setDispatchType] = useState('');
  const [dispatchSeverity, setDispatchSeverity] = useState('');
  const [editingMember, setEditingMember] = useState<Row | null>(null);
  const [memberForm, setMemberForm] = useState({ full_name: '', email: '', password: '', phone: '', role: 'responder' });
  const [assistanceForm, setAssistanceForm] = useState({ incident_report_id: '', incident_title: '', explanation: '', needs_more_manpower: false, needs_resources: false, needs_equipment: false, beyond_barangay_capability: false });
  const [broadcastForm, setBroadcastForm] = useState({ category: 'Emergency Advisory', content: '' });
  const [broadcastFiles, setBroadcastFiles] = useState<FileList | null>(null);
  const [hotlineDraft, setHotlineDraft] = useState({ purpose: '', number: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (section === 'command-center' || section === 'reports') {
        if (user?.role !== 'staff') {
          const response = await barangayAPI.reports();
          setReports(asRows(response.data));
          if (section === 'command-center' && ['dispatcher', 'responder'].includes(user?.role || '')) {
            const members = await barangayAPI.team();
            setTeam(asRows(members.data));
          }
        }
      } else if (section === 'team') {
        const response = await barangayAPI.team();
        setTeam(asRows(response.data));
      } else if (section === 'assistance') {
        if (user?.role === 'dispatcher') {
          const response = await barangayAPI.assistanceRequests();
          setRequests(asRows(response.data?.requests));
        } else {
          const [requestResponse, reportResponse] = await Promise.all([barangayAPI.myAssistanceRequests(), barangayAPI.reports()]);
          setRequests(asRows(requestResponse.data?.requests));
          setReports(asRows(reportResponse.data));
        }
      } else if (section === 'community') {
        const response = await barangayAPI.broadcasts();
        setBroadcasts(asRows(response.data));
      } else if (section === 'hotlines') {
        const response = await barangayAPI.hotlines(user?.barangay_id);
        setHotlines(asRows(response.data?.entries ?? response.data));
      } else if (section === 'analytics') {
        const [reportResponse, postResponse, teamResponse, stationResponse] = await Promise.all([
          barangayAPI.reports(), barangayAPI.broadcasts(), barangayAPI.team(), evacuationAPI.list({ barangay_id: user?.barangay_id }),
        ]);
        setReports(asRows(reportResponse.data));
        setBroadcasts(asRows(postResponse.data));
        setTeam(asRows(teamResponse.data));
        setStations(asRows(stationResponse.data));
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not load barangay operations');
    } finally {
      setLoading(false);
    }
  }, [section, user?.role, user?.barangay_id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refreshReports = () => {
      if (section === 'command-center' || section === 'reports' || section === 'assistance') void load();
    };
    socket.on('barangay:report_updated', refreshReports);
    return () => { socket.off('barangay:report_updated', refreshReports); };
  }, [load, section]);

  const title = useMemo(() => ({
    'command-center': 'Barangay Command Center',
    reports: 'Incident Reports',
    team: 'Barangay Team',
    assistance: 'Assistance Requests',
    community: 'Community Updates',
    hotlines: 'Barangay Hotlines',
    analytics: 'Barangay Analytics',
  }[section]), [section]);

  const filteredReports = reports.filter((report) => `${report.title || ''} ${report.type || ''} ${report.address || ''} ${report.status || ''}`.toLowerCase().includes(search.toLowerCase()));
  const mapCenter: [number, number] = reports.length
    ? [reports.reduce((sum, row) => sum + Number(row.latitude || 14.9133), 0) / reports.length, reports.reduce((sum, row) => sum + Number(row.longitude || 121.0436), 0) / reports.length]
    : [14.9133, 121.0436];
  const openReports = reports.filter((r) => !['resolved', 'closed'].includes(String(r.status || '').toLowerCase()));
  const responders = team.filter((member) => member.role === 'responder' && member.is_active !== false);
  const responderAssignedReports = reports.filter((report) => {
    const assignedIds = Array.isArray(report.assigned_team_leader_ids) ? report.assigned_team_leader_ids.map(String) : [];
    return report.barangay_responded_by === user?.id || assignedIds.includes(user?.id || '');
  });

  const dispatchSelected = async () => {
    if (!selected || !selectedResponder) return toast.error('Select an available responder');
    if (!dispatchType || !dispatchSeverity) return toast.error('Choose the incident type and severity');
    try {
      await barangayAPI.dispatchReport(selected.id, { team_leader_id: selectedResponder, notes, incident_type: dispatchType, severity: dispatchSeverity });
      toast.success('Responder assigned');
      setSelected(null); setNotes(''); setSelectedResponder(''); setDispatchModalOpen(false);
      await load();
    } catch (error: any) { toast.error(error.response?.data?.error || 'Could not assign responder'); }
  };

  const openDispatchModal = () => {
    if (!selected) return;
    setDispatchType(selected.incident_type || '');
    setDispatchSeverity(selected.severity || '');
    setDispatchModalOpen(true);
  };

  const updateResponse = async () => {
    if (!selected) return;
    try {
      await barangayAPI.respondToReport(selected.id, { notes });
      toast.success('Incident status updated'); setNotes(''); await load();
    } catch (error: any) { toast.error(error.response?.data?.error || 'Could not update incident'); }
  };

  const escalateReport = async () => {
    if (!selected) return;
    const reason = notes.trim() || window.prompt('Why does this incident need MDRRMO support?') || '';
    if (!reason.trim()) return toast.error('Add an escalation reason');
    try {
      await barangayAPI.escalateReport(selected.id, { notes: reason });
      toast.success('Incident escalated to MDRRMO'); setNotes(''); await load();
    } catch (error: any) { toast.error(error.response?.data?.error || 'Could not escalate incident'); }
  };

  const closeReport = async () => {
    if (!selected) return;
    const summary = window.prompt('Write a short resolution summary');
    if (!summary?.trim()) return;
    try {
      await barangayAPI.closeReport(selected.id, { resolved_notes: summary.trim() });
      toast.success('Incident resolved'); setSelected(null); await load();
    } catch (error: any) { toast.error(error.response?.data?.error || 'Could not close incident'); }
  };

  const uploadFieldMedia = async (file?: File) => {
    if (!selected || !file) return;
    const body = new FormData(); body.append('media', file);
    try {
      await barangayAPI.uploadFieldMedia(selected.id, body);
      toast.success('Field documentation uploaded');
      await load();
    } catch (error: any) { toast.error(error.response?.data?.error || 'Could not upload field documentation'); }
  };

  const saveMember = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (editingMember) await barangayAPI.updateTeamMember(editingMember.id, memberForm);
      else await barangayAPI.addTeamMember(memberForm);
      toast.success(editingMember ? 'Team member updated' : 'Team member added');
      setMemberForm({ full_name: '', email: '', password: '', phone: '', role: 'responder' });
      setEditingMember(null); await load();
    } catch (error: any) { toast.error(error.response?.data?.error || 'Could not save team member'); }
  };

  const deactivateMember = async (member: Row) => {
    if (!window.confirm(`Deactivate ${member.full_name}?`)) return;
    try { await barangayAPI.deactivateTeamMember(member.id); toast.success('Team member deactivated'); await load(); }
    catch (error: any) { toast.error(error.response?.data?.error || 'Could not deactivate account'); }
  };

  const submitAssistance = async (event: React.FormEvent) => {
    event.preventDefault();
    if (assistanceForm.beyond_barangay_capability && !assistanceForm.incident_report_id) {
      toast.error('Link the assigned incident that needs MDRRMO review');
      return;
    }
    try {
      await barangayAPI.createAssistanceRequest({ ...assistanceForm, incident_report_id: assistanceForm.incident_report_id || null });
      setAssistanceForm({ incident_report_id: '', incident_title: '', explanation: '', needs_more_manpower: false, needs_resources: false, needs_equipment: false, beyond_barangay_capability: false });
      toast.success('Request sent to your dispatcher'); await load();
    } catch (error: any) { toast.error(error.response?.data?.error || 'Could not send assistance request'); }
  };

  const decideAssistance = async (request: Row, decision: string) => {
    const dispatcher_notes = window.prompt('Add a note for the response team') || '';
    try { await barangayAPI.decideAssistanceRequest(request.id, { decision, dispatcher_notes }); toast.success('Request updated'); await load(); }
    catch (error: any) { toast.error(error.response?.data?.error || 'Could not decide request'); }
  };

  const submitBroadcast = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = new FormData(); body.append('category', broadcastForm.category); body.append('content', broadcastForm.content);
    Array.from(broadcastFiles || []).forEach((file) => body.append('media', file));
    try {
      await barangayAPI.createBroadcast(body); setBroadcastForm({ category: 'Emergency Advisory', content: '' }); setBroadcastFiles(null);
      toast.success('Community update published'); await load();
    } catch (error: any) { toast.error(error.response?.data?.error || 'Could not publish update'); }
  };

  const addHotline = () => {
    if (!hotlineDraft.purpose.trim() || !hotlineDraft.number.trim()) return toast.error('Enter the hotline purpose and number');
    setHotlines((current) => [...current, { purpose: hotlineDraft.purpose.trim(), numbers: [hotlineDraft.number.trim()] }]);
    setHotlineDraft({ purpose: '', number: '' });
  };

  const saveHotlines = async () => {
    try { await barangayAPI.saveHotlines(hotlines); toast.success('Hotline directory saved'); }
    catch (error: any) { toast.error(error.response?.data?.error || 'Could not save hotline directory'); }
  };

  const renderReportList = (withMap: boolean) => (
    <>
      <div className="stats-grid" style={{ padding: 0, marginBottom: 18 }}>
        {[
          { label: 'Open reports', count: openReports.length, color: '#f59e0b', icon: <AlertTriangle size={18} /> },
          { label: 'Escalated', count: reports.filter((r) => r.status === 'escalated').length, color: '#ef4444', icon: <ShieldAlert size={18} /> },
          { label: 'Resolved', count: reports.filter((r) => ['resolved', 'closed'].includes(r.status)).length, color: '#10b981', icon: <Check size={18} /> },
        ].map((metric) => <div className="stat-card" key={metric.label} style={{ '--stat-color': metric.color } as React.CSSProperties}><div className="stat-icon">{metric.icon}</div><div className="stat-value">{metric.count}</div><div className="stat-label">{metric.label}</div></div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: withMap ? 'minmax(0,1.4fr) minmax(320px,.9fr)' : '1fr', gap: 18, alignItems: 'start' }}>
        {withMap && <div className="card" style={{ padding: 0, overflow: 'hidden', height: 420 }}>
          <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution={CARTO_ATTRIBUTION} url={CARTO_DARK_MAP_URL} />
            {reports.filter((r) => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude))).map((report) => <CircleMarker key={report.id} center={[Number(report.latitude), Number(report.longitude)]} radius={9} pathOptions={{ color: statusColor(report.severity || report.status), fillColor: statusColor(report.severity || report.status), fillOpacity: .8 }} eventHandlers={{ click: () => setSelected(report) }}><Popup><strong>{report.title || report.type}</strong><br />{report.status || 'Pending'}</Popup></CircleMarker>)}
          </MapContainer>
        </div>}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <input className="form-input" placeholder="Search reports" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="btn btn-outline btn-sm" onClick={load} title="Refresh"><RefreshCw size={16} /></button>
          </div>
          <div style={{ maxHeight: withMap ? 344 : 'none', overflowY: withMap ? 'auto' : 'visible' }}>
            {filteredReports.length === 0 ? <div className="empty-state"><CircleHelp size={28} /><p>No incident reports found for this barangay.</p></div> : filteredReports.map((report) => <button key={report.id} type="button" onClick={() => { setSelected(report); setNotes(''); setSelectedResponder(''); }} className="barangay-report-row" style={{ width: '100%', textAlign: 'left', border: '1px solid var(--border-color)', borderRadius: 14, padding: 14, marginBottom: 10, background: selected?.id === report.id ? 'rgba(14,165,233,.12)' : 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{report.title || report.type || 'Incident report'}</strong><span className="status-badge" style={{ color: statusColor(report.status), textTransform: 'capitalize' }}>{String(report.status || report.barangay_response_status || 'pending').replaceAll('_', ' ')}</span></div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>{report.address || report.barangay_name || 'Location pending'} · {report.reporter_name || 'Resident'}</div>
            </button>)}
          </div>
        </div>
      </div>
      {selected && <div className="card" style={{ marginTop: 18, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}><div><div className="eyebrow">Selected incident</div><h2 style={{ margin: '5px 0 8px' }}>{selected.title || selected.type}</h2><div className="field-help">{selected.address || 'Location not provided'} · {selected.reporter_name || 'Resident'} · {selected.reporter_phone || 'No phone'}</div></div><button className="btn btn-outline btn-sm" onClick={() => setSelected(null)}>Close</button></div>
        <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>{selected.description || selected.specifics || 'No additional description.'}</p>
        {(selected.incident_type || selected.severity) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}><span className="badge">Type · {INCIDENT_TYPE_OPTIONS.find((option) => option.value === selected.incident_type)?.label || String(selected.incident_type || 'Unclassified').replaceAll('_', ' ')}</span><span className="badge">Severity · {INCIDENT_SEVERITY_OPTIONS.find((option) => option.value === selected.severity)?.label || String(selected.severity || 'Unclassified')}</span></div>}
        {user?.role === 'dispatcher' && <div style={{ margin: '16px 0' }}><button className="btn btn-primary" onClick={openDispatchModal}><Send size={15} /> Classify & Dispatch</button></div>}
        {['dispatcher', 'responder'].includes(user?.role || '') && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, alignItems: 'end' }}>
          {user?.role === 'dispatcher' && <button className="btn btn-outline" onClick={updateResponse}>Mark responding</button>}
          {user?.role === 'dispatcher' && <button className="btn btn-outline" onClick={escalateReport}><ShieldAlert size={15} /> Escalate to MDRRMO</button>}
          <button className="btn btn-outline" onClick={closeReport}>Resolve incident</button>
          <label className="btn btn-outline" style={{ cursor: 'pointer' }}>Upload field media<input type="file" accept="image/*,video/*" hidden onChange={(e) => void uploadFieldMedia(e.target.files?.[0])} /></label>
        </div>}
      </div>}
    </>
  );

  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;

  return <>
    <div className="page-header">
      <div><div className="eyebrow">{user?.barangay_name || 'Barangay operations'}</div><h1 className="page-title">{title}</h1><p className="page-subtitle">Secure workspace for your barangay. Reports and team records are limited to your coordination area.</p></div>
      <button className="btn btn-outline" onClick={load}><RefreshCw size={16} /> Refresh</button>
    </div>
    <div className="page-content">
      {(section === 'command-center' || section === 'reports') && renderReportList(section === 'command-center')}

      {section === 'team' && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(290px,.8fr) minmax(0,1.2fr)', gap: 18, alignItems: 'start' }}>
        <form className="card" onSubmit={saveMember} style={{ padding: 20 }}><div className="card-title">{editingMember ? 'Update team account' : 'Add team member'}</div>
          <label className="form-label">Full name</label><input className="form-input" value={memberForm.full_name} onChange={(e) => setMemberForm({ ...memberForm, full_name: e.target.value })} required />
          <label className="form-label" style={{ marginTop: 12 }}>Email</label><input className="form-input" type="email" value={memberForm.email} onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} required />
          <label className="form-label" style={{ marginTop: 12 }}>Phone</label><input className="form-input" value={memberForm.phone} onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })} />
          <label className="form-label" style={{ marginTop: 12 }}>Role</label><select className="form-select" value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}>{(user?.role === 'responder' ? ['staff'] : ['dispatcher', 'responder', 'staff']).map((role) => <option key={role} value={role}>{role}</option>)}</select>
          <label className="form-label" style={{ marginTop: 12 }}>Password {editingMember && '(leave blank to keep current)'}</label><input className="form-input" type="password" minLength={8} value={memberForm.password} onChange={(e) => setMemberForm({ ...memberForm, password: e.target.value })} required={!editingMember} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button className="btn btn-primary" type="submit"><Plus size={15} /> Save</button>{editingMember && <button className="btn btn-outline" type="button" onClick={() => { setEditingMember(null); setMemberForm({ full_name: '', email: '', password: '', phone: '', role: 'responder' }); }}>Cancel</button>}</div>
        </form>
        <div className="card" style={{ padding: 18 }}><div className="card-title" style={{ marginBottom: 14 }}>Team accounts <span className="badge">{team.length}</span></div>{team.map((member) => <div key={member.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}><div><strong>{member.full_name}</strong><div className="field-help">{member.email} · {member.role} · {member.is_active === false ? 'inactive' : 'active'}</div></div>{user?.role === 'admin' && member.role !== 'admin' && <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-outline btn-sm" onClick={() => { setEditingMember(member); setMemberForm({ full_name: member.full_name, email: member.email, password: '', phone: member.phone || '', role: member.role }); }}>Edit</button><button className="btn btn-outline btn-sm" onClick={() => void deactivateMember(member)}>Deactivate</button></div>}</div>)}</div>
      </div>}

      {section === 'assistance' && <div style={{ display: 'grid', gridTemplateColumns: user?.role === 'responder' ? 'minmax(300px,.85fr) minmax(0,1.15fr)' : '1fr', gap: 18, alignItems: 'start' }}>
        {user?.role === 'responder' && <form className="card" onSubmit={submitAssistance} style={{ padding: 20 }}><div className="card-title">Request more support</div><label className="form-label">Link an assigned incident (optional)</label><select className="form-select" value={assistanceForm.incident_report_id} onChange={(e) => { const report = responderAssignedReports.find((row) => row.id === e.target.value); setAssistanceForm({ ...assistanceForm, incident_report_id: e.target.value, incident_title: report?.title || '' }); }}><option value="">General support request</option>{responderAssignedReports.map((report) => <option key={report.id} value={report.id}>{report.title || report.type} · {String(report.status || 'pending').replaceAll('_', ' ')}</option>)}</select><label className="form-label" style={{ marginTop: 12 }}>Incident label</label><input className="form-input" value={assistanceForm.incident_title} onChange={(e) => setAssistanceForm({ ...assistanceForm, incident_title: e.target.value })} placeholder="Incident name" /><label className="form-label" style={{ marginTop: 12 }}>Explain what is needed</label><textarea className="form-input" rows={4} minLength={10} value={assistanceForm.explanation} onChange={(e) => setAssistanceForm({ ...assistanceForm, explanation: e.target.value })} required /><div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{[['needs_more_manpower', 'More responders'], ['needs_resources', 'Resources'], ['needs_equipment', 'Equipment'], ['beyond_barangay_capability', 'Beyond barangay capability · request MDRRMO review']].map(([key, label]) => <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={(assistanceForm as any)[key]} onChange={(e) => setAssistanceForm({ ...assistanceForm, [key]: e.target.checked })} />{label}</label>)}</div><button className="btn btn-primary" style={{ marginTop: 16 }}><Send size={15} /> Send request</button></form>}
        <div className="card" style={{ padding: 18 }}><div className="card-title" style={{ marginBottom: 14 }}>{user?.role === 'dispatcher' ? 'Incoming requests' : 'Your requests'}</div>{requests.length === 0 ? <div className="empty-state"><p>No assistance requests yet.</p></div> : requests.map((request) => <div key={request.id} style={{ padding: 14, borderRadius: 12, background: 'var(--bg-secondary)', marginBottom: 10 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{request.incident_title || 'General assistance'}{request.beyond_barangay_capability && <span className="badge" style={{ marginLeft: 8 }}>MDRRMO review requested</span>}</strong><span className="status-badge" style={{ color: statusColor(request.status) }}>{request.status}</span></div><p style={{ color: 'var(--text-secondary)', margin: '8px 0' }}>{request.explanation}</p><div className="field-help">Requested by {request.requested_by_user?.full_name || 'Response team'}{request.incident_report_id ? ' · Linked to incident report' : ''}</div>{user?.role === 'dispatcher' && request.status === 'pending' && <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button className="btn btn-primary btn-sm" onClick={() => void decideAssistance(request, 'provide_barangay_assistance')}>Assign local support</button><button className="btn btn-outline btn-sm" onClick={() => void decideAssistance(request, 'coordinate_mdrrmo')}>{request.incident_report_id ? 'Escalate linked incident' : 'Coordinate MDRRMO'}</button></div>}{user?.role === 'responder' && <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button className="btn btn-outline btn-sm" onClick={() => barangayAPI.actionAssistanceRequest(request.id, { action: 'acknowledge' }).then(load).catch(() => toast.error('Could not acknowledge request'))}>Acknowledge</button><button className="btn btn-outline btn-sm" onClick={() => barangayAPI.actionAssistanceRequest(request.id, { action: 'cancel' }).then(load).catch(() => toast.error('Could not cancel request'))}>Cancel</button></div>}</div>)}</div>
      </div>}

      {section === 'community' && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px,.8fr) minmax(0,1.2fr)', gap: 18, alignItems: 'start' }}>
        <form className="card" onSubmit={submitBroadcast} style={{ padding: 20 }}><div className="card-title">Publish community update</div><label className="form-label">Category</label><select className="form-select" value={broadcastForm.category} onChange={(e) => setBroadcastForm({ ...broadcastForm, category: e.target.value })}>{['Emergency Advisory', 'Weather Update', 'Community Notice', 'Health Advisory'].map((item) => <option key={item}>{item}</option>)}</select><label className="form-label" style={{ marginTop: 12 }}>Message</label><textarea className="form-input" rows={5} minLength={5} value={broadcastForm.content} onChange={(e) => setBroadcastForm({ ...broadcastForm, content: e.target.value })} required /><label className="form-label" style={{ marginTop: 12 }}>Photos or video (optional)</label><input className="form-input" type="file" accept="image/*,video/*" multiple onChange={(e) => setBroadcastFiles(e.target.files)} /><button className="btn btn-primary" style={{ marginTop: 16 }}><Megaphone size={15} /> Publish update</button></form>
        <div className="card" style={{ padding: 18 }}><div className="card-title" style={{ marginBottom: 14 }}>Published updates</div>{broadcasts.map((post) => <div key={post.id} style={{ padding: 14, borderBottom: '1px solid var(--border-color)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{post.category}</strong><span className="field-help">{post.created_at ? new Date(post.created_at).toLocaleDateString() : ''}</span></div><p style={{ color: 'var(--text-secondary)' }}>{post.content}</p><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-outline btn-sm" onClick={() => barangayAPI.pinBroadcast(post.id, !post.is_pinned).then(load).catch(() => toast.error('Could not pin update'))}>{post.is_pinned ? 'Unpin' : 'Pin'}</button><button className="btn btn-outline btn-sm" onClick={() => barangayAPI.deleteBroadcast(post.id).then(load).catch(() => toast.error('Could not remove update'))}>Remove</button></div></div>)}</div>
      </div>}

      {section === 'hotlines' && <div className="card" style={{ padding: 20, maxWidth: 980 }}><div className="card-title">Emergency contact directory</div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 9, alignItems: 'end', margin: '16px 0' }}><div><label className="form-label">Purpose</label><input className="form-input" value={hotlineDraft.purpose} onChange={(e) => setHotlineDraft({ ...hotlineDraft, purpose: e.target.value })} placeholder="Medical emergency" /></div><div><label className="form-label">Phone number</label><input className="form-input" value={hotlineDraft.number} onChange={(e) => setHotlineDraft({ ...hotlineDraft, number: e.target.value })} placeholder="09xx xxx xxxx" /></div><button className="btn btn-outline" onClick={addHotline}><Plus size={15} /> Add</button></div>{hotlines.map((entry, index) => <div key={`${entry.purpose}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr auto', gap: 8, marginBottom: 8 }}><input className="form-input" value={entry.purpose} onChange={(e) => setHotlines((items) => items.map((item, i) => i === index ? { ...item, purpose: e.target.value } : item))} /><input className="form-input" value={(entry.numbers || []).join(', ')} onChange={(e) => setHotlines((items) => items.map((item, i) => i === index ? { ...item, numbers: e.target.value.split(',').map((number: string) => number.trim()).filter(Boolean) } : item))} /><button className="btn btn-outline btn-sm" onClick={() => setHotlines((items) => items.filter((_, i) => i !== index))}>Remove</button></div>)}<button className="btn btn-primary" style={{ marginTop: 14 }} onClick={saveHotlines}><Phone size={15} /> Save hotlines</button></div>}

      {section === 'analytics' && <div className="stats-grid" style={{ padding: 0 }}>
        {[
          { label: 'Incident reports', value: reports.length, icon: <AlertTriangle size={20} /> },
          { label: 'Active reports', value: openReports.length, icon: <MapPin size={20} /> },
          { label: 'Team members', value: team.length, icon: <Users size={20} /> },
          { label: 'Community updates', value: broadcasts.length, icon: <Megaphone size={20} /> },
          { label: 'Evacuation stations', value: stations.length, icon: <ClipboardList size={20} /> },
        ].map((item) => <div key={item.label} className="stat-card"><div className="stat-icon">{item.icon}</div><div className="stat-value">{item.value}</div><div className="stat-label">{item.label}</div></div>)}
        <div style={{ gridColumn: '1 / -1' }}><IncidentAnalyticsCharts incidents={reports} /></div>
      </div>}
    </div>
    {dispatchModalOpen && selected && <div className="pin-modal-backdrop" style={{ zIndex: 3600 }} onClick={() => setDispatchModalOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="barangay-dispatch-title" onClick={(event) => event.stopPropagation()} className="card" style={{ width: 'min(680px, calc(100vw - 32px))', maxHeight: '88vh', overflowY: 'auto', padding: 24, background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
        <div className="eyebrow">Dispatcher review</div><h2 id="barangay-dispatch-title" style={{ margin: '5px 0 8px' }}>Classify and dispatch</h2>
        <div className="field-help" style={{ marginBottom: 12 }}>{selected.title || selected.type} · {selected.address || 'Location not provided'}</div>
        <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>{selected.description || selected.specifics || 'No additional description.'}</p>
        {Array.isArray(selected.proof_urls) && selected.proof_urls.length > 0 && <div style={{ marginBottom: 14 }}><label className="form-label">Submitted evidence</label><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{selected.proof_urls.map((url: string, index: number) => <a key={`${url}-${index}`} className="btn btn-outline btn-sm" href={url} target="_blank" rel="noreferrer">Open evidence {index + 1}</a>)}</div></div>}
        <label className="form-label">Incident type</label><select className="form-select" value={dispatchType} onChange={(event) => setDispatchType(event.target.value)}><option value="">Select type</option>{INCIDENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <label className="form-label" style={{ marginTop: 12 }}>Severity</label><select className="form-select" value={dispatchSeverity} onChange={(event) => setDispatchSeverity(event.target.value)}><option value="">Select severity</option>{INCIDENT_SEVERITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <label className="form-label" style={{ marginTop: 12 }}>Assign responder</label><select className="form-select" value={selectedResponder} onChange={(event) => setSelectedResponder(event.target.value)}><option value="">Select active responder</option>{responders.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select>
        <label className="form-label" style={{ marginTop: 12 }}>Dispatch instructions</label><input className="form-input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional instructions for the team" />
        <p className="field-help" style={{ marginTop: 10 }}>The responder will receive this classification with the incident assignment. If escalated, MDRRMO will receive these values and can adjust them.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}><button className="btn btn-outline" onClick={() => setDispatchModalOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!dispatchType || !dispatchSeverity || !selectedResponder} onClick={() => void dispatchSelected()}><Send size={15} /> Send responder</button></div>
      </div>
    </div>}
  </>;
}
