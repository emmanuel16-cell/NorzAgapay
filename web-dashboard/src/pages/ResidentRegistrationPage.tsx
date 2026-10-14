import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCopy, KeyRound, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PublicHeader from '../components/PublicHeader';
import { authAPI } from '../lib/api';

type RegistrationResult = {
  token: string;
  temporaryPassword: string;
  user: { id: string; full_name: string; username: string | null; email: string | null; phone: string | null; role: string; status: string; verified: boolean; barangay_name?: string };
};

const errorMessage = (error: any) => error?.response?.data?.error || 'Resident registration could not be completed. Please try again.';

export default function ResidentRegistrationPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [step, setStep] = useState<'details' | 'verify' | 'password'>('details');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const requestCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const response = await authAPI.requestResidentWebRegistrationOtp({ username: username.trim(), phone });
      setNotice(response.data.message || 'A verification code was sent to your mobile number.');
      setStep('verify');
    } catch (requestError: any) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await authAPI.verifyResidentWebRegistrationOtp({ phone, otp });
      setResult(response.data as RegistrationResult);
      setStep('password');
    } catch (verifyError: any) {
      setError(errorMessage(verifyError));
    } finally {
      setLoading(false);
    }
  };

  const copyPassword = async () => {
    if (!result?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('Clipboard access is unavailable. Select and copy the temporary password manually.');
    }
  };

  const proceed = () => {
    if (!result) return;
    setSession(result.token, result.user, 'resident');
    navigate('/my-reports', { replace: true });
  };

  return (
    <div className="public-login-page resident-registration-page">
      <PublicHeader />
      <main className="login-page public-login-main resident-register-main">
        <section className="login-card resident-register-card" aria-labelledby="resident-register-title">
          {step !== 'password' ? <img className="login-emblem" src="/NA-icon.png" alt="Norz-Agapay" /> : <div className="resident-register-success-icon"><CheckCircle2 size={28} /></div>}
          {step === 'details' && <>
            <h1 className="login-title" id="resident-register-title">Create a resident account</h1>
            <p className="login-subtitle">Verify your mobile number to set up your account.</p>
            <div className="resident-register-steps" aria-label="Step 1 of 3"><span className="current">1</span><i /><span>2</span><i /><span>3</span></div>
            {error && <div className="resident-register-error" role="alert">{error}</div>}
            <form onSubmit={(event) => void requestCode(event)}>
              <div className="form-group"><label className="form-label" htmlFor="resident-register-username">Username</label><div className="resident-register-input-wrap"><UserRound size={17} /><input id="resident-register-username" className="form-input" autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]{3,32}" title="Use 3–32 letters, numbers, dots, underscores, or hyphens." value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Choose a username" required /></div><small>3–32 letters, numbers, dots, underscores, or hyphens.</small></div>
              <div className="form-group"><label className="form-label" htmlFor="resident-register-phone">Mobile number</label><div className="resident-register-input-wrap"><Phone size={17} /><input id="resident-register-phone" className="form-input" type="tel" inputMode="numeric" autoComplete="tel" pattern="09[0-9]{9}" maxLength={11} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="09XXXXXXXXX" required /></div><small>We’ll text a one-time verification code to this number.</small></div>
              <button type="submit" className="btn btn-primary btn-lg resident-register-submit" disabled={loading}><Phone size={17} /> {loading ? 'Sending code…' : 'Send verification code'}</button>
            </form>
          </>}

          {step === 'verify' && <>
            <h1 className="login-title" id="resident-register-title">Verify your mobile</h1>
            <p className="login-subtitle">Enter the 6-digit code sent to <strong>{phone}</strong>. It expires in 10 minutes.</p>
            <div className="resident-register-steps" aria-label="Step 2 of 3"><span className="complete">✓</span><i className="complete" /><span className="current">2</span><i /><span>3</span></div>
            {notice && <div className="resident-register-notice" role="status">{notice}</div>}
            {error && <div className="resident-register-error" role="alert">{error}</div>}
            <form onSubmit={(event) => void verifyCode(event)}>
              <div className="form-group"><label className="form-label" htmlFor="resident-register-otp">Verification code</label><input id="resident-register-otp" className="form-input resident-register-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required /></div>
              <button type="submit" className="btn btn-primary btn-lg resident-register-submit" disabled={loading}><ShieldCheck size={17} /> {loading ? 'Verifying…' : 'Verify and create account'}</button>
            </form>
            <button type="button" className="login-setup-toggle resident-register-back" onClick={() => { setStep('details'); setError(''); setNotice(''); }}>Change username or number</button>
          </>}

          {step === 'password' && result && <>
            <h1 className="login-title" id="resident-register-title">Your account is ready</h1>
            <p className="login-subtitle">Save this temporary password. You’ll use it to sign in again.</p>
            <div className="resident-register-steps" aria-label="Step 3 of 3"><span className="complete">✓</span><i className="complete" /><span className="complete">✓</span><i className="complete" /><span className="current">3</span></div>
            <div className="resident-register-credential"><div><span>Username</span><strong>{result.user.username || username}</strong></div><div className="resident-register-password-row"><div><span>Temporary password</span><code>{result.temporaryPassword}</code></div><button type="button" className="workspace-secondary-action" onClick={() => void copyPassword()}><ClipboardCopy size={16} /> {copied ? 'Copied' : 'Copy'}</button></div></div>
            {error && <div className="resident-register-error" role="alert">{error}</div>}
            <button type="button" className="btn btn-primary btn-lg resident-register-submit" onClick={proceed}><KeyRound size={17} /> Proceed to your account <ArrowRight size={17} /></button>
          </>}

          <Link className="resident-register-signin" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
        </section>
      </main>
    </div>
  );
}
