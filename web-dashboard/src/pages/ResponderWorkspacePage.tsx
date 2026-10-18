import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, ClipboardList, MapPin, RefreshCw, ShieldAlert, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { reportAPI, respondUnitAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { createDemoResponderReport } from '../demoResponderReport';

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
  created_at?: string | null;
  response_status?: string | null;
  barangay_response_status?: string | null;
  assignment_status?: string | null;
  is_central_assignment?: boolean;
  barangay_arrived_at?: string | null;
  barangay_dispatched_at?: string | null;
  response_notes?: string | null;
  barangay_response_notes?: string | null;
  barangay_crew_members?: Array<{ member_id: string; member_name: string; crew_role: string }>;
  mdrrmo_arrived_at?: string | null;
  mdrrmo_assignments?: ResponseAssignment[];
  assigned_responder_ids?: string[];
  is_demo?: boolean;
};

const emptyAssessment = { situation: '', affected_people: '', actions_taken: '', risks_resources: '' };
type AssessmentField = keyof typeof emptyAssessment;

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
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      setReports(items);
      setAssessments(Object.fromEntries(items.map((report: AssignedReport) => [
        report.id,
        parseFieldAssessment(isBarangay
          ? report.barangay_response_notes || report.response_notes
          : report.response_notes || report.barangay_response_notes, isBarangay),
      ])));
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
      setResolutionNotes('');
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
    return isBarangay
      ? reportAPI.saveBarangayAssignmentFieldNotes(reportId, values)
      : reportAPI.saveMdrrmoFieldAssessment(reportId, values);
  };

  return (
    <div className="responder-workspace">
      <header className="responder-workspace-header">
        <div><span className="workspace-eyebrow">{isBarangay ? `BARANGAY RESPONSE · ${user?.barangay_name || 'YOUR BARANGAY'}` : 'MDRRMO FIELD RESPONSE'}</span><h1>My responses</h1><p>Assigned incidents and the updates needed to complete each response.</p></div>
        <button className="workspace-secondary-action" type="button" onClick={() => void loadWorkspace(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'workspace-spinning' : ''} /> Refresh</button>
      </header>
      <section className="resident-summary-grid" aria-label="Response summary">
        <article><span>Active assignments</span><strong>{activeReports.length}</strong></article>
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
          const assessmentSaved = savedAssessmentNotes.includes(isBarangay ? '[BARANGAY FIELD ASSESSMENT]' : '[MDRRMO FIELD ASSESSMENT]');
          const arrived = isBarangay
            ? Boolean(report.barangay_arrived_at)
            : Boolean(assignment ? assignment.arrived_at : report.mdrrmo_arrived_at);
          const canUpdateField = !report.is_demo && (isBarangay ? responseStatus === 'responding' : assignmentStatus === 'responding');
          const canManageCrew = !report.is_demo && !arrived && (isBarangay
            ? Boolean(report.is_central_assignment && report.barangay_dispatched_at && responseStatus === 'responding')
            : assignmentStatus === 'responding');
          const selectedCrewIds = crewDraftSelections[report.id] || [];
          const currentAssessment = assessments[report.id] || emptyAssessment;
          const selectedBarangayCrew = barangayCrewSelections[report.id] || [];
          const savedMdrrmoCrew = (assignment?.crew || []).filter((member) => member.member_role !== 'team_leader');
          const savedBarangayCrew = report.barangay_crew_members || [];
          const displayStatus = responseStatus === 'responding' ? 'Responding' : assignmentStatus === 'active' ? 'Assigned' : assignmentStatus || 'Assigned';
          return <article className="responder-report-card" key={report.id}>
            <header><div><span className="workspace-eyebrow">{report.is_demo ? 'DEMO ASSIGNMENT · ' : ''}{report.incident_type?.replaceAll('_', ' ') || 'Incident'}{report.severity ? ` · ${report.severity}` : ''}</span><h2>{report.title || 'Incident response'}</h2></div><span className={`resident-status ${responseStatus === 'responding' ? 'responding' : ''} ${report.is_demo ? 'demo' : ''}`}>{report.is_demo ? 'Demo preview' : displayStatus}</span></header>
            <p className="responder-report-description">{report.description || 'No incident details were provided.'}</p>
            <div className="resident-report-meta"><span><Activity size={14} /> {report.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.created_at)) : 'Time unavailable'}</span><span><MapPin size={14} /> {report.latitude != null && report.longitude != null ? `${Number(report.latitude).toFixed(5)}, ${Number(report.longitude).toFixed(5)}` : 'Location unavailable'}</span></div>

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
              {!arrived && <button className="workspace-secondary-action" type="button" disabled={saving} onClick={() => void perform(() => isBarangay ? reportAPI.arriveBarangayAssignment(report.id, { method: 'manual' }) : reportAPI.arriveAtMdrrmoIncident(report.id), 'Arrival recorded.')}>Record arrival</button>}
              <div className="responder-assessment-grid">
                <label>Situation<textarea value={currentAssessment.situation} onChange={(event) => updateAssessment(report.id, 'situation', event.target.value)} placeholder="Describe what you found, or enter Not applicable." /></label>
                <label>People affected / urgency<textarea value={currentAssessment.affected_people} onChange={(event) => updateAssessment(report.id, 'affected_people', event.target.value)} placeholder="Enter the impact, or Not applicable." /></label>
                <label>Actions taken<textarea value={currentAssessment.actions_taken} onChange={(event) => updateAssessment(report.id, 'actions_taken', event.target.value)} placeholder="Describe response actions, or enter Not applicable." /></label>
                <label>Risks / resources<textarea value={currentAssessment.risks_resources} onChange={(event) => updateAssessment(report.id, 'risks_resources', event.target.value)} placeholder="Note remaining risks or resources, or Not applicable." /></label>
              </div>
              <div className="responder-action-row">
                <button className="workspace-secondary-action" type="button" disabled={saving || Object.values(currentAssessment).some((value) => !value.trim())} onClick={() => void perform(() => saveAssessment(report.id), 'Field assessment saved.')}><CheckCircle2 size={16} /> Save assessment</button>
                <label className="workspace-secondary-action upload-action"><Upload size={16} /> Add field media<input type="file" accept="image/*,video/*" multiple onChange={(event) => { uploadMedia(report, event.currentTarget.files); event.currentTarget.value = ''; }} /></label>
              </div>
              {arrived && <div className="responder-resolution-form"><label>Resolution summary<textarea value={resolutionNotes} onChange={(event) => setResolutionNotes(event.target.value)} placeholder="Summarize the outcome and enter Not applicable where needed." /></label><button className="workspace-primary-action" type="button" disabled={saving || !resolutionNotes.trim() || !assessmentSaved} onClick={() => void perform(() => isBarangay ? reportAPI.closeBarangayAssignment(report.id, resolutionNotes) : reportAPI.closeMdrrmoReport(report.id, resolutionNotes), 'Incident response resolved.')}>Resolve incident</button>{!assessmentSaved && <small>Save the field assessment before resolving.</small>}</div>}
            </section>}
            {isBarangay && !report.is_central_assignment && <div className="workspace-message">This historical barangay-originated case remains available here for reference.</div>}
          </article>;
        })}
      </div>}
    </div>
  );
}
