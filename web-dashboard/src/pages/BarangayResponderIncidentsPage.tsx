import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, MapPin, RefreshCw, X } from 'lucide-react';
import { reportAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { createDemoResponderReport } from '../demoResponderReport';

type Incident = ReturnType<typeof createDemoResponderReport> & {
  id: string;
  title?: string | null;
  description?: string | null;
  incident_type?: string | null;
  severity?: string | null;
  type?: string | null;
  status?: string | null;
  response_status?: string | null;
  barangay_response_status?: string | null;
  assignment_status?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  barangay_resolved_at?: string | null;
  address?: string | null;
  location_name?: string | null;
  barangay_name?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  is_demo?: boolean;
};

type IncidentFilter = 'all' | 'active' | 'resolved';

function statusFor(incident: Incident): 'Assigned' | 'Responding' | 'Resolved' {
  const response = String(incident.barangay_response_status || incident.response_status || incident.status || '').toLowerCase();
  const assignment = String(incident.assignment_status || '').toLowerCase();
  if (['resolved', 'closed', 'completed'].includes(response) || assignment === 'completed') return 'Resolved';
  if (['responding', 'in_progress', 'in progress'].includes(response)) return 'Responding';
  return 'Assigned';
}

function hasLocation(incident: Incident) {
  return incident.latitude != null && incident.longitude != null &&
    Number.isFinite(Number(incident.latitude)) && Number.isFinite(Number(incident.longitude));
}

function incidentTime(value?: string | null) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function BarangayResponderIncidentsPage() {
  const { user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [filter, setFilter] = useState<IncidentFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [demoIncident] = useState<Incident>(() => createDemoResponderReport());
  const [demoDismissed, setDemoDismissed] = useState(false);

  const loadIncidents = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      // The responder role is filtered by the API to assignments addressed to this account.
      const response = await reportAPI.barangayReports();
      setIncidents(Array.isArray(response.data) ? response.data : []);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || 'Your assigned incidents could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadIncidents(); }, [loadIncidents]);

  const isDebugResponder = user?.account_kind === 'barangay' && user.role === 'responder' &&
    localStorage.getItem('norzagapay_debug_session') === 'true';
  const showDemo = isDebugResponder && localStorage.getItem('norzagapay_responder_demo_hidden') !== 'true' && !demoDismissed;
  const allIncidents = useMemo(() => showDemo ? [...incidents, demoIncident] : incidents, [demoIncident, incidents, showDemo]);
  const activeCount = incidents.filter((incident) => statusFor(incident) !== 'Resolved').length;
  const resolvedCount = incidents.length - activeCount;
  const visibleIncidents = allIncidents.filter((incident) => {
    if (filter === 'resolved') return statusFor(incident) === 'Resolved';
    if (filter === 'active') return statusFor(incident) !== 'Resolved';
    return true;
  });

  const dismissDemo = () => {
    localStorage.setItem('norzagapay_responder_demo_hidden', 'true');
    setDemoDismissed(true);
  };

  return (
    <main className="responder-incidents-page">
      <header className="responder-workspace-header">
        <div>
          <span className="workspace-eyebrow">INCIDENT MONITORING · {user?.barangay_name || 'YOUR BARANGAY'}</span>
          <h1>My incidents</h1>
          <p>Incidents dispatched to your responder account.</p>
        </div>
        <button className="workspace-secondary-action" type="button" onClick={() => void loadIncidents(true)} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? 'workspace-spinning' : ''} /> Refresh
        </button>
      </header>

      <section className="resident-summary-grid" aria-label="Assigned incident summary">
        <article><span>Active assignments</span><strong>{activeCount}</strong></article>
        <article><span>Resolved assignments</span><strong>{resolvedCount}</strong></article>
        <article><span>Total assigned</span><strong>{incidents.length}</strong></article>
      </section>

      {showDemo && <div className="responder-demo-notice" role="note">
        <div><strong>Debug demo preview</strong><span>The sample card is not a real incident, is not saved, and is excluded from these counts.</span></div>
        <button type="button" onClick={dismissDemo}><X size={15} /> Hide preview</button>
      </div>}

      {error && <div className="workspace-message workspace-message-error" role="alert"><AlertCircle size={17} />{error}<button type="button" onClick={() => void loadIncidents()}>Try again</button></div>}

      <section className="responder-incidents-panel" aria-label="Incidents assigned to you">
        <div className="responder-incidents-toolbar">
          <div><h2>Assigned incidents</h2><p>Only reports dispatched to you are listed here.</p></div>
          <div className="responder-incidents-filters" role="group" aria-label="Filter incidents">
            {(['all', 'active', 'resolved'] as IncidentFilter[]).map((value) => <button key={value} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'active' ? 'Active' : 'Resolved'}</button>)}
          </div>
        </div>

        {loading ? <p className="resident-reports-state">Loading assigned incidents…</p> : error ? null : visibleIncidents.length === 0 ? (
          <div className="resident-reports-empty"><CheckCircle2 size={23} /><strong>{filter === 'resolved' ? 'No resolved assignments' : 'No assigned incidents'}</strong><span>Incidents dispatched to your responder account will appear here.</span></div>
        ) : <div className="responder-incidents-list">
          {visibleIncidents.map((incident) => {
            const status = statusFor(incident);
            const coordinates = hasLocation(incident) ? `${Number(incident.latitude).toFixed(5)}, ${Number(incident.longitude).toFixed(5)}` : null;
            const mapUrl = coordinates ? `https://www.google.com/maps?q=${encodeURIComponent(`${incident.latitude},${incident.longitude}`)}` : null;
            const location = incident.location_name || incident.address || incident.barangay_name;
            return <article className="responder-incident-card" key={incident.id}>
              <header>
                <div><span className="workspace-eyebrow">{incident.is_demo ? 'DEMO ASSIGNMENT · ' : ''}{(incident.incident_type || incident.type || 'Incident').replaceAll('_', ' ')}{incident.severity ? ` · ${incident.severity}` : ''}</span><h3>{incident.title || 'Incident report'}</h3></div>
                <span className={`resident-status ${status === 'Responding' ? 'responding' : ''} ${incident.is_demo ? 'demo' : status === 'Resolved' ? 'resolved' : ''}`}>{incident.is_demo ? 'Demo preview' : status}</span>
              </header>
              <p>{incident.description || 'No incident details were provided.'}</p>
              <div className="responder-incident-meta">
                <span>{incidentTime(status === 'Resolved' ? incident.barangay_resolved_at || incident.resolved_at || incident.created_at : incident.created_at)}</span>
                {location && <span><MapPin size={14} /> {location}</span>}
                {coordinates && <span><MapPin size={14} /> {incident.is_demo ? 'Demo pin' : coordinates}</span>}
                {!coordinates && !location && <span><MapPin size={14} /> Location unavailable</span>}
                {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer">Open map <ExternalLink size={13} /></a>}
              </div>
            </article>;
          })}
        </div>}
      </section>
    </main>
  );
}
