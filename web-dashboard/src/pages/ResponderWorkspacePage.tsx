import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, ClipboardList, RefreshCw, ShieldAlert, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { reportAPI, respondUnitAPI, socket, type TransportHospital } from '../lib/api';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useAuth } from '../context/AuthContext';
import { createDemoResponderReport } from '../demoResponderReport';
import IncidentLocationCard from '../components/IncidentLocationCard';
import ResponderLocationMapModal from '../components/ResponderLocationMapModal';
import { formatIncidentLocation, hasIncidentPin, type IncidentLocationPreview } from '../lib/incidentLocation';

type CrewMember = { id?: string; unit_member_id?: string; name?: string; full_name?: string; member_role: string; is_active?: boolean };
type BarangayCrewMember = { id: string; full_name: string; account_role: 'responder' | 'staff' };
type BarangayCrewSelection = { member_id: string; crew_role: string };
type ResponseAssignment = { responder_id?: string; status?: string; assignment_status?: string; arrived_at?: string | null; crew?: CrewMember[] };
type AssignedReport = {
  id: string;
  title?: string | null;
  description?: string | null;
  incident_type?: string | null;
  severity?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  address?: string | null;
  location_name?: string | null;
  barangay_name?: string | null;
  created_at?: string | null;
  response_status?: string | null;
  barangay_response_status?: string | null;
  assignment_status?: string | null;
  is_central_assignment?: boolean;
  barangay_arrived_at?: string | null;
  barangay_dispatched_at?: string | null;
  response_notes?: string | null;
  barangay_response_notes?: string | null;
  responded_by?: string | null;
  barangay_responded_by?: string | null;
  arrived_at?: string | null;
  assigned_team_leader_ids?: string[];
  barangay_crew_members?: Array<{ member_id: string; member_name: string; crew_role: string }>;
  mdrrmo_arrived_at?: string | null;
  mdrrmo_assignments?: ResponseAssignment[];
  assigned_responder_ids?: string[];
  responder_media?: Array<{ id?: string; url?: string; type?: string }> | string | null;
  is_demo?: boolean;
};

type TriageOutcome = 'safe' | 'mild_injuries' | 'severe_injuries';
const emptyAssessment = {
  situation: '', affected_people: '', actions_taken: '', risks_resources: '',
  triage_outcome: '' as TriageOutcome | '',
  transport_status: 'not_required' as 'not_required' | 'in_transit' | 'delivered',
  hospital_name: '', hospital_address: '', hospital_latitude: '', hospital_longitude: '',
  transport_started_at: '', transport_completed_at: '',
};
type AssessmentField = keyof typeof emptyAssessment;
type FieldAssessment = typeof emptyAssessment;
const AUTO_ARRIVAL_RADIUS_METERS = 100;
const AUTO_ARRIVAL_MAX_ACCURACY_METERS = 50;

const triageSummary = (outcome: TriageOutcome | '') => outcome === 'safe'
  ? 'Safe; no injuries reported.'
  : outcome === 'mild_injuries'
    ? 'Mild injuries; treated on site.'
    : outcome === 'severe_injuries'
      ? 'Severe injuries; transport required.'
      : '';

function parseResponderMedia(value: AssignedReport['responder_media']) {
  let items = value;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { return []; }
  }
  if (!Array.isArray(items)) return [];
  return items.flatMap((item, index) => item && typeof item === 'object' && typeof item.url === 'string'
    ? [{ id: item.id || item.url || String(index), url: item.url, type: item.type || 'image' }]
    : []);
}

function distanceMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const parseFieldAssessment = (notes: string | null | undefined, isBarangay: boolean) => {
  const marker = String(notes || '').match(isBarangay
    ? /\[BARANGAY FIELD (?:NOTES|ASSESSMENT)\]([\s\S]*)$/i
    : /\[(?:MDRRMO )?FIELD ASSESSMENT\]([\s\S]*)$/i);
  if (!marker) return { ...emptyAssessment };
  const values: Record<string, string> = {};
  marker[1].split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(':');
    if (separator > 0) values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  });
  return {
    situation: values.situation || '',
    affected_people: values['people affected / urgency'] || values['people affected'] || '',
    actions_taken: values['actions taken'] || values['action taken'] || '',
    risks_resources: values['risks / resources'] || values['risk / resource'] || '',
    triage_outcome: (values['triage outcome'] || '') as TriageOutcome | '',
    transport_status: (values['transport status'] || 'not_required') as typeof emptyAssessment.transport_status,
    hospital_name: values['hospital destination'] || '',
    hospital_address: values['hospital address'] || '',
    hospital_latitude: values['hospital latitude'] || '',
    hospital_longitude: values['hospital longitude'] || '',
    transport_started_at: values['transport started at'] || '',
    transport_completed_at: values['transport completed at'] || '',
  };
};

