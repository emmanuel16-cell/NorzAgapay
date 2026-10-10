import { ArrowRight, CheckCircle2, MapPin, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import PublicHeader from '../components/PublicHeader';

const reportSteps = [
  { icon: MapPin, title: 'Share the location', description: 'Pin the incident location so responders know where help is needed.' },
  { icon: ShieldCheck, title: 'Send clear details', description: 'Add a mobile number and a short description so the report can be reviewed.' },
  { icon: CheckCircle2, title: 'MDRRMO reviews it', description: 'MDRRMO reviews each report and coordinates the appropriate response.' },
];

export default function HomePage() {
  return (
    <div className="public-home-page">
      <PublicHeader />
      <main>
        <section className="public-home-hero" aria-labelledby="public-home-title">
          <div className="public-home-hero-content">
            <span className="public-home-eyebrow">NORZAGARAY EMERGENCY RESPONSE</span>
            <h1 id="public-home-title">When help is needed, <span>start here.</span></h1>
            <p className="public-home-intro">Send an incident report to MDRRMO with its location and details. The command center will review it and coordinate the response.</p>
            <div className="public-home-hero-actions">
              <Link className="public-home-primary-action" to="/report">Report an incident <ArrowRight size={19} aria-hidden="true" /></Link>
              <Link className="public-home-secondary-action" to="/login">Command center login</Link>
            </div>
            <p className="public-home-note">You can report an incident without creating an account.</p>
          </div>
          <div className="public-home-hero-emblem" aria-hidden="true">
            <div className="public-home-emblem-glow" />
            <img src="/NA-icon.png" alt="" />
            <span>UNITY · SERVICE · PREPAREDNESS</span>
          </div>
        </section>

        <section className="public-home-steps" aria-labelledby="public-home-steps-title">
          <div className="public-home-section-heading">
            <span>HOW IT WORKS</span>
            <h2 id="public-home-steps-title">Help responders act with the right information.</h2>
          </div>
          <div className="public-home-step-grid">
            {reportSteps.map(({ icon: Icon, title, description }, index) => (
              <article className="public-home-step-card" key={title}>
                <span className="public-home-step-number">0{index + 1}</span>
                <span className="public-home-step-icon"><Icon size={20} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
          <Link className="public-home-inline-link" to="/report">Start a report <ArrowRight size={16} aria-hidden="true" /></Link>
        </section>
      </main>
      <footer className="public-home-footer"><img src="/NA-icon.png" alt="" /><span>Norz-Agapay · Norzagaray, Bulacan</span></footer>
    </div>
  );
}
