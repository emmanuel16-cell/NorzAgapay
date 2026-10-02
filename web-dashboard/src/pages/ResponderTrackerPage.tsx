import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Circle,
  Clock3,
  MapPin,
  Navigation,
  Radio,
  RotateCcw,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { socket, taskAPI } from '../lib/api';

interface Incident {
  id: string;
  title?: string;
  type?: string;
  severity?: string;
  status?: string;
  resolved_at?: string | null;
  address?: string;
  latitude?: number | string;
  longitude?: number | string;
}

interface TaskResponder {
  responder_id?: string;
  status?: string;
  responder?: { full_name?: string };
}

interface ResponseTask {
  id: string;
  title: string;
  task_type?: string;
  required_skill?: string;
  assigned_to?: string | null;
  assigned_user?: { full_name?: string; role?: string } | null;
  responders?: TaskResponder[];
  status: 'pending' | 'accepted' | 'in_progress' | 'returning' | 'completed' | 'cancelled' | string;
  created_at: string;
  accepted_at?: string | null;
  arrived_at?: string | null;
  returning_at?: string | null;
  completed_at?: string | null;
  incident?: Incident | null;
  address?: string;
  latitude?: number | string;
  longitude?: number | string;
}

interface ResponderLocation {
  userId: string;
  latitude: number;
  longitude: number;
  timestamp: number;
}

type Filter = 'active' | 'all' | 'resolved';

const stages = [
  { label: 'Accepted', icon: Check },
  { label: 'Going to incident', icon: Navigation },
  { label: 'On scene', icon: MapPin },
  { label: 'Returning', icon: RotateCcw },
  { label: 'Resolved', icon: ShieldCheck },
];

