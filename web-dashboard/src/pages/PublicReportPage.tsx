import { useEffect, useState, type FormEvent } from 'react';
import { MapPin, Phone, Siren, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';
import { reportAPI } from '../lib/api';

type HotlineGroup = {
  barangay_name: string;
  entries: Array<{ label?: string; name?: string; phone?: string; number?: string; numbers?: string[]; purpose?: string }>;
};
type PublicHotlines = {
  national: Array<{ label: string; phone: string }>;
  mdrrmo: Array<{ label: string; phone: string; email?: string }>;
  barangays: HotlineGroup[];
};

const emptyHotlines: PublicHotlines = { national: [], mdrrmo: [], barangays: [] };

export default function PublicReportPage() {
  const [hotlines, setHotlines] = useState<PublicHotlines>(emptyHotlines);
  const [guestPhone, setGuestPhone] = useState('');
  const [sendTo, setSendTo] = useState<'barangay' | 'mdrrmo'>('mdrrmo');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [evidence, setEvidence] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    reportAPI.publicHotlines()
      .then((response) => {
        const data = response.data || {};
        setHotlines({
          national: Array.isArray(data.national) ? data.national : [],
          mdrrmo: Array.isArray(data.mdrrmo) ? data.mdrrmo : [],
          barangays: Array.isArray(data.barangays) ? data.barangays : [],
        });
      })
      .catch(() => setHotlines({ ...emptyHotlines, national: [{ label: 'National Emergency Hotline', phone: '911' }] }));
  }, []);

  const requestLocation = () => {
    setMessage('');
    setSubmitted(false);
    if (!navigator.geolocation) { setMessage('This browser cannot read your location.'); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => setMessage('Allow location access or try again from the incident location.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setSubmitted(false);
    const phone = guestPhone.replace(/\D/g, '');
    if (!/^09\d{9}$/.test(phone)) { setMessage('Enter an 11-digit mobile number starting with 09.'); return; }
    if (!location) { setMessage('Add the incident location before submitting.'); return; }
    if (description.trim().length < 8) { setMessage('Describe the incident in at least 8 characters.'); return; }
    setBusy(true);
    try {
      await reportAPI.guestReport({
        type: 'emergency', title: 'Resident Incident Report', description: description.trim(),
        latitude: location.latitude, longitude: location.longitude, contact_number: phone, send_to: sendTo,
      }, evidence);
      setDescription('');
      setGuestPhone('');
      setLocation(null);
      setEvidence(null);
      const input = document.getElementById('public-report-evidence') as HTMLInputElement | null;
      if (input) input.value = '';
      setSubmitted(true);
      setMessage(sendTo === 'barangay'
        ? 'Report sent to the closest active barangay. It can be escalated to MDRRMO if more support is needed.'
        : 'Report sent to MDRRMO for review. A dispatcher can assign it to a nearby active barangay.');
    } catch (error: any) {
      setMessage(error?.response?.data?.error || 'The report could not be submitted. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-report-page">
      <PublicHeader />
      <main className="public-report-layout">
        <div className="public-report-intro">
          <span className="public-home-eyebrow">PUBLIC INCIDENT REPORTING</span>
          <h1>Tell us what is happening.</h1>
          <p>Share a mobile number, incident location, and clear details. Choose whether the closest active barangay or MDRRMO should receive the report.</p>
          <p className="public-report-login-note">Already have an operations account? <Link to="/login">Log in to the command center</Link>.</p>
        </div>
        <div className="public-report-content-grid">
          <section className="public-intake-panel" aria-labelledby="public-report-title">
            <div className="public-intake-heading"><span><Siren size={19} /></span><div><h2 id="public-report-title">Report an incident</h2><p>No account is needed to submit a report.</p></div></div>
            <form className="public-report-form" onSubmit={(event) => void submitReport(event)}>
              <label htmlFor="public-report-phone">Mobile number <b>Required</b></label>
              <input id="public-report-phone" type="tel" inputMode="numeric" autoComplete="tel" pattern="09[0-9]{9}" title="Enter an 11-digit mobile number starting with 09." maxLength={11} placeholder="09XXXXXXXXX" value={guestPhone} onChange={(event) => setGuestPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} required />
              <label htmlFor="public-report-description">Incident details <b>Required</b></label>
              <textarea id="public-report-description" rows={5} minLength={8} maxLength={2000} placeholder="Describe what happened and who needs help…" value={description} onChange={(event) => setDescription(event.target.value)} required />
              <span className="public-report-field-label">Incident location <b>Required</b></span>
              <button className={'public-location-button ' + (location ? 'located' : '')} type="button" onClick={requestLocation} aria-describedby="public-report-location-status">
                <MapPin size={16} aria-hidden="true" />{location ? 'Update incident location' : 'Add current incident location'}
              </button>
              <span id="public-report-location-status" className="public-report-location-status" aria-live="polite">{location ? `Location attached · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'Use the device at the incident location to add a map pin.'}</span>
              <fieldset className="public-report-routing" disabled={busy}>
                <legend>Send report to</legend>
                <label><input type="radio" name="public-report-recipient" value="barangay" checked={sendTo === 'barangay'} onChange={() => setSendTo('barangay')} /><span><strong>Closest barangay</strong><small>Based on the incident location. The barangay can escalate to MDRRMO.</small></span></label>
                <label><input type="radio" name="public-report-recipient" value="mdrrmo" checked={sendTo === 'mdrrmo'} onChange={() => setSendTo('mdrrmo')} /><span><strong>MDRRMO</strong><small>A dispatcher can assign the report to a nearby active barangay.</small></span></label>
              </fieldset>
              <label className="public-evidence-label" htmlFor="public-report-evidence"><Upload size={15} aria-hidden="true" /> Add photo or video <span>(optional)</span></label>
              <input id="public-report-evidence" type="file" accept="image/*,video/*" onChange={(event) => setEvidence(event.target.files?.[0] || null)} />
              {message && <p className={submitted ? 'public-report-success' : 'public-report-error'} role="status">{message}</p>}
              <button type="submit" className="btn btn-primary btn-lg public-report-submit" disabled={busy}>{busy ? 'Sending report…' : `Send report to ${sendTo === 'barangay' ? 'closest barangay' : 'MDRRMO'}`}</button>
            </form>
          </section>
          <aside className="public-hotlines-panel" aria-labelledby="public-hotlines-title">
            <div className="public-hotlines-heading"><span><Phone size={18} aria-hidden="true" /></span><div><h2 id="public-hotlines-title">Emergency hotlines</h2><p>Call directly if you need immediate assistance.</p></div></div>
            <div className="public-hotline-list">
              {[...(hotlines.national || []), ...(hotlines.mdrrmo || [])].map((line, index) => <a key={`${line.phone}-${index}`} href={`tel:${line.phone}`}><span>{line.label}</span><strong>{line.phone}</strong></a>)}
              {(hotlines.barangays || []).map((group) => group.entries.flatMap((line, index) => {
                const phones = [line.phone, line.number, ...(line.numbers || [])].filter((phone): phone is string => Boolean(phone));
                return phones.map((phone, numberIndex) => <a key={`${group.barangay_name}-${phone}-${index}-${numberIndex}`} href={`tel:${phone}`}><span>{line.label || line.name || line.purpose || group.barangay_name} · Brgy. {group.barangay_name}</span><strong>{phone}</strong></a>);
              }))}
              {hotlines.national.length === 0 && hotlines.mdrrmo.length === 0 && hotlines.barangays.length === 0 && <p className="public-hotlines-empty">Hotline information is not available right now.</p>}
            </div>
            {hotlines.mdrrmo?.[0]?.email && <a className="public-hotline-email" href={`mailto:${hotlines.mdrrmo[0].email}`}>{hotlines.mdrrmo[0].email}</a>}
          </aside>
        </div>
      </main>
    </div>
  );
}
