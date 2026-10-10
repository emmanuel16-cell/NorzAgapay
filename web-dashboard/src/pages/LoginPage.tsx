import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authAPI, debugAPI, reportAPI } from '../lib/api';
import { Phone, MapPin, Upload, Siren } from 'lucide-react';

type DebugAccount = { id: string; full_name: string; email: string; role: string; audience: 'standard' | 'barangay'; barangay_name?: string };
type HotlineGroup = { barangay_name: string; entries: Array<{ label?: string; name?: string; phone?: string; number?: string; numbers?: string[]; purpose?: string }> };

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [audience, setAudience] = useState<'mdrrmo' | 'barangay'>('mdrrmo');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDebugAccounts, setShowDebugAccounts] = useState(false);
  const [debugAccounts, setDebugAccounts] = useState<DebugAccount[]>([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [hotlines, setHotlines] = useState<{ national: Array<{ label: string; phone: string }>; mdrrmo: Array<{ label: string; phone: string; email?: string }>; barangays: HotlineGroup[] }>({ national: [], mdrrmo: [], barangays: [] });
  const [guestPhone, setGuestPhone] = useState('');
  const [guestDescription, setGuestDescription] = useState('');
  const [guestLocation, setGuestLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [guestEvidence, setGuestEvidence] = useState<File | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [setupName, setSetupName] = useState('');
  const { login, debugLogin, user, canAccessDashboard, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    authAPI.masterAdminSetupStatus()
      .then((res) => setSetupRequired(Boolean(res.data.setupRequired)))
      .catch(() => setSetupRequired(false));
  }, []);

  useEffect(() => {
    reportAPI.publicHotlines()
      .then((res) => setHotlines(res.data || { national: [], mdrrmo: [], barangays: [] }))
      .catch(() => setHotlines({ national: [{ label: 'National Emergency Hotline', phone: '911' }], mdrrmo: [], barangays: [] }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, audience);
      // The login call in AuthContext updates state, we check it here
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
      setLoading(false);
    }
  };

  const handleMasterAdminSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authAPI.createMasterAdmin({ full_name: setupName, email, password });
      setSetupRequired(false);
      await login(email, password);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Master admin setup failed. Please try again.');
      setLoading(false);
    }
  };

  const toggleDebugAccounts = async () => {
    if (showDebugAccounts) {
      setShowDebugAccounts(false);
      return;
    }
    setShowDebugAccounts(true);
    if (debugAccounts.length > 0) return;
    setDebugLoading(true);
    setError('');
    try {
      const [standard, barangay] = await Promise.all([debugAPI.accounts('standard'), debugAPI.accounts('barangay')]);
      setDebugAccounts([
        ...(standard.data.accounts || []).map((account: DebugAccount) => ({ ...account, audience: 'standard' as const })),
        ...(barangay.data.accounts || []).map((account: DebugAccount) => ({ ...account, audience: 'barangay' as const })),
      ]);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Debug quick login is unavailable.');
      setShowDebugAccounts(false);
    } finally {
      setDebugLoading(false);
    }
  };

  const selectDebugAccount = async (accountId: string, accountAudience: 'standard' | 'barangay') => {
    setDebugLoading(true);
    try {
      await debugLogin(accountId, accountAudience);
      setShowDebugAccounts(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Quick login failed.');
    } finally {
      setDebugLoading(false);
    }
  };

  const requestGuestLocation = () => {
    setGuestError('');
    if (!navigator.geolocation) { setGuestError('This browser cannot read your location.'); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => setGuestLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => setGuestError('Allow location access or try again from the incident location.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const submitGuestReport = async (event: React.FormEvent) => {
    event.preventDefault();
    setGuestError('');
    const phone = guestPhone.replace(/\D/g, '');
    if (!/^09\d{9}$/.test(phone)) { setGuestError('Enter an 11-digit mobile number starting with 09.'); return; }
    if (!guestLocation) { setGuestError('Add the incident location before submitting.'); return; }
    if (guestDescription.trim().length < 8) { setGuestError('Describe the incident in at least 8 characters.'); return; }
    setGuestBusy(true);
    try {
      await reportAPI.guestReport({
        type: 'emergency', title: 'Resident Incident Report', description: guestDescription.trim(),
        latitude: guestLocation.latitude, longitude: guestLocation.longitude, contact_number: phone,
      }, guestEvidence);
      setGuestDescription(''); setGuestPhone(''); setGuestLocation(null); setGuestEvidence(null);
      const input = document.getElementById('public-report-evidence') as HTMLInputElement | null;
      if (input) input.value = '';
      setGuestError('Report sent to MDRRMO for review.');
    } catch (error: any) {
      setGuestError(error?.response?.data?.error || 'The report could not be submitted. Please try again.');
    } finally { setGuestBusy(false); }
  };

  // Separate effect to handle redirection after login state is updated
  React.useEffect(() => {
    if (user) {
      if (canAccessDashboard) {
        navigate('/');
      } else {
        setError('This account does not have web dashboard access. Please use the mobile app.');
        logout(); // Log them out immediately
      }
    }
  }, [user, canAccessDashboard, navigate, logout]);

  return (
    <div className="login-page public-intake-page">
      <section className="public-intake-panel" aria-labelledby="public-report-title">
        <div className="public-intake-heading"><span><Siren size={19} /></span><div><h2 id="public-report-title">Report an incident</h2><p>Anyone can send a report to MDRRMO without signing in.</p></div></div>
        <form className="public-report-form" onSubmit={(event) => void submitGuestReport(event)}>
          <label htmlFor="public-report-phone">Mobile number <b>Required</b></label>
          <input id="public-report-phone" inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="09XXXXXXXXX" value={guestPhone} onChange={(event) => setGuestPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} required />
          <label htmlFor="public-report-description">Incident details</label>
          <textarea id="public-report-description" rows={4} maxLength={2000} placeholder="Describe what happened and who needs help…" value={guestDescription} onChange={(event) => setGuestDescription(event.target.value)} required />
          <button className={'public-location-button ' + (guestLocation ? 'located' : '')} type="button" onClick={requestGuestLocation}><MapPin size={16} />{guestLocation ? `Location attached · ${guestLocation.latitude.toFixed(5)}, ${guestLocation.longitude.toFixed(5)}` : 'Add current incident location'}</button>
          <label className="public-evidence-label" htmlFor="public-report-evidence"><Upload size={15} /> Add photo or video (optional)</label>
          <input id="public-report-evidence" type="file" accept="image/*,video/*" onChange={(event) => setGuestEvidence(event.target.files?.[0] || null)} />
          {guestError && <p className={guestError.startsWith('Report sent') ? 'public-report-success' : 'public-report-error'} role="status">{guestError}</p>}
          <button className="btn btn-primary btn-lg public-report-submit" disabled={guestBusy}>{guestBusy ? 'Sending report…' : 'Send report to MDRRMO'}</button>
          <small>Reports are reviewed by MDRRMO. They may assign response to the barangay best positioned to help.</small>
        </form>
        <section className="public-hotlines" aria-labelledby="public-hotlines-title">
          <h3 id="public-hotlines-title"><Phone size={16} /> Emergency hotlines</h3>
          <div className="public-hotline-list">
            {[...(hotlines.national || []), ...(hotlines.mdrrmo || [])].map((line, index) => <a key={`${line.phone}-${index}`} href={`tel:${line.phone}`}><span>{line.label}</span><strong>{line.phone}</strong></a>)}
            {(hotlines.barangays || []).map((group) => group.entries.flatMap((line, index) => {
              const phones = [line.phone, line.number, ...(line.numbers || [])].filter((phone): phone is string => Boolean(phone));
              return phones.map((phone, numberIndex) => <a key={`${group.barangay_name}-${phone}-${index}-${numberIndex}`} href={`tel:${phone}`}><span>{line.label || line.name || line.purpose || group.barangay_name} · Brgy. {group.barangay_name}</span><strong>{phone}</strong></a>);
            }))}
          </div>
          {hotlines.mdrrmo?.[0]?.email && <a className="public-hotline-email" href={`mailto:${hotlines.mdrrmo[0].email}`}>{hotlines.mdrrmo[0].email}</a>}
        </section>
      </section>
      <div className="login-card">
        <button className="login-logo" type="button" onClick={toggleDebugAccounts} title="Click logo to toggle Debug Quick Login">
          <img src="/NA-icon.png" alt="NorzAgapay" />
        </button>
        <h1 className="login-title">{showSetup ? 'Create Master Admin' : 'NorzAgapay'}</h1>
        <p className="login-subtitle">{showSetup ? 'Set up the first command center account' : 'Crisis Management Command Center'}</p>

        {error && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(231,76,60,0.1)',
            border: '1px solid rgba(231,76,60,0.3)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent)',
            fontSize: '13px',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        {showSetup ? (
          <form onSubmit={handleMasterAdminSetup}>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" autoComplete="name" value={setupName} onChange={event => setSetupName(event.target.value)} required minLength={2} />
            </div>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Password (at least 12 characters)</label>
              <input className="form-input" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={12} />
            </div>
            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '8px' }} disabled={loading}>
              {loading ? 'Creating account…' : 'Create Master Admin'}
            </button>
            <button type="button" className="login-setup-toggle" onClick={() => { setShowSetup(false); setError(''); }}>
              Back to sign in
            </button>
          </form>
        ) : <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-audience">Sign in to</label>
            <select id="login-audience" className="form-input" value={audience} onChange={(event) => setAudience(event.target.value as 'mdrrmo' | 'barangay')}>
              <option value="mdrrmo">MDRRMO command center</option>
              <option value="barangay">Barangay command center</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              id="login-email"
              type="email"
              className="form-input"
              placeholder="admin@mdrrmo.gov.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              id="login-password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            id="login-submit"
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: '8px' }}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>}

        {!showSetup && setupRequired && (
          <button type="button" className="login-setup-toggle" onClick={() => { setShowSetup(true); setError(''); }}>
            First time here? Create the Master Admin account
          </button>
        )}

        {showDebugAccounts && (
          <div className="debug-dropdown">
            <div className="debug-dropdown-header">
              <h3 className="debug-dropdown-title">Debug quick login</h3>
              <button
                type="button"
                className="debug-dropdown-close"
                onClick={() => setShowDebugAccounts(false)}
                title="Close"
              >
                ✕
              </button>
            </div>
            {debugLoading ? (
              <p style={{ fontSize: '13px', color: '#94a3b8', margin: '8px 0' }}>Loading accounts…</p>
            ) : debugAccounts.length === 0 ? (
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: '8px 0' }}>No active accounts found.</p>
            ) : (
              <div className="debug-dropdown-list">
                {debugAccounts.map((account) => (
                  <button
                    type="button"
                    key={account.id}
                    className="debug-account-card"
                    onClick={() => selectDebugAccount(account.id, account.audience)}
                    disabled={debugLoading}
                  >
                    <div className="debug-account-name">{account.full_name}</div>
                    <div className="debug-account-meta">{account.email} · {account.role}{account.audience === 'barangay' ? ` · Brgy. ${account.barangay_name || 'Barangay account'}` : ' · MDRRMO'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Authorized {audience === 'barangay' ? 'Barangay' : 'MDRRMO'} Personnel
        </p>
      </div>
    </div>
  );
}
