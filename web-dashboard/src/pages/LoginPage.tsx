import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, House, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authAPI, debugAPI } from '../lib/api';
import PublicHeader from '../components/PublicHeader';
import PasswordInput from '../components/PasswordInput';
import MobileNumberInput from '../components/MobileNumberInput';
import { formatMobileNumber, normalizeMobileNumberInput } from '../lib/mobileNumber';

type DebugAccount = { id: string; full_name: string; phone?: string | null; role: string; audience: 'standard' | 'barangay' | 'resident'; barangay_id?: string; barangay_name?: string };

function groupDebugAccounts(accounts: DebugAccount[]) {
  const mdrrmo = accounts.filter((account) => account.audience === 'standard');
  const barangayGroups = new Map<string, { id: string; name: string; accounts: DebugAccount[] }>();
  accounts.filter((account) => account.audience === 'barangay').forEach((account) => {
    const name = account.barangay_name?.trim() || 'Unassigned Barangay';
    const key = account.barangay_id || name.toLowerCase();
    const group = barangayGroups.get(key) || { id: key, name, accounts: [] };
    group.accounts.push(account);
    barangayGroups.set(key, group);
  });

  return {
    mdrrmo,
    barangays: [...barangayGroups.values()].sort((first, second) => first.name.localeCompare(second.name)),
    residents: accounts.filter((account) => account.audience === 'resident'),
  };
}

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [setupPhone, setSetupPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryKind, setRecoveryKind] = useState<'mdrrmo' | 'barangay' | 'resident'>('mdrrmo');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryOtpSent, setRecoveryOtpSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDebugAccounts, setShowDebugAccounts] = useState(false);
  const [debugAccounts, setDebugAccounts] = useState<DebugAccount[]>([]);
  const [debugLoading, setDebugLoading] = useState(false);
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(normalizeMobileNumberInput(phone), password, 'auto');
      // The login call in AuthContext updates state, we check it here
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
      setLoading(false);
    }
  };

  const handleMasterAdminSetup = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const normalizedPhone = normalizeMobileNumberInput(setupPhone);
      await authAPI.createMasterAdmin({ full_name: setupName, phone: normalizedPhone, password });
      setSetupRequired(false);
      await login(normalizedPhone, password, 'auto');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Master admin setup failed. Please try again.');
      setLoading(false);
    }
  };

  const handlePasswordRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const normalizedPhone = normalizeMobileNumberInput(recoveryPhone);
      if (!recoveryOtpSent) {
        const { data } = await authAPI.sendPasswordResetOtp(recoveryKind, normalizedPhone);
        setRecoveryOtpSent(true);
        setError(data.message || 'If an account of this type uses that mobile number, a code will be sent by SMS.');
      } else {
        await authAPI.resetPassword(recoveryKind, {
          phone: normalizedPhone,
          otp: recoveryOtp.trim(),
          new_password: recoveryPassword,
        });
        setShowRecovery(false);
        setRecoveryOtpSent(false);
        setRecoveryOtp('');
        setRecoveryPassword('');
        setPassword('');
        setPhone(normalizedPhone);
        setError('Password reset. Sign in with your new password.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Password recovery failed. Please try again.');
    } finally {
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
      const [standard, barangay, residents] = await Promise.all([
        debugAPI.accounts('standard'),
        debugAPI.accounts('barangay'),
        debugAPI.accounts('resident'),
      ]);
      setDebugAccounts([
        ...(standard.data.accounts || []).map((account: DebugAccount) => ({ ...account, audience: 'standard' as const })),
        ...(barangay.data.accounts || []).map((account: DebugAccount) => ({ ...account, audience: 'barangay' as const })),
        ...(residents.data.accounts || []).map((account: DebugAccount) => ({ ...account, audience: 'resident' as const })),
      ]);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Debug quick login is unavailable.');
      setShowDebugAccounts(false);
    } finally {
      setDebugLoading(false);
    }
  };

  const selectDebugAccount = async (accountId: string, accountAudience: 'standard' | 'barangay' | 'resident') => {
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

  const debugGroups = groupDebugAccounts(debugAccounts);
  const renderDebugAccount = (account: DebugAccount) => (
    <button
      type="button"
      key={`${account.audience}-${account.id}`}
      className="debug-account-card"
      onClick={() => selectDebugAccount(account.id, account.audience)}
      disabled={debugLoading}
    >
      <div className="debug-account-name">{account.full_name}</div>
      <div className="debug-account-meta">{formatMobileNumber(account.phone) || 'No mobile number'} · {account.role.replaceAll('_', ' ')}</div>
    </button>
  );

  // Separate effect to handle redirection after login state is updated
  useEffect(() => {
    if (user) {
      if (canAccessDashboard) {
        const destination = user.account_kind === 'barangay'
          ? user.role === 'responder' ? '/my-responses' : user.role === 'staff' ? '/barangay-workspace' : user.role === 'admin' && !user.coordination_verified ? '/barangay/register' : user.role === 'admin' || user.role === 'dispatcher' ? '/barangay-dashboard' : '/command-center'
          : user.role === 'resident'
            ? '/my-reports'
            : user.role === 'responder'
              ? '/my-responses'
              : user.role === 'admin'
                ? '/users'
                : user.role === 'logistics'
                  ? '/respond-units'
                  : '/command-center';
        navigate(destination);
      } else {
        setError('This account does not have web dashboard access. Please use the mobile app.');
        logout(); // Log them out immediately
      }
    }
  }, [user, canAccessDashboard, navigate, logout]);

  return (
    <div className="public-login-page">
      <PublicHeader showActions={false} />
      <main className="login-page public-login-main">
      <div className="public-login-content">
      <section className="login-card public-login-card" aria-label={showSetup ? 'Create master admin account' : showRecovery ? 'Reset password' : 'Sign in'}>
        {!showSetup && (
          <button
            type="button"
            className="login-emblem-button"
            aria-label={showDebugAccounts ? 'Close developer quick login' : 'Open developer quick login'}
            aria-pressed={showDebugAccounts}
            aria-controls="developer-quick-login"
            title="Toggle developer quick login"
            onClick={() => void toggleDebugAccounts()}
          >
            <img className="login-emblem" src="/NA-icon.png" alt="" />
          </button>
        )}
        {showSetup && <>
          <h1 className="login-title">Create Master Admin</h1>
          <p className="login-subtitle">Set up the first command center account</p>
        </>}

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
              <label className="form-label">Mobile number</label>
              <MobileNumberInput className="form-input" value={setupPhone} onValueChange={setSetupPhone} placeholder="09XXXXXXXXX" required />
            </div>
            <div className="form-group">
              <label className="form-label">Password (at least 12 characters)</label>
              <PasswordInput className="form-input" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={12} />
            </div>
            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '8px' }} disabled={loading}>
              {loading ? 'Creating account…' : 'Create Master Admin'}
            </button>
            <button type="button" className="login-setup-toggle" onClick={() => { setShowSetup(false); setError(''); }}>
              Back to sign in
            </button>
          </form>
        ) : showRecovery ? <form onSubmit={handlePasswordRecovery}>
          <h1 className="login-title">Reset password</h1>
          <p className="login-subtitle">Choose which account to recover. We’ll send a verification code by SMS.</p>
          <div className="form-group">
            <label className="form-label" htmlFor="recovery-account-kind">Account type</label>
            <select id="recovery-account-kind" className="form-input" value={recoveryKind} onChange={(event) => setRecoveryKind(event.target.value as typeof recoveryKind)} disabled={recoveryOtpSent}>
              <option value="mdrrmo">MDRRMO</option>
              <option value="barangay">Barangay</option>
              <option value="resident">Resident</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="recovery-phone">Mobile number</label>
            <MobileNumberInput id="recovery-phone" className="form-input" placeholder="09XXXXXXXXX" value={recoveryPhone} onValueChange={setRecoveryPhone} required />
          </div>
          {recoveryOtpSent && <>
            <div className="form-group">
              <label className="form-label" htmlFor="recovery-otp">SMS verification code</label>
              <input id="recovery-otp" className="form-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={recoveryOtp} onChange={(event) => setRecoveryOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="recovery-new-password">New password</label>
              <PasswordInput id="recovery-new-password" className="form-input" autoComplete="new-password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} minLength={8} required />
            </div>
          </>}
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '8px' }} disabled={loading || (recoveryOtpSent && recoveryOtp.length !== 6)}>
            {loading ? 'Please wait…' : recoveryOtpSent ? 'Reset password' : 'Send SMS code'}
          </button>
          <button type="button" className="login-setup-toggle" onClick={() => { setShowRecovery(false); setRecoveryOtpSent(false); setRecoveryOtp(''); setError(''); }}>Back to sign in</button>
        </form> : <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-phone">Mobile number</label>
            <MobileNumberInput
              id="login-phone"
              className="form-input"
              placeholder="09XXXXXXXXX"
              value={phone}
              onValueChange={setPhone}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <PasswordInput
              id="login-password"
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
          <button type="button" className="login-setup-toggle" onClick={() => { setRecoveryPhone(phone); setShowRecovery(true); setError(''); }}>
            Forgot password?
          </button>
        </form>}

        {!showSetup && setupRequired && (
          <button type="button" className="login-setup-toggle" onClick={() => { setShowSetup(true); setError(''); }}>
            First time here? Create the Master Admin account
          </button>
        )}

        {showDebugAccounts && (
          <div className="debug-dropdown" id="developer-quick-login">
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
                {debugGroups.mdrrmo.length > 0 && <section className="debug-account-group"><h4>MDRRMO</h4>{debugGroups.mdrrmo.map(renderDebugAccount)}</section>}
                {debugGroups.barangays.map((group) => <section className="debug-account-group" key={group.id}><h4>Barangay · {group.name}</h4>{group.accounts.map(renderDebugAccount)}</section>)}
                {debugGroups.residents.length > 0 && <section className="debug-account-group"><h4>Resident</h4>{debugGroups.residents.map(renderDebugAccount)}</section>}
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Secure access for MDRRMO, barangay teams, and residents.
        </p>
      </section>

      <aside className="public-login-callout" aria-labelledby="public-login-callout-title">
          <div className="public-login-callout-copy">
            <span className="public-login-eyebrow">NORZAGARAY EMERGENCY RESPONSE</span>
            <h1 id="public-login-callout-title">Fast, coordinated response starts with your barangay.</h1>
            <p>Connect your barangay with the MDRRMO and help your community get the support it needs.</p>
          </div>

          <div className="public-login-actions">
            <Link className="public-login-register primary" to="/barangay/register">
              <ShieldCheck size={21} aria-hidden="true" />
              <span>Register Your Barangay</span>
              <ArrowUpRight size={19} aria-hidden="true" />
            </Link>
            <span className="public-login-or">or</span>
            <Link className="public-login-register secondary" to="/resident/register">
              <House size={20} aria-hidden="true" />
              <span>Create a Resident Account</span>
              <ArrowUpRight size={19} aria-hidden="true" />
            </Link>
          </div>

          <p className="public-login-callout-note">Create an account to report emergencies, follow updates, and coordinate local response.</p>
      </aside>
      </div>
      </main>
    </div>
  );
}
