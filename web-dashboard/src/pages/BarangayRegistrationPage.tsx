import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, BadgeCheck, Check, Clock3, Download, FileCheck2, FileText, LogOut, Phone, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import MobileNumberInput from '../components/MobileNumberInput';
import PasswordInput from '../components/PasswordInput';
import { useAuth } from '../context/AuthContext';
import { API_BASE, authAPI, barangayAPI } from '../lib/api';
import { formatMobileNumber, isValidMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';

type BarangayOption = { id: string; name: string; municipality?: string };
type RegistrationForm = { full_name: string; phone: string; password: string; barangay_id: string; position_designation: string };
type Verification = {
  status?: string;
  reference_no?: string;
  punong_barangay_name?: string;
  punong_barangay_position?: string;
  position_designation?: string;
  document_url?: string | null;
  submitted_at?: string | null;
  rejection_reason?: string | null;
  correction_reason?: string | null;
};

const initialForm: RegistrationForm = { full_name: '', phone: '', password: '', barangay_id: '', position_designation: '' };

function errorMessage(error: any, fallback: string) {
  return error?.response?.data?.error || error?.message || fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function StepIndicator({ activeStep }: { activeStep: 1 | 2 | 3 }) {
  const steps = ['Account details', 'SMS verification', 'MDRRMO review'];
  return <div className="barangay-onboarding-steps" aria-label={`Step ${activeStep} of 3: ${steps[activeStep - 1]}`}>
    {steps.map((label, index) => {
      const step = index + 1;
      const state = step < activeStep ? 'complete' : step === activeStep ? 'current' : '';
      return <div className="barangay-onboarding-step-wrap" key={label}>
        <div className={`barangay-onboarding-step ${state}`} aria-current={step === activeStep ? 'step' : undefined}>
          <span>{step < activeStep ? <Check size={14} /> : step}</span>
          <small>{label}</small>
        </div>
        {step < steps.length && <i className={step < activeStep ? 'complete' : ''} aria-hidden="true" />}
      </div>;
    })}
  </div>;
}

export default function BarangayRegistrationPage() {
  const { user, loading: authLoading, setSession, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegistrationForm>(initialForm);
  const [barangays, setBarangays] = useState<BarangayOption[]>([]);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [barangaysLoading, setBarangaysLoading] = useState(true);
  const [requestLoading, setRequestLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [verification, setVerification] = useState<Verification | null>(null);
  const [official, setOfficial] = useState({ official_name: '', official_position: '', position_designation: '' });
  const [coordinationVerified, setCoordinationVerified] = useState(false);

  const isPendingBarangayAdmin = user?.account_kind === 'barangay'
    && user.role === 'admin'
    && !user.coordination_verified;
  const isReviewStage = Boolean(isPendingBarangayAdmin);
  const status = String(verification?.status || user?.verification_status || 'pending_document').toLowerCase();
  const detailsSaved = Boolean(
    verification?.punong_barangay_name?.trim()
    && verification?.punong_barangay_position?.trim()
    && official.official_name.trim() === verification.punong_barangay_name.trim()
    && official.official_position.trim() === verification.punong_barangay_position.trim()
    && official.position_designation.trim() === (verification.position_designation || '').trim(),
  );
  const canUploadDocument = detailsSaved && ['pending_document', 'needs_correction'].includes(status);
  const submittedDocumentUrl = verification?.document_url
    ? (/^https?:\/\//i.test(verification.document_url) ? verification.document_url : `${API_BASE.replace(/\/api\/?$/, '')}${verification.document_url}`)
    : null;

  useEffect(() => {
    if (authLoading || user) return;
    let cancelled = false;
    setBarangaysLoading(true);
    authAPI.barangaysForAdminSignup()
      .then(({ data }) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : [];
        setBarangays(rows);
        if (rows.length) setForm((current) => ({ ...current, barangay_id: current.barangay_id || rows[0].id }));
      })
      .catch((loadError: any) => { if (!cancelled) setError(errorMessage(loadError, 'Eligible barangays could not be loaded.')); })
      .finally(() => { if (!cancelled) setBarangaysLoading(false); });
    return () => { cancelled = true; };
  }, [authLoading, user]);

  const loadAccountRequest = useCallback(async (quiet = false) => {
    if (!quiet) setRequestLoading(true);
    if (!quiet) setError('');
    try {
      const { data } = await barangayAPI.accountRequest();
      const record = (data?.verification || null) as Verification | null;
      const isActive = Boolean(data?.coordination_verified);
      setVerification(record);
      setCoordinationVerified(isActive);
      if (!quiet) {
        setOfficial({
          official_name: record?.punong_barangay_name || '',
          official_position: record?.punong_barangay_position || '',
          position_designation: record?.position_designation || user?.position_designation || '',
        });
      }
      updateUser({ coordination_verified: isActive, verification_status: record?.status || 'pending_document' });
      if (isActive) navigate('/barangay-dashboard', { replace: true });
    } catch (loadError: any) {
      if (!quiet) setError(errorMessage(loadError, 'Your Barangay Account Request could not be loaded.'));
    } finally {
      if (!quiet) setRequestLoading(false);
    }
  }, [navigate, updateUser, user?.position_designation]);

  useEffect(() => {
    if (!isReviewStage) return;
    void loadAccountRequest();
    const refreshTimer = window.setInterval(() => { void loadAccountRequest(true); }, 30000);
    return () => window.clearInterval(refreshTimer);
  }, [isReviewStage, loadAccountRequest]);

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
    } catch (sendError: any) { setError(errorMessage(sendError, 'The verification code could not be sent.')); }
    finally { setSaving(false); }
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const { data } = await authAPI.verifyBarangayRegistrationOtp({ phone: normalizeMobileNumberInput(form.phone), otp: otp.trim() });
      setSession(data.token, data.user, 'barangay');
      navigate('/barangay/register', { replace: true });
    } catch (verifyError: any) { setError(errorMessage(verifyError, 'The account could not be verified.')); }
    finally { setSaving(false); }
  };

  const saveRequestDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setMessage(''); setSaving(true);
    try {
      const { data } = await barangayAPI.saveAccountRequest(official);
      const record = (data.verification || verification) as Verification | null;
      setVerification(record);
      setCoordinationVerified(Boolean(data.coordination_verified));
      if (record) setOfficial({
        official_name: record.punong_barangay_name || official.official_name,
        official_position: record.punong_barangay_position || official.official_position,
        position_designation: record.position_designation || '',
      });
      updateUser({ coordination_verified: Boolean(data.coordination_verified), verification_status: record?.status || 'pending_document' });
      if (data.coordination_verified) navigate('/barangay-dashboard', { replace: true });
      setMessage('Request details saved. Download the authorization form, have it signed, then upload it here.');
    } catch (saveError: any) { setError(errorMessage(saveError, 'Request details could not be saved.')); }
    finally { setSaving(false); }
  };

  const downloadAuthorization = async () => {
    setError(''); setSaving(true);
    try {
      const { data } = await barangayAPI.certificateTemplate(true);
      const barangayName = (user?.barangay_name || 'Barangay').replace(/[^a-z0-9]+/gi, '_');
      downloadBlob(data, `Barangay_Account_Request_${barangayName}.pdf`);
    } catch (downloadError: any) { setError(errorMessage(downloadError, 'The authorization form could not be downloaded.')); }
    finally { setSaving(false); }
  };

  const uploadAuthorization = async (file?: File) => {
    if (!file) return;
    setError(''); setMessage('');
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) { setError('Upload a signed PDF, PNG, or JPG file.'); return; }
    setSaving(true);
    try {
      const { data } = await barangayAPI.submitCertificate(file);
      setVerification(data.verification || verification);
      updateUser({ verification_status: data.verification?.status || 'under_review' });
      setMessage('Your signed request was sent to MDRRMO. We will check for a decision automatically.');
    } catch (uploadError: any) { setError(errorMessage(uploadError, 'The signed document could not be uploaded.')); }
    finally { setSaving(false); }
  };

  const reopenRequest = async () => {
    setError(''); setMessage(''); setSaving(true);
    try {
      const { data } = await barangayAPI.resubmitAccountRequest();
      setVerification(data.verification || verification);
      updateUser({ verification_status: data.verification?.status || 'pending_document' });
      setMessage(data.message || 'Your request is open again. Review the details and upload a corrected signed document.');
    } catch (resubmitError: any) { setError(errorMessage(resubmitError, 'The request could not be reopened.')); }
    finally { setSaving(false); }
  };

  const requestActivation = async () => {
    setError(''); setMessage(''); setSaving(true);
    try {
      const { data } = await barangayAPI.requestActivation();
      setVerification(data.verification || verification);
      updateUser({ coordination_verified: false, verification_status: data.verification?.status || 'activation_pending' });
      setMessage(data.message || 'Your activation request was sent to MDRRMO.');
    } catch (activationError: any) { setError(errorMessage(activationError, 'The activation request could not be sent.')); }
    finally { setSaving(false); }
  };

  if (authLoading) return <div className="loading-overlay"><div className="spinner" /></div>;
  if (user && !isPendingBarangayAdmin) {
    return <Navigate to={user.account_kind === 'barangay' && user.role === 'admin' ? '/barangay-dashboard' : '/login'} replace />;
  }

  const activeStep: 1 | 2 | 3 = isReviewStage ? 3 : otpSent ? 2 : 1;
  const reviewTitle = status === 'under_review' ? 'MDRRMO is reviewing your request'
    : status === 'needs_correction' ? 'Corrections are needed'
      : status === 'rejected' ? 'Your request needs to be resubmitted'
        : status === 'activation_pending' ? 'Reactivation is under review'
          : status === 'verified' ? 'Your barangay was approved'
            : 'Complete your Barangay Account Request';
  const reviewDescription = status === 'under_review' ? 'Your signed authorization was received. You can leave this page; when you sign in again, you will return here until MDRRMO makes a decision.'
    : status === 'needs_correction' ? 'Review the message from MDRRMO below, update the request if needed, then upload a corrected signed document.'
      : status === 'rejected' ? 'MDRRMO did not approve the submitted request. Read the feedback, correct the issue, then reopen the request to submit an updated document.'
        : status === 'activation_pending' ? 'Your barangay was approved previously and MDRRMO is reviewing the request to restore access.'
          : status === 'verified' ? 'MDRRMO has approved the request. Access is currently inactive; send an activation request if you still need access.'
            : 'Save the authorizing official’s details, download the authorization form, get it signed, and upload the signed copy for MDRRMO review.';

  return (
    <div className="public-login-page barangay-registration-page">
      <main className="login-page public-login-main barangay-registration-main">
        <section className={`login-card barangay-registration-card${isReviewStage ? ' barangay-review-card' : ''}`} aria-labelledby="barangay-registration-title">
          <span className="barangay-registration-eyebrow">BARANGAY ACCOUNT</span>
          <h1 className="login-title" id="barangay-registration-title">{isReviewStage ? 'MDRRMO review' : otpSent ? 'Verify your mobile number' : 'Create a barangay administrator account'}</h1>
          <p className="login-subtitle barangay-registration-intro">{isReviewStage ? <>Signed in as <strong>{user?.full_name}</strong>. Your account setup continues here until MDRRMO approves access.</> : otpSent ? <>Enter the 6-digit code sent to <strong>{formatMobileNumber(form.phone)}</strong>. It expires in 10 minutes.</> : 'Create your account with a mobile number and password. MDRRMO must review your signed Barangay Account Request before operational access is activated.'}</p>
          <StepIndicator activeStep={activeStep} />

          {error && <div className="resident-register-error" role="alert"><AlertCircle size={17} />{error}{isReviewStage && <button type="button" onClick={() => void loadAccountRequest()}>Retry</button>}</div>}
          {message && <div className="resident-register-notice" role="status">{message}</div>}

          {isReviewStage ? <div className="barangay-review-stage">
            {requestLoading && !verification ? <div className="barangay-review-loading"><span className="spinner" /> Loading your request…</div> : <>
              <section className={`barangay-review-status status-${status}`} aria-live="polite">
                <span className="barangay-review-status-icon">{status === 'verified' && !coordinationVerified ? <BadgeCheck size={22} /> : status === 'needs_correction' || status === 'rejected' ? <AlertCircle size={22} /> : <Clock3 size={22} />}</span>
                <div><h2>{reviewTitle}</h2><p>{reviewDescription}</p></div>
              </section>

              {verification?.reference_no && <div className="barangay-review-reference"><span>Request reference</span><strong>{verification.reference_no}</strong></div>}
              {(verification?.correction_reason || verification?.rejection_reason) && <div className="barangay-review-feedback"><strong>MDRRMO feedback</strong><p>{verification.correction_reason || verification.rejection_reason}</p></div>}

              {status === 'rejected' && <div className="barangay-review-actions"><button className="btn btn-primary" type="button" onClick={() => void reopenRequest()} disabled={saving}><RefreshCw size={17} /> {saving ? 'Reopening…' : 'Start resubmission'}</button></div>}

              {status === 'verified' && !coordinationVerified && <div className="barangay-review-actions"><button className="btn btn-primary" type="button" onClick={() => void requestActivation()} disabled={saving}><ShieldCheck size={17} /> {saving ? 'Sending…' : 'Request access activation'}</button></div>}

              {status === 'pending_document' || status === 'needs_correction' || !verification ? <>
                <form className="barangay-review-details" onSubmit={(event) => void saveRequestDetails(event)}>
                  <h2>Account request details</h2>
                  <div className="barangay-registration-form">
                    <div className="form-group"><label className="form-label" htmlFor="review-position-designation">Administrator designation</label><input id="review-position-designation" className="form-input" maxLength={120} value={official.position_designation} onChange={(event) => setOfficial((current) => ({ ...current, position_designation: event.target.value }))} placeholder="e.g. Barangay Administrator" /></div>
                    <div className="form-group"><label className="form-label" htmlFor="review-official-name">Authorizing official name</label><input id="review-official-name" className="form-input" required minLength={2} maxLength={120} value={official.official_name} onChange={(event) => setOfficial((current) => ({ ...current, official_name: event.target.value }))} placeholder="Punong Barangay’s full name" /></div>
                    <div className="form-group"><label className="form-label" htmlFor="review-official-position">Authorizing official position</label><input id="review-official-position" className="form-input" required minLength={2} maxLength={120} value={official.official_position} onChange={(event) => setOfficial((current) => ({ ...current, official_position: event.target.value }))} placeholder="e.g. Punong Barangay" /></div>
                  </div>
                  <button className="btn btn-primary barangay-review-primary" type="submit" disabled={saving}><FileCheck2 size={17} /> {saving ? 'Saving…' : 'Save request details'}</button>
                </form>

                <div className="barangay-review-document">
                  <div className="barangay-review-document-icon"><FileText size={20} /></div>
                  <div className="barangay-review-document-copy"><strong>Signed authorization document</strong><p>Download the form, have the required official sign and seal it, then upload a clear PDF or image.</p></div>
                  <button className="workspace-secondary-action" type="button" onClick={() => void downloadAuthorization()} disabled={saving || !detailsSaved}><Download size={16} /> Download form</button>
                  <label className={`btn btn-outline barangay-review-upload${!canUploadDocument || saving ? ' disabled' : ''}`}>
                    <Upload size={16} /> {saving ? 'Please wait…' : 'Upload signed form'}
                    <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" disabled={!canUploadDocument || saving} onChange={(event) => { void uploadAuthorization(event.target.files?.[0]); event.currentTarget.value = ''; }} />
                  </label>
                  {!detailsSaved && <small className="barangay-review-hint">Save the request details before downloading the authorization form.</small>}
                </div>
              </> : null}

              {status === 'under_review' && submittedDocumentUrl && <p className="barangay-review-document-link"><FileText size={16} /> <a href={submittedDocumentUrl} target="_blank" rel="noreferrer">Open the submitted signed document</a></p>}
              {status === 'activation_pending' && <div className="barangay-review-pending"><Clock3 size={17} /> Your activation request is waiting for MDRRMO review.</div>}
            </>}
            <div className="barangay-review-footer"><button className="login-setup-toggle resident-register-back" type="button" onClick={() => { logout(); navigate('/login', { replace: true }); }}><LogOut size={15} /> Sign out</button><button className="login-setup-toggle resident-register-back" type="button" onClick={() => void loadAccountRequest()} disabled={requestLoading}><RefreshCw size={15} /> Refresh status</button></div>
          </div> : !otpSent ? <form className="barangay-registration-form" onSubmit={(event) => void sendCode(event)}>
            <div className="form-group"><label className="form-label" htmlFor="barangay-register-name">Full name</label><input id="barangay-register-name" className="form-input" required minLength={2} maxLength={120} autoComplete="name" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} /></div>
            <div className="form-group"><label className="form-label" htmlFor="barangay-register-phone">Mobile number</label><div className="resident-register-input-wrap"><Phone size={17} /><MobileNumberInput id="barangay-register-phone" className="form-input" value={form.phone} onValueChange={(phone) => setForm((current) => ({ ...current, phone }))} placeholder="09XXXXXXXXX" required /></div></div>
            <div className="form-group"><label className="form-label" htmlFor="barangay-register-password">Password</label><PasswordInput id="barangay-register-password" className="form-input" required minLength={8} maxLength={128} autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></div>
            <div className="form-group"><label className="form-label" htmlFor="barangay-register-barangay">Barangay</label><select id="barangay-register-barangay" className="form-input" required value={form.barangay_id} disabled={barangaysLoading || barangays.length === 0} onChange={(event) => setForm((current) => ({ ...current, barangay_id: event.target.value }))}>{barangaysLoading && <option value="">Loading eligible barangays…</option>}{!barangaysLoading && barangays.length === 0 && <option value="">No eligible barangays available</option>}{barangays.map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label" htmlFor="barangay-register-designation">Official designation (position in your barangay)</label><input id="barangay-register-designation" className="form-input" required minLength={2} maxLength={120} value={form.position_designation} onChange={(event) => setForm((current) => ({ ...current, position_designation: event.target.value }))} placeholder="e.g. Barangay Administrator" /></div>
            <button className="btn btn-primary btn-lg resident-register-submit" type="submit" disabled={saving || barangaysLoading || barangays.length === 0}><Phone size={17} /> {saving ? 'Sending code…' : 'Send verification code'}</button>
          </form> : <form className="barangay-registration-form" onSubmit={(event) => void verify(event)}>
            <div className="form-group"><label className="form-label" htmlFor="barangay-register-otp">Verification code</label><input id="barangay-register-otp" className="form-input resident-register-otp" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></div>
            <button className="btn btn-primary btn-lg resident-register-submit" type="submit" disabled={saving || otp.length !== 6}><ShieldCheck size={17} /> {saving ? 'Verifying…' : 'Verify and create account'} <ArrowRight size={17} /></button>
            <button className="login-setup-toggle resident-register-back" type="button" disabled={saving} onClick={() => { setOtpSent(false); setOtp(''); setMessage(''); setError(''); }}>Change registration details</button>
            <button className="login-setup-toggle resident-register-back" type="button" disabled={saving} onClick={() => void sendCode()}>Send another code</button>
          </form>}

          {!isReviewStage && <p className="barangay-registration-footnote">Account creation does not activate barangay dispatch access. MDRRMO must review the signed authorization document.</p>}
          {!isReviewStage && <Link className="resident-register-signin" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>}
        </section>
      </main>
    </div>
  );
}
