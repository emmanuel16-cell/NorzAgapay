import { useEffect, useState } from 'react';
import { BadgeCheck, Check, Copy, X } from 'lucide-react';

type ReportSubmittedModalProps = {
  reference: string;
  message: string;
  continueLabel?: string;
  onContinue: () => void;
};

export default function ReportSubmittedModal({
  reference,
  message,
  continueLabel = 'Continue to tracking',
  onContinue,
}: ReportSubmittedModalProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onContinue();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onContinue]);

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopyState('copied');
      return;
    } catch {
      // Clipboard permissions may be unavailable outside a secure browser context.
    }

    const field = document.createElement('textarea');
    field.value = reference;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    setCopyState(copied ? 'copied' : 'failed');
  };

  return <div
    className="report-submitted-backdrop"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onContinue(); }}
  >
    <section className="report-submitted-modal" role="dialog" aria-modal="true" aria-labelledby="report-submitted-title" aria-describedby="report-submitted-message">
      <button className="report-submitted-close" type="button" onClick={onContinue} aria-label="Close and go to report tracking"><X size={18} /></button>
      <span className="report-submitted-icon"><BadgeCheck size={27} aria-hidden="true" /></span>
      <span className="report-submitted-kicker">REPORT RECEIVED</span>
      <h2 id="report-submitted-title">Your report was sent</h2>
      <p id="report-submitted-message">{message}</p>
      <div className="report-submitted-reference">
        <span>REPORT REFERENCE</span>
        <strong>{reference}</strong>
      </div>
      <button className="report-submitted-copy" type="button" onClick={() => void copyReference()}>
        {copyState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {copyState === 'copied' ? 'Copied' : 'Copy report reference'}
      </button>
      {copyState === 'failed' && <p className="report-submitted-copy-error" role="status">Could not copy automatically. Select and copy the reference above.</p>}
      <button className="report-submitted-continue" type="button" onClick={onContinue}>{continueLabel}</button>
      <small>After closing, you’ll go to this report’s tracking page.</small>
    </section>
  </div>;
}
