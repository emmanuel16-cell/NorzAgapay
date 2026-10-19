import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Download, MapPin, Printer, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toDataURL } from 'qrcode';
import PublicHeader from '../components/PublicHeader';

const quickAccessLinks = [
  { id: 'home', label: 'Landing page', description: 'Scan to open the Norz-Agapay home page.', printTitle: 'Norz-Agapay Web App', printIntro: 'Visit the official site for emergency response information and reporting.', url: 'https://norz-agapay.vercel.app/', pdf: '/downloads/norz-agapay-home-qr.pdf' },
  { id: 'report', label: 'Report an incident', description: 'Scan to start a new incident report.', printTitle: 'Norz-Agapay Reporting', printIntro: 'Submit an emergency report to MDRRMO.', url: 'https://norz-agapay.vercel.app/report', pdf: '/downloads/norz-agapay-incident-report-qr.pdf' },
];

const emergencyHotlines = [
  ['National Emergency Hotline', '911'],
  ['MDRRMO Rescue (Norzagaray)', '0905-247-0355'],
  ['Philippine National Police (Norzagaray)', '0998-598-5389'],
  ['Bureau of Fire Protection (Norzagaray)', '0943-348-1854'],
];

const reportSteps = [
  { icon: MapPin, title: 'Share the location and evidence', description: 'Pin where it happened and, if available, attach a photo or video to help responders assess the situation.' },
  { icon: ShieldCheck, title: 'MDRRMO reviews your report', description: 'Guest and resident reports go to MDRRMO first. A dispatcher can assign a nearby active barangay when local response is needed.' },
  { icon: CheckCircle2, title: 'Track progress and updates', description: 'Guests can use their report reference and mobile number; signed-in residents can follow updates in My Reports.' },
];

export default function HomePage() {
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
  const [printQrCodes, setPrintQrCodes] = useState<Record<string, string>>({});
  const [qrCodeError, setQrCodeError] = useState(false);
  const [printTarget, setPrintTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const generateCodes = (dark: string) => Promise.all(quickAccessLinks.map(async ({ id, url }) => [
      id,
      await toDataURL(url, {
        width: 240,
        margin: 4,
        errorCorrectionLevel: 'H',
        color: { dark, light: '#ffffff' },
      }),
    ] as const));
    void Promise.all([generateCodes('#07142e'), generateCodes('#000000')])
      .then(([screenEntries, printEntries]) => {
        if (!cancelled) {
          setQrCodes(Object.fromEntries(screenEntries));
          setPrintQrCodes(Object.fromEntries(printEntries));
        }
      })
      .catch(() => {
        if (!cancelled) setQrCodeError(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!printTarget) return;
    const resetPrintTarget = () => setPrintTarget(null);
    const timeout = window.setTimeout(() => window.print(), 120);
    window.addEventListener('afterprint', resetPrintTarget);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('afterprint', resetPrintTarget);
    };
  }, [printTarget]);

  return (
    <div className="public-home-page">
      <PublicHeader />
      <main>
        <section className="public-home-hero" aria-labelledby="public-home-title">
          <div className="public-home-hero-content">
            <span className="public-home-eyebrow">NORZAGARAY EMERGENCY RESPONSE</span>
            <h1 id="public-home-title">When help is needed, <span>start here.</span></h1>
            <p className="public-home-intro">Share the incident location and details, and attach a photo or video if available. MDRRMO reviews reports first and can coordinate a barangay response.</p>
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
        </section>

        <section className="public-home-qr-section" aria-labelledby="public-home-qr-title">
          <div className="public-home-section-heading public-home-qr-heading">
            <span>QUICK ACCESS</span>
            <h2 id="public-home-qr-title">Scan to visit or report.</h2>
            <p>Open the home page or go straight to incident reporting with your phone.</p>
          </div>
          <div className="public-home-qr-grid">
            {quickAccessLinks.map(({ id, label, description, url, pdf }) => (
              <article className="public-home-qr-card" key={id}>
                <a className="public-home-qr-image-link" href={url} aria-label={`Open ${label}`}>
                  {qrCodes[id]
                    ? <img src={qrCodes[id]} alt={`QR code linking to ${label}`} />
                    : <span className="public-home-qr-placeholder" role="status">{qrCodeError ? 'QR code unavailable' : 'Preparing QR code…'}</span>}
                </a>
                <div className="public-home-qr-copy">
                  <h3>{label}</h3>
                  <p>{description}</p>
                  <a href={url}>{url.replace('https://', '')}</a>
                  <div className="public-home-qr-actions">
                    <a className="public-home-qr-action" href={pdf} download>
                      <Download size={14} aria-hidden="true" /> Download PDF
                    </a>
                    <button className="public-home-qr-action" type="button" onClick={() => setPrintTarget(id)} disabled={!qrCodes[id] || !printQrCodes[id]}>
                      <Printer size={14} aria-hidden="true" /> Print
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
        {printTarget && (() => {
          const target = quickAccessLinks.find(({ id }) => id === printTarget);
          if (!target || !qrCodes[target.id] || !printQrCodes[target.id]) return null;
          return <section className={`public-home-print-sheet ${target.id === 'report' ? 'public-home-print-sheet-report' : ''}`} aria-hidden="true">
            <div className="public-home-print-content">
              <div className="public-home-print-qr"><img src={printQrCodes[target.id]} alt="" /></div>
              <a className="public-home-print-url" href={target.url}>{target.url.replace('https://', '')}</a>
              <h1>{target.printTitle}</h1>
              <p>{target.printIntro}</p>
              {target.id === 'report' && <>
                <p className="public-home-print-hotline-intro">For immediate assistance, call one of the hotlines below.</p>
                <table className="public-home-print-hotlines">
                  <caption>Emergency Hotlines</caption>
                  <thead><tr><th>Emergency Services</th><th>Hotline Number</th></tr></thead>
                  <tbody>{emergencyHotlines.map(([name, number]) => <tr key={name}><td>{name}</td><td>{number}</td></tr>)}</tbody>
                </table>
              </>}
              <footer>Norz-Agapay | Norzagaray, Bulacan</footer>
            </div>
          </section>;
        })()}
      </main>
      <footer className="public-home-footer"><img src="/NA-icon.png" alt="" /><span>Norz-Agapay · Norzagaray, Bulacan</span></footer>
    </div>
  );
}
