import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import NotificationManager from './components/NotificationManager';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import PublicReportPage from './pages/PublicReportPage';
import TrackReportPage from './pages/TrackReportPage';
import CommandCenter from './pages/CommandCenter';
import VerificationPage from './pages/VerificationPage';
import ResourceRequestsPage from './pages/ResourceRequestsPage';
import RespondUnitsPage from './pages/RespondUnitsPage';
import UsersPage from './pages/UsersPage';
import AlertBroadcastsPage from './pages/AlertBroadcastsPage';
import OfficersPage from './pages/OfficersPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ReportsPage from './pages/ReportsPage';
import ResidentReportsPage from './pages/ResidentReportsPage';
import ResponderWorkspacePage from './pages/ResponderWorkspacePage';
import BarangayStaffWorkspacePage from './pages/BarangayStaffWorkspacePage';
import MunicipalityBoundaryPage from './pages/MunicipalityBoundaryPage';
import CommandLocationsPage from './pages/CommandLocationsPage';
import BarangayDashboardPage from './pages/BarangayDashboardPage';
import BarangayAdministrationPage from './pages/BarangayAdministrationPage';
import BarangayTeamPage from './pages/BarangayTeamPage';
import BarangayBoardPage from './pages/BarangayBoardPage';
import BarangayAssistancePage from './pages/BarangayAssistancePage';
import BarangayAnalyticsPage from './pages/BarangayAnalyticsPage';
import BarangayRegistrationPage from './pages/BarangayRegistrationPage';
import { MunicipalityBoundaryProvider } from './context/MunicipalityBoundaryContext';

import './index.css';

function landingPath(user: { role?: string; account_kind?: string } | null) {
  if (user?.account_kind === 'barangay') {
    if (user.role === 'responder') return '/my-responses';
    if (user.role === 'staff') return '/barangay-workspace';
    if (user.role === 'admin' && !user.coordination_verified) return '/barangay-settings';
    if (user.role === 'admin') return '/barangay-dashboard';
    if (user.role === 'dispatcher') return '/barangay-dashboard';
    return '/command-center';
  }
  if (user?.role === 'resident') return '/my-reports';
  if (user?.role === 'responder') return '/my-responses';
  if (user?.role === 'admin') return '/users';
  if (user?.role === 'logistics') return '/respond-units';
  return '/command-center';
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessDashboard } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;
  if (!user || !canAccessDashboard) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LoginRoute() {
  const { user, loading, canAccessDashboard } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;
  if (user && canAccessDashboard) return <Navigate to={landingPath(user)} replace />;
  return <LoginPage />;
}

function RoleAccess({ roles, children, allowBarangayDashboard = false }: { roles: string[]; children: React.ReactNode; allowBarangayDashboard?: boolean }) {
  const { user, isMasterAdmin } = useAuth();
  const isBarangay = user?.account_kind === 'barangay';
  const barangayDashboardPage = allowBarangayDashboard && isBarangay && user?.coordination_verified && ['admin', 'dispatcher'].includes(user.role || '');
  const roleAccess = roles.includes(user?.role || '');
  const masterAdminAccess = isMasterAdmin && !roles.includes('resident') && !roles.includes('responder');
  if (!roleAccess && !masterAdminAccess && !barangayDashboardPage) {
    return <Navigate to={landingPath(user)} replace />;
  }
  return <>{children}</>;
}

function BarangayAccess({ roles, children, allowInactive = false }: { roles: string[]; children: React.ReactNode; allowInactive?: boolean }) {
  const { user } = useAuth();
  if (user?.account_kind !== 'barangay' || !roles.includes(user.role || '')) {
    return <Navigate to={landingPath(user)} replace />;
  }
  if (!allowInactive && !user.coordination_verified) return <Navigate to="/barangay-settings" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/report" element={<PublicReportPage />} />
      <Route path="/track-report" element={<TrackReportPage />} />
      <Route path="/barangay/register" element={<BarangayRegistrationPage />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route path="command-center" element={<RoleAccess roles={['dispatcher']} allowBarangayDashboard><CommandCenter /></RoleAccess>} />
        <Route path="weather-monitoring" element={<Navigate to="/command-center" replace />} />
        <Route path="advisories" element={<Navigate to="/command-center" replace />} />
        <Route path="earthquakes" element={<Navigate to="/command-center" replace />} />
        <Route path="reports" element={<RoleAccess roles={['dispatcher']} allowBarangayDashboard><ReportsPage /></RoleAccess>} />
        <Route path="my-reports" element={<RoleAccess roles={['resident']}><ResidentReportsPage /></RoleAccess>} />
        <Route path="my-responses" element={<RoleAccess roles={['responder']}><ResponderWorkspacePage /></RoleAccess>} />
        <Route path="barangay-workspace" element={<BarangayAccess roles={['admin', 'staff']}><BarangayStaffWorkspacePage /></BarangayAccess>} />
        <Route path="barangay-dashboard" element={<BarangayAccess roles={['admin', 'dispatcher']}><BarangayDashboardPage /></BarangayAccess>} />
        <Route path="barangay-settings" element={<BarangayAccess roles={['admin', 'dispatcher', 'responder', 'staff']} allowInactive><BarangayAdministrationPage /></BarangayAccess>} />
        <Route path="barangay-team" element={<BarangayAccess roles={['admin', 'staff']}><BarangayTeamPage /></BarangayAccess>} />
        <Route path="barangay-board" element={<BarangayAccess roles={['admin', 'dispatcher', 'responder', 'staff']}><BarangayBoardPage /></BarangayAccess>} />
        <Route path="barangay-assistance" element={<BarangayAccess roles={['admin', 'dispatcher', 'responder']}><BarangayAssistancePage /></BarangayAccess>} />
        <Route path="barangay-analytics" element={<BarangayAccess roles={['admin']}><BarangayAnalyticsPage /></BarangayAccess>} />
        <Route path="locations" element={<RoleAccess roles={['admin', 'dispatcher']} allowBarangayDashboard><CommandLocationsPage /></RoleAccess>} />
        <Route path="requests" element={<RoleAccess roles={['dispatcher']}><ResourceRequestsPage /></RoleAccess>} />
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
