import { Bell, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function PublicHeader() {
  return (
    <header className="public-site-header">
      <div className="public-site-header-inner">
        <Link className="public-site-brand" to="/" aria-label="Norz-Agapay home">
          <img src="/NA-icon.png" alt="" />
          <span>Norz-Agapay</span>
        </Link>
        <nav className="public-site-actions" aria-label="Main navigation">
          <Link className="public-site-action public-site-login" to="/login">
            <UserRound size={22} strokeWidth={2.2} aria-hidden="true" />
            <span>Log in</span>
          </Link>
          <Link className="public-site-action public-site-report" to="/report">
            <Bell size={20} strokeWidth={2.2} aria-hidden="true" />
            <span>Report Incident</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
