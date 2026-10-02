import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import NotificationManager from './components/NotificationManager';
import LoginPage from './pages/LoginPage';
import CommandCenter from './pages/CommandCenter';
import MissionsPage from './pages/MissionsPage';
import VerificationPage from './pages/VerificationPage';
import ResourceRequestsPage from './pages/ResourceRequestsPage';
import RespondUnitsPage from './pages/RespondUnitsPage';
import ResponderTrackerPage from './pages/ResponderTrackerPage';
import UsersPage from './pages/UsersPage';
import AlertBroadcastsPage from './pages/AlertBroadcastsPage';
import OfficersPage from './pages/OfficersPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ReportsPage from './pages/ReportsPage';
import WeatherMonitoringV2 from './pages/WeatherMonitoringV2';
import EvacuationCentersPage from './pages/EvacuationCentersPage';

import './index.css';

function homeForRole(role?: string) {
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

function RoleAccess({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user, isMasterAdmin } = useAuth();
  if (!isMasterAdmin && !roles.includes(user?.role || '')) {
    return <Navigate to={homeForRole(user?.role)} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner"/></div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<RoleAccess roles={['dispatcher']}><CommandCenter /></RoleAccess>} />
        <Route path="weather-monitoring" element={<RoleAccess roles={[]}><WeatherMonitoringV2 /></RoleAccess>} />
        <Route path="advisories" element={<Navigate to="/weather-monitoring" replace />} />
        <Route path="earthquakes" element={<Navigate to="/weather-monitoring" replace />} />
        <Route path="reports" element={<RoleAccess roles={['dispatcher']}><ReportsPage /></RoleAccess>} />
        <Route path="missions" element={<RoleAccess roles={['dispatcher']}><MissionsPage /></RoleAccess>} />
        <Route path="requests" element={<RoleAccess roles={['logistics']}><ResourceRequestsPage /></RoleAccess>} />
        <Route path="evacuation-centers" element={<RoleAccess roles={['logistics']}><EvacuationCentersPage /></RoleAccess>} />
        <Route path="verification" element={<Navigate to="/verification/officers" replace />} />
        <Route path="verification/officers" element={<RoleAccess roles={['admin']}><VerificationPage category="officers" /></RoleAccess>} />
        <Route path="verification/barangay" element={<RoleAccess roles={['admin']}><VerificationPage category="barangay" /></RoleAccess>} />
        <Route path="respond-units" element={<RoleAccess roles={['logistics']}><RespondUnitsPage /></RoleAccess>} />
        <Route path="responder-tracker" element={<RoleAccess roles={['logistics', 'dispatcher']}><ResponderTrackerPage /></RoleAccess>} />
        <Route path="shipments" element={<Navigate to="/responder-tracker" replace />} />
        <Route path="users" element={<RoleAccess roles={['admin']}><UsersPage /></RoleAccess>} />
        <Route path="alert-broadcasts" element={<RoleAccess roles={['admin']}><AlertBroadcastsPage /></RoleAccess>} />
        <Route path="officers" element={<RoleAccess roles={['admin']}><OfficersPage /></RoleAccess>} />
        <Route path="analytics" element={<RoleAccess roles={['admin']}><AnalyticsPage /></RoleAccess>} />
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
