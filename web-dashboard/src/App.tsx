import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import NotificationManager from './components/NotificationManager';
import LoginPage from './pages/LoginPage';
import CommandCenter from './pages/CommandCenter';
import VerificationPage from './pages/VerificationPage';
import ResourceRequestsPage from './pages/ResourceRequestsPage';
import RespondUnitsPage from './pages/RespondUnitsPage';
import ResponderTrackerPage from './pages/ResponderTrackerPage';
import UsersPage from './pages/UsersPage';
import AlertBroadcastsPage from './pages/AlertBroadcastsPage';
import BarangayOperationsPage from './pages/BarangayOperationsPage';
import BarangayCoordinationPage from './pages/BarangayCoordinationPage';
import OfficersPage from './pages/OfficersPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ReportsPage from './pages/ReportsPage';
import WeatherMonitoringV2 from './pages/WeatherMonitoringV2';
import EvacuationCentersPage from './pages/EvacuationCentersPage';

import './index.css';

function homeForUser(user?: { role?: string; account_scope?: string; barangay_id?: string; coordination_verified?: boolean }) {
  if (user?.account_scope === 'barangay' || user?.barangay_id) {
    if (!user.coordination_verified) return '/barangay/coordination';
    return user.role === 'staff' ? '/barangay/community' : '/';
  }
  const role = user?.role;
  if (role === 'admin') return '/users';
  if (role === 'logistics') return '/evacuation-centers';
  if (role === 'dispatcher') return '/';
  return '/';
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessDashboard } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner"/></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessDashboard) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleAccess({ roles, scope = 'mdrrmo', allowPendingCoordination = false, children }: { roles: string[]; scope?: 'mdrrmo' | 'barangay'; allowPendingCoordination?: boolean; children: React.ReactNode }) {
  const { user, isMasterAdmin, isBarangayAccount } = useAuth();
  const location = useLocation();
  const hasScope = scope === 'barangay' ? isBarangayAccount : !isBarangayAccount;
  if (!hasScope || (!isMasterAdmin && !roles.includes(user?.role || ''))) {
    return <Navigate to={homeForUser(user || undefined)} replace />;
  }
  if (scope === 'barangay' && !allowPendingCoordination && !user?.coordination_verified) {
    return <Navigate to="/barangay/coordination" replace />;
  }
  if (scope === 'barangay' && user?.coordination_verified && location.pathname === '/barangay/coordination') {
    return <Navigate to={homeForUser(user || undefined)} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading, isBarangayAccount } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner"/></div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route index element={isBarangayAccount
          ? <RoleAccess scope="barangay" roles={['admin', 'dispatcher', 'responder', 'staff']}><BarangayOperationsPage section="command-center" /></RoleAccess>
          : <RoleAccess roles={['dispatcher']}><CommandCenter /></RoleAccess>} />
        <Route path="weather-monitoring" element={<RoleAccess roles={[]}><WeatherMonitoringV2 /></RoleAccess>} />
        <Route path="advisories" element={<Navigate to="/weather-monitoring" replace />} />
        <Route path="earthquakes" element={<Navigate to="/weather-monitoring" replace />} />
        <Route path="reports" element={<RoleAccess roles={['dispatcher']}><ReportsPage /></RoleAccess>} />
        <Route path="requests" element={<RoleAccess roles={['logistics']}><ResourceRequestsPage /></RoleAccess>} />
        <Route path="evacuation-centers" element={<RoleAccess roles={['admin', 'logistics']}><EvacuationCentersPage /></RoleAccess>} />
        <Route path="verification" element={<Navigate to="/verification/officers" replace />} />
        <Route path="verification/officers" element={<RoleAccess roles={['admin']}><VerificationPage category="officers" /></RoleAccess>} />
        <Route path="verification/barangay" element={<RoleAccess roles={['admin']}><VerificationPage category="barangay" /></RoleAccess>} />
        <Route path="respond-units" element={<RoleAccess roles={['logistics']}><RespondUnitsPage /></RoleAccess>} />
        <Route path="responder-tracker" element={<RoleAccess roles={['logistics', 'dispatcher']}><ResponderTrackerPage /></RoleAccess>} />
        <Route path="users" element={<RoleAccess roles={['admin']}><UsersPage /></RoleAccess>} />
        <Route path="alert-broadcasts" element={<RoleAccess roles={['admin']}><AlertBroadcastsPage /></RoleAccess>} />
        <Route path="officers" element={<RoleAccess roles={['admin']}><OfficersPage /></RoleAccess>} />
        <Route path="analytics" element={<RoleAccess roles={['admin']}><AnalyticsPage /></RoleAccess>} />
        <Route path="barangay/coordination" element={<RoleAccess scope="barangay" roles={['admin', 'dispatcher', 'responder', 'staff']} allowPendingCoordination><BarangayCoordinationPage /></RoleAccess>} />
        <Route path="barangay/reports" element={<RoleAccess scope="barangay" roles={['admin', 'dispatcher', 'responder']}><BarangayOperationsPage section="reports" /></RoleAccess>} />
        <Route path="barangay/team" element={<RoleAccess scope="barangay" roles={['admin', 'responder']}><BarangayOperationsPage section="team" /></RoleAccess>} />
        <Route path="barangay/assistance" element={<RoleAccess scope="barangay" roles={['dispatcher', 'responder']}><BarangayOperationsPage section="assistance" /></RoleAccess>} />
        <Route path="barangay/community" element={<RoleAccess scope="barangay" roles={['admin', 'staff']}><BarangayOperationsPage section="community" /></RoleAccess>} />
        <Route path="barangay/hotlines" element={<RoleAccess scope="barangay" roles={['admin', 'staff']}><BarangayOperationsPage section="hotlines" /></RoleAccess>} />
        <Route path="barangay/evac-stations" element={<RoleAccess scope="barangay" roles={['admin', 'responder', 'staff']}><EvacuationCentersPage /></RoleAccess>} />
        <Route path="barangay/analytics" element={<RoleAccess scope="barangay" roles={['admin']}><BarangayOperationsPage section="analytics" /></RoleAccess>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationManager />
        <Toaster position="top-right" toastOptions={{
          style: { background:'#1A2332', color:'#F4F6F7', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px' },
        }} />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
