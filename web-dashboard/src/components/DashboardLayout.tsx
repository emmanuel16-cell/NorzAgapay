import { useState, useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  MapPin,
  AlertTriangle,
  Tent,
  ClipboardList,
  Ambulance,
  CheckCircle2,
  Users,
  Award,
  BarChart3,
  LogOut,
  Moon,
  Sun,
  Megaphone,
  Map as MapIcon,
  Menu,
  X,
} from 'lucide-react';

interface NavItem {
  path?: string;
  icon?: ReactNode;
  label: string;
  section?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Incident Monitoring', section: true },
  { path: '/command-center', icon: <MapPin size={19} strokeWidth={1.8} />, label: 'Command Center' },
  { path: '/reports', icon: <AlertTriangle size={19} strokeWidth={1.8} />, label: 'Incidents' },
  { path: '/locations', icon: <MapIcon size={19} strokeWidth={1.8} />, label: 'Command Locations' },
  { path: '/requests', icon: <ClipboardList size={19} strokeWidth={1.8} />, label: 'Assistance Request' },
  { label: 'Operations', section: true },
  { path: '/evacuation-centers', icon: <Tent size={19} strokeWidth={1.8} />, label: 'Evacuation Centers' },
  { path: '/municipality-boundary', icon: <MapIcon size={19} strokeWidth={1.8} />, label: 'Municipality Boundary' },
  { path: '/respond-units', icon: <Ambulance size={19} strokeWidth={1.8} />, label: 'Respond Units' },
  { path: '/officers', icon: <Award size={19} strokeWidth={1.8} />, label: 'Officers' },
  { label: 'Administration', section: true },
  { path: '/verification/barangay', icon: <CheckCircle2 size={19} strokeWidth={1.8} />, label: 'Barangay Verification' },
  { path: '/users', icon: <Users size={19} strokeWidth={1.8} />, label: 'User Management' },
  { path: '/alert-broadcasts', icon: <Megaphone size={19} strokeWidth={1.8} />, label: 'Alert Broadcasts' },
  { path: '/analytics', icon: <BarChart3 size={19} strokeWidth={1.8} />, label: 'Analytics' },
];

export default function DashboardLayout() {
  const { user, logout, isMasterAdmin } = useAuth();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return localStorage.getItem('dashboard_theme') === 'light' ? 'light' : 'dark';
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('dashboard_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(current => current === 'dark' ? 'light' : 'dark');

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

  const roleNav = user?.account_kind === 'barangay'
    ? navItems.filter(item => ['Incident Monitoring', '/command-center', '/reports', 'Operations', '/locations'].includes(item.path || item.label))
    : isMasterAdmin
    ? navItems
    : user?.role === 'admin'
      ? navItems.filter(item => ['Operations', '/locations', '/officers', 'Administration', '/verification/barangay', '/users', '/alert-broadcasts', '/analytics'].includes(item.path || item.label))
      : user?.role === 'logistics'
        ? navItems.filter(item => ['Operations', '/evacuation-centers', '/municipality-boundary', '/respond-units', '/officers'].includes(item.path || item.label))
        : user?.role === 'dispatcher'
          ? navItems.filter(item => ['Incident Monitoring', '/command-center', '/reports', '/requests', 'Operations', '/locations', '/respond-units'].includes(item.path || item.label))
          : [];

  return (
    <div className={`app-layout ${isCollapsed ? 'sidebar-collapsed' : ''}`}>
      {mobileOpen && <button type="button" className="mobile-sidebar-backdrop" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`}>
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
          {roleNav.map((item, i) =>
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
                end={item.path === '/command-center'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
                onClick={() => setMobileOpen(false)}
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
                  <div className="user-role">{user?.role === 'logistics' ? 'Staff' : user?.role?.replace(/_/g, ' ')}</div>
                </div>
                <button
                  className="theme-toggle-btn"
                  onClick={toggleTheme}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                </button>
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
                title={`${user?.full_name || ''} (${user?.role === 'logistics' ? 'Staff' : user?.role?.replace(/_/g, ' ') || ''})`}
              >
                {initials}
              </div>
              <button
                className="collapsed-theme-btn"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
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
        <div className="mobile-dashboard-header">
          <button type="button" aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={21} /> : <Menu size={21} />}</button>
          <strong>{user?.account_kind === 'barangay' ? user.barangay_name || 'Barangay Command' : 'NorzAgapay Command'}</strong>
          <button type="button" aria-label="Sign out" onClick={handleLogout}><LogOut size={18} /></button>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
