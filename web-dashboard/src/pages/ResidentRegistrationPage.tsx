import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Phone, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PublicHeader from '../components/PublicHeader';
import MobileNumberInput from '../components/MobileNumberInput';
import PasswordInput from '../components/PasswordInput';
import { authAPI } from '../lib/api';
import { formatMobileNumber, isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';

const errorMessage = (error: any) => error?.response?.data?.error || 'Resident registration could not be completed. Please try again.';

export default function ResidentRegistrationPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [step, setStep] = useState<'details' | 'verify'>('details');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const requestCode = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setError('');
    setNotice('');
    if (!isValidMobileNumber(phone)) { setError('Enter exactly 11 digits starting with 09.'); return; }
    setLoading(true);
    try {
      const response = await authAPI.requestResidentWebRegistrationOtp({
        full_name: fullName.trim(),
        phone: normalizeMobileNumberInput(phone),
        password,
      });
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
      const response = await authAPI.verifyResidentWebRegistrationOtp({ phone: normalizeMobileNumberInput(phone), otp });
      setSession(response.data.token, response.data.user, 'resident');
      navigate('/my-reports', { replace: true });
    } catch (verifyError: any) {
      setError(errorMessage(verifyError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="public-login-page resident-registration-page">
      <PublicHeader />
      <main className="login-page public-login-main resident-register-main">
        <section className="login-card resident-register-card" aria-labelledby="resident-register-title">
          <img className="login-emblem" src="/NA-icon.png" alt="Norz-Agapay" />
          <h1 className="login-title" id="resident-register-title">{step === 'details' ? 'Create a resident account' : 'Verify your mobile'}</h1>
          <p className="login-subtitle">{step === 'details' ? 'Choose a password and verify your mobile number to create your account.' : <>Enter the 6-digit code sent to <strong>{formatMobileNumber(phone)}</strong>. It expires in 10 minutes.</>}</p>
          <div className="resident-register-steps" aria-label={step === 'details' ? 'Step 1 of 2' : 'Step 2 of 2'}><span className={step === 'details' ? 'current' : 'complete'}>{step === 'details' ? '1' : '✓'}</span><i className={step === 'verify' ? 'complete' : ''} /><span className={step === 'verify' ? 'current' : ''}>2</span></div>
          {notice && <div className="resident-register-notice" role="status">{notice}</div>}
          {error && <div className="resident-register-error" role="alert">{error}</div>}
          {step === 'details' ? <form onSubmit={(event) => void requestCode(event)}>
            <div className="form-group"><label className="form-label" htmlFor="resident-register-name">Full name</label><input id="resident-register-name" className="form-input" autoComplete="name" minLength={2} maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} required /></div>
            <div className="form-group"><label className="form-label" htmlFor="resident-register-phone">Mobile number</label><div className="resident-register-input-wrap"><Phone size={17} /><MobileNumberInput id="resident-register-phone" className="form-input" value={phone} onValueChange={setPhone} placeholder="09XXXXXXXXX" required /></div></div>
            <div className="form-group"><label className="form-label" htmlFor="resident-register-password">Password</label><PasswordInput id="resident-register-password" className="form-input" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
            <button type="submit" className="btn btn-primary btn-lg resident-register-submit" disabled={loading}><Phone size={17} /> {loading ? 'Sending code…' : 'Send verification code'}</button>
          </form> : <form onSubmit={(event) => void verifyCode(event)}>
            <div className="form-group"><label className="form-label" htmlFor="resident-register-otp">Verification code</label><input id="resident-register-otp" className="form-input resident-register-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required /></div>
            <button type="submit" className="btn btn-primary btn-lg resident-register-submit" disabled={loading}><ShieldCheck size={17} /> {loading ? 'Verifying…' : 'Verify and create account'} <ArrowRight size={17} /></button>
            <button type="button" className="login-setup-toggle resident-register-back" onClick={() => { setStep('details'); setError(''); setNotice(''); }}>Change registration details</button>
            <button type="button" className="login-setup-toggle resident-register-back" disabled={loading} onClick={() => void requestCode()}>Send another code</button>
          </form>}
          <Link className="resident-register-signin" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
        </section>
      </main>
    </div>
  );
}
