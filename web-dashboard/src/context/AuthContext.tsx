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
  canAccessDashboard: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedUser = localStorage.getItem('norzagapay_user');
      return savedUser ? JSON.parse(savedUser) as User : null;
    } catch {
      localStorage.removeItem('norzagapay_user');
      return null;
    }
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
    if (!token) {
      setLoading(false);
      return;
    }

    authAPI.me()
      .then((response) => {
        const freshUser = response.data.user as User;
        localStorage.setItem('norzagapay_user', JSON.stringify(freshUser));
        setUser(freshUser);
      })
      .catch(() => {
        setToken(null);
        setUser(null);
        localStorage.removeItem('norzagapay_token');
        localStorage.removeItem('norzagapay_user');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = async (email: string, password: string) => {
    const response = await authAPI.login(email, password);
    const { token: savedToken, user: loggedInUser } = response.data;
    localStorage.setItem('norzagapay_token', savedToken);
    localStorage.setItem('norzagapay_user', JSON.stringify(loggedInUser));
    setToken(savedToken);
    setUser(loggedInUser);
  };

  const debugLogin = async (accountId: string) => {
    const response = await debugAPI.quickLogin(accountId);
    const { token: savedToken, user: loggedInUser } = response.data;
    localStorage.setItem('norzagapay_token', savedToken);
    localStorage.setItem('norzagapay_user', JSON.stringify(loggedInUser));
    setToken(savedToken);
    setUser(loggedInUser);
  };

  const logout = () => {
    localStorage.removeItem('norzagapay_token');
    localStorage.removeItem('norzagapay_user');
    setToken(null);
    setUser(null);
  };

  const isAdmin = user?.role === 'admin';
  const isMasterAdmin = user?.role === 'master_admin';
  const canAccessDashboard = isMasterAdmin || ['admin', 'logistics', 'dispatcher'].includes(user?.role || '');

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
