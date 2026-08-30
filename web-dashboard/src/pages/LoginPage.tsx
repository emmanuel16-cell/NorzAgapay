import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { debugAPI } from '../lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDebugAccounts, setShowDebugAccounts] = useState(false);
  const [debugAccounts, setDebugAccounts] = useState<Array<{ id: string; full_name: string; email: string; role: string }>>([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const { login, debugLogin, user, isAdmin, isCommander, logout } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // The login call in AuthContext updates state, we check it here
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
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
      const res = await debugAPI.accounts();
      setDebugAccounts(res.data.accounts ?? []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Debug quick login is unavailable.');
      setShowDebugAccounts(false);
    } finally {
      setDebugLoading(false);
    }
  };

  const selectDebugAccount = async (accountId: string) => {
    setDebugLoading(true);
    try {
      await debugLogin(accountId);
      setShowDebugAccounts(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Quick login failed.');
    } finally {
      setDebugLoading(false);
    }
  };

  // Separate effect to handle redirection after login state is updated
  React.useEffect(() => {
    if (user) {
      if (isAdmin || isCommander) {
        navigate('/');
      } else {
        setError('Access Denied: This dashboard is restricted to Commanders and Administrators. Please use the mobile app.');
        logout(); // Log them out immediately
      }
    }
  }, [user, isAdmin, isCommander, navigate, logout]);

  return (
    <div className="login-page">
      <div className="login-card">
        <button className="login-logo" type="button" onClick={toggleDebugAccounts} title="Click logo to toggle Debug Quick Login">
          <img src="/NA-icon.png" alt="NorzAgapay" />
        </button>
        <h1 className="login-title">NorzAgapay</h1>
        <p className="login-subtitle">Crisis Management Command Center</p>

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

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              id="login-email"
              type="email"
              className="form-input"
              placeholder="commander@mdrrmo.gov.ph"
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
        </form>

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
                    onClick={() => selectDebugAccount(account.id)}
                    disabled={debugLoading}
                  >
                    <div className="debug-account-name">{account.full_name}</div>
                    <div className="debug-account-meta">{account.email} · {account.role}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>
          MDRRMO Authorized Personnel Only
        </p>
      </div>
    </div>
  );
}
