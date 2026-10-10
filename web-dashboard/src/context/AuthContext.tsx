import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authAPI, socket, debugAPI } from '../lib/api';

interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
  unit_type?: string;
  status: string;
  verified: boolean;
  position_designation?: string;
  is_active?: boolean;
  account_kind?: 'mdrrmo' | 'barangay';
  barangay_id?: string;
  barangay_name?: string;
  coordination_verified?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, audience?: 'mdrrmo' | 'barangay') => Promise<void>;
  debugLogin: (accountId: string, audience?: 'standard' | 'barangay') => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isMasterAdmin: boolean;
  canAccessDashboard: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('norzagapay_token'));
  const [accountKind, setAccountKind] = useState<'mdrrmo' | 'barangay'>(() =>
    localStorage.getItem('norzagapay_account_kind') === 'barangay' ? 'barangay' : 'mdrrmo');
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

  const login = async (email: string, password: string, audience: 'mdrrmo' | 'barangay' = 'mdrrmo') => {
    const response = audience === 'barangay'
      ? await authAPI.barangayLogin(email, password)
      : await authAPI.login(email, password);
    const { token: savedToken, user: loggedInUser } = response.data;
    const nextKind = audience;
    loggedInUser.account_kind = nextKind;
    localStorage.setItem('norzagapay_account_kind', nextKind);
    localStorage.setItem('norzagapay_token', savedToken);
    localStorage.setItem('norzagapay_user', JSON.stringify(loggedInUser));
    setAccountKind(nextKind);
    setToken(savedToken);
    setUser(loggedInUser);
  };

  const debugLogin = async (accountId: string, audience: 'standard' | 'barangay' = 'standard') => {
    const response = await debugAPI.quickLogin(accountId, audience);
    const { token: savedToken, user: loggedInUser } = response.data;
    const nextKind = audience === 'barangay' ? 'barangay' : 'mdrrmo';
    loggedInUser.account_kind = nextKind;
    localStorage.setItem('norzagapay_account_kind', nextKind);
    localStorage.setItem('norzagapay_token', savedToken);
    localStorage.setItem('norzagapay_user', JSON.stringify(loggedInUser));
    setAccountKind(nextKind);
    setToken(savedToken);
    setUser(loggedInUser);
  };

  const logout = () => {
    localStorage.removeItem('norzagapay_token');
    localStorage.removeItem('norzagapay_user');
    localStorage.removeItem('norzagapay_account_kind');
    setToken(null);
    setUser(null);
  };

  const isAdmin = user?.role === 'admin';
  const isMasterAdmin = user?.role === 'master_admin';
  const canAccessDashboard = user?.account_kind === 'barangay'
    ? Boolean(user.coordination_verified && ['admin', 'dispatcher'].includes(user.role))
    : isMasterAdmin || ['admin', 'logistics', 'dispatcher'].includes(user?.role || '');

  return (
    <AuthContext.Provider value={{ user, token, loading, login, debugLogin, logout, isAdmin, isMasterAdmin, canAccessDashboard }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
