export type MdrrmoReportGroup = 'resident' | 'escalated';

export interface MdrrmoReportVisibilityFields {
  reporter_type?: string | null;
  send_to?: string | null;
  specifics?: string | null;
  description?: string | null;
  status?: string | null;
  is_escalated?: boolean | string | null;
  beyond_barangay_capability?: boolean | string | null;
  review_outcome?: string | null;
}

const isTrue = (value?: boolean | string | null) => value === true || String(value || '').toLowerCase() === 'true';

export function isEscalatedMdrrmoReport(report: MdrrmoReportVisibilityFields): boolean {
  return String(report.status || '').toLowerCase() === 'escalated' ||
    isTrue(report.is_escalated) ||
    isTrue(report.beyond_barangay_capability);
}

export function isVisibleToMdrrmo(report: MdrrmoReportVisibilityFields): boolean {
  if (report.review_outcome) return false;
  if (isEscalatedMdrrmoReport(report)) return true;

  const routeMarker = `${report.specifics || ''}\n${report.description || ''}`
    .match(/\[send_to:([^\]]+)\]/i)?.[1];
  const sendTo = String(report.send_to || routeMarker || '').trim().toLowerCase();
  return sendTo === 'mdrrmo';
}

export function getMdrrmoReportGroup(report: MdrrmoReportVisibilityFields): MdrrmoReportGroup {
  return isEscalatedMdrrmoReport(report) ? 'escalated' : 'resident';
}
