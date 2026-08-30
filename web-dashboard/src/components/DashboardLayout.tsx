import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';

interface NavItem {
  path?: string;
  icon?: string;
  label: string;
  section?: boolean;
}

const navItems: NavItem[] = [
  { path: '/weather-monitoring', icon: '🌤️', label: 'Weather Monitoring' },
  { label: 'Operations', section: true },
  { path: '/', icon: '📍', label: 'Command Center' },
  { path: '/reports', icon: '📊', label: 'Reports' },
  { path: '/missions', icon: '🎯', label: 'Missions' },
  { label: 'Logistics', section: true },
  { path: '/evacuation-centers', icon: '🏕️', label: 'Evacuation Centers' },
  { path: '/requests', icon: '📋', label: 'Resource Requests' },
  { path: '/volunteer-dispatch', icon: '🚚', label: 'Volunteer Dispatch' },
  { path: '/respond-units', icon: '🚓', label: 'Respond Units' },
  { path: '/inventory', icon: '📦', label: 'Inventory' },
  { path: '/shipments', icon: '🛣️', label: 'Shipment Tracker' },
  { label: 'Administration', section: true },
  { path: '/verification', icon: '✅', label: 'Verification Queue' },
  { path: '/users', icon: '👥', label: 'User Management' },
  { path: '/officers', icon: '🎖️', label: 'Officers' },
  { path: '/analytics', icon: '📊', label: 'Analytics' },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <img className="sidebar-logo" src="/NA-icon.png" alt="NorzAgapay" />
          <div>
            <div className="sidebar-title">NorzAgapay</div>
            <div className="sidebar-subtitle">MDRRMO Command</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item, i) =>
            item.section ? (
              <div key={i} className="nav-section-label">{item.label}</div>
            ) : (
              <NavLink
                key={item.path}
                to={item.path!}
                end={item.path === '/'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          )}
        </nav>

        <div className="sidebar-footer">
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
            style={{ width: '100%', marginTop: '10px' }}
          >
            Sign Out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
