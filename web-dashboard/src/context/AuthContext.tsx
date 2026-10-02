import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authAPI, barangayAuthAPI, socket } from '../lib/api';
import { debugAPI } from '../lib/api';

interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
  unit_type?: string;
  status: string;
  verified: boolean;
  account_scope?: 'mdrrmo' | 'barangay';
  barangay_id?: string;
  barangay_name?: string;
  coordination_verified?: boolean;
  position_designation?: string;
  is_active?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  debugLogin: (accountId: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isMasterAdmin: boolean;
  isBarangayAccount: boolean;
  isMdrrmoAccount: boolean;
  canAccessDashboard: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('norzagapay_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [token, setToken] = useState<string | null>(localStorage.getItem('norzagapay_token'));
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
    if (token) {
      let storedUser: User | null = null;
      try {
        const rawUser = localStorage.getItem('norzagapay_user');
        storedUser = rawUser ? JSON.parse(rawUser) as User : null;
      } catch {
        storedUser = null;
      }
      const isBarangay = storedUser?.account_scope === 'barangay' || Boolean(storedUser?.barangay_id);
      (isBarangay ? barangayAuthAPI.me() : authAPI.me())
        .then((res) => {
          const returnedUser = isBarangay ? res.data : res.data.user;
          const freshUser = {
            ...returnedUser,
            account_scope: isBarangay ? 'barangay' as const : 'mdrrmo' as const,
          };
          localStorage.setItem('norzagapay_user', JSON.stringify(freshUser));
          setUser(freshUser);
        })
        .catch(() => { setToken(null); localStorage.removeItem('norzagapay_token'); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    let res: any;
    let accountScope: User['account_scope'] = 'mdrrmo';
    try {
      res = await authAPI.login(email, password);
    } catch {
      res = await barangayAuthAPI.login(email, password);
      accountScope = 'barangay';
    }
    const { token: t } = res.data;
    const u: User = { ...res.data.user, account_scope: accountScope };
    localStorage.setItem('norzagapay_token', t);
    localStorage.setItem('norzagapay_user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  };

  const debugLogin = async (accountId: string) => {
    let res: any;
    let accountScope: User['account_scope'] = 'mdrrmo';
    try {
      res = await debugAPI.quickLogin(accountId);
    } catch {
      res = await debugAPI.quickLogin(accountId, 'barangay');
      accountScope = 'barangay';
    }
    const { token: t } = res.data;
    const u: User = { ...res.data.user, account_scope: accountScope };
    localStorage.setItem('norzagapay_token', t);
    localStorage.setItem('norzagapay_user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem('norzagapay_token');
    localStorage.removeItem('norzagapay_user');
    setToken(null);
    setUser(null);
  };

  const isAdmin = user?.role === 'admin';
  const isBarangayAccount = user?.account_scope === 'barangay' || Boolean(user?.barangay_id);
  const isMdrrmoAccount = Boolean(user) && !isBarangayAccount;
  const isMasterAdmin = isMdrrmoAccount && user?.role === 'master_admin';
  const canAccessDashboard = isBarangayAccount
    ? Boolean(user?.barangay_id && user?.is_active !== false)
    : isMasterAdmin || ['admin', 'logistics', 'dispatcher'].includes(user?.role || '');

  return (
    <AuthContext.Provider value={{ user, token, loading, login, debugLogin, logout, isAdmin: isAdmin && isMdrrmoAccount, isMasterAdmin, isBarangayAccount, isMdrrmoAccount, canAccessDashboard }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