export default function ResponderWorkspacePage() {
  const { user } = useAuth();
  const isBarangay = user?.account_kind === 'barangay';
  const [demoReport] = useState<AssignedReport>(() => createDemoResponderReport());
  const [demoDismissed, setDemoDismissed] = useState(false);
  const [reports, setReports] = useState<AssignedReport[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [barangayRoster, setBarangayRoster] = useState<BarangayCrewMember[]>([]);
  const [crewSelections, setCrewSelections] = useState<Record<string, string[]>>({});
  const [crewDraftSelections, setCrewDraftSelections] = useState<Record<string, string[]>>({});
  const [crewEditorReportId, setCrewEditorReportId] = useState<string | null>(null);
  const [barangayCrewSelections, setBarangayCrewSelections] = useState<Record<string, BarangayCrewSelection[]>>({});
  const [assessments, setAssessments] = useState<Record<string, typeof emptyAssessment>>({});
  const assessmentBaseline = useRef<Record<string, FieldAssessment>>({});
  const [responderGps, setResponderGps] = useState<{ latitude: number; longitude: number; capturedAt: number } | null>(null);
  const [nearbyHospitals, setNearbyHospitals] = useState<Record<string, TransportHospital[]>>({});
  const [hospitalSearchResults, setHospitalSearchResults] = useState<Record<string, TransportHospital[]>>({});
  const [hospitalSearchQuery, setHospitalSearchQuery] = useState<Record<string, string>>({});
  const [selectedHospitals, setSelectedHospitals] = useState<Record<string, TransportHospital | null>>({});
  const [hospitalLoading, setHospitalLoading] = useState<Record<string, boolean>>({});
  const [transportPickerOpen, setTransportPickerOpen] = useState<Record<string, boolean>>({});
  const [locationPreviews, setLocationPreviews] = useState<Record<string, IncidentLocationPreview>>({});
  const [locationPreviewLoading, setLocationPreviewLoading] = useState<Record<string, boolean>>({});
  const requestedLocationPreviews = useRef(new Set<string>());
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [locationMapReport, setLocationMapReport] = useState<AssignedReport | null>(null);
  const autoArrivalInFlight = useRef(new Set<string>());
  const autoArrivalAttemptedAt = useRef(new Map<string, number>());
  const closeLocationMap = useCallback(() => setLocationMapReport(null), []);

  const loadLocationPreview = useCallback(async (report: AssignedReport) => {
    if (report.is_demo || !hasIncidentPin(report)) return;
    const requestKey = `${report.id}:${report.latitude}:${report.longitude}`;
    if (requestedLocationPreviews.current.has(requestKey)) return;
    requestedLocationPreviews.current.add(requestKey);
    setLocationPreviewLoading((current) => ({ ...current, [report.id]: true }));
    try {
      const response = isBarangay
        ? await reportAPI.barangayLocationPreview(report.id)
        : await reportAPI.mdrrmoReportLocationPreview(report.id);
      setLocationPreviews((current) => ({ ...current, [report.id]: response.data || {} }));
    } catch (previewError) {
      requestedLocationPreviews.current.delete(requestKey);
      console.warn(`Could not load location labels for response ${report.id}:`, previewError);
    } finally {
      setLocationPreviewLoading((current) => ({ ...current, [report.id]: false }));
    }
  }, [isBarangay]);

  const loadWorkspace = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [queueResponse, rosterResponse] = await Promise.all([
        isBarangay ? reportAPI.barangayReports() : reportAPI.mdrrmoQueue(),
        isBarangay ? reportAPI.barangayCrewRoster() : respondUnitAPI.myUnit(),
      ]);
      const items = Array.isArray(queueResponse.data) ? queueResponse.data : [];
      const members: CrewMember[] = isBarangay ? [] : Array.isArray(rosterResponse?.data?.members) ? rosterResponse.data.members : [];
      const barangayMembers: BarangayCrewMember[] = isBarangay && Array.isArray(rosterResponse?.data?.members) ? rosterResponse.data.members : [];
      const nextAssessmentBaseline = Object.fromEntries(items.map((report: AssignedReport) => [
        report.id,
        parseFieldAssessment(isBarangay
          ? report.barangay_response_notes || report.response_notes
          : report.response_notes || report.barangay_response_notes, isBarangay),
      ]));
      const previousAssessmentBaseline = assessmentBaseline.current;
      setReports(items);
      setAssessments((current) => Object.fromEntries(items.map((report: AssignedReport) => {
        const incoming = nextAssessmentBaseline[report.id];
        if (!incoming) return [report.id, { ...emptyAssessment }];
        const draft = current[report.id];
        const previous = previousAssessmentBaseline[report.id];
        if (!draft || !previous) return [report.id, incoming];
        const merged = { ...incoming };
        (Object.keys(emptyAssessment) as AssessmentField[]).forEach((field) => {
          if (draft[field] !== previous[field]) merged[field] = draft[field];
        });
        return [report.id, merged];
      })));
      assessmentBaseline.current = nextAssessmentBaseline;
      setCrew(members);
      setBarangayRoster(barangayMembers);
      setCrewSelections(Object.fromEntries(items.map((report: AssignedReport) => {
        const assignment = report.mdrrmo_assignments?.find((item) => item.responder_id === user?.id && item.status !== 'removed');
        const savedIds = (assignment?.crew || []).filter((member) => member.member_role !== 'team_leader')
          .map((member) => member.unit_member_id || member.id || '').filter(Boolean);
        return [report.id, savedIds];
      })));
      setBarangayCrewSelections(Object.fromEntries(items.map((report: AssignedReport) => [
        report.id,
        (report.barangay_crew_members || []).map((member) => ({ member_id: member.member_id, crew_role: member.crew_role })),
      ])));
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || 'Your assigned responses could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isBarangay, user?.id]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => { reports.forEach((report) => void loadLocationPreview(report)); }, [reports, loadLocationPreview]);

  useEffect(() => {
    if (user?.role !== 'responder' || !user.id || !navigator.geolocation) return;
    const isAssignedResponse = (report: AssignedReport) => {
      if (report.is_demo) return false;
      const status = String((isBarangay ? report.barangay_response_status : report.response_status) || report.response_status || '').toLowerCase();
      if (status !== 'responding') return false;
      if (isBarangay) {
        const notes = String(report.barangay_response_notes || report.response_notes || '');
        const assignedIds = [
          ...(report.assigned_team_leader_ids || []),
          ...(report.assigned_responder_ids || []),
          ...(notes.match(/^\[ASSIGNED:([^\]]+)\]/)?.[1]?.split(',').map((id) => id.trim()).filter(Boolean) || []),
          report.barangay_responded_by || report.responded_by || '',
        ];
        return assignedIds.includes(user.id);
      }
      const assignment = report.mdrrmo_assignments?.find((item) => item.responder_id === user.id && item.status !== 'removed');
      return Boolean(assignment && (assignment.status || assignment.assignment_status) === 'responding');
    };
    const hasArrived = (report: AssignedReport) => isBarangay
      ? Boolean(report.barangay_arrived_at || report.arrived_at)
      : Boolean(report.mdrrmo_assignments?.find((item) => item.responder_id === user.id)?.arrived_at || report.mdrrmo_arrived_at);
    const isAssignedAndEnRoute = (report: AssignedReport) => isAssignedResponse(report) && !hasArrived(report);
    const isTransporting = (report: AssignedReport) => isAssignedResponse(report) &&
      parseFieldAssessment(isBarangay ? report.barangay_response_notes || report.response_notes : report.response_notes, isBarangay).transport_status === 'in_transit';
    if (!reports.some((report) => isAssignedAndEnRoute(report) || isTransporting(report))) return;

    type GpsFix = { latitude: number; longitude: number; accuracy_m: number | null; capturedAt: number; fix_at: string };
    let latestFix: GpsFix | null = null;
    const checkAutoArrival = (fix: GpsFix) => {
      if (!Number.isFinite(fix.accuracy_m) || fix.accuracy_m === null || fix.accuracy_m > AUTO_ARRIVAL_MAX_ACCURACY_METERS ||
          Date.now() - fix.capturedAt > 20_000) return;
      for (const report of reports) {
        if (!isAssignedAndEnRoute(report) || !hasIncidentPin(report)) continue;
        const latitude = Number(report.latitude);
        const longitude = Number(report.longitude);
        if (distanceMeters(latitude, longitude, fix.latitude, fix.longitude) > AUTO_ARRIVAL_RADIUS_METERS) continue;
        if (autoArrivalInFlight.current.has(report.id)) continue;
        const lastAttempt = autoArrivalAttemptedAt.current.get(report.id) || 0;
        if (Date.now() - lastAttempt < 15_000) continue;
        autoArrivalAttemptedAt.current.set(report.id, Date.now());
        autoArrivalInFlight.current.add(report.id);
        const gpsArrival = {
          method: 'gps' as const,
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracy_m: fix.accuracy_m,
          fix_at: fix.fix_at,
        };
        const recordArrival = isBarangay
          ? report.is_central_assignment
            ? reportAPI.arriveBarangayAssignment(report.id, gpsArrival)
            : reportAPI.arriveBarangayReport(report.id, gpsArrival)
          : reportAPI.arriveAtMdrrmoIncident(report.id, gpsArrival);
        void recordArrival.then(() => {
          autoArrivalAttemptedAt.current.set(report.id, Number.POSITIVE_INFINITY);
          toast.success(`Arrival recorded automatically: ${report.title || 'Incident'}`);
          void loadWorkspace(true);
        }).catch((arrivalError: any) => {
          const statusCode = arrivalError?.response?.status;
          if (statusCode === 403 || statusCode === 404 || statusCode === 409) {
            autoArrivalAttemptedAt.current.set(report.id, Number.POSITIVE_INFINITY);
            void loadWorkspace(true);
          } else {
            console.warn(`Automatic arrival could not be recorded for ${report.id}:`, arrivalError);
          }
        }).finally(() => {
          autoArrivalInFlight.current.delete(report.id);
        });
      }
    };
    const sendFix = () => {
      if (!latestFix || Date.now() - latestFix.capturedAt > 20_000) return;
      checkAutoArrival(latestFix);
      if (socket.connected) socket.emit(isBarangay ? 'barangay:gps:update' : 'gps:update', {
          userId: user.id,
          latitude: latestFix.latitude,
          longitude: latestFix.longitude,
          accuracy_m: latestFix.accuracy_m,
        });
    };
    const watchId = navigator.geolocation.watchPosition((position) => {
      const fixTimestamp = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
      latestFix = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_m: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        capturedAt: Date.now(),
        fix_at: new Date(fixTimestamp).toISOString(),
      };
      setResponderGps({ latitude: latestFix.latitude, longitude: latestFix.longitude, capturedAt: latestFix.capturedAt });
      sendFix();
    }, (locationError) => {
      console.warn('Responder GPS update unavailable:', locationError.message);
    }, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
    const heartbeat = window.setInterval(sendFix, 10_000);
    socket.on('connect', sendFix);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeat);
      socket.off('connect', sendFix);
    };
  }, [isBarangay, loadWorkspace, reports, user?.id, user?.role]);

  useRealtimeRefresh(loadWorkspace, {
    events: [
      'incident:lifecycle', 'incident_report:updated', 'incident_report:reviewed', 'mdrrmo:report_updated',
      'barangay:report_updated', 'barangay:report_assigned', 'incident:alert',
      'task:statusChanged', 'task:membersUpdated',
    ],
  });

  useEffect(() => {
    if (!crewEditorReportId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setCrewEditorReportId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [crewEditorReportId, saving]);

  const responseStatusFor = (report: AssignedReport) => String((isBarangay ? report.barangay_response_status : report.response_status) || report.response_status || 'pending').toLowerCase();
  const activeReports = reports.filter((report) => responseStatusFor(report) !== 'resolved');
  const resolvedCount = reports.length - activeReports.length;
  const showDemoPreview = isBarangay && user?.role === 'responder' &&
    localStorage.getItem('norzagapay_debug_session') === 'true' &&
    localStorage.getItem('norzagapay_responder_demo_hidden') !== 'true' && !demoDismissed;
  const visibleActiveReports = showDemoPreview ? [...activeReports, demoReport] : activeReports;

  const perform = async (action: () => Promise<unknown>, successMessage: string) => {
    setSaving(true);
    try {
      await action();
      toast.success(successMessage);
      await loadWorkspace(true);
      return true;
    } catch (actionError: any) {
      toast.error(actionError?.response?.data?.error || 'The response update could not be saved.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const assignmentFor = (report: AssignedReport) => report.mdrrmo_assignments?.find((assignment) =>
    assignment.responder_id === user?.id && assignment.status !== 'removed');

  const canSaveMdrrmoCrew = (memberIds: string[]) => memberIds.length >= 2 && memberIds.length <= 7 &&
    memberIds.some((id) => crew.some((member) => (member.unit_member_id || member.id) === id && member.member_role === 'driver_responder')) &&
    memberIds.some((id) => crew.some((member) => (member.unit_member_id || member.id) === id && member.member_role === 'first_aider_responder'));

  const toggleCrew = (reportId: string, member: CrewMember) => {
    const id = member.unit_member_id || member.id;
    if (!id) return;
    setCrewDraftSelections((all) => {
      const current = all[reportId] || [];
      if (current.includes(id)) return { ...all, [reportId]: current.filter((value) => value !== id) };
      if (current.length >= 7) {
        toast.error('Select no more than seven crew members.');
        return all;
      }
      return { ...all, [reportId]: [...current, id] };
    });
  };

  const openCrewEditor = (reportId: string) => {
    setCrewDraftSelections((current) => ({
      ...current,
      [reportId]: [...(crewSelections[reportId] || [])],
    }));
    setCrewEditorReportId(reportId);
  };

  const cancelCrewEditor = () => setCrewEditorReportId(null);

  const saveCrewEditor = async (reportId: string) => {
    const memberIds = crewDraftSelections[reportId] || [];
    const saved = await perform(
      () => reportAPI.saveMdrrmoResponseCrew(reportId, memberIds),
      'MDRRMO response crew saved.',
    );
    if (saved) {
      setCrewSelections((current) => ({ ...current, [reportId]: [...memberIds] }));
      setCrewEditorReportId(null);
    }
  };

  const toggleBarangayCrew = (reportId: string, memberId: string) => {
    setBarangayCrewSelections((all) => {
      const current = all[reportId] || [];
      return {
        ...all,
        [reportId]: current.some((member) => member.member_id === memberId)
          ? current.filter((member) => member.member_id !== memberId)
          : [...current, { member_id: memberId, crew_role: 'member' }],
      };
    });
  };

  const setBarangayCrewRole = (reportId: string, memberId: string, crewRole: string) => {
    setBarangayCrewSelections((all) => ({
      ...all,
      [reportId]: (all[reportId] || []).map((member) => member.member_id === memberId ? { ...member, crew_role: crewRole } : member),
    }));
  };

  const uploadMedia = (report: AssignedReport, files?: FileList | null) => {
    const selectedFiles = files ? Array.from(files) : [];
    if (!selectedFiles.length) return;
    void perform(async () => {
      for (const file of selectedFiles) {
        if (isBarangay) {
          if (report.is_central_assignment) await reportAPI.uploadBarangayAssignmentMedia(report.id, file);
          else await reportAPI.uploadBarangayFieldMedia(report.id, file);
        } else {
          await reportAPI.uploadMdrrmoFieldMedia(report.id, file);
        }
      }
    }, `${selectedFiles.length} field attachment${selectedFiles.length === 1 ? '' : 's'} added.`);
  };

  const updateAssessment = (reportId: string, field: AssessmentField, value: string) => {
    setAssessments((current) => ({
      ...current,
      [reportId]: { ...(current[reportId] || emptyAssessment), [field]: value },
    }));
  };

  const saveAssessment = (reportId: string) => {
    const values = assessments[reportId] || emptyAssessment;
    const assessment = {
      situation: values.situation,
      affected_people: values.affected_people,
      actions_taken: values.actions_taken,
      risks_resources: values.risks_resources,
      triage_outcome: values.triage_outcome as TriageOutcome,
    };
    return isBarangay
      ? reportAPI.saveBarangayAssignmentFieldNotes(reportId, assessment)
      : reportAPI.saveMdrrmoFieldAssessment(reportId, assessment);
  };

  const getFreshResponderCoordinates = async () => {
    if (responderGps && Date.now() - responderGps.capturedAt < 20_000) {
      return { latitude: responderGps.latitude, longitude: responderGps.longitude };
    }
    if (!navigator.geolocation) throw new Error('Location access is needed to place the hospital on the map.');
    return new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition((position) => {
        const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setResponderGps({ ...fix, capturedAt: Date.now() });
        resolve(fix);
      }, () => reject(new Error('Allow location access to search for hospitals from your current position.')), {
        enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000,
      });
    });
  };

  const loadNearbyHospitals = async (reportId: string) => {
    setHospitalLoading((current) => ({ ...current, [reportId]: true }));
    try {
      const location = await getFreshResponderCoordinates();
      const response = isBarangay
        ? await reportAPI.barangayTransportHospitals(reportId, location.latitude, location.longitude)
        : await reportAPI.mdrrmoTransportHospitals(reportId, location.latitude, location.longitude);
      const hospitals = response.data?.hospitals || [];
      setNearbyHospitals((current) => ({ ...current, [reportId]: hospitals }));
      if (!hospitals.length) toast('No mapped hospitals were found nearby. Search by hospital name.');
    } catch (lookupError: any) {
      toast.error(lookupError?.response?.data?.error || lookupError?.message || 'Could not find nearby hospitals.');
    } finally {
      setHospitalLoading((current) => ({ ...current, [reportId]: false }));
    }
  };

  const searchHospitalByName = async (reportId: string) => {
    const query = (hospitalSearchQuery[reportId] || '').trim();
    if (query.length < 2) { toast.error('Enter at least two characters for the hospital name.'); return; }
    setHospitalLoading((current) => ({ ...current, [reportId]: true }));
    try {
      const location = await getFreshResponderCoordinates();
      const response = isBarangay
        ? await reportAPI.searchBarangayTransportHospitals(reportId, query, location.latitude, location.longitude)
        : await reportAPI.searchMdrrmoTransportHospitals(reportId, query, location.latitude, location.longitude);
      const hospitals = response.data?.hospitals || [];
      setHospitalSearchResults((current) => ({ ...current, [reportId]: hospitals }));
      if (!hospitals.length) toast('No mapped result found. Try a fuller hospital name.');
    } catch (lookupError: any) {
      toast.error(lookupError?.response?.data?.error || lookupError?.message || 'Could not search for that hospital.');
    } finally {
      setHospitalLoading((current) => ({ ...current, [reportId]: false }));
    }
  };

  const setTriageOutcome = (reportId: string, outcome: TriageOutcome) => {
    setAssessments((current) => ({
      ...current,
      [reportId]: (() => {
        const existing = current[reportId] || emptyAssessment;
        const previousSummary = triageSummary(existing.triage_outcome);
        const affectedPeople = !existing.affected_people.trim() || existing.affected_people === previousSummary
          ? triageSummary(outcome)
          : existing.affected_people;
        return { ...existing, triage_outcome: outcome, affected_people: affectedPeople };
      })(),
    }));
    setSelectedHospitals((current) => ({ ...current, [reportId]: null }));
    setTransportPickerOpen((current) => ({ ...current, [reportId]: false }));
  };

  const startTransport = (reportId: string) => {
    const hospital = selectedHospitals[reportId];
    if (!hospital) { toast.error('Choose a hospital result so its map location can be shown.'); return; }
    void perform(() => isBarangay
      ? reportAPI.updateBarangayTransport(reportId, {
        status: 'in_transit', hospital_name: hospital.name, hospital_address: hospital.address,
        hospital_latitude: hospital.latitude, hospital_longitude: hospital.longitude,
      })
      : reportAPI.updateMdrrmoTransport(reportId, {
        status: 'in_transit', hospital_name: hospital.name, hospital_address: hospital.address,
        hospital_latitude: hospital.latitude, hospital_longitude: hospital.longitude,
      }), `Transport started to ${hospital.name}.`);
  };

  const completeTransport = (reportId: string) => {
    void perform(() => isBarangay
      ? reportAPI.updateBarangayTransport(reportId, { status: 'delivered' })
      : reportAPI.updateMdrrmoTransport(reportId, { status: 'delivered' }), 'Transport marked delivered.');
  };

  return (
    <div className="responder-workspace">
      <header className="responder-workspace-header">
        <div><span className="workspace-eyebrow">{isBarangay ? `BARANGAY RESPONSE · ${user?.barangay_name || 'YOUR BARANGAY'}` : 'MDRRMO FIELD RESPONSE'}</span><h1>My responses</h1><p>Assigned incidents and the updates needed to complete each response.</p></div>
        <button className="workspace-secondary-action" type="button" onClick={() => void loadWorkspace(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'workspace-spinning' : ''} /> Refresh</button>
      </header>
      <section className="resident-summary-grid" aria-label="Response summary">
        <article><span>Active</span><strong>{activeReports.length}</strong></article>
        <article><span>Resolved</span><strong>{resolvedCount}</strong></article>
        <article><span>{isBarangay ? 'Scoped reports' : 'Unit crew'}</span><strong>{isBarangay ? reports.length : crew.length}</strong></article>
      </section>
      {error && <div className="workspace-message workspace-message-error" role="alert"><AlertCircle size={17} />{error}<button type="button" onClick={() => void loadWorkspace()}>Try again</button></div>}
      {showDemoPreview && <div className="responder-demo-notice" role="note"><div><strong>Debug demo preview</strong><span>This sample is not a real incident, is not saved, and is excluded from the counts above.</span></div><button type="button" onClick={() => { localStorage.setItem('norzagapay_responder_demo_hidden', 'true'); setDemoDismissed(true); }}><X size={15} /> Hide preview</button></div>}
      {!loading && !isBarangay && crew.length === 0 && <div className="workspace-message"><ShieldAlert size={17} />Your unit roster is not available yet. Ask logistics staff to assign your team and crew.</div>}
      {loading ? <p className="resident-reports-state">Loading assigned responses…</p> : visibleActiveReports.length === 0 ? (
        <div className="resident-reports-empty"><CheckCircle2 size={23} /><strong>No active assignments</strong><span>New dispatches assigned to your responder account will appear here.</span></div>
      ) : <div className="responder-report-list">
        {visibleActiveReports.map((report) => {
          const assignment = assignmentFor(report);
          const assignmentStatus = String(isBarangay ? report.assignment_status || '' : assignment?.status || assignment?.assignment_status || '').toLowerCase();
          const responseStatus = responseStatusFor(report);
          const savedAssessmentNotes = String(isBarangay ? report.barangay_response_notes || report.response_notes || '' : report.response_notes || '');
          const hasAssessmentMarker = savedAssessmentNotes.includes(isBarangay ? '[BARANGAY FIELD ASSESSMENT]' : '[MDRRMO FIELD ASSESSMENT]');
          const arrived = isBarangay
            ? Boolean(report.barangay_arrived_at)
            : Boolean(assignment ? assignment.arrived_at : report.mdrrmo_arrived_at);
          const canUpdateField = !report.is_demo && (isBarangay ? responseStatus === 'responding' : assignmentStatus === 'responding');
          const canManageCrew = !report.is_demo && !arrived && (isBarangay
            ? Boolean(report.is_central_assignment && report.barangay_dispatched_at && responseStatus === 'responding')
            : assignmentStatus === 'responding');
          const selectedCrewIds = crewDraftSelections[report.id] || [];
          const currentAssessment = assessments[report.id] || emptyAssessment;
          const fieldMedia = parseResponderMedia(report.responder_media);
          const resolutionSummary = resolutionNotes[report.id] || '';
          const persistedAssessment = parseFieldAssessment(savedAssessmentNotes, isBarangay);
          const assessmentSaved = hasAssessmentMarker && [
            'situation', 'affected_people', 'actions_taken', 'risks_resources', 'triage_outcome',
          ].every((key) => currentAssessment[key as keyof typeof emptyAssessment] === persistedAssessment[key as keyof typeof emptyAssessment]);
          const triageSaved = Boolean(currentAssessment.triage_outcome);
          const transportInProgress = currentAssessment.transport_status === 'in_transit';
          const canResolve = assessmentSaved && triageSaved &&
            (currentAssessment.triage_outcome !== 'severe_injuries' || currentAssessment.transport_status === 'delivered');
          const selectedBarangayCrew = barangayCrewSelections[report.id] || [];
          const savedMdrrmoCrew = (assignment?.crew || []).filter((member) => member.member_role !== 'team_leader');
          const savedBarangayCrew = report.barangay_crew_members || [];
          const hasMapLocation = !report.is_demo && hasIncidentPin(report);
          const locationPreview = locationPreviews[report.id];
          const displayStatus = responseStatus === 'responding' ? 'Responding' : assignmentStatus === 'active' ? 'Assigned' : assignmentStatus || 'Assigned';
          return <article className="responder-report-card" key={report.id}>
            <header><div><span className="workspace-eyebrow">{report.is_demo ? 'DEMO ASSIGNMENT · ' : ''}{report.incident_type?.replaceAll('_', ' ') || 'Incident'}{report.severity ? ` · ${report.severity}` : ''}</span><h2>{report.title || 'Incident response'}</h2></div><span className={`resident-status ${responseStatus === 'responding' ? 'responding' : ''} ${report.is_demo ? 'demo' : ''}`}>{report.is_demo ? 'Demo preview' : displayStatus}</span></header>
            <p className="responder-report-description">{report.description || 'No incident details were provided.'}</p>
            <div className="resident-report-meta"><span><Activity size={14} /> {report.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.created_at)) : 'Time unavailable'}</span></div>
            <IncidentLocationCard
              location={locationPreview}
              fallbackLabel={formatIncidentLocation(report)}
              loading={Boolean(locationPreviewLoading[report.id])}
              coordinates={hasIncidentPin(report) ? `${Number(report.latitude).toFixed(5)}, ${Number(report.longitude).toFixed(5)}` : null}
              onOpenMap={hasMapLocation ? () => setLocationMapReport(report) : undefined}
            />

            {canManageCrew && !isBarangay && <section className="responder-action-panel">
              <h3><ClipboardList size={16} /> MDRRMO response crew</h3>
              <div className="responder-selected-crew-list">
                {savedMdrrmoCrew.map((member) => <div className="responder-selected-crew-member" key={member.unit_member_id || member.id}>
                  <strong>{member.name || member.full_name || 'Crew member'}</strong>
                  <span>{member.member_role.replaceAll('_', ' ')}</span>
                </div>)}
                {savedMdrrmoCrew.length === 0 && <small>No crew selected yet.</small>}
              </div>
              <button className="workspace-secondary-action responder-change-crew-button" type="button" disabled={saving} onClick={() => openCrewEditor(report.id)}>Change crew</button>
              {crewEditorReportId === report.id && <div className="responder-crew-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) cancelCrewEditor(); }}>
                <section className="responder-crew-modal" role="dialog" aria-modal="true" aria-labelledby={`responder-crew-modal-title-${report.id}`}>
                  <header className="responder-crew-modal-header">
                    <div><span className="workspace-eyebrow">MDRRMO RESPONSE</span><h2 id={`responder-crew-modal-title-${report.id}`}>Change response crew</h2><p>Select a driver responder and a first aider, with up to seven crew members total.</p></div>
                    <button className="responder-crew-modal-close" type="button" aria-label="Close crew editor" disabled={saving} onClick={cancelCrewEditor}><X size={18} /></button>
                  </header>
                  <div className="responder-crew-modal-list">
                    {crew.filter((member) => member.is_active !== false && ['radio_operator', 'driver_responder', 'first_aider_responder'].includes(member.member_role)).map((member) => {
                      const id = member.unit_member_id || member.id || '';
                      return <label className="responder-crew-option" key={id}><input type="checkbox" checked={selectedCrewIds.includes(id)} onChange={() => toggleCrew(report.id, member)} /><span><strong>{member.name || member.full_name || 'Crew member'}</strong><small>{member.member_role.replaceAll('_', ' ')}</small></span></label>;
                    })}
                    {crew.every((member) => member.is_active === false || !['radio_operator', 'driver_responder', 'first_aider_responder'].includes(member.member_role)) && <p className="responder-crew-guidance">No active crew members are available in your municipal unit roster.</p>}
                  </div>
                  {!canSaveMdrrmoCrew(selectedCrewIds) && <small className="responder-crew-guidance responder-crew-modal-guidance">Choose a driver responder and a first aider, with no more than seven crew members.</small>}
                  <footer className="responder-crew-modal-actions">
                    <button className="workspace-secondary-action" type="button" disabled={saving} onClick={cancelCrewEditor}>Cancel</button>
                    <button className="workspace-primary-action" type="button" disabled={saving || !canSaveMdrrmoCrew(selectedCrewIds)} onClick={() => void saveCrewEditor(report.id)}>{saving ? 'Saving crew…' : 'Save response crew'}</button>
                  </footer>
                </section>
              </div>}
            </section>}

            {canManageCrew && isBarangay && <section className="responder-action-panel">
              <h3><ClipboardList size={16} /> {user?.barangay_name || 'Barangay'} response crew</h3>
              <p className="responder-report-description">This assignment is already accepted. Choose members from your barangay roster and give each their response role.</p>
              {savedBarangayCrew.length > 0 && <small className="responder-crew-guidance">Current crew: {savedBarangayCrew.map((member) => `${member.member_name} (${member.crew_role.replaceAll('_', ' ')})`).join(', ')}</small>}
              {barangayRoster.length === 0 && <div className="workspace-message">No active staff or responders are available in this barangay roster.</div>}
              {barangayRoster.map((member) => {
                const selected = selectedBarangayCrew.find((item) => item.member_id === member.id);
                return <div className="responder-crew-option" key={member.id}>
                  <label><input type="checkbox" checked={Boolean(selected)} onChange={() => toggleBarangayCrew(report.id, member.id)} /><span><strong>{member.full_name}</strong><small>{member.account_role}</small></span></label>
                  {selected && <select aria-label={`Response role for ${member.full_name}`} value={selected.crew_role} onChange={(event) => setBarangayCrewRole(report.id, member.id, event.target.value)}>
                    <option value="team_leader">Team leader</option><option value="driver">Driver</option><option value="first_aider">First aider</option><option value="radio_operator">Radio operator</option><option value="member">Responder / member</option>
                  </select>}
                </div>;
              })}
              <button className="workspace-primary-action" type="button" disabled={saving || selectedBarangayCrew.length === 0 || selectedBarangayCrew.length > 20} onClick={() => void perform(() => reportAPI.saveBarangayResponseCrew(report.id, selectedBarangayCrew), 'Barangay response crew saved.')}>Save response crew</button>
            </section>}

            {!canManageCrew && canUpdateField && isBarangay && savedBarangayCrew.length > 0 && <div className="workspace-message">Barangay crew: {savedBarangayCrew.map((member) => `${member.member_name} (${member.crew_role.replaceAll('_', ' ')})`).join(', ')}</div>}

            {canUpdateField && <section className="responder-action-panel">
              <h3><Activity size={16} /> Field response</h3>
              {!arrived && <button className="workspace-secondary-action" type="button" disabled={saving} onClick={() => void perform(() => isBarangay
                ? report.is_central_assignment
                  ? reportAPI.arriveBarangayAssignment(report.id, { method: 'manual' })
                  : reportAPI.arriveBarangayReport(report.id, { method: 'manual' })
                : reportAPI.arriveAtMdrrmoIncident(report.id), 'Arrival recorded.')}>Record arrival</button>}
              {!arrived && <small className="responder-arrival-hint">GPS records arrival automatically within 100 m when accuracy is 50 m or better. Keep this workspace open, or record arrival manually.</small>}
              {!arrived && <label className="workspace-secondary-action upload-action"><Upload size={16} /> Add field media<input type="file" accept="image/*,video/*" multiple onChange={(event) => { uploadMedia(report, event.currentTarget.files); event.currentTarget.value = ''; }} /></label>}
              {arrived ? <>
                <div className="responder-assessment-grid responder-assessment-grid-primary">
                  <label>Situation<textarea value={currentAssessment.situation} onChange={(event) => updateAssessment(report.id, 'situation', event.target.value)} placeholder="Describe what you found, or enter Not applicable." /></label>
                  <label>Risks / resources<textarea value={currentAssessment.risks_resources} onChange={(event) => updateAssessment(report.id, 'risks_resources', event.target.value)} placeholder="Note remaining risks or resources, or Not applicable." /></label>
                </div>
                <fieldset className="responder-triage-choice">
                  <legend>People affected / urgency</legend>
                  <div className="responder-triage-options">
                    {([
                      ['safe', 'Safe', 'No injuries reported'],
                      ['mild_injuries', 'Mild injuries', 'Treated on site'],
                      ['severe_injuries', 'Severe injuries', 'Transport needed'],
                    ] as const).map(([value, label, detail]) => <label className={currentAssessment.triage_outcome === value ? 'selected' : ''} key={value}>
                      <input type="radio" name={`triage-${report.id}`} value={value} checked={currentAssessment.triage_outcome === value} onChange={() => setTriageOutcome(report.id, value)} />
                      <span><strong>{label}</strong><small>{detail}</small></span>
                    </label>)}
                  </div>
                </fieldset>
                <div className="responder-assessment-grid responder-assessment-grid-secondary">
                  <label>People affected / urgency<textarea value={currentAssessment.affected_people} onChange={(event) => updateAssessment(report.id, 'affected_people', event.target.value)} placeholder="Describe the impact, or enter Not applicable." /></label>
                  <label>Actions taken<textarea value={currentAssessment.actions_taken} onChange={(event) => updateAssessment(report.id, 'actions_taken', event.target.value)} placeholder="Describe response actions, or enter Not applicable." /></label>
                </div>
                <div className="responder-action-row">
                  <button className="workspace-secondary-action" type="button" disabled={saving || !currentAssessment.triage_outcome || [currentAssessment.situation, currentAssessment.affected_people, currentAssessment.actions_taken, currentAssessment.risks_resources].some((value) => !value.trim())} onClick={() => void perform(() => saveAssessment(report.id), 'Field assessment saved.')}><CheckCircle2 size={16} /> Save assessment</button>
                </div>
                <section className="responder-field-media-section" aria-label="Field media">
                  <div className="responder-field-media-preview">
                    {fieldMedia.length === 0 ? <span>No field media yet</span> : fieldMedia.map((media, index) => media.type === 'video'
                      ? <video key={media.id} src={media.url} controls preload="metadata" aria-label={`Field video ${index + 1}`} />
                      : <a key={media.id} href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt={`Field attachment ${index + 1}`} loading="lazy" /></a>)}
                  </div>
                  <label className="workspace-secondary-action upload-action"><Upload size={16} /> Add field media<input type="file" accept="image/*,video/*" multiple onChange={(event) => { uploadMedia(report, event.currentTarget.files); event.currentTarget.value = ''; }} /></label>
                </section>
                {currentAssessment.triage_outcome === 'severe_injuries' && currentAssessment.transport_status !== 'in_transit' && currentAssessment.transport_status !== 'delivered' && <button className="workspace-primary-action responder-transport-trigger" type="button" disabled={saving || !assessmentSaved} onClick={() => setTransportPickerOpen((current) => ({ ...current, [report.id]: !current[report.id] }))}>{transportPickerOpen[report.id] ? 'Hide transport destination' : 'Transport injured'}</button>}
                {currentAssessment.triage_outcome === 'severe_injuries' && (transportInProgress || currentAssessment.transport_status === 'delivered' || transportPickerOpen[report.id]) && <section className="responder-transport-panel" aria-label="Injured person transport">
                  <h4>Transport injured person</h4>
                  {transportInProgress ? <>
                    <p className="responder-transport-active">In transit to <strong>{currentAssessment.hospital_name}</strong></p>
                    {currentAssessment.hospital_address && <small>{currentAssessment.hospital_address}</small>}
                    <button className="workspace-primary-action" type="button" disabled={saving} onClick={() => completeTransport(report.id)}>Mark delivered</button>
                  </> : currentAssessment.transport_status === 'delivered' ? <p className="responder-transport-active">Delivered to <strong>{currentAssessment.hospital_name}</strong>.</p> : <>
                    {!assessmentSaved && <small>Save the severe injury assessment before selecting a destination.</small>}
                    <button className="workspace-secondary-action" type="button" disabled={saving || !assessmentSaved || Boolean(hospitalLoading[report.id])} onClick={() => void loadNearbyHospitals(report.id)}>{hospitalLoading[report.id] ? 'Finding hospitals…' : 'Show up to 10 nearest hospitals'}</button>
                    {(nearbyHospitals[report.id] || []).length > 0 && <div className="responder-hospital-options" role="list" aria-label="Nearest hospitals">
                      {(nearbyHospitals[report.id] || []).map((hospital) => <button type="button" role="listitem" className={selectedHospitals[report.id]?.name === hospital.name && selectedHospitals[report.id]?.latitude === hospital.latitude ? 'selected' : ''} key={`${hospital.name}:${hospital.latitude}:${hospital.longitude}`} onClick={() => setSelectedHospitals((current) => ({ ...current, [report.id]: hospital }))}>
                        <strong>{hospital.name}</strong><span>{hospital.address}</span><small>{hospital.distance_meters >= 1000 ? `${(hospital.distance_meters / 1000).toFixed(1)} km` : `${hospital.distance_meters} m`} away</small>
                      </button>)}
                    </div>}
                    <div className="responder-manual-hospital">
                      <label>Or enter the hospital requested by the affected person<input value={hospitalSearchQuery[report.id] || ''} onChange={(event) => setHospitalSearchQuery((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="Hospital name" /></label>
                      <button className="workspace-secondary-action" type="button" disabled={saving || !assessmentSaved || Boolean(hospitalLoading[report.id])} onClick={() => void searchHospitalByName(report.id)}>{hospitalLoading[report.id] ? 'Searching…' : 'Find hospital on map'}</button>
                    </div>
                    {(hospitalSearchResults[report.id] || []).length > 0 && <div className="responder-hospital-options" role="list" aria-label="Hospital name matches">
                      {(hospitalSearchResults[report.id] || []).map((hospital) => <button type="button" role="listitem" className={selectedHospitals[report.id]?.name === hospital.name && selectedHospitals[report.id]?.latitude === hospital.latitude ? 'selected' : ''} key={`${hospital.name}:${hospital.latitude}:${hospital.longitude}`} onClick={() => setSelectedHospitals((current) => ({ ...current, [report.id]: hospital }))}>
                        <strong>{hospital.name}</strong><span>{hospital.address}</span><small>{hospital.distance_meters >= 1000 ? `${(hospital.distance_meters / 1000).toFixed(1)} km` : `${hospital.distance_meters} m`} away</small>
                      </button>)}
                    </div>}
                    {selectedHospitals[report.id] && <div className="responder-hospital-selection"><span>Destination selected</span><strong>{selectedHospitals[report.id]?.name}</strong><button className="workspace-primary-action" type="button" disabled={saving} onClick={() => startTransport(report.id)}>Start transport</button></div>}
                  </>}
                </section>}
                <div className="responder-resolution-form"><label>Resolution summary<textarea value={resolutionSummary} onChange={(event) => setResolutionNotes((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="Summarize the outcome and enter Not applicable where needed." /></label><button className="workspace-primary-action" type="button" disabled={saving || !resolutionSummary.trim() || !canResolve} onClick={() => void perform(() => isBarangay ? reportAPI.closeBarangayAssignment(report.id, resolutionSummary) : reportAPI.closeMdrrmoReport(report.id, resolutionSummary), 'Incident response resolved.').then((saved) => { if (saved) setResolutionNotes((current) => ({ ...current, [report.id]: '' })); })}>Resolve incident</button>{!assessmentSaved && <small>Save the field assessment before resolving.</small>}{currentAssessment.triage_outcome === 'severe_injuries' && currentAssessment.transport_status !== 'delivered' && <small>Mark the injured person delivered before resolving.</small>}</div>
              </> : <div className="responder-transport-guidance">After you arrive, assess the people affected and record the field response before resolving.</div>}
            </section>}
            {isBarangay && !report.is_central_assignment && <div className="workspace-message">This historical barangay-originated case remains available here for reference.</div>}
          </article>;
        })}
      </div>}
      {locationMapReport && hasIncidentPin(locationMapReport) && <ResponderLocationMapModal
        latitude={Number(locationMapReport.latitude)}
        longitude={Number(locationMapReport.longitude)}
        locationName={locationPreviews[locationMapReport.id]?.road || locationPreviews[locationMapReport.id]?.landmark || formatIncidentLocation(locationMapReport)}
        onClose={closeLocationMap}
      />}
    </div>
  );
}
