import { useState } from 'react';
import { X } from 'lucide-react';

export type ReportReviewOutcome = 'inconclusive' | 'false_report';

type Props = {
  reporterName?: string | null;
  falseReportCount?: number;
  residentStrikeCount?: number;
  linkedResident?: boolean;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (outcome: ReportReviewOutcome, reason: string) => void;
};

type Step = 'choice' | 'confirm_inconclusive' | 'reason' | 'confirm_false_report';

export default function InvalidReportReviewDialog({
  reporterName,
  falseReportCount = 0,
  residentStrikeCount = 0,
  linkedResident = false,
  submitting = false,
  onClose,
  onSubmit,
}: Props) {
  const [step, setStep] = useState<Step>('choice');
  const [reason, setReason] = useState('');
  const label = reporterName?.trim() || 'the reporter';

  return <div className="invalid-review-overlay" onClick={onClose}>
    <section className="invalid-review-dialog" role="dialog" aria-modal="true" aria-labelledby="invalid-review-title" onClick={(event) => event.stopPropagation()}>
      <button className="selection-close-btn invalid-review-close" type="button" onClick={onClose} aria-label="Close review" disabled={submitting}><X size={20} /></button>
      {step === 'choice' ? <>
        <h2 id="invalid-review-title">Why is {label}’s Report Invalid?</h2>
        <p>Choose how MDRRMO should record this review.</p>
        <div className="invalid-review-options">
          <button className="inconclusive-option" type="button" onClick={() => setStep('confirm_inconclusive')}>Inconclusive</button>
          <button className="false-reporter-option" type="button" onClick={() => setStep('confirm_false_report')}>
            False Reporter
            <small>{falseReportCount} false mark{falseReportCount === 1 ? '' : 's'} on this report{linkedResident ? ` · ${residentStrikeCount} of 3 resident account marks` : ' · no resident account strike'}</small>
          </button>
        </div>
      </> : step === 'confirm_inconclusive' ? <>
        <h2 id="invalid-review-title">Confirm inconclusive review</h2>
        <p>This report will be marked inconclusive. The reporter will see the reason and can edit and resubmit it.</p>
        <div className="invalid-review-actions">
          <button type="button" onClick={() => setStep('choice')} disabled={submitting}>Back</button>
          <button type="button" onClick={() => setStep('reason')} disabled={submitting}>Continue</button>
        </div>
      </> : step === 'confirm_false_report' ? <>
        <h2 id="invalid-review-title">Confirm False Reporter</h2>
        <p>This report will be hidden from the MDRRMO map until its reporter edits and resubmits it.</p>
        <div className="invalid-review-actions">
          <button type="button" onClick={() => setStep('choice')} disabled={submitting}>Back</button>
          <button type="button" className="invalid-review-danger-action" onClick={() => onSubmit('false_report', '')} disabled={submitting}>{submitting ? 'Saving…' : 'Confirm False Reporter'}</button>
        </div>
      </> : <>
        <h2 id="invalid-review-title">Why is this report inconclusive?</h2>
        <p>The reporter will receive this reason and can correct and resubmit their report.</p>
        <textarea autoFocus className="invalid-review-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain what could not be confirmed…" maxLength={1000} />
        <div className="invalid-review-actions">
          <button type="button" onClick={() => setStep('confirm_inconclusive')} disabled={submitting}>Back</button>
          <button type="button" onClick={() => onSubmit('inconclusive', reason.trim())} disabled={submitting || !reason.trim()}>{submitting ? 'Saving…' : 'Notify Reporter'}</button>
        </div>
      </>}
    </section>
  </div>;
}
