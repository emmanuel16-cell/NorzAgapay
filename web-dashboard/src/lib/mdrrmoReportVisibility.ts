export type MdrrmoReportGroup = 'resident' | 'escalated';

export interface MdrrmoReportVisibilityFields {
  type?: string | null;
  reporter_type?: string | null;
  send_to?: string | null;
  specifics?: string | null;
  description?: string | null;
  status?: string | null;
  is_escalated?: boolean | string | null;
  beyond_barangay_capability?: boolean | string | null;
  review_outcome?: string | null;
  mdrrmo_coordination_notes?: string | null;
}

const isTrue = (value?: boolean | string | null) => value === true || String(value || '').toLowerCase() === 'true';

export function isEscalatedMdrrmoReport(report: MdrrmoReportVisibilityFields): boolean {
  return String(report.status || '').toLowerCase() === 'escalated' ||
    isTrue(report.is_escalated) ||
    isTrue(report.beyond_barangay_capability) ||
    Boolean(String(report.mdrrmo_coordination_notes || '').trim());
}

export function isDirectMdrrmoReport(report: MdrrmoReportVisibilityFields): boolean {
  const routeMarker = `${report.specifics || ''}\n${report.description || ''}`
    .match(/\[send_to:([^\]]+)\]/i)?.[1];
  const rawSendTo = String(report.send_to || '').trim().toLowerCase();
  const sendTo = (rawSendTo && rawSendTo !== 'all') ? rawSendTo : String(routeMarker || '').trim().toLowerCase();
  if (sendTo === 'mdrrmo' || sendTo === 'all' || rawSendTo === 'all') return true;
  if (sendTo === 'barangay' || rawSendTo === 'barangay') return false;
  if (String(report.type || '').toLowerCase() === 'emergency') return true;
  return false;
}

export function isVisibleToMdrrmo(report: MdrrmoReportVisibilityFields): boolean {
  if (report.review_outcome) return false;
  if (isEscalatedMdrrmoReport(report)) return true;
  return isDirectMdrrmoReport(report);
}

export function getMdrrmoReportGroup(report: MdrrmoReportVisibilityFields): MdrrmoReportGroup {
  return isEscalatedMdrrmoReport(report) ? 'escalated' : 'resident';
}

