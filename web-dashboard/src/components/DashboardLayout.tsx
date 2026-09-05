import { useState, useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  CloudSun,
  MapPin,
  AlertTriangle,
  Target,
  Tent,
  ClipboardList,
  Ambulance,
  Route,
  CheckCircle2,
  Users,
  Award,
  BarChart3,
  LogOut,
} from 'lucide-react';

interface NavItem {
  path?: string;
  icon?: ReactNode;
  label: string;
  section?: boolean;
}

const navItems: NavItem[] = [
  { path: '/weather-monitoring', icon: <CloudSun size={19} strokeWidth={1.8} />, label: 'Weather Monitoring' },
  { label: 'Operations', section: true },
  { path: '/', icon: <MapPin size={19} strokeWidth={1.8} />, label: 'Command Center' },
  { path: '/reports', icon: <AlertTriangle size={19} strokeWidth={1.8} />, label: 'Incidents' },
  { path: '/missions', icon: <Target size={19} strokeWidth={1.8} />, label: 'Missions' },
  { label: 'Logistics', section: true },
  { path: '/evacuation-centers', icon: <Tent size={19} strokeWidth={1.8} />, label: 'Evacuation Centers' },
  { path: '/requests', icon: <ClipboardList size={19} strokeWidth={1.8} />, label: 'Resource Requests' },
  { path: '/respond-units', icon: <Ambulance size={19} strokeWidth={1.8} />, label: 'Respond Units' },
  { path: '/shipments', icon: <Route size={19} strokeWidth={1.8} />, label: 'Shipment Tracker' },
  { label: 'Administration', section: true },
  { path: '/verification', icon: <CheckCircle2 size={19} strokeWidth={1.8} />, label: 'Verification Queue' },
  { path: '/users', icon: <Users size={19} strokeWidth={1.8} />, label: 'User Management' },
  { path: '/officers', icon: <Award size={19} strokeWidth={1.8} />, label: 'Officers' },
  { path: '/analytics', icon: <BarChart3 size={19} strokeWidth={1.8} />, label: 'Analytics' },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  const handleToggle = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  // Dispatch window resize event so Leaflet map and charts auto-adjust size smoothly
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 280);
    return () => clearTimeout(timer);
  }, [isCollapsed]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = user?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'NA';

  return (
    <div className={`app-layout ${isCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div
            className="sidebar-brand"
            onClick={isCollapsed ? () => setIsCollapsed(false) : undefined}
            title={isCollapsed ? 'Click to expand sidebar' : undefined}
            role={isCollapsed ? 'button' : undefined}
            tabIndex={isCollapsed ? 0 : undefined}
            onKeyDown={isCollapsed ? (e) => (e.key === 'Enter' || e.key === ' ') && setIsCollapsed(false) : undefined}
          >
            <img className="sidebar-logo" src="/NA-icon.png" alt="NorzAgapay" />
            {!isCollapsed && (
              <div className="sidebar-brand-text">
                <div className="sidebar-title">NorzAgapay</div>
                <div className="sidebar-subtitle">MDRRMO Command</div>
              </div>
            )}
          </div>

          {!isCollapsed && (
            <button
              className="sidebar-toggle-btn"
              onClick={handleToggle}
              title="Minimize sidebar"
              aria-label="Minimize sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7"></polyline>
                <polyline points="18 17 13 12 18 7"></polyline>
              </svg>
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item, i) =>
            item.section ? (
              <div
                key={i}
                className={`nav-section-label ${isCollapsed ? 'collapsed' : ''}`}
                title={isCollapsed ? item.label : undefined}
              >
                {isCollapsed ? <div className="nav-section-divider" /> : item.label}
              </div>
            ) : (
              <NavLink
                key={item.path}
                to={item.path!}
                end={item.path === '/'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
                title={isCollapsed ? item.label : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                {!isCollapsed && <span className="nav-text">{item.label}</span>}
              </NavLink>
            )
          )}
        </nav>

        <div className={`sidebar-footer ${isCollapsed ? 'collapsed' : ''}`}>
          {!isCollapsed ? (
            <>
              <div className="user-badge">
                <div className="user-avatar">{initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.full_name}
                  </div>
                  <div className="user-role">{user?.role?.replace(/_/g, ' ')}</div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="btn btn-outline btn-sm"
                style={{ width: '100%', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <LogOut size={15} strokeWidth={1.8} />
                <span>Sign Out</span>
              </button>
            </>
          ) : (
            <div className="collapsed-footer-actions">
              <div
                className="user-avatar"
                title={`${user?.full_name || ''} (${user?.role?.replace(/_/g, ' ') || ''})`}
              >
                {initials}
              </div>
              <button
                onClick={handleLogout}
                className="collapsed-logout-btn"
                title="Sign Out"
                aria-label="Sign Out"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <LogOut size={16} strokeWidth={1.8} />
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

