import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authAPI } from '../lib/api';
import { debugAPI } from '../lib/api';

interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
  unit_type?: string;
  status: string;
  verified: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  debugLogin: (accountId: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isCommander: boolean;
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
      authAPI.me()
        .then((res) => setUser(res.data.user))
        .catch(() => { setToken(null); localStorage.removeItem('norzagapay_token'); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const res = await authAPI.login(email, password);
    const { user: u, token: t } = res.data;
    localStorage.setItem('norzagapay_token', t);
    localStorage.setItem('norzagapay_user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  };

  const debugLogin = async (accountId: string) => {
    const res = await debugAPI.quickLogin(accountId);
    const { user: u, token: t } = res.data;
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
  const isCommander = user?.role === 'commander';

  return (
    <AuthContext.Provider value={{ user, token, loading, login, debugLogin, logout, isAdmin, isCommander }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
