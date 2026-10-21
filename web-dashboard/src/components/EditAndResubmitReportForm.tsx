import { useState, type FormEvent } from 'react';
import { AlertCircle, Send, X } from 'lucide-react';
import { reportAPI } from '../lib/api';
import { INCIDENT_SEVERITY_OPTIONS, INCIDENT_TYPE_OPTIONS } from '../lib/incidentClassification';
import CameraEvidenceCapture from './CameraEvidenceCapture';

export type EditableIncidentReport = {
  id: string;
  title?: string | null;
  incident_type?: string | null;
  severity?: string | null;
  description?: string | null;
  specifics?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  incident_occurred_at?: string | null;
  incident_time_precision?: string | null;
  proof_url?: string | null;
  proof_type?: string | null;
  proof_urls?: string[] | null;
  proof_types?: string[] | null;
};

function toLocalDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function EditAndResubmitReportForm({
  report,
  guestPhone,
  onCancel,
  onSubmitted,
}: {
  report: EditableIncidentReport;
  guestPhone?: string;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const [title, setTitle] = useState(report.title || 'Incident report');
  const [incidentType, setIncidentType] = useState(INCIDENT_TYPE_OPTIONS.some((item) => item.value === report.incident_type) ? report.incident_type! : 'not_sure');
  const [severity, setSeverity] = useState(INCIDENT_SEVERITY_OPTIONS.some((item) => item.value === report.severity) ? report.severity! : 'moderate');
  const [description, setDescription] = useState(report.description || '');
  const [specifics, setSpecifics] = useState(report.specifics || '');
  const [address, setAddress] = useState(report.address || '');
  const [latitude, setLatitude] = useState(report.latitude == null ? '' : String(report.latitude));
  const [longitude, setLongitude] = useState(report.longitude == null ? '' : String(report.longitude));
  const [occurredAt, setOccurredAt] = useState(toLocalDateTime(report.incident_occurred_at));
  const [timePrecision, setTimePrecision] = useState(['exact', 'approximate'].includes(report.incident_time_precision || '') ? report.incident_time_precision! : 'unknown');
  const urls = [...(report.proof_urls || [])].filter(Boolean);
  if (!urls.length && report.proof_url) urls.push(report.proof_url);
  const [keptUrls, setKeptUrls] = useState(() => new Set(urls));
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const body = new FormData();
      body.append('type', 'emergency');
      body.append('title', title.trim());
      body.append('incident_type', incidentType);
      body.append('severity', severity);
      body.append('description', description.trim());
      body.append('specifics', specifics.trim());
      body.append('address', address.trim());
      body.append('latitude', latitude);
      body.append('longitude', longitude);
      body.append('incident_occurred_at', timePrecision !== 'unknown' && occurredAt ? new Date(occurredAt).toISOString() : '');
      body.append('incident_time_precision', timePrecision);
      body.append('kept_proof_urls', JSON.stringify(urls.filter((url) => keptUrls.has(url))));
      body.append('request_id', requestId);
      if (guestPhone) body.append('contact_number', guestPhone);
      files.forEach((file) => body.append('proof', file));
      await reportAPI.resubmit(report.id, body);
      onSubmitted();
    } catch (submitError: any) {
      setError(submitError?.response?.data?.error || 'The report could not be resubmitted. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return <form className="report-resubmit-form" onSubmit={(event) => void submit(event)}>
    <header><div><span className="workspace-eyebrow">CORRECT YOUR REPORT</span><h3>Edit and resubmit</h3><p>Your report will return to MDRRMO review under the same reference.</p></div><button type="button" aria-label="Cancel editing" onClick={onCancel} disabled={submitting}><X size={18} /></button></header>
    <div className="report-resubmit-grid">
      <label className="wide">Report title<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={180} required /></label>
      <label>Incident category<select value={incidentType} onChange={(event) => setIncidentType(event.target.value)}>{INCIDENT_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Severity<select value={severity} onChange={(event) => setSeverity(event.target.value)}>{INCIDENT_SEVERITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="wide">Incident details<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={4} /></label>
      {incidentType === 'other' && <label className="wide">Other emergency details<textarea value={specifics} onChange={(event) => setSpecifics(event.target.value)} maxLength={1000} rows={2} /></label>}
      <label className="wide">Address or landmark<input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={300} /></label>
      <label>Latitude<input type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} required /></label>
      <label>Longitude<input type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} required /></label>
      <label>Incident time precision<select value={timePrecision} onChange={(event) => { setTimePrecision(event.target.value); if (event.target.value === 'unknown') setOccurredAt(''); }}><option value="unknown">Unknown</option><option value="exact">Exact</option><option value="approximate">Approximate</option></select></label>
      <label>Incident date and time<input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} disabled={timePrecision === 'unknown'} /></label>
    </div>
    <fieldset className="report-resubmit-evidence"><legend>Photo or video evidence</legend>
      {urls.length > 0 && <div className="report-resubmit-kept">{urls.map((url, index) => <label key={`${url}-${index}`}><input type="checkbox" checked={keptUrls.has(url)} onChange={() => setKeptUrls((current) => { const next = new Set(current); if (next.has(url)) next.delete(url); else next.add(url); return next; })} /><span>Keep existing attachment {index + 1}</span></label>)}</div>}
      <CameraEvidenceCapture files={files} onFilesChange={setFiles} />
    </fieldset>
    {error && <p className="report-resubmit-error" role="alert"><AlertCircle size={16} />{error}</p>}
    <footer><button type="button" className="workspace-secondary-action" onClick={onCancel} disabled={submitting}>Cancel</button><button type="submit" className="workspace-primary-action" disabled={submitting}>{submitting ? 'Resubmitting…' : <><Send size={15} /> Resubmit report</>}</button></footer>
  </form>;
}
