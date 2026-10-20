import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  AlertTriangle, ArrowRight, Bell, Check, CheckCircle2, ChevronDown, Copy,
  Clock3, ExternalLink, FileText, Flame, LocateFixed, MapPin, Megaphone,
  Navigation, Phone, RefreshCw, ShieldCheck, Siren, TentTree, Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { broadcastAPI, evacuationAPI, reportAPI } from '../lib/api';
import { CARTO_ATTRIBUTION, CARTO_DARK_MAP_URL } from '../lib/mapConfig';
import CommunityAlertsBoard from '../components/CommunityAlertsBoard';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

type ResidentReport = {
  id: string; title?: string | null; description?: string | null; incident_type?: string | null;
  status?: string | null; assignment_status?: string | null; response_status?: string | null;
  mdrrmo_response_status?: string | null; barangay_response_status?: string | null;
  review_outcome?: string | null; created_at?: string | null; resolved_at?: string | null;
  mdrrmo_dispatched_at?: string | null; barangay_dispatched_at?: string | null; dispatched_at?: string | null;
  latitude?: number | string | null; longitude?: number | string | null;
  barangay_name?: string | null; response_barangay_name?: string | null;
};
type BroadcastMedia = { url: string; type?: string };
type Broadcast = {
  id: string; category?: string; content?: string; author_name?: string; barangay_name?: string;
  is_mdrrmo?: boolean; is_pinned?: boolean; created_at?: string; links?: string[]; media?: BroadcastMedia[];
};
type EvacuationCenter = {
  id: string; name: string; address?: string | null; latitude: number | string; longitude: number | string;
  barangay_id?: string; barangays?: { name?: string; municipality?: string } | Array<{ name?: string; municipality?: string }> | null;
};
type HotlineLine = { label?: string; name?: string; purpose?: string; phone?: string; number?: string; numbers?: string[] };
type HotlinesResponse = { national?: HotlineLine[]; mdrrmo?: HotlineLine[]; barangays?: Array<{ barangay_name: string; entries: HotlineLine[] }> };

