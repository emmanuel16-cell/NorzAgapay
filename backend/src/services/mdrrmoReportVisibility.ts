type MdrrmoReportVisibilityFields = {
  type?: unknown;
  reporter_type?: unknown;
  send_to?: unknown;
  specifics?: unknown;
  description?: unknown;
  status?: unknown;
  is_escalated?: unknown;
  beyond_barangay_capability?: unknown;
  review_outcome?: unknown;
  mdrrmo_coordination_notes?: unknown;
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
    Boolean(text(report.mdrrmo_coordination_notes));
}

export function isDirectMdrrmoReport(report: MdrrmoReportVisibilityFields): boolean {
  const routeMarker = `${text(report.specifics)}\n${text(report.description)}`
    .match(/\[send_to:([^\]]+)\]/i)?.[1];
  const sendTo = text(report.send_to);
  const route = (sendTo && sendTo !== 'all') ? sendTo : text(routeMarker);
  if (route === 'mdrrmo' || route === 'all' || sendTo === 'all') return true;
  if (route === 'barangay' || sendTo === 'barangay') return false;
  if (text(report.type) === 'emergency') return true;
  return false;
}

export function isVisibleToMdrrmo(report: MdrrmoReportVisibilityFields): boolean {
  if (text(report.review_outcome)) return false;
  if (isEscalatedForMdrrmo(report)) return true;
  return isDirectMdrrmoReport(report);
}