function asCoordinate(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function distanceKm(from: ResponderLocation, latitude: number, longitude: number): number {
  const radians = (degrees: number) => degrees * (Math.PI / 180);
  const latDelta = radians(latitude - from.latitude);
  const lngDelta = radians(longitude - from.longitude);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(latitude)) * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function isReturning(task: ResponseTask, location: ResponderLocation | null): boolean {
  if (task.status === 'returning') return true;
  if (task.status !== 'in_progress' || !location || Date.now() - location.timestamp >= 5 * 60 * 1000) return false;
  const latitude = asCoordinate(task.latitude ?? task.incident?.latitude);
  const longitude = asCoordinate(task.longitude ?? task.incident?.longitude);
  return latitude !== null && longitude !== null && distanceKm(location, latitude, longitude) > 0.5;
}

function stageIndex(task: ResponseTask, location: ResponderLocation | null): number {
  if (task.incident?.status === 'resolved') return 4;
  if (task.status === 'completed') return 3;
  switch (task.status) {
    case 'accepted': return 1;
    case 'in_progress': return isReturning(task, location) ? 3 : 2;
    case 'returning': return 3;
    default: return 0;
  }
}

function taskIsResolved(task: ResponseTask): boolean {
  return task.status === 'cancelled' || task.incident?.status === 'resolved';
}

function taskStatusLabel(task: ResponseTask, location: ResponderLocation | null): string {
  if (task.status === 'cancelled') return 'Cancelled';
  if (task.incident?.status === 'resolved') return 'Resolved';
  if (task.status === 'pending') return 'Awaiting acceptance';
  if (task.status === 'accepted') return 'En route';
  if (task.status === 'in_progress') return isReturning(task, location) ? 'Returning' : 'On scene';
  if (task.status === 'returning' || task.status === 'completed') return 'Returning';
  return 'Dispatched';
}

function respondersFor(task: ResponseTask): string {
  if (task.assigned_user?.full_name) return task.assigned_user.full_name;
  const names = (task.responders || [])
    .map((responder) => responder.responder?.full_name)
    .filter((name): name is string => Boolean(name));
  return names.length ? names.join(', ') : 'Responder not assigned';
}

function locationFor(task: ResponseTask, locations: Record<string, ResponderLocation>): ResponderLocation | null {
  const ids = [task.assigned_to, ...(task.responders || []).map((responder) => responder.responder_id)]
    .filter((id): id is string => Boolean(id));
  for (const id of ids) {
    const location = locations[id];
    if (location) return location;
  }
  return null;
}

function stageDetail(
  task: ResponseTask,
  index: number,
  isCurrent: boolean,
  location: ResponderLocation | null,
): string {
  const acceptedAt = formatTime(task.accepted_at);
  const arrivedAt = formatTime(task.arrived_at);
  const returningAt = formatTime(task.returning_at);
  const completedAt = formatTime(task.completed_at);

  if (index === 0) {
    if (task.status === 'pending') return 'Waiting for the responder to accept the dispatch';
    return acceptedAt ? `Accepted · ${acceptedAt}` : 'Dispatch accepted';
  }

  if (index === 1) {
    if (task.status === 'pending') return 'Starts when the responder accepts';
    if (!isCurrent) return acceptedAt ? `Departed · ${acceptedAt}` : 'Responder accepted and departed';
    const latitude = asCoordinate(task.latitude ?? task.incident?.latitude);
    const longitude = asCoordinate(task.longitude ?? task.incident?.longitude);
    const isFresh = location && Date.now() - location.timestamp < 5 * 60 * 1000;
    if (latitude === null || longitude === null) return 'Incident location is unavailable for an ETA';
    if (!location) return 'Waiting for a live responder location to estimate arrival';
    if (!isFresh) return 'Responder location is stale; waiting for a fresh GPS update';
    const km = distanceKm(location, latitude, longitude);
    const minutes = Math.max(1, Math.round((km / 25) * 60));
    return `About ${minutes} min · ${km.toFixed(1)} km straight-line estimate`;
  }

  if (index === 2) {
    if (task.status === 'pending' || task.status === 'accepted') return 'Arrival will be recorded when the responder marks on scene';
    return arrivedAt ? `Arrived · ${arrivedAt}` : 'Responder marked on scene';
  }

  if (index === 3) {
    if (task.status === 'completed') {
      return completedAt ? `Field response complete · ${completedAt}; awaiting incident resolution` : 'Field response complete; return phase active';
    }
    if (task.status === 'in_progress' && isReturning(task, location)) return 'Live GPS shows the responder moving away from the incident';
    if (task.status !== 'returning' && task.incident?.status !== 'resolved') {
      return 'Return trip starts after the response is complete';
    }
    return returningAt ? `Return started · ${returningAt}` : 'Responder is returning to base';
  }

  if (task.incident?.status !== 'resolved') return 'Waiting for the incident to be marked resolved';
  const resolvedAt = formatTime(task.incident.resolved_at);
  return resolvedAt ? `Incident resolved · ${resolvedAt}` : 'Incident resolved';
}

export default function ResponderTrackerPage() {
  const [tasks, setTasks] = useState<ResponseTask[]>([]);
  const [locations, setLocations] = useState<Record<string, ResponderLocation>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('active');

  const fetchTasks = useCallback(() => {
    taskAPI.list()
      .then((response) => setTasks(response.data.tasks || []))
      .catch(() => toast.error('Failed to load responder tracking'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchTasks();

    const handleLocation = (location: ResponderLocation) => {
      if (!location?.userId) return;
      setLocations((current) => ({ ...current, [location.userId]: location }));
    };
    const handleAllLocations = (allLocations: ResponderLocation[]) => {
      setLocations(Object.fromEntries((allLocations || []).map((location) => [location.userId, location])));
    };
    const refreshTasks = () => fetchTasks();

    socket.on('gps:location', handleLocation);
    socket.on('gps:allLocations', handleAllLocations);
    socket.on('task:statusChanged', refreshTasks);
    socket.emit('gps:requestAll');
    const interval = window.setInterval(refreshTasks, 30000);

    return () => {
      socket.off('gps:location', handleLocation);
      socket.off('gps:allLocations', handleAllLocations);
      socket.off('task:statusChanged', refreshTasks);
      window.clearInterval(interval);
    };
  }, [fetchTasks]);

  const trackedTasks = useMemo(() => {
    const assigned = tasks.filter((task) => task.assigned_to || task.responders?.some((responder) => responder.status !== 'left'));
    if (filter === 'active') return assigned.filter((task) => !taskIsResolved(task));
    if (filter === 'resolved') return assigned.filter(taskIsResolved);
    return assigned;
  }, [filter, tasks]);

  const activeCount = tasks.filter((task) => (task.assigned_to || task.responders?.some((responder) => responder.status !== 'left')) && !taskIsResolved(task)).length;
  const enRouteCount = tasks.filter((task) => task.status === 'accepted' && !taskIsResolved(task)).length;
  const returningCount = tasks.filter((task) =>
    !taskIsResolved(task) && (task.status === 'completed' || isReturning(task, locationFor(task, locations)))).length;

  return (
    <>
      <div className="page-header responder-tracker-header">
        <div>
          <h1 className="page-title">Responder Tracker</h1>
          <p className="responder-tracker-subtitle">Follow each assigned responder from dispatch through the return trip.</p>
        </div>
        <label className="responder-tracker-filter-label">
          <span>Show</span>
          <select className="form-select" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="active">Active responses</option>
            <option value="all">All responses</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
      </div>

      <div className="page-content responder-tracker-content">
        <div className="responder-tracker-overview">
          <div className="responder-overview-card">
            <span className="responder-overview-icon active"><Activity size={18} /></span>
            <div><strong>{activeCount}</strong><span>Active responses</span></div>
          </div>
          <div className="responder-overview-card">
            <span className="responder-overview-icon en-route"><Navigation size={18} /></span>
            <div><strong>{enRouteCount}</strong><span>Responders en route</span></div>
          </div>
          <div className="responder-overview-card">
            <span className="responder-overview-icon returning"><RotateCcw size={18} /></span>
            <div><strong>{returningCount}</strong><span>Returning to base</span></div>
          </div>
          <div className="responder-live-indicator"><Radio size={15} /> Live updates</div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /></div>
        ) : trackedTasks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Siren size={34} /></div>
            <p>{filter === 'resolved' ? 'No resolved responses yet' : 'No responder dispatches found'}</p>
          </div>
        ) : (
          <div className="responder-tracker-grid">
            {trackedTasks.map((task) => {
              const responderLocation = locationFor(task, locations);
              const currentStage = stageIndex(task, responderLocation);
              const incidentName = task.incident?.title || task.title || 'Incident response';
              const address = task.address || task.incident?.address;
              const cancelled = task.status === 'cancelled';
              const locationUpdated = responderLocation
                ? Date.now() - responderLocation.timestamp < 5 * 60 * 1000
                : false;

              return (
                <article className="card responder-tracker-card" key={task.id}>
                  <div className="responder-card-topline">
                    <div className="responder-identity">
                      <span className="responder-avatar"><Activity size={19} /></span>
                      <div>
                        <span className="responder-card-eyebrow">Assigned responder</span>
                        <h2>{respondersFor(task)}</h2>
                      </div>
                    </div>
                    <span className={`responder-status-pill ${cancelled ? 'cancelled' : taskIsResolved(task) ? 'resolved' : 'active'}`}>
                      {taskStatusLabel(task, responderLocation)}
                    </span>
                  </div>

                  <div className="responder-incident-summary">
                    <div className="responder-incident-title">{incidentName}</div>
                    <div className="responder-incident-meta">
                      <span><Siren size={14} />{(task.incident?.type || task.task_type || 'Response').replace(/_/g, ' ')}</span>
                      {address && <span><MapPin size={14} />{address}</span>}
                    </div>
                  </div>

                  {cancelled ? (
                    <div className="responder-cancelled-note">This dispatch was cancelled.</div>
                  ) : (
                    <div className="responder-timeline" aria-label="Responder progress">
                      {stages.map((stage, index) => {
                        const Icon = stage.icon;
                        const isComplete = index < currentStage || task.incident?.status === 'resolved';
                        const isCurrent = index === currentStage && !taskIsResolved(task);
                        const detail = stageDetail(task, index, isCurrent, responderLocation);
                        const showArrivalEstimate = index === 1 && isCurrent;

                        return (
                          <div className={`responder-timeline-stage ${isComplete ? 'complete' : ''} ${isCurrent ? 'current' : ''}`} key={stage.label}>
                            <div className="responder-timeline-rail">
                              <span className="responder-timeline-dot">
                                {isComplete ? <Check size={13} strokeWidth={3} /> : <Icon size={13} />}
                              </span>
                              {index < stages.length - 1 && <span className="responder-timeline-line" />}
                            </div>
                            <div className="responder-timeline-copy">
                              <div className="responder-timeline-heading">
                                <strong>{stage.label}</strong>
                                {showArrivalEstimate && <span className="responder-stage-live"><span />Current stage</span>}
                              </div>
                              <p>{detail}</p>
                              {showArrivalEstimate && responderLocation && locationUpdated && (
                                <span className="responder-gps-fresh"><Radio size={12} /> Live GPS update</span>
                              )}
                              {showArrivalEstimate && detail.startsWith('About ') && (
                                <span className="responder-eta-note"><Clock3 size={12} /> Approximate ETA; straight-line distance</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="responder-card-footer">
                    <span><Clock3 size={13} /> Dispatched {formatTime(task.created_at) || 'time unavailable'}</span>
                    {responderLocation && locationUpdated
                      ? <span className="responder-gps-status"><Radio size={12} /> GPS connected</span>
                      : <span className="responder-gps-status muted"><Circle size={9} /> GPS unavailable</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
