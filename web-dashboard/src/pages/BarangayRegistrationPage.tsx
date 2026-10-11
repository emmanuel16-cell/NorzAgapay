import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, MailCheck } from 'lucide-react';
import PublicHeader from '../components/PublicHeader';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../lib/api';

type BarangayOption = { id: string; name: string; municipality?: string };
type RegistrationForm = { full_name: string; email: string; phone: string; barangay_id: string; position_designation: string };
const initialForm: RegistrationForm = { full_name: '', email: '', phone: '', barangay_id: '', position_designation: '' };

export default function BarangayRegistrationPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegistrationForm>(initialForm);
  const [barangays, setBarangays] = useState<BarangayOption[]>([]);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    authAPI.barangaysForAdminSignup()
      .then(({ data }) => {
        const rows = Array.isArray(data) ? data : [];
        setBarangays(rows);
        if (rows.length) setForm((current) => ({ ...current, barangay_id: current.barangay_id || rows[0].id }));
      })
      .catch((loadError: any) => setError(loadError?.response?.data?.error || 'Eligible barangays could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  const sendCode = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault(); setError(''); setMessage(''); setSaving(true);
    try {
      const { data } = await authAPI.sendBarangayRegistrationOtp({
        full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim(),
        barangay_id: form.barangay_id, position_designation: form.position_designation.trim(),
      });
      setOtpSent(true);
      setMessage(data.message || `A verification code was sent to ${form.email}.`);
    } catch (sendError: any) { setError(sendError?.response?.data?.error || 'The verification code could not be sent.'); }
    finally { setSaving(false); }
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const { data } = await authAPI.verifyBarangayRegistrationOtp(form.email.trim(), otp.trim());
      setSession(data.token, data.user, 'barangay');
      navigate('/barangay-settings', { replace: true });
    } catch (verifyError: any) { setError(verifyError?.response?.data?.error || 'The account could not be verified.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="public-login-page">
      <PublicHeader />
      <main className="barangay-registration-main">
        <section className="barangay-registration-card">
          <Link className="barangay-registration-back" to="/login"><ArrowLeft size={16} /> Back to sign in</Link>
          <div className="barangay-registration-mark">{otpSent ? <MailCheck size={25} /> : <BadgeCheck size={25} />}</div>
          <span className="workspace-eyebrow">BARANGAY ACCOUNT</span>
          <h1>{otpSent ? 'Verify your email' : 'Create a barangay administrator account'}</h1>
          <p className="barangay-registration-intro">{otpSent ? `Enter the 6-digit code sent to ${form.email}. The code expires after 10 minutes.` : 'This creates the first administrator account for an eligible barangay. MDRRMO must review the signed Barangay Account Request before operational access is activated.'}</p>
          {error && <div className="barangay-registration-error" role="alert">{error}</div>}
          {message && <div className="barangay-registration-message" role="status">{message}</div>}

          {!otpSent ? <form className="barangay-registration-form" onSubmit={(event) => void sendCode(event)}>
            <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} /></label>
            <label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
            <label>Mobile number <span>(optional)</span><input type="tel" maxLength={30} autoComplete="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="09XXXXXXXXX" /></label>
            <label>Barangay<select required value={form.barangay_id} disabled={loading || barangays.length === 0} onChange={(event) => setForm((current) => ({ ...current, barangay_id: event.target.value }))}>{loading && <option value="">Loading eligible barangays…</option>}{!loading && barangays.length === 0 && <option value="">No eligible barangays available</option>}{barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}</option>)}</select></label>
            <label>Official designation<input required minLength={2} maxLength={120} value={form.position_designation} onChange={(event) => setForm((current) => ({ ...current, position_designation: event.target.value }))} placeholder="e.g. Barangay Administrator" /></label>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving || loading || barangays.length === 0}>{saving ? 'Sending code…' : 'Send email verification code'}</button>
          </form> : <form className="barangay-registration-form" onSubmit={(event) => void verify(event)}>
            <label>6-digit verification code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></label>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving || otp.length !== 6}>{saving ? 'Verifying…' : 'Verify and create account'}</button>
            <button className="barangay-registration-secondary" type="button" disabled={saving} onClick={() => { setOtpSent(false); setOtp(''); setMessage(''); setError(''); }}>Change registration details</button>
            <button className="barangay-registration-secondary" type="button" disabled={saving} onClick={() => void sendCode()}>Send another code</button>
          </form>}
          <p className="barangay-registration-footnote">Account creation does not activate barangay dispatch access. The signed authorization document still requires MDRRMO review.</p>
        </section>
      </main>
    </div>
  );
}
