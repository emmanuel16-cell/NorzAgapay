import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import NotificationManager from './components/NotificationManager';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import PublicReportPage from './pages/PublicReportPage';
import CommandCenter from './pages/CommandCenter';
import VerificationPage from './pages/VerificationPage';
import ResourceRequestsPage from './pages/ResourceRequestsPage';
import RespondUnitsPage from './pages/RespondUnitsPage';
import UsersPage from './pages/UsersPage';
import AlertBroadcastsPage from './pages/AlertBroadcastsPage';
import OfficersPage from './pages/OfficersPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ReportsPage from './pages/ReportsPage';
import EvacuationCentersPage from './pages/EvacuationCentersPage';
import MunicipalityBoundaryPage from './pages/MunicipalityBoundaryPage';
import CommandLocationsPage from './pages/CommandLocationsPage';
import { MunicipalityBoundaryProvider } from './context/MunicipalityBoundaryContext';

import './index.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessDashboard } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;
  if (!user || !canAccessDashboard) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LoginRoute() {
  const { user, loading, canAccessDashboard } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;
  if (user && canAccessDashboard) return <Navigate to="/command-center" replace />;
  return <LoginPage />;
}

function RoleAccess({ roles, children, allowBarangayDashboard = false }: { roles: string[]; children: React.ReactNode; allowBarangayDashboard?: boolean }) {
  const { user, isMasterAdmin } = useAuth();
  const isBarangay = user?.account_kind === 'barangay';
  const barangayDashboardPage = allowBarangayDashboard && isBarangay && ['admin', 'dispatcher'].includes(user?.role || '');
  if (!isMasterAdmin && !roles.includes(user?.role || '') && !barangayDashboardPage) {
    return <Navigate to={isBarangay ? '/command-center' : user?.role === 'admin' ? '/users' : user?.role === 'logistics' ? '/evacuation-centers' : '/command-center'} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/report" element={<PublicReportPage />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route path="command-center" element={<RoleAccess roles={['dispatcher']} allowBarangayDashboard><CommandCenter /></RoleAccess>} />
        <Route path="weather-monitoring" element={<Navigate to="/command-center" replace />} />
        <Route path="advisories" element={<Navigate to="/command-center" replace />} />
        <Route path="earthquakes" element={<Navigate to="/command-center" replace />} />
        <Route path="reports" element={<RoleAccess roles={['dispatcher']} allowBarangayDashboard><ReportsPage /></RoleAccess>} />
        <Route path="locations" element={<RoleAccess roles={['admin', 'dispatcher']} allowBarangayDashboard><CommandLocationsPage /></RoleAccess>} />
        <Route path="requests" element={<RoleAccess roles={['dispatcher']}><ResourceRequestsPage /></RoleAccess>} />
        <Route path="evacuation-centers" element={<RoleAccess roles={['admin', 'logistics']}><EvacuationCentersPage /></RoleAccess>} />
        <Route path="municipality-boundary" element={<RoleAccess roles={['logistics']}><MunicipalityBoundaryPage /></RoleAccess>} />
        <Route path="verification" element={<Navigate to="/verification/barangay" replace />} />
        <Route path="verification/officers" element={<Navigate to="/verification/barangay" replace />} />
        <Route path="verification/barangay" element={<RoleAccess roles={['admin']}><VerificationPage category="barangay" /></RoleAccess>} />
        <Route path="respond-units" element={<RoleAccess roles={['logistics', 'dispatcher', 'master_admin']}><RespondUnitsPage /></RoleAccess>} />
        <Route path="users" element={<RoleAccess roles={['admin']}><UsersPage /></RoleAccess>} />
        <Route path="alert-broadcasts" element={<RoleAccess roles={['admin']}><AlertBroadcastsPage /></RoleAccess>} />
        <Route path="officers" element={<RoleAccess roles={['admin', 'logistics']}><OfficersPage /></RoleAccess>} />
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
        <MunicipalityBoundaryProvider>
          <NotificationManager />
          <Toaster position="top-right" toastOptions={{
            style: { background: '#1A2332', color: '#F4F6F7', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px' },
          }} />
          <AppRoutes />
        </MunicipalityBoundaryProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
