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
import InventoryPage from './pages/InventoryPage';
import VolunteerDispatchPage from './pages/VolunteerDispatchPage';
import RespondUnitsPage from './pages/RespondUnitsPage';
import ShipmentsPage from './pages/ShipmentsPage';
import UsersPage from './pages/UsersPage';
import OfficersPage from './pages/OfficersPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ReportsPage from './pages/ReportsPage';
import WeatherMonitoringV2 from './pages/WeatherMonitoringV2';
import AdvisoriesPage from './pages/AdvisoriesPage';
import EarthquakeMonitoringPage from './pages/EarthquakeMonitoringPage';
import EvacuationCentersPage from './pages/EvacuationCentersPage';

import './index.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin, isCommander } = useAuth();
  if (loading) return <div className="loading-overlay"><div className="spinner"/></div>;
  if (!user) return <Navigate to="/login" replace />;
  
  // Only allow admin and commander to access dashboard
  if (!isAdmin && !isCommander) {
    return <Navigate to="/login" replace />;
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
        <Route index element={<CommandCenter />} />
        <Route path="weather-monitoring" element={<WeatherMonitoringV2 />} />
        <Route path="advisories" element={<AdvisoriesPage />} />
        <Route path="earthquakes" element={<EarthquakeMonitoringPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="missions" element={<MissionsPage />} />
        <Route path="requests" element={<ResourceRequestsPage />} />
        <Route path="evacuation-centers" element={<EvacuationCentersPage />} />
        <Route path="verification" element={<VerificationPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="volunteer-dispatch" element={<VolunteerDispatchPage />} />
        <Route path="respond-units" element={<RespondUnitsPage />} />
        <Route path="shipments" element={<ShipmentsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="officers" element={<OfficersPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
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
