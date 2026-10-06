type MdrrmoReportVisibilityFields = {
  reporter_type?: unknown;
  send_to?: unknown;
  specifics?: unknown;
  description?: unknown;
  status?: unknown;
  is_escalated?: unknown;
  beyond_barangay_capability?: unknown;
  barangay_response_notes?: unknown;
  review_outcome?: unknown;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isTrue(value: unknown): boolean {
  return value === true || text(value) === 'true';
}

export function isEscalatedForMdrrmo(report: MdrrmoReportVisibilityFields): boolean {
  return text(report.status) === 'escalated' ||
    isTrue(report.is_escalated) ||
    isTrue(report.beyond_barangay_capability) ||
    text(report.barangay_response_notes).includes('escalated');
}

export function isVisibleToMdrrmo(report: MdrrmoReportVisibilityFields): boolean {
  if (text(report.review_outcome)) return false;
  if (isEscalatedForMdrrmo(report)) return true;

  const routeMarker = `${text(report.specifics)}\n${text(report.description)}`
    .match(/\[send_to:([^\]]+)\]/i)?.[1];
  const route = text(report.send_to) || text(routeMarker);
  return text(report.reporter_type) === 'resident' && route === 'mdrrmo';
}
