import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import NotificationManager from './components/NotificationManager';
import { MunicipalityBoundaryProvider } from './context/MunicipalityBoundaryContext';

import './index.css';

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Page failed to load:', error);
  }

  render() {
    if (this.state.hasError) {
      return <main className="loading-overlay" role="alert"><section className="card"><h1>Page unavailable</h1><p>This page could not be loaded. Reload and try again.</p><button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>Reload page</button></section></main>;
    }
    return this.props.children;
  }
}

const LoginPage = lazy(() => import('./pages/LoginPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const PublicReportPage = lazy(() => import('./pages/PublicReportPage'));
const TrackReportPage = lazy(() => import('./pages/TrackReportPage'));
const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const VerificationPage = lazy(() => import('./pages/VerificationPage'));
const ResourceRequestsPage = lazy(() => import('./pages/ResourceRequestsPage'));
const RespondUnitsPage = lazy(() => import('./pages/RespondUnitsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const AlertBroadcastsPage = lazy(() => import('./pages/AlertBroadcastsPage'));
const OfficersPage = lazy(() => import('./pages/OfficersPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const ResidentReportsPage = lazy(() => import('./pages/ResidentReportsPage'));
const ResidentAlertsPage = lazy(() => import('./pages/ResidentPortalPages').then((pages) => ({ default: pages.ResidentAlertsPage })));
const ResidentEvacuationPage = lazy(() => import('./pages/ResidentPortalPages').then((pages) => ({ default: pages.ResidentEvacuationPage })));
const ResidentHomePage = lazy(() => import('./pages/ResidentPortalPages').then((pages) => ({ default: pages.ResidentHomePage })));
const ResidentHotlinesPage = lazy(() => import('./pages/ResidentPortalPages').then((pages) => ({ default: pages.ResidentHotlinesPage })));
const ResidentReportHubPage = lazy(() => import('./pages/ResidentPortalPages').then((pages) => ({ default: pages.ResidentReportHubPage })));
const ResidentIncidentReportPage = lazy(() => import('./pages/ResidentIncidentReportPage'));
const ResponderWorkspacePage = lazy(() => import('./pages/ResponderWorkspacePage'));
const BarangayStaffWorkspacePage = lazy(() => import('./pages/BarangayStaffWorkspacePage'));
const MunicipalityBoundaryPage = lazy(() => import('./pages/MunicipalityBoundaryPage'));
const CommandLocationsPage = lazy(() => import('./pages/CommandLocationsPage'));
const BarangayDashboardPage = lazy(() => import('./pages/BarangayDashboardPage'));
const BarangayAdministrationPage = lazy(() => import('./pages/BarangayAdministrationPage'));
const BarangayTeamPage = lazy(() => import('./pages/BarangayTeamPage'));
const BarangayBoardPage = lazy(() => import('./pages/BarangayBoardPage'));
const BarangayAssistancePage = lazy(() => import('./pages/BarangayAssistancePage'));
const BarangayAnalyticsPage = lazy(() => import('./pages/BarangayAnalyticsPage'));
const BarangayRegistrationPage = lazy(() => import('./pages/BarangayRegistrationPage'));
const ResponderUnitTeamPage = lazy(() => import('./pages/ResponderUnitTeamPage'));
const ResidentRegistrationPage = lazy(() => import('./pages/ResidentRegistrationPage'));

function landingPath(user: { role?: string; account_kind?: string; coordination_verified?: boolean } | null) {
  if (user?.account_kind === 'barangay') {
    if (user.role === 'responder') return '/my-responses';
    if (user.role === 'staff') return '/barangay-workspace';
    if (user.role === 'admin' && !user.coordination_verified) return '/barangay/register';
    if (user.role === 'admin') return '/barangay-dashboard';
    if (user.role === 'dispatcher') return '/barangay-dashboard';
    return '/command-center';
  }
  if (user?.role === 'resident') return '/resident-home';
  if (user?.role === 'responder') return '/my-responses';
  if (user?.role === 'admin') return '/users';
  if (user?.role === 'logistics') return '/users';
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

function RoleAccess({ roles, children, allowBarangayRoles = [] }: { roles: string[]; children: React.ReactNode; allowBarangayRoles?: string[] }) {
  const { user, isMasterAdmin } = useAuth();
  const isBarangay = user?.account_kind === 'barangay';
  const barangayRoleAccess = isBarangay && Boolean(user?.coordination_verified) && allowBarangayRoles.includes(user?.role || '');
  const roleAccess = !isBarangay && roles.includes(user?.role || '');
  const masterAdminAccess = !isBarangay && isMasterAdmin && !roles.includes('resident') && !roles.includes('responder');
  if (!roleAccess && !masterAdminAccess && !barangayRoleAccess) {
    return <Navigate to={landingPath(user)} replace />;
  }
  return <>{children}</>;
}

function BarangayAccess({ roles, children, allowInactive = false }: { roles: string[]; children: React.ReactNode; allowInactive?: boolean }) {
  const { user } = useAuth();
  if (user?.account_kind !== 'barangay' || !roles.includes(user.role || '')) {
    return <Navigate to={landingPath(user)} replace />;
  }
  if (!allowInactive && !user.coordination_verified) return <Navigate to="/barangay/register" replace />;
  return <>{children}</>;
}

function BarangaySettingsRoute() {
  const { user } = useAuth();
  if (user?.account_kind === 'barangay' && user.role === 'admin' && !user.coordination_verified) {
    return <Navigate to="/barangay/register" replace />;
  }
  return <BarangayAccess roles={['admin', 'dispatcher', 'responder', 'staff']} allowInactive><BarangayAdministrationPage /></BarangayAccess>;
}

function IncidentReportsRoute() {
  const { user, isMasterAdmin } = useAuth();
  const isBarangay = user?.account_kind === 'barangay';
  const allowed = isBarangay
    ? Boolean(user?.coordination_verified) && ['dispatcher', 'responder'].includes(user?.role || '')
    : ['dispatcher', 'responder'].includes(user?.role || '') || isMasterAdmin;
  if (!allowed) return <Navigate to={landingPath(user)} replace />;
  return <ReportsPage readOnlyResponder={user?.role === 'responder'} />;
}

function BarangayTeamRoute() {
  const { user } = useAuth();
  if (user?.account_kind === 'barangay') {
    return <BarangayAccess roles={['admin', 'dispatcher', 'responder', 'staff']}><BarangayTeamPage /></BarangayAccess>;
  }
  return <RoleAccess roles={['responder']}><ResponderUnitTeamPage /></RoleAccess>;
}

function BarangayBoardRoute() {
  const { user } = useAuth();
  if (user?.account_kind === 'barangay') {
    return <BarangayAccess roles={['admin', 'dispatcher', 'responder', 'staff']}><BarangayBoardPage /></BarangayAccess>;
  }
  return <RoleAccess roles={['responder']}><BarangayBoardPage /></RoleAccess>;
}

function BarangayAssistanceRoute() {
  const { user } = useAuth();
  if (user?.account_kind === 'barangay') {
    return <BarangayAccess roles={['dispatcher', 'responder']}><BarangayAssistancePage /></BarangayAccess>;
  }
  return <RoleAccess roles={['responder']}><BarangayAssistancePage /></RoleAccess>;
}

function AppRoutes() {
  return (
    <RouteErrorBoundary>
    <Suspense fallback={<div className="loading-overlay" role="status" aria-label="Loading page"><div className="spinner" /></div>}>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/report" element={<PublicReportPage />} />
      <Route path="/track-report" element={<TrackReportPage />} />
      <Route path="/barangay/register" element={<BarangayRegistrationPage />} />
      <Route path="/resident/register" element={<ResidentRegistrationPage />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route path="command-center" element={<RoleAccess roles={['dispatcher']} allowBarangayRoles={['dispatcher']}><CommandCenter /></RoleAccess>} />
        <Route path="weather-monitoring" element={<Navigate to="/command-center" replace />} />
        <Route path="advisories" element={<Navigate to="/command-center" replace />} />
        <Route path="earthquakes" element={<Navigate to="/command-center" replace />} />
        <Route path="reports" element={<IncidentReportsRoute />} />
        <Route path="my-reports" element={<RoleAccess roles={['resident']}><ResidentReportsPage /></RoleAccess>} />
        <Route path="resident-home" element={<RoleAccess roles={['resident']}><ResidentHomePage /></RoleAccess>} />
        <Route path="resident-alerts" element={<RoleAccess roles={['resident']}><ResidentAlertsPage /></RoleAccess>} />
        <Route path="resident-report" element={<RoleAccess roles={['resident']}><ResidentReportHubPage /></RoleAccess>} />
        <Route path="resident-new-report" element={<RoleAccess roles={['resident']}><ResidentIncidentReportPage /></RoleAccess>} />
        <Route path="resident-evacuation" element={<RoleAccess roles={['resident']}><ResidentEvacuationPage /></RoleAccess>} />
        <Route path="resident-hotlines" element={<RoleAccess roles={['resident']}><ResidentHotlinesPage /></RoleAccess>} />
        <Route path="my-responses" element={<RoleAccess roles={['responder']} allowBarangayRoles={['responder']}><ResponderWorkspacePage /></RoleAccess>} />
        <Route path="barangay-workspace" element={<BarangayAccess roles={['admin', 'staff']}><BarangayStaffWorkspacePage /></BarangayAccess>} />
        <Route path="barangay-dashboard" element={<BarangayAccess roles={['admin', 'dispatcher']}><BarangayDashboardPage /></BarangayAccess>} />
        <Route path="barangay-settings" element={<BarangaySettingsRoute />} />
        <Route path="barangay-team" element={<BarangayTeamRoute />} />
        <Route path="barangay-board" element={<BarangayBoardRoute />} />
        <Route path="barangay-assistance" element={<BarangayAssistanceRoute />} />
        <Route path="barangay-analytics" element={<BarangayAccess roles={['admin']}><BarangayAnalyticsPage /></BarangayAccess>} />
        <Route path="locations" element={<RoleAccess roles={['admin', 'logistics']}><CommandLocationsPage /></RoleAccess>} />
        <Route path="requests" element={<RoleAccess roles={['dispatcher']}><ResourceRequestsPage /></RoleAccess>} />
        <Route path="municipality-boundary" element={<RoleAccess roles={['admin', 'logistics']}><MunicipalityBoundaryPage /></RoleAccess>} />
        <Route path="verification" element={<Navigate to="/verification/barangay" replace />} />
        <Route path="verification/officers" element={<Navigate to="/verification/barangay" replace />} />
        <Route path="verification/barangay" element={<RoleAccess roles={['admin', 'logistics']}><VerificationPage category="barangay" /></RoleAccess>} />
        <Route path="respond-units" element={<RoleAccess roles={['admin', 'logistics', 'dispatcher', 'master_admin']}><RespondUnitsPage /></RoleAccess>} />
        <Route path="users" element={<RoleAccess roles={['admin', 'logistics']}><UsersPage /></RoleAccess>} />
        <Route path="alert-broadcasts" element={<RoleAccess roles={['admin', 'logistics']}><AlertBroadcastsPage /></RoleAccess>} />
        <Route path="officers" element={<RoleAccess roles={['admin', 'logistics']}><OfficersPage /></RoleAccess>} />
        <Route path="analytics" element={<RoleAccess roles={['admin', 'logistics']}><AnalyticsPage /></RoleAccess>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </RouteErrorBoundary>
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