const defaultCenter: [number, number] = [14.9133, 121.0436];
const mediaPin = L.divIcon({ className: 'resident-map-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
const residentPin = L.divIcon({ className: 'resident-map-current-pin', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] });
const alertCategories = [
  { id: 'all', label: 'All updates' }, { id: 'all_disaster', label: 'Disaster alerts' },
  { id: 'disaster_red', label: 'Red alert' }, { id: 'disaster_orange', label: 'Orange alert' },
  { id: 'disaster_yellow', label: 'Yellow alert' }, { id: 'safety_advisory', label: 'Safety' },
  { id: 'relief_assistance', label: 'Relief & assistance' }, { id: 'all_clear', label: 'All clear' },
];

function normalizeCategory(category?: string) {
  return ({ disaster_alert_yellow: 'disaster_yellow', disaster_alert_orange: 'disaster_orange', disaster_alert_red: 'disaster_red', all_clear_notice: 'all_clear' } as Record<string, string>)[category || ''] || category || 'safety_advisory';
}
function categoryName(category?: string) {
  return alertCategories.find((item) => item.id === normalizeCategory(category))?.label || (category || 'Safety advisory').replaceAll('_', ' ');
}
function formatDate(value?: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatHotlineNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  return /^09\d{9}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}` : value;
}
function reportState(report: ResidentReport) {
  const statuses = [report.mdrrmo_response_status, report.barangay_response_status, report.response_status, report.status]
    .map((value) => String(value || '').toLowerCase());
  if (report.review_outcome === 'invalid' || statuses.some((status) => ['invalid', 'rejected', 'false_report'].includes(status))) return 'Closed after review';
  if (statuses.some((status) => ['resolved', 'closed', 'completed', 'complete'].includes(status))) return 'Resolved';
  if (statuses.some((status) => ['responding', 'accepted', 'en_route', 'on_scene', 'arrived'].includes(status)) || report.mdrrmo_dispatched_at || report.barangay_dispatched_at || report.dispatched_at) return 'Response in progress';
  if (report.assignment_status === 'active') return 'Assigned to barangay';
  return 'Received by MDRRMO';
}
function readRelationName(relation: EvacuationCenter['barangays']) {
  return Array.isArray(relation) ? relation[0]?.name : relation?.name;
}
function distanceKm(a: [number, number], b: [number, number]) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]); const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function MapRecenter({ point }: { point: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(point, Math.max(map.getZoom(), 12), { animate: true }); }, [map, point]);
  return null;
}

function useResidentFeed() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Broadcast[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((value) => value + 1);
  useRealtimeRefresh(refresh, { publicUpdates: true });
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.allSettled([reportAPI.verifiedBarangays(), broadcastAPI.publicFeed()])
      .then(([barangayResult, feedResult]) => {
        if (!active) return;
        if (barangayResult.status === 'fulfilled') {
          const list = Array.isArray(barangayResult.value.data) ? barangayResult.value.data : [];
          setBarangays(list.filter((item: any) => item.is_verified !== false).map((item: any) => String(item.name || '')).filter(Boolean));
        }
        if (feedResult.status === 'fulfilled') setPosts(Array.isArray(feedResult.value.data) ? feedResult.value.data : []);
        else setError((feedResult.reason as any)?.response?.data?.error || 'Community alerts could not be loaded.');
      })
      .catch((loadError: any) => { if (active) setError(loadError?.response?.data?.error || 'Community alerts could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);
  const preferredBarangay = useMemo(() => barangays.find((name) => name.toLowerCase() === user?.barangay_name?.toLowerCase()) || user?.barangay_name || barangays[0] || '', [barangays, user?.barangay_name]);
  return { posts, barangays, preferredBarangay, loading, error, refresh };
}

export function ResidentHomePage() {
  const { user } = useAuth();
  const { posts, preferredBarangay, loading: feedLoading, error: feedError } = useResidentFeed();
  const [reports, setReports] = useState<ResidentReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState('');
  const refreshReports = useCallback(async () => {
    try {
      const response = await reportAPI.mine();
      setReports(Array.isArray(response.data) ? response.data : []);
      setReportsError('');
    } catch {
      setReportsError('Your report summary could not be loaded.');
    } finally {
      setReportsLoading(false);
    }
  }, []);
  useEffect(() => { void refreshReports(); }, [refreshReports]);
  useRealtimeRefresh(refreshReports, { events: ['incident_report:updated', 'incident_report:reviewed', 'incident:lifecycle'] });
  const resolved = reports.filter((report) => reportState(report) === 'Resolved').length;
  const closedAfterReview = reports.filter((report) => reportState(report) === 'Closed after review').length;
  const active = reports.length - resolved - closedAfterReview;
  const visiblePosts = posts.filter((post) => post.is_mdrrmo !== false || Boolean(preferredBarangay && post.barangay_name?.toLowerCase().replace(/^barangay\s+/i, '') === preferredBarangay.toLowerCase().replace(/^barangay\s+/i, '')));
  const urgentPost = visiblePosts.find((post) => ['disaster_red', 'disaster_orange'].includes(normalizeCategory(post.category)));
  const latestPosts = visiblePosts.slice(0, 2);
  const latestReports = reports.slice(0, 2);
  return <main className="resident-portal-page">
    <section className="resident-welcome-panel">
      <div className="resident-welcome-copy"><span className="resident-kicker"><ShieldCheck size={15} /> RESIDENT PORTAL</span><h1>Good day, {user?.full_name?.split(' ')[0] || 'Resident'}.</h1><p>Stay informed, find a safe place nearby, and reach your response team.</p><div className="resident-welcome-actions"><Link className="resident-button resident-button-danger" to="/resident-report"><Siren size={17} /> Report an incident</Link><Link className="resident-button resident-button-glass" to="/resident-alerts"><Bell size={16} /> Community alerts</Link></div></div>
      <div className="resident-welcome-art" aria-hidden="true"><div className="resident-art-ring ring-one"/><div className="resident-art-ring ring-two"/><span><Siren size={42}/></span><small>NORZAGARAY<br/>RESIDENT SAFETY</small></div>
    </section>
    {urgentPost && <Link className="resident-urgent-banner" to="/resident-alerts"><span><AlertTriangle size={18}/></span><div><strong>{categoryName(urgentPost.category)} · {urgentPost.author_name || urgentPost.barangay_name || 'MDRRMO'}</strong><p>{urgentPost.content || 'A priority alert is active. Open the alerts feed for details.'}</p></div><ArrowRight size={18}/></Link>}
    <section className="resident-stat-grid" aria-label="Your report summary">
      <article><span className="resident-stat-icon"><FileText size={18}/></span><small>Your reports</small><strong>{reportsLoading || reportsError ? '—' : reports.length}</strong><span className="resident-stat-note">Submitted from your account</span></article>
      <article><span className="resident-stat-icon amber"><Clock3 size={18}/></span><small>In progress</small><strong>{reportsLoading || reportsError ? '—' : active}</strong><span className="resident-stat-note">Awaiting or receiving a response</span></article>
      <article><span className="resident-stat-icon green"><CheckCircle2 size={18}/></span><small>Resolved</small><strong>{reportsLoading || reportsError ? '—' : resolved}</strong><span className="resident-stat-note">Reports with a completed outcome</span></article>
    </section>
    <div className="resident-home-columns">
      <section className="resident-home-section resident-quick-actions"><header><div><span className="resident-section-kicker">QUICK ACCESS</span><h2>What do you need?</h2></div></header><div className="resident-action-grid">
        <Link to="/resident-report" className="resident-action-card emergency"><span><Siren size={20}/></span><div><strong>Report an incident</strong><small>Send an emergency or community report</small></div><ArrowRight size={17}/></Link>
        <Link to="/resident-evacuation" className="resident-action-card"><span><TentTree size={20}/></span><div><strong>Find evacuation centers</strong><small>See verified shelters on the map</small></div><ArrowRight size={17}/></Link>
        <Link to="/resident-hotlines" className="resident-action-card"><span><Phone size={20}/></span><div><strong>Emergency hotlines</strong><small>Call MDRRMO or a local hotline</small></div><ArrowRight size={17}/></Link>
        <Link to="/my-reports" className="resident-action-card"><span><FileText size={20}/></span><div><strong>Track my reports</strong><small>Review dispatch and resolution updates</small></div><ArrowRight size={17}/></Link>
      </div></section>
      <section className="resident-home-section resident-home-alerts"><header><div><span className="resident-section-kicker">COMMUNITY FEED</span><h2>Latest alerts</h2></div><Link to="/resident-alerts">All alerts <ArrowRight size={15}/></Link></header>
        {feedLoading ? <p className="resident-loading-line">Loading community updates…</p> : feedError ? <p className="resident-loading-line" role="status">Community updates could not be loaded.</p> : latestPosts.length ? <div className="resident-mini-post-list">{latestPosts.map((post) => <article className="resident-mini-post" key={`${post.is_mdrrmo ? 'mdrrmo' : 'barangay'}-${post.id}`}><span className={`resident-post-dot ${normalizeCategory(post.category)}`}/><div><div className="resident-mini-post-meta"><strong>{post.is_mdrrmo === false ? `Brgy. ${post.barangay_name || 'community'}` : 'MDRRMO Norzagaray'}</strong><span>{categoryName(post.category)}</span></div><p>{post.content || 'Official community update.'}</p><time>{formatDate(post.created_at)}</time></div></article>)}</div> : <div className="resident-compact-empty"><Megaphone size={20}/><span>No current community posts.</span></div>}
      </section>
    </div>
    <section className="resident-home-section resident-home-reports"><header><div><span className="resident-section-kicker">PERSONAL UPDATES</span><h2>Recent reports</h2></div><Link to="/my-reports">View all reports <ArrowRight size={15}/></Link></header>
      {reportsLoading ? <p className="resident-loading-line">Loading your reports…</p> : reportsError ? <p className="resident-loading-line" role="status">{reportsError} <Link to="/my-reports">Open My Reports</Link></p> : latestReports.length ? <div className="resident-recent-report-grid">{latestReports.map((report) => <article key={report.id}><span className={`resident-report-state ${reportState(report) === 'Resolved' ? 'complete' : ''}`}>{reportState(report)}</span><strong>{report.title || report.incident_type?.replaceAll('_', ' ') || 'Incident report'}</strong><p>{report.title?.toLowerCase().startsWith('visual ') ? 'Visual report submitted. View captured evidence in My Reports.' : report.description || 'No additional details.'}</p><footer><span><MapPin size={13}/>{report.response_barangay_name || report.barangay_name || 'Norzagaray'}</span><time>{formatDate(report.created_at)}</time></footer></article>)}</div> : <div className="resident-compact-empty"><Siren size={20}/><span>You haven’t submitted a report yet.</span><Link to="/resident-report">Create your first report</Link></div>}
    </section>
    <p className="resident-portal-footnote"><ShieldCheck size={14}/> Your report history is private to your account. Public alerts and evacuation center listings are shared town-wide.</p>
  </main>;
}

export function ResidentAlertsPage() {
  const { user } = useAuth();
  const { posts, barangays, preferredBarangay, loading, error, refresh } = useResidentFeed();
  return <main className="resident-portal-page">
    <header className="resident-page-heading"><div><span className="resident-kicker"><Bell size={15}/> COMMUNITY INFORMATION{user?.barangay_name ? ` · ${user.barangay_name}` : ''}</span><h1>Community alerts</h1><p>Official MDRRMO updates and posts from your selected barangay.</p></div><button className="resident-button resident-button-outline" type="button" onClick={refresh}><RefreshCw size={16}/> Refresh</button></header>
    <CommunityAlertsBoard posts={posts} barangays={barangays} initialBarangay={preferredBarangay} loading={loading} error={error} onRefresh={refresh}/>
  </main>;
}

export function ResidentReportHubPage() {
  const { user } = useAuth();
  return <main className="resident-portal-page resident-report-hub"><header className="resident-page-heading"><div><span className="resident-kicker"><Siren size={15}/> REPORTING{user?.barangay_name ? ` · ${user.barangay_name}` : ''}</span><h1>Incident reporting</h1><p>Send an emergency report to MDRRMO or share a community concern for local coordination.</p></div></header>
    <section className="resident-reporting-hero"><div><span>REPORT AS {user?.full_name?.toUpperCase() || 'RESIDENT'}</span><h2>Tell us what’s happening.</h2><p>Include a clear description and mark the incident location so responders can find it.</p></div><span className="resident-reporting-hero-icon"><Siren size={30}/></span></section>
    <div className="resident-report-kind-grid"><Link to="/resident-new-report?type=emergency" className="resident-report-kind emergency"><span className="resident-kind-icon"><Flame size={23}/></span><span className="resident-kind-badge">URGENT RESPONSE</span><h2>Emergency incident</h2><p>For medical emergencies, fires, dangerous flooding, or an immediate threat to life. Sent to MDRRMO for dispatch.</p><strong>Start emergency report <ArrowRight size={17}/></strong></Link><Link to="/resident-new-report?type=community" className="resident-report-kind community"><span className="resident-kind-icon"><MapPin size={23}/></span><span className="resident-kind-badge">COMMUNITY CONCERN</span><h2>Community incident</h2><p>For road damage, drainage blockage, fallen trees, minor flooding, and other local hazards.</p><strong>Report a community concern <ArrowRight size={17}/></strong></Link></div>
    <div className="resident-report-help-row"><div><Phone size={19}/><span><strong>Need help right now?</strong><small>Call a response hotline directly for immediate assistance.</small></span></div><Link className="resident-button resident-button-outline" to="/resident-hotlines">Open emergency hotlines <ArrowRight size={15}/></Link></div>
    <Link to="/my-reports" className="resident-track-reports"><span><FileText size={20}/><span><strong>Track submitted reports</strong><small>See response milestones, dispatch updates, and resolution history.</small></span></span><ArrowRight size={18}/></Link>
  </main>;
}

export function ResidentEvacuationPage() {
  const [centers, setCenters] = useState<EvacuationCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [barangay, setBarangay] = useState('');
  const [locationMessage, setLocationMessage] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { const response = await evacuationAPI.list(); setCenters(Array.isArray(response.data) ? response.data : []); } catch (loadError: any) { setError(loadError?.response?.data?.error || 'Evacuation centers could not be loaded.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(load, { publicUpdates: true });
  const list = useMemo(() => centers.map((center) => ({ ...center, lat: Number(center.latitude), lng: Number(center.longitude), place: readRelationName(center.barangays) || 'Norzagaray', distance: currentLocation ? distanceKm(currentLocation, [Number(center.latitude), Number(center.longitude)]) : undefined })).filter((center) => Number.isFinite(center.lat) && Number.isFinite(center.lng)).filter((center) => !barangay || center.place === barangay).sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY)), [centers, currentLocation, barangay]);
  useEffect(() => { if (list.length && !list.some((center) => center.id === selectedId)) setSelectedId(list[0].id); }, [list, selectedId]);
  const selected = list.find((center) => center.id === selectedId);
  const mapPoint: [number, number] = selected ? [selected.lat, selected.lng] : currentLocation || defaultCenter;
  const findMe = () => {
    setLocationMessage('');
    if (!navigator.geolocation) { setLocationMessage('This browser cannot read your current location.'); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => { setCurrentLocation([coords.latitude, coords.longitude]); setSelectedId(''); setLocationMessage('Showing centers nearest to your current location.'); }, () => setLocationMessage('Location access was unavailable. Showing the Norzagaray town center.'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };
  const places = [...new Set(centers.map((center) => readRelationName(center.barangays)).filter((name): name is string => Boolean(name)))].sort();
  return <main className="resident-portal-page"><header className="resident-page-heading"><div><span className="resident-kicker"><TentTree size={15}/> EVACUATION SUPPORT</span><h1>Evacuation centers</h1><p>Find verified active shelters and open directions to the center you choose.</p></div><div className="resident-page-actions"><button className="resident-button resident-button-outline" type="button" onClick={findMe}><LocateFixed size={16}/> {currentLocation ? 'Update my location' : 'Use my location'}</button><button className="resident-icon-button" type="button" onClick={() => void load()} aria-label="Refresh evacuation centers"><RefreshCw size={16}/></button></div></header>
    {locationMessage && <p className="resident-location-message" role="status">{locationMessage}</p>}
    {error && <div className="resident-feedback error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
    <section className="resident-evac-layout"><div className="resident-evac-map"><MapContainer center={mapPoint} zoom={12} scrollWheelZoom zoomControl style={{ width: '100%', height: '100%' }}><TileLayer url={CARTO_DARK_MAP_URL} attribution={CARTO_ATTRIBUTION}/><MapRecenter point={mapPoint}/>{list.map((center) => <Marker key={center.id} position={[center.lat, center.lng]} icon={mediaPin} eventHandlers={{ click: () => setSelectedId(center.id) }}><Popup><strong>{center.name}</strong><br/>{center.place}</Popup></Marker>)}{currentLocation && <Marker position={currentLocation} icon={residentPin}><Popup>Your current location</Popup></Marker>}</MapContainer><div className="resident-map-caption"><MapPin size={14}/>{currentLocation ? 'Map centered on the selected nearby center' : 'Verified evacuation centers in Norzagaray'}</div></div>
      <aside className="resident-evac-sidebar"><header><div><span className="resident-section-kicker">SAFE PLACES</span><h2>Nearby centers <span>{list.length}</span></h2></div><label className="resident-select-label compact"><select value={barangay} onChange={(event) => setBarangay(event.target.value)}><option value="">All barangays</option>{places.map((place) => <option key={place} value={place}>{place}</option>)}</select><ChevronDown size={13}/></label></header>
        <div className="resident-center-list">{loading ? <p className="resident-loading-line">Loading centers…</p> : list.length ? list.map((center, index) => <button type="button" key={center.id} className={`resident-center-card ${center.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(center.id)}><span className="resident-center-number">{index + 1}</span><span className="resident-center-copy"><strong>{center.name}</strong><small>{center.address || center.place}</small><span>{center.distance != null ? `${center.distance.toFixed(1)} km away` : center.place}</span></span><ArrowRight size={16}/></button>) : <div className="resident-feed-empty small"><TentTree size={22}/><strong>No centers available</strong><span>No active evacuation centers are published by verified barangays.</span></div>}</div>
        {selected && <div className="resident-selected-center"><span className="resident-section-kicker">SELECTED CENTER</span><h3>{selected.name}</h3><p>{selected.address || selected.place}</p>{selected.distance != null && <small><Navigation size={13}/>{selected.distance.toFixed(1)} km from your location</small>}<a href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`} target="_blank" rel="noreferrer">Get directions <ExternalLink size={14}/></a></div>}
      </aside></section>
  </main>;
}

export function ResidentHotlinesPage() {
  const { user } = useAuth();
  const [data, setData] = useState<HotlinesResponse>({ national: [], mdrrmo: [], barangays: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState('');
  const [copiedHotlineId, setCopiedHotlineId] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { const response = await reportAPI.publicHotlines(); setData(response.data || { national: [], mdrrmo: [], barangays: [] }); } catch (loadError: any) { setError(loadError?.response?.data?.error || 'Hotline information could not be loaded.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(load, { publicUpdates: true });
  const barangayGroups = (data.barangays || []).filter((group) => (group.entries || []).some((line) => [line.phone, line.number, ...(line.numbers || [])].some((number) => Boolean(number))));
  const activeBarangay = barangayGroups.find((group) => group.barangay_name === selectedBarangay)
    || barangayGroups.find((group) => group.barangay_name === user?.barangay_name)
    || barangayGroups[0];
  const groups = [
    { id: 'mdrrmo', title: 'MDRRMO', subtitle: 'Municipal disaster risk reduction and management', icon: <ShieldCheck size={18}/>, entries: data.mdrrmo || [] },
    { id: 'pnp', title: 'Philippine National Police (PNP)', subtitle: 'Norzagaray Municipal Police Station', icon: <ShieldCheck size={18}/>, entries: [{ label: 'Norzagaray Municipal Police Station', phone: '0998-598-5388' }] },
    { id: 'bfp', title: 'Bureau of Fire Protection (BFP)', subtitle: 'Norzagaray Fire Station', icon: <Flame size={18}/>, entries: [{ label: 'Norzagaray Fire Station', phone: '0917-159-5831' }] },
  ];
  const hotlineRows = (lines: HotlineLine[], title: string) => lines.flatMap((line, index) => {
    const numbers = [line.phone, line.number, ...(line.numbers || [])].filter((value): value is string => Boolean(value));
    return numbers.map((number, numberIndex) => ({ id: `${title}-${index}-${numberIndex}`, label: line.label || line.name || line.purpose || title, number }));
  });
  const copyHotline = async (id: string, number: string) => {
    try {
      await navigator.clipboard.writeText(number.replace(/\D/g, ''));
      setCopiedHotlineId(id);
      window.setTimeout(() => setCopiedHotlineId((current) => current === id ? '' : current), 1800);
    } catch {
      setCopiedHotlineId('');
    }
  };
  const renderHotlineList = (lines: HotlineLine[], title: string) => <div className="resident-hotline-list">{hotlineRows(lines, title).map((entry) => {
    const copied = copiedHotlineId === entry.id;
    return <article key={entry.id}><div><strong>{entry.label}</strong><span>{formatHotlineNumber(entry.number)}</span></div><div className="resident-hotline-actions"><button type="button" className="resident-hotline-copy" onClick={() => void copyHotline(entry.id, entry.number)} aria-label={copied ? 'Phone number copied' : `Copy ${entry.label} phone number`} title={copied ? 'Copied' : 'Copy phone number'}>{copied ? <Check size={15}/> : <Copy size={15}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button><a href={`tel:${entry.number.replace(/[^+\d]/g, '')}`} aria-label={`Call ${entry.label} at ${entry.number}`}><Phone size={16}/> Call</a></div></article>;
  })}</div>;
  return <main className="resident-portal-page"><header className="resident-page-heading"><div><span className="resident-kicker"><Phone size={15}/> DIRECT CONTACT</span><h1>Emergency hotlines</h1><p>Call directly if you need immediate assistance or cannot submit an online report.</p></div><button className="resident-icon-button" type="button" onClick={() => void load()} aria-label="Refresh hotline list"><RefreshCw size={16}/></button></header>
    <div className="resident-hotline-notice"><span><Phone size={19}/></span><div><strong>In immediate danger?</strong><p>Call the emergency hotline directly. Online reports may take time to reach responders.</p></div><a href="tel:911">Call 911</a></div>
    {error && <div className="resident-feedback error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
    {loading ? <div className="resident-feed-empty"><RefreshCw className="workspace-spinning" size={22}/><strong>Loading hotlines</strong></div> : <div className="resident-hotline-grid">{groups.map((group) => { const entries = hotlineRows(group.entries, group.title); return <section className="resident-hotline-group" key={group.id}><header><span>{group.icon}</span><div><h2>{group.title}</h2><p>{group.subtitle}</p></div></header>{entries.length ? renderHotlineList(group.entries, group.title) : <p className="resident-hotline-empty">No published numbers for this group.</p>}</section>; })}
      <section className="resident-hotline-group resident-hotline-barangay-group"><header><span><Users size={18}/></span><div><h2>{activeBarangay ? `Barangay ${activeBarangay.barangay_name}` : 'Barangay emergency hotline'}</h2><p>Local response contacts</p></div><label className="resident-hotline-barangay-select"><select aria-label="Choose a barangay with published hotlines" value={activeBarangay?.barangay_name || ''} onChange={(event) => setSelectedBarangay(event.target.value)} disabled={!barangayGroups.length}><option value="" disabled>Select barangay</option>{barangayGroups.map((group) => <option key={group.barangay_name} value={group.barangay_name}>{group.barangay_name}</option>)}</select><ChevronDown size={15}/></label></header>
        {activeBarangay ? renderHotlineList(activeBarangay.entries || [], activeBarangay.barangay_name) : <p className="resident-hotline-empty">No barangays have published hotline numbers yet.</p>}
      </section>
    </div>}
    <div className="resident-hotline-footer"><span>MDRRMO and barangay contacts are published by those offices. Call 911 for national emergency assistance.</span><Link to="/resident-report">Submit an incident report <ArrowRight size={14}/></Link></div>
  </main>;
}
