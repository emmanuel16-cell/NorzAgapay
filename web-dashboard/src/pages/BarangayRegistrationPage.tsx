import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Phone } from 'lucide-react';
import PublicHeader from '../components/PublicHeader';
import MobileNumberInput from '../components/MobileNumberInput';
import PasswordInput from '../components/PasswordInput';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../lib/api';
import { formatMobileNumber, isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';

type BarangayOption = { id: string; name: string; municipality?: string };
type RegistrationForm = { full_name: string; phone: string; password: string; barangay_id: string; position_designation: string };
const initialForm: RegistrationForm = { full_name: '', phone: '', password: '', barangay_id: '', position_designation: '' };

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
      const phone = normalizeMobileNumberInput(form.phone);
      if (!isValidMobileNumber(phone)) throw new Error('Enter exactly 11 digits starting with 09.');
      const { data } = await authAPI.sendBarangayRegistrationOtp({
        full_name: form.full_name.trim(), phone, password: form.password,
        barangay_id: form.barangay_id, position_designation: form.position_designation.trim(),
      });
      setOtpSent(true);
      setMessage(data.message || `A verification code was sent to ${formatMobileNumber(phone)}.`);
    } catch (sendError: any) { setError(sendError?.response?.data?.error || sendError?.message || 'The verification code could not be sent.'); }
    finally { setSaving(false); }
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const { data } = await authAPI.verifyBarangayRegistrationOtp({ phone: normalizeMobileNumberInput(form.phone), otp: otp.trim() });
      setSession(data.token, data.user, 'barangay');
      navigate('/barangay-settings', { replace: true });
    } catch (verifyError: any) { setError(verifyError?.response?.data?.error || 'The account could not be verified.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="public-login-page barangay-registration-page">
      <PublicHeader />
      <main className="barangay-registration-main">
        <section className="barangay-registration-card">
          <Link className="barangay-registration-back" to="/login"><ArrowLeft size={16} /> Back to sign in</Link>
          <div className="barangay-registration-mark"><BadgeCheck size={25} /></div>
          <span className="workspace-eyebrow">BARANGAY ACCOUNT</span>
          <h1>{otpSent ? 'Verify your mobile number' : 'Create a barangay administrator account'}</h1>
          <p className="barangay-registration-intro">{otpSent ? `Enter the 6-digit code sent to ${formatMobileNumber(form.phone)}. The code expires after 10 minutes.` : 'Create your account with a mobile number and password. MDRRMO must review the signed Barangay Account Request before operational access is activated.'}</p>
          {error && <div className="barangay-registration-error" role="alert">{error}</div>}
          {message && <div className="barangay-registration-message" role="status">{message}</div>}
          {!otpSent ? <form className="barangay-registration-form" onSubmit={(event) => void sendCode(event)}>
            <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} /></label>
            <label>Mobile number <MobileNumberInput value={form.phone} onValueChange={(phone) => setForm((current) => ({ ...current, phone }))} placeholder="09XXXXXXXXX" required /></label>
            <label>Password<PasswordInput required minLength={8} maxLength={128} autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></label>
            <label>Barangay<select required value={form.barangay_id} disabled={loading || barangays.length === 0} onChange={(event) => setForm((current) => ({ ...current, barangay_id: event.target.value }))}>{loading && <option value="">Loading eligible barangays…</option>}{!loading && barangays.length === 0 && <option value="">No eligible barangays available</option>}{barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}</option>)}</select></label>
            <label>Official designation<input required minLength={2} maxLength={120} value={form.position_designation} onChange={(event) => setForm((current) => ({ ...current, position_designation: event.target.value }))} placeholder="e.g. Barangay Administrator" /></label>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving || loading || barangays.length === 0}><Phone size={16} /> {saving ? 'Sending code…' : 'Send SMS verification code'}</button>
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
