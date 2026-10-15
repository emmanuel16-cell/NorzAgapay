import { useState, useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import UserSettingsModal from './UserSettingsModal';
import {
  MapPin,
  AlertTriangle,
  ClipboardList,
  FileText,
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
  Building2,
  MessageSquareText,
  Handshake,
  Home,
  Bell,
  TentTree,
  PhoneCall,
  Siren,
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
  { path: '/my-reports', icon: <FileText size={19} strokeWidth={1.8} />, label: 'My Reports' },
  { path: '/my-responses', icon: <ClipboardList size={19} strokeWidth={1.8} />, label: 'My Responses' },
  { path: '/reports', icon: <AlertTriangle size={19} strokeWidth={1.8} />, label: 'Incidents' },
  { path: '/barangay-workspace', icon: <FileText size={19} strokeWidth={1.8} />, label: 'Resolved Reports' },
  { label: 'Barangay Operations', section: true },
  { path: '/barangay-dashboard', icon: <Building2 size={19} strokeWidth={1.8} />, label: 'Barangay Overview' },
  { path: '/barangay-assistance', icon: <Handshake size={19} strokeWidth={1.8} />, label: 'Assistance Requests' },
  { path: '/barangay-board', icon: <MessageSquareText size={19} strokeWidth={1.8} />, label: 'Barangay Board' },
  { label: 'Barangay Administration', section: true },
  { path: '/barangay-team', icon: <Users size={19} strokeWidth={1.8} />, label: 'Barangay Team' },
  { path: '/barangay-analytics', icon: <BarChart3 size={19} strokeWidth={1.8} />, label: 'Barangay Analytics' },
  { path: '/locations', icon: <MapIcon size={19} strokeWidth={1.8} />, label: 'Command Locations' },
  { path: '/requests', icon: <ClipboardList size={19} strokeWidth={1.8} />, label: 'Assistance Request' },
  { label: 'Operations', section: true },
  { path: '/municipality-boundary', icon: <MapIcon size={19} strokeWidth={1.8} />, label: 'Municipality Boundary' },
  { path: '/respond-units', icon: <Ambulance size={19} strokeWidth={1.8} />, label: 'Respond Units' },
  { path: '/officers', icon: <Award size={19} strokeWidth={1.8} />, label: 'Officers' },
  { label: 'Administration', section: true },
  { path: '/verification/barangay', icon: <CheckCircle2 size={19} strokeWidth={1.8} />, label: 'Barangay Verification' },
  { path: '/users', icon: <Users size={19} strokeWidth={1.8} />, label: 'User Management' },
  { path: '/alert-broadcasts', icon: <Megaphone size={19} strokeWidth={1.8} />, label: 'Alert Broadcasts' },
  { path: '/analytics', icon: <BarChart3 size={19} strokeWidth={1.8} />, label: 'Analytics' },
];

function navigationForRole(role?: string, accountKind?: string, isMasterAdmin = false, coordinationVerified = false): NavItem[] {
  if (role === 'resident') return [
    { label: 'Resident services', section: true },
    { path: '/resident-home', icon: <Home size={19} strokeWidth={1.8} />, label: 'Home' },
    { path: '/resident-alerts', icon: <Bell size={19} strokeWidth={1.8} />, label: 'Community Alerts' },
    { path: '/resident-report', icon: <Siren size={19} strokeWidth={1.8} />, label: 'Report an Incident' },
    { path: '/my-reports', icon: <FileText size={19} strokeWidth={1.8} />, label: 'My Reports' },
    { path: '/resident-evacuation', icon: <TentTree size={19} strokeWidth={1.8} />, label: 'Evacuation Centers' },
    { path: '/resident-hotlines', icon: <PhoneCall size={19} strokeWidth={1.8} />, label: 'Emergency Hotlines' },
  ];
  if (accountKind === 'barangay') {
    if (role === 'admin' && !coordinationVerified) return [];
    const visiblePaths: Record<string, string[]> = {
      admin: ['/barangay-dashboard', '/barangay-workspace', '/barangay-board', '/barangay-team', '/barangay-analytics'],
      dispatcher: ['/barangay-dashboard', '/command-center', '/reports', '/barangay-assistance', '/barangay-board', '/barangay-team'],
      responder: ['/reports', '/my-responses', '/barangay-assistance', '/barangay-board', '/barangay-team'],
      staff: ['/barangay-workspace', '/barangay-team', '/barangay-board'],
    };
    const paths = visiblePaths[role || ''] || [];
    if (role === 'admin') {
      const adminNavigation = [
        { path: '/barangay-dashboard', label: 'Overview' },
        { path: '/barangay-workspace', label: 'Incidents' },
        { path: '/barangay-board', label: 'Board' },
        { path: '/barangay-team', label: 'User Management' },
        { path: '/barangay-analytics', label: 'Analytics' },
      ];
      return [
        { label: 'Administration', section: true },
        ...adminNavigation.map(({ path, label }) => ({
          ...navItems.find((item) => item.path === path)!,
          label,
          ...(path === '/barangay-workspace' ? { icon: <AlertTriangle size={19} strokeWidth={1.8} /> } : {}),
        })),
      ];
    }
    if (role === 'dispatcher') {
      const item = (path: string) => navItems.find((navItem) => navItem.path === path)!;
      return [
        { label: 'Incident Monitoring', section: true },
        item('/command-center'),
        item('/reports'),
        item('/barangay-assistance'),
        { label: 'Barangay Operations', section: true },
        item('/barangay-dashboard'),
        item('/barangay-board'),
        item('/barangay-team'),
      ];
    }
    if (role === 'responder') {
      const item = (path: string) => navItems.find((navItem) => navItem.path === path)!;
      return [
        { label: 'Incident Monitoring', section: true },
        item('/my-responses'),
        item('/reports'),
        item('/barangay-assistance'),
        { label: 'Barangay Operations', section: true },
        item('/barangay-board'),
        { label: 'Barangay Administration', section: true },
        item('/barangay-team'),
      ];
    }
    const visibleItems = navItems.filter((item) => item.path ? paths.includes(item.path) : paths.some((path) => {
      if (path === '/barangay-dashboard' || path === '/barangay-assistance' || path === '/barangay-board') return item.label === 'Barangay Operations';
      if (path === '/barangay-team' || path === '/barangay-analytics') return item.label === 'Barangay Administration';
      if (path === '/command-center' || path === '/reports') return item.label === 'Incident Monitoring';
      if (path === '/barangay-workspace' || path === '/my-responses') return item.label === 'Incident Monitoring';
      if (path === '/locations') return item.label === 'Operations';
      return false;
    }));
    return visibleItems;
  }
  if (role === 'responder') {
    const item = (path: string) => navItems.find((navItem) => navItem.path === path)!;
    return [
      { label: 'Incident Monitoring', section: true },
      item('/my-responses'),
      item('/reports'),
      { ...item('/barangay-assistance'), label: 'Assistance Requests' },
      { label: 'MDRRMO Operations', section: true },
      { ...item('/barangay-board'), label: 'MDRRMO Board' },
      { ...item('/barangay-team'), label: 'Response Unit' },
    ];
  }
  if (isMasterAdmin) return navItems.filter((item) => !['/my-reports', '/my-responses', '/barangay-workspace'].includes(item.path || ''));
  if (role === 'admin' || role === 'logistics') return navItems.filter((item) => [
    'Operations', '/respond-units', '/officers',
    'Administration', '/verification/barangay', '/users', '/alert-broadcasts', '/analytics',
  ].includes(item.path || item.label));
  if (role === 'dispatcher') return navItems.filter((item) => ['Incident Monitoring', '/command-center', '/reports', '/requests', 'Operations', '/locations', '/respond-units'].includes(item.path || item.label));
  return [];
}

export default function DashboardLayout() {
  const { user, logout, isMasterAdmin } = useAuth();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    const isPhoneLayout = window.matchMedia('(max-width: 768px)').matches;
    return !isPhoneLayout && localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return localStorage.getItem('dashboard_theme') === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    const phoneLayout = window.matchMedia('(max-width: 768px)');
    const syncSidebarForScreenSize = (event: MediaQueryListEvent) => {
      if (event.matches) setIsCollapsed(false);
      else setMobileOpen(false);
    };
    phoneLayout.addEventListener('change', syncSidebarForScreenSize);
    return () => phoneLayout.removeEventListener('change', syncSidebarForScreenSize);
  }, []);

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

  const openSettings = () => setSettingsOpen(true);

  const requestLogout = () => {
    setMobileOpen(false);
    setLogoutConfirmationOpen(true);
  };

  const handleLogout = () => {
    setLogoutConfirmationOpen(false);
    logout();
    navigate('/login');
  };

  useEffect(() => {
    if (!logoutConfirmationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLogoutConfirmationOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [logoutConfirmationOpen]);

  const initials = user?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'NA';

  const roleNav = navigationForRole(user?.role, user?.account_kind, isMasterAdmin, user?.coordination_verified);

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
            <img className="sidebar-logo" src="/NA-icon.png" alt="Norz-Agapay" />
            {!isCollapsed && (
              <div className="sidebar-brand-text">
                <div className="sidebar-title">Norz-Agapay</div>
                <div className="sidebar-subtitle">{user?.role === 'resident' ? 'Resident Portal' : 'MDRRMO Command'}</div>
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
                <button type="button" className="user-profile-trigger" onClick={openSettings} aria-haspopup="dialog" aria-label="Open account settings">
                  <div className="user-avatar">{initials}</div>
                  <span className="user-profile-copy">
                    <span className="user-name">{user?.full_name}</span>
                    <span className="user-role">{user?.role === 'logistics' ? 'Staff' : user?.role?.replace(/_/g, ' ')}</span>
                  </span>
                </button>
                <button
                  className="theme-toggle-btn"
                  onClick={toggleTheme}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                </button>
              </div>
            </>
          ) : (
            <div className="collapsed-footer-actions">
              <button
                type="button"
                className="user-avatar collapsed-profile-trigger"
                onClick={openSettings}
                aria-haspopup="dialog"
                aria-label="Open account settings"
                title={`${user?.full_name || ''} (${user?.role === 'logistics' ? 'Staff' : user?.role?.replace(/_/g, ' ') || ''})`}
              >
                {initials}
              </button>
              <button
                className="collapsed-theme-btn"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="main-content">
        <div className="mobile-dashboard-header">
          <button type="button" aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={21} /> : <Menu size={21} />}</button>
          <strong>{user?.account_kind === 'barangay'
            ? user.barangay_name || 'Barangay Command'
            : user?.role === 'resident'
              ? 'Resident Services'
              : user?.role === 'responder'
                ? 'Field Response'
                : 'Norz-Agapay Command'}</strong>
          <span className="mobile-dashboard-header-spacer" aria-hidden="true" />
        </div>
        <Outlet />
      </main>
      {settingsOpen && <UserSettingsModal theme={theme} onThemeChange={setTheme} onClose={() => setSettingsOpen(false)} onSignOut={requestLogout} />}
      {logoutConfirmationOpen && (
        <div
          className="logout-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLogoutConfirmationOpen(false);
          }}
        >
          <section className="logout-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title">
            <div className="logout-confirm-heading">
              <div className="logout-confirm-icon"><LogOut size={21} /></div>
              <h2 id="logout-confirm-title">Sign out?</h2>
            </div>
            <p>Are you sure you want to sign out of your account?</p>
            <div className="logout-confirm-actions">
              <button type="button" className="btn btn-outline" onClick={() => setLogoutConfirmationOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleLogout}>Sign Out</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
