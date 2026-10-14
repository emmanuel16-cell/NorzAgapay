import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authAPI, socket, debugAPI } from '../lib/api';

interface User {
  id: string;
  full_name: string;
  username?: string | null;
  email: string | null;
  phone?: string | null;
  role: string;
  unit_type?: string;
  status: string;
  verified: boolean;
  position_designation?: string;
  is_active?: boolean;
  account_kind?: 'mdrrmo' | 'barangay' | 'resident';
  barangay_id?: string;
  barangay_name?: string;
  coordination_verified?: boolean;
  verification_status?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (identifier: string, password: string, accountKind?: 'auto' | 'mdrrmo' | 'barangay' | 'resident') => Promise<void>;
  setSession: (token: string, user: User, accountKind: 'mdrrmo' | 'barangay' | 'resident') => void;
  debugLogin: (accountId: string, audience?: 'standard' | 'barangay' | 'resident') => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
  logout: () => void;
  isAdmin: boolean;
  isMasterAdmin: boolean;
  canAccessDashboard: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('norzagapay_token'));
  const [accountKind, setAccountKind] = useState<'mdrrmo' | 'barangay' | 'resident'>(() => {
    const savedKind = localStorage.getItem('norzagapay_account_kind');
    return savedKind === 'barangay' || savedKind === 'resident' ? savedKind : 'mdrrmo';
  });
  const [user, setUser] = useState<User | null>(() => {
    if (!localStorage.getItem('norzagapay_token')) {
      localStorage.removeItem('norzagapay_user');
      return null;
    }
    try {
      const savedUser = localStorage.getItem('norzagapay_user');
      return savedUser ? JSON.parse(savedUser) as User : null;
    } catch {
      localStorage.removeItem('norzagapay_user');
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      socket.auth = { token };
      socket.connect();
    } else {
      socket.disconnect();
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      localStorage.removeItem('norzagapay_user');
      setLoading(false);
      return;
    }

    (accountKind === 'barangay' ? authAPI.barangayMe() : authAPI.me())
      .then((response) => {
        const freshUser = (accountKind === 'barangay' ? response.data : response.data.user) as User;
        freshUser.account_kind = accountKind;
        localStorage.setItem('norzagapay_user', JSON.stringify(freshUser));
        setUser(freshUser);
      })
      .catch(() => {
        setToken(null);
        setUser(null);
        localStorage.removeItem('norzagapay_token');
        localStorage.removeItem('norzagapay_user');
        localStorage.removeItem('norzagapay_account_kind');
      })
      .finally(() => setLoading(false));
  }, [token, accountKind]);

  const login = async (identifier: string, password: string, requestedKind: 'auto' | 'mdrrmo' | 'barangay' | 'resident' = 'auto') => {
    const loginKinds: Array<'mdrrmo' | 'barangay' | 'resident'> = requestedKind === 'auto'
      ? ['mdrrmo', 'barangay', 'resident']
      : [requestedKind];
    let response: Awaited<ReturnType<typeof authAPI.login>>
      | Awaited<ReturnType<typeof authAPI.residentLogin>>
      | Awaited<ReturnType<typeof authAPI.barangayLogin>>
      | null = null;
    let nextKind: 'mdrrmo' | 'barangay' | 'resident' | null = null;
    let firstUnauthorized: unknown;
    for (const kind of loginKinds) {
      try {
        response = kind === 'mdrrmo'
          ? await authAPI.login(identifier, password)
          : kind === 'barangay'
            ? await authAPI.barangayLogin(identifier, password)
            : await authAPI.residentLogin(identifier, password);
        nextKind = kind;
        break;
      } catch (loginError) {
        const status = (loginError as { response?: { status?: number } }).response?.status;
        if (status !== 401) throw loginError;
        if (!firstUnauthorized) firstUnauthorized = loginError;
      }
    }
    if (!response || !nextKind) throw firstUnauthorized || new Error('Login failed.');
    const { token: savedToken, user: loggedInUser } = response.data;
    loggedInUser.account_kind = nextKind;
    localStorage.removeItem('norzagapay_debug_session');
    localStorage.setItem('norzagapay_account_kind', nextKind);
    localStorage.setItem('norzagapay_token', savedToken);
    localStorage.setItem('norzagapay_user', JSON.stringify(loggedInUser));
    setAccountKind(nextKind);
    setToken(savedToken);
    setUser(loggedInUser);
  };

  const setSession = (savedToken: string, sessionUser: User, nextKind: 'mdrrmo' | 'barangay' | 'resident') => {
    const nextUser = { ...sessionUser, account_kind: nextKind };
    localStorage.removeItem('norzagapay_debug_session');
    localStorage.setItem('norzagapay_account_kind', nextKind);
    localStorage.setItem('norzagapay_token', savedToken);
    localStorage.setItem('norzagapay_user', JSON.stringify(nextUser));
    setAccountKind(nextKind);
    setToken(savedToken);
    setUser(nextUser);
  };

  const debugLogin = async (accountId: string, audience: 'standard' | 'barangay' | 'resident' = 'standard') => {
    const response = await debugAPI.quickLogin(accountId, audience);
    const { token: savedToken, user: loggedInUser } = response.data;
    const nextKind = audience === 'barangay' ? 'barangay' : audience === 'resident' ? 'resident' : 'mdrrmo';
    loggedInUser.account_kind = nextKind;
    localStorage.setItem('norzagapay_debug_session', 'true');
    localStorage.removeItem('norzagapay_responder_demo_hidden');
    localStorage.setItem('norzagapay_account_kind', nextKind);
    localStorage.setItem('norzagapay_token', savedToken);
    localStorage.setItem('norzagapay_user', JSON.stringify(loggedInUser));
    setAccountKind(nextKind);
    setToken(savedToken);
    setUser(loggedInUser);
  };

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      localStorage.setItem('norzagapay_user', JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = () => {
    localStorage.removeItem('norzagapay_debug_session');
    localStorage.removeItem('norzagapay_token');
    localStorage.removeItem('norzagapay_user');
    localStorage.removeItem('norzagapay_account_kind');
    setToken(null);
    setUser(null);
  };

  const isAdmin = user?.role === 'admin';
  const isMasterAdmin = user?.role === 'master_admin';
  const canAccessDashboard = user?.account_kind === 'barangay'
    ? Boolean(['admin', 'dispatcher', 'staff', 'responder'].includes(user.role) && (user.coordination_verified || user.role === 'admin'))
    : user?.role === 'resident' || isMasterAdmin || ['admin', 'logistics', 'dispatcher', 'responder'].includes(user?.role || '');

  return (
    <AuthContext.Provider value={{ user, token, loading, login, setSession, debugLogin, updateUser, logout, isAdmin, isMasterAdmin, canAccessDashboard }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
