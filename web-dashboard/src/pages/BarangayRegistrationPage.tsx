import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, MailCheck } from 'lucide-react';
import PublicHeader from '../components/PublicHeader';
import MobileNumberInput from '../components/MobileNumberInput';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../lib/api';
import { formatMobileNumber, isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';

type BarangayOption = { id: string; name: string; municipality?: string };
type RegistrationForm = { full_name: string; username: string; email: string; phone: string; delivery_method: 'email' | 'sms'; barangay_id: string; position_designation: string };
const initialForm: RegistrationForm = { full_name: '', username: '', email: '', phone: '', delivery_method: 'sms', barangay_id: '', position_designation: '' };

export default function BarangayRegistrationPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegistrationForm>(initialForm);
  const [barangays, setBarangays] = useState<BarangayOption[]>([]);
  const [otp, setOtp] = useState('');
  const [otpDeliveryMethod, setOtpDeliveryMethod] = useState<'email' | 'sms'>('sms');
  const [otpDestination, setOtpDestination] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const hasEmail = Boolean(form.email.trim());
  const hasPhone = Boolean(form.phone.trim());
  const selectedDeliveryMethod = hasEmail && hasPhone
    ? form.delivery_method
    : hasEmail ? 'email' : 'sms';

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
      const email = form.email.trim().toLowerCase();
      const phone = normalizeMobileNumberInput(form.phone);
      if (form.phone && !isValidMobileNumber(phone)) throw new Error('Enter exactly 11 digits starting with 09.');
      if (!email && !phone) throw new Error('Enter an email address or mobile number to receive a verification code.');
      const deliveryMethod = selectedDeliveryMethod;
      const destination = deliveryMethod === 'email' ? email : phone;
      const { data } = await authAPI.sendBarangayRegistrationOtp({
        full_name: form.full_name.trim(), username: form.username.trim(), email: email || undefined, phone: phone || undefined,
        delivery_method: deliveryMethod,
        barangay_id: form.barangay_id, position_designation: form.position_designation.trim(),
      });
      setOtpSent(true);
      setOtpDeliveryMethod(deliveryMethod);
      setOtpDestination(destination);
      setMessage(data.message || `A verification code was sent to ${destination}.`);
    } catch (sendError: any) { setError(sendError?.response?.data?.error || sendError?.message || 'The verification code could not be sent.'); }
    finally { setSaving(false); }
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const { data } = await authAPI.verifyBarangayRegistrationOtp({ delivery_method: otpDeliveryMethod, destination: otpDestination, otp: otp.trim() });
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
          <div className="barangay-registration-mark">{otpSent ? <MailCheck size={25} /> : <BadgeCheck size={25} />}</div>
          <span className="workspace-eyebrow">BARANGAY ACCOUNT</span>
          <h1>{otpSent ? `Verify your ${otpDeliveryMethod === 'sms' ? 'mobile number' : 'email'}` : 'Create a barangay administrator account'}</h1>
          <p className="barangay-registration-intro">{otpSent ? `Enter the 6-digit code sent to ${otpDeliveryMethod === 'sms' ? formatMobileNumber(otpDestination) : otpDestination}. The code expires after 10 minutes.` : 'This creates the first administrator account for an eligible barangay. MDRRMO must review the signed Barangay Account Request before operational access is activated.'}</p>
          {error && <div className="barangay-registration-error" role="alert">{error}</div>}
          {message && <div className="barangay-registration-message" role="status">{message}</div>}

          {!otpSent ? <form className="barangay-registration-form" onSubmit={(event) => void sendCode(event)}>
            <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} /></label>
            <label>Username<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" title="Use 3–32 letters, numbers, dots, underscores, or hyphens." autoComplete="username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="Choose a username" /></label>
            <label>Email address<input type="email" autoComplete="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
            <label>Mobile number <MobileNumberInput value={form.phone} onValueChange={(phone) => setForm((current) => ({ ...current, phone }))} placeholder="09XXXXXXXXX" /></label>
            <small className="barangay-registration-contact-hint"><strong>At least one contact method is required.</strong> If you enter both, choose where to receive your verification code.</small>
            {hasEmail && hasPhone && <label>Send verification code by<select value={form.delivery_method} onChange={(event) => setForm((current) => ({ ...current, delivery_method: event.target.value as 'email' | 'sms' }))}><option value="sms">Mobile SMS</option><option value="email">Email</option></select></label>}
            <label>Barangay<select required value={form.barangay_id} disabled={loading || barangays.length === 0} onChange={(event) => setForm((current) => ({ ...current, barangay_id: event.target.value }))}>{loading && <option value="">Loading eligible barangays…</option>}{!loading && barangays.length === 0 && <option value="">No eligible barangays available</option>}{barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}</option>)}</select></label>
            <label>Official designation<input required minLength={2} maxLength={120} value={form.position_designation} onChange={(event) => setForm((current) => ({ ...current, position_designation: event.target.value }))} placeholder="e.g. Barangay Administrator" /></label>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving || loading || barangays.length === 0}>{saving ? 'Sending code…' : `Send ${selectedDeliveryMethod === 'sms' ? 'SMS' : 'email'} verification code`}</button>
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
