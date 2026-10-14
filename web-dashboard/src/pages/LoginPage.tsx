import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authAPI, debugAPI } from '../lib/api';
import PublicHeader from '../components/PublicHeader';
import PasswordInput from '../components/PasswordInput';

type DebugAccount = { id: string; full_name: string; username?: string | null; email?: string | null; phone?: string | null; role: string; audience: 'standard' | 'barangay'; barangay_id?: string; barangay_name?: string };

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
  };
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginAccountKind, setLoginAccountKind] = useState<'auto' | 'mdrrmo' | 'barangay' | 'resident'>('auto');
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
      await login(email, password, loginAccountKind);
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
      await authAPI.createMasterAdmin({ full_name: setupName, email, password });
      setSetupRequired(false);
      await login(email, password, 'mdrrmo');
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
      <div className="debug-account-meta">{account.username || account.email || account.phone || 'No username'} · {account.role.replaceAll('_', ' ')}</div>
    </button>
  );

  // Separate effect to handle redirection after login state is updated
  useEffect(() => {
    if (user) {
      if (canAccessDashboard) {
        const destination = user.account_kind === 'barangay'
          ? user.role === 'responder' ? '/my-responses' : user.role === 'staff' ? '/barangay-workspace' : user.role === 'admin' && !user.coordination_verified ? '/barangay-settings' : user.role === 'admin' || user.role === 'dispatcher' ? '/barangay-dashboard' : '/command-center'
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
      <PublicHeader />
      <main className="login-page public-login-main">
      <div className="login-card">
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
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
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
        ) : <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-account-kind">Account type</label>
            <select id="login-account-kind" className="form-input" value={loginAccountKind} onChange={(event) => setLoginAccountKind(event.target.value as typeof loginAccountKind)}>
              <option value="auto">Find my account automatically</option>
              <option value="resident">Resident</option>
              <option value="barangay">Barangay team</option>
              <option value="mdrrmo">MDRRMO team</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">{loginAccountKind === 'resident' ? 'Username or mobile number' : loginAccountKind === 'mdrrmo' ? 'Username or email' : loginAccountKind === 'auto' ? 'Email, username, or mobile number' : 'Email Address'}</label>
            <input
              id="login-email"
              type={loginAccountKind === 'barangay' ? 'email' : 'text'}
              autoComplete={loginAccountKind === 'barangay' ? 'email' : 'username'}
              className="form-input"
              placeholder={loginAccountKind === 'resident' ? 'username or 09XXXXXXXXX' : loginAccountKind === 'auto' ? 'email, username, or 09XXXXXXXXX' : loginAccountKind === 'mdrrmo' ? 'username or admin@mdrrmo.gov.ph' : 'admin@barangay.gov.ph'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
        </form>}

        {!showSetup && loginAccountKind === 'barangay' && (
          <Link className="login-setup-toggle barangay-register-link" to="/barangay/register">Need an account? Register your barangay administrator</Link>
        )}

        {!showSetup && <Link className="login-setup-toggle resident-register-link" to="/resident/register">Create a resident account</Link>}

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
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>
          MDRRMO and barangay teams, responders, and residents can sign in here.
        </p>
      </div>
      </main>
    </div>
  );
}
