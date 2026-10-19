import { Camera, FileText } from 'lucide-react';

type ReportModeChoicesProps = {
  onSelect: (mode: 'standard' | 'visual') => void;
};

export default function ReportModeChoices({ onSelect }: ReportModeChoicesProps) {
  return <section className="report-mode-choices" aria-labelledby="report-mode-title">
    <div className="report-mode-intro"><h2 id="report-mode-title">How would you like to report?</h2><p>Choose a report format to continue.</p></div>
    <div className="report-mode-choice-grid">
      <button type="button" className="report-mode-choice" onClick={() => onSelect('standard')}>
        <span className="report-mode-choice-icon"><FileText size={19} aria-hidden="true" /></span>
        <strong>Standard report</strong>
        <small>Use the report form with incident details. You can also capture a photo or video.</small>
      </button>
      <button type="button" className="report-mode-choice" onClick={() => onSelect('visual')}>
        <span className="report-mode-choice-icon"><Camera size={19} aria-hidden="true" /></span>
        <strong>Visual report</strong>
        <small>No incident details needed. Capture at least one photo or video with your camera.</small>
      </button>
    </div>
  </section>;
}
