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
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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

interface IncidentReportDetails {
  id: string;
  type?: string | null;
  title?: string | null;
  incident_type?: string | null;
  severity?: string | null;
  dispatched_at?: string | null;
  resolved_at?: string | null;
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
  returned_at?: string | null;
  incident?: Incident | null;
  report?: IncidentReportDetails | null;
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
  { id: 'accepted', label: 'Accepted', icon: Check },
  { id: 'en-route', label: 'En route', icon: Navigation },
  { id: 'arrived', label: 'Arrived', icon: MapPin },
  { id: 'resolved', label: 'Resolved', icon: ShieldCheck },
  { id: 'returned', label: 'Returned', icon: RotateCcw },
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

function formatClock(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function durationMinutes(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.max(0, Math.round((end - start) / 60000));
}

function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 1) return 'Less than 1 min';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${minutes} min${minutes === 1 ? '' : 's'}`;
  if (remainingMinutes === 0) return `${hours} hr${hours === 1 ? '' : 's'}`;
  return `${hours} hr${hours === 1 ? '' : 's'} ${remainingMinutes} min`;
}

function dispatchedAt(task: ResponseTask): string | null {
  return task.report?.dispatched_at || task.created_at || null;
}

function resolvedAt(task: ResponseTask): string | null {
  return task.report?.resolved_at || task.incident?.resolved_at || null;
}

function stageTimestamp(task: ResponseTask, index: number): string | null {
  switch (index) {
    case 0: return task.accepted_at || null;
    case 1: return task.accepted_at || null;
    case 2: return task.arrived_at || null;
    case 3: return resolvedAt(task);
    case 4: return task.returned_at || null;
    default: return null;
  }
}

function stageCompleted(task: ResponseTask, index: number): boolean {
  switch (index) {
    case 0: return Boolean(task.accepted_at);
    case 1: return Boolean(task.arrived_at);
    case 2: return Boolean(task.arrived_at);
    case 3: return Boolean(resolvedAt(task));
    case 4: return Boolean(task.returned_at);
    default: return false;
  }
}

function stageCurrentIndex(task: ResponseTask): number {
  if (task.status === 'pending') return 0;
  if (task.status === 'accepted') return 1;
  if (task.status === 'in_progress') return 2;
  if (task.status === 'returning') return 4;
  return -1;
}

function stageTimeLabel(task: ResponseTask, index: number): string | null {
  if (index === 4 && task.status === 'returning' && !task.returned_at) {
    const returnStart = formatClock(task.returning_at || resolvedAt(task));
    return returnStart ? `In progress since ${returnStart}` : 'Return in progress';
  }
  const timestamp = stageTimestamp(task, index);
  const clock = formatClock(timestamp);
  if (!clock) return null;
  return index === 1 ? `Since ${clock}` : clock;
}

function stageDurationLabel(task: ResponseTask, index: number, now: number): string | null {
  const dispatch = dispatchedAt(task);
  const accepted = task.accepted_at || null;
  const arrived = task.arrived_at || null;
  const resolved = resolvedAt(task);
  const returned = task.returned_at || null;
  const liveTime = new Date(now).toISOString();
  let minutes: number | null = null;
  let suffix = '';

  if (index === 0) {
    minutes = durationMinutes(dispatch, accepted);
    suffix = 'from dispatch';
  } else if (index === 1) {
    minutes = durationMinutes(accepted, arrived || (task.status === 'accepted' ? liveTime : null));
    suffix = 'to arrival';
  } else if (index === 2) {
    minutes = durationMinutes(arrived, resolved || (task.status === 'in_progress' ? liveTime : null));
    suffix = 'on scene';
  } else if (index === 3) {
    minutes = durationMinutes(resolved, returned);
    suffix = 'to return';
  } else {
    if (returned) {
      minutes = durationMinutes(dispatch, returned);
      suffix = 'total response';
    } else if (task.status === 'returning') {
      minutes = durationMinutes(resolved, liveTime);
      suffix = 'on return trip';
    }
  }

  const value = formatDuration(minutes);
  return value ? `${value} ${suffix}` : null;
}

function isReturning(task: ResponseTask, location: ResponderLocation | null): boolean {
  if (task.status === 'returning') return true;
  if (task.status !== 'in_progress' || !location || Date.now() - location.timestamp >= 5 * 60 * 1000) return false;
  const latitude = asCoordinate(task.latitude ?? task.incident?.latitude);
  const longitude = asCoordinate(task.longitude ?? task.incident?.longitude);
  return latitude !== null && longitude !== null && distanceKm(location, latitude, longitude) > 0.5;
}

function taskIsFinished(task: ResponseTask): boolean {
  return task.status === 'cancelled' || task.status === 'completed';
}

function taskStatusLabel(task: ResponseTask, location: ResponderLocation | null): string {
  if (task.status === 'cancelled') return 'Cancelled';
  if (task.status === 'completed') return task.returned_at ? 'Returned' : 'Completed · return not recorded';
  if (task.status === 'returning') return 'Returning to base';
  if (task.status === 'pending') return 'Awaiting acceptance';
  if (task.status === 'accepted') return 'En route';
  if (task.status === 'in_progress') return isReturning(task, location) ? 'Returning · GPS' : 'On scene';
  return 'Dispatched';
}

function respondersFor(task: ResponseTask): string {
  const responderNames = (task.responders || [])
    .filter((responder) => responder.status !== 'left')
    .map((responder) => responder.responder?.full_name);
  const names = [task.assigned_user?.full_name, ...responderNames]
    .filter((name): name is string => Boolean(name));
  const uniqueNames = [...new Set(names)];
  return uniqueNames.length ? uniqueNames.join(', ') : 'Responder not assigned';
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

function arrivalEstimate(task: ResponseTask, location: ResponderLocation | null): string | null {
  const latitude = asCoordinate(task.latitude ?? task.incident?.latitude);
  const longitude = asCoordinate(task.longitude ?? task.incident?.longitude);
  if (latitude === null || longitude === null || !location || Date.now() - location.timestamp >= 5 * 60 * 1000) return null;
  const km = distanceKm(location, latitude, longitude);
  const minutes = Math.max(1, Math.round((km / 25) * 60));
  return `About ${minutes} min ETA · ${km.toFixed(1)} km straight-line`;
}

export default function ResponderTrackerPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<ResponseTask[]>([]);
  const [locations, setLocations] = useState<Record<string, ResponderLocation>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('active');
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

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
    if (filter === 'active') return assigned.filter((task) => !taskIsFinished(task));
    if (filter === 'resolved') return assigned.filter(taskIsFinished);
    return assigned;
  }, [filter, tasks]);

  const activeCount = tasks.filter((task) => (task.assigned_to || task.responders?.some((responder) => responder.status !== 'left')) && !taskIsFinished(task)).length;
  const enRouteCount = tasks.filter((task) => task.status === 'accepted' && !taskIsFinished(task)).length;
  const returningCount = tasks.filter((task) =>
    !taskIsFinished(task) && (task.status === 'returning' || isReturning(task, locationFor(task, locations)))).length;

  const openResponderOnMap = (task: ResponseTask) => {
    const responder = task.assigned_to
      ? { id: task.assigned_to, name: task.assigned_user?.full_name }
      : (() => {
          const assignedVolunteer = (task.responders || []).find((item) => item.responder_id && item.status !== 'left');
          return assignedVolunteer
            ? { id: assignedVolunteer.responder_id!, name: assignedVolunteer.responder?.full_name }
            : undefined;
        })();
    const responderId = responder?.id;
    if (!responderId) {
      toast.error('This dispatch has no assigned responder to show on the map');
      return;
    }

    const params = new URLSearchParams({ responder: responderId, task: task.id });
    const responderName = responder?.name;
    if (responderName) params.set('name', responderName);
    navigate(`/?${params.toString()}`);
  };

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
              const currentStage = stageCurrentIndex(task);
              const incidentName = task.incident?.title || task.title || 'Incident response';
              const address = task.address || task.incident?.address;
              const cancelled = task.status === 'cancelled';
              const finished = taskIsFinished(task);
              const reportType = task.report?.type || 'Not specified';
              const reportCategory = task.report?.title || task.incident?.type?.replace(/_/g, ' ') || task.task_type?.replace(/_/g, ' ') || 'Not specified';
              const priority = task.report?.severity || task.incident?.severity || 'Not specified';
              const priorityTone = ['low', 'moderate', 'high', 'critical'].includes(priority.toLowerCase())
                ? priority.toLowerCase()
                : 'unknown';
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
                    <span className={`responder-status-pill ${cancelled ? 'cancelled' : finished ? 'resolved' : 'active'}`}>
                      {taskStatusLabel(task, responderLocation)}
                    </span>
                  </div>

                  <div className="responder-incident-summary">
                    <div className="responder-incident-title">{incidentName}</div>
                    <div className="responder-report-facts">
                      <div className="responder-report-fact">
                        <span>Type</span>
                        <strong>{reportType.replace(/_/g, ' ')}</strong>
                      </div>
                      <div className="responder-report-fact">
                        <span>Category</span>
                        <strong>{reportCategory}</strong>
                      </div>
                      <div className="responder-report-fact">
                        <span>Priority</span>
                        <strong className={`responder-priority-badge ${priorityTone}`}>{priority.replace(/_/g, ' ')}</strong>
                      </div>
                    </div>
                    {address && <div className="responder-incident-meta"><span><MapPin size={14} />{address}</span></div>}
                  </div>

                  {cancelled ? (
                    <div className="responder-cancelled-note">This dispatch was cancelled.</div>
                  ) : (
                    <div className="responder-timeline" aria-label="Responder progress">
                      {stages.map((stage, index) => {
                        const Icon = stage.icon;
                        const isComplete = stageCompleted(task, index);
                        const isCurrent = index === currentStage && !finished && !cancelled;
                        const timeLabel = stageTimeLabel(task, index);
                        const durationLabel = stageDurationLabel(task, index, clockNow);
                        const showArrivalEstimate = index === 1 && isCurrent && task.status === 'accepted';
                        const fallback = task.status === 'pending' && index === 0
                          ? 'Waiting for acceptance'
                          : task.status === 'completed' && index === 4 && !task.returned_at
                            ? 'Return time not recorded'
                            : '—';

                        return (
                          <div className={`responder-timeline-stage ${isComplete ? 'complete' : ''} ${isCurrent ? 'current' : ''}`} key={stage.id}>
                            <div className="responder-timeline-rail">
                              <span className="responder-timeline-dot">
                                {isComplete ? <Check size={13} strokeWidth={3} /> : <Icon size={13} />}
                              </span>
                              {index < stages.length - 1 && <span className="responder-timeline-line" />}
                            </div>
                            <div className="responder-timeline-copy">
                              <div className="responder-timeline-heading">
                                <strong>{stage.label}</strong>
                                {isCurrent && <span className="responder-stage-live"><span />Current</span>}
                              </div>
                              <p className="responder-timeline-time">{timeLabel || fallback}</p>
                              {durationLabel && <span className="responder-timeline-duration">{durationLabel}</span>}
                              {showArrivalEstimate && responderLocation && locationUpdated && (
                                <span className="responder-gps-fresh"><Radio size={12} /> Live GPS update</span>
                              )}
                              {showArrivalEstimate && arrivalEstimate(task, responderLocation) && (
                                <span className="responder-eta-note"><Clock3 size={12} /> {arrivalEstimate(task, responderLocation)}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="responder-card-footer">
                    <span><Clock3 size={13} /> Dispatched {formatTime(dispatchedAt(task)) || 'time unavailable'}</span>
                    {responderLocation && locationUpdated
                      ? <span className="responder-gps-status"><Radio size={12} /> GPS connected</span>
                      : <span className="responder-gps-status muted"><Circle size={9} /> GPS unavailable</span>}
                    {user?.role === 'dispatcher' && !cancelled && (
                      <button className="responder-map-button" onClick={() => openResponderOnMap(task)}>
                        <MapPin size={14} /> View in map
                      </button>
                    )}
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
