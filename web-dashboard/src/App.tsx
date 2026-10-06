import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import NotificationManager from './components/NotificationManager';
import LoginPage from './pages/LoginPage';
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
import { MunicipalityBoundaryProvider } from './context/MunicipalityBoundaryContext';

import './index.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessDashboard } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;
  if (!user || !canAccessDashboard) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleAccess({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user, isMasterAdmin } = useAuth();
  if (!isMasterAdmin && !roles.includes(user?.role || '')) {
    return <Navigate to={user?.role === 'admin' ? '/users' : user?.role === 'logistics' ? '/evacuation-centers' : '/'} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner" /></div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<RoleAccess roles={['dispatcher']}><CommandCenter /></RoleAccess>} />
        <Route path="weather-monitoring" element={<Navigate to="/" replace />} />
        <Route path="advisories" element={<Navigate to="/" replace />} />
        <Route path="earthquakes" element={<Navigate to="/" replace />} />
        <Route path="reports" element={<RoleAccess roles={['dispatcher']}><ReportsPage /></RoleAccess>} />
        <Route path="requests" element={<RoleAccess roles={['dispatcher']}><ResourceRequestsPage /></RoleAccess>} />
        <Route path="evacuation-centers" element={<RoleAccess roles={['admin', 'logistics']}><EvacuationCentersPage /></RoleAccess>} />
        <Route path="municipality-boundary" element={<RoleAccess roles={['logistics']}><MunicipalityBoundaryPage /></RoleAccess>} />
        <Route path="verification" element={<Navigate to="/verification/barangay" replace />} />
        <Route path="verification/officers" element={<Navigate to="/verification/barangay" replace />} />
        <Route path="verification/barangay" element={<RoleAccess roles={['admin']}><VerificationPage category="barangay" /></RoleAccess>} />
        <Route path="respond-units" element={<RoleAccess roles={['logistics']}><RespondUnitsPage /></RoleAccess>} />
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
