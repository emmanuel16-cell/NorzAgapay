import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';
import { isDirectMdrrmoReport, isEscalatedForMdrrmo } from './mdrrmoReportVisibility';

type ResolutionCycle = 'barangay' | 'mdrrmo';
type Assessment = Record<string, string>;

const assessmentLabels: Record<string, string> = {
  situation: 'Situation',
  people: 'People affected / urgency',
  actions: 'Actions taken',
  risks: 'Risks / resources',
};

export class IncompleteResolutionReportError extends Error {
  missingFields: string[];

  constructor(missingFields: string[]) {
    super(`Complete these required fields before downloading the resolution PDF: ${missingFields.join(', ')}`);
    this.name = 'IncompleteResolutionReportError';
    this.missingFields = missingFields;
  }
}

function fontPath(configuredPath: string, candidates: string[]): string | null {
  for (const candidate of [configuredPath, ...candidates]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveFonts() {
  const regular = fontPath(config.timesNewRomanRegularFontPath, [
    path.resolve(process.cwd(), 'assets/fonts/times.ttf'),
    'C:\\Windows\\Fonts\\times.ttf',
    '/usr/share/fonts/truetype/msttcorefonts/times.ttf',
    '/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf',
  ]);
  const bold = fontPath(config.timesNewRomanBoldFontPath, [
    path.resolve(process.cwd(), 'assets/fonts/timesbd.ttf'),
    'C:\\Windows\\Fonts\\timesbd.ttf',
    '/usr/share/fonts/truetype/msttcorefonts/timesbd.ttf',
    '/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Bold.ttf',
  ]);
  return {
    regular: regular || 'Times-Roman',
    bold: bold || 'Times-Bold',
    regularPath: regular,
    boldPath: bold,
  };
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\[SEND_TO:[^\]]+\]/gi, '')
    .replace(/^\[ASSIGNED:[^\]]+\]\s*/i, '')
    .trim();
}

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch { /* use legacy delimiters below */ }
  return value.includes('|||') ? value.split('|||').map((item) => item.trim()).filter(Boolean) : [value];
}

function phDate(value: unknown): string {
  if (!value) return 'Not recorded';
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date);
}

function phDateTimeWithSeconds(value: unknown): string {
  if (!value) return 'Not recorded';
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(date);
}

function cycleTimestamp(report: any, cycle: ResolutionCycle, event: string, shared: string): unknown {
  const own = report[`${cycle}_${event}`];
  if (own) return own;
  const otherCycle = cycle === 'barangay' ? 'mdrrmo' : 'barangay';
  if (report[`${otherCycle}_${event}`]) return null;
  return report[shared];
}

function elapsedLabel(startValue: unknown, endValue: unknown, stage: string): string {
  if (!startValue || !endValue) return '';
  const seconds = Math.floor((new Date(String(endValue)).getTime() - new Date(String(startValue)).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const elapsed = hours > 0
    ? `${hours} hr${hours === 1 ? '' : 's'}${remainingMinutes ? ` ${remainingMinutes} min` : ''}`
    : `${minutes} min${minutes === 1 ? '' : 's'}`;
  return `${elapsed} after ${stage}`;
}

function completionDuration(startValue: unknown, endValue: unknown): string {
  if (!startValue || !endValue) return 'Not recorded';
  const seconds = Math.round((new Date(String(endValue)).getTime() - new Date(String(startValue)).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return 'Not recorded';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hr${hours === 1 ? '' : 's'}`);
  if (minutes) parts.push(`${minutes} min`);
  if (remainingSeconds || !parts.length) parts.push(`${remainingSeconds} sec${remainingSeconds === 1 ? '' : 's'}`);
  return parts.join(' ');
}

function parseAssessment(notesValue: unknown, channel: ResolutionCycle): Assessment {
  const notes = typeof notesValue === 'string' ? notesValue : '';
  const upper = notes.toUpperCase();
  const marker = channel === 'mdrrmo' ? '[MDRRMO FIELD ASSESSMENT]' : 'FIELD ASSESSMENT';
  const start = upper.indexOf(marker);
  if (start < 0) return {};
  const body = notes.slice(start + marker.length);
  const aliases: Record<string, RegExp> = {
    situation: /(?:^|\n)\s*Situation\s*:\s*/i,
    people: /(?:^|\n)\s*People affected\s*\/\s*urgency\s*:\s*/i,
    actions: /(?:^|\n)\s*Actions taken\s*:\s*/i,
    risks: /(?:^|\n)\s*Risks\s*\/\s*resources(?: needed)?\s*:\s*/i,
  };
  const matches = Object.entries(aliases)
    .map(([key, regex]) => {
      const match = regex.exec(body);
      return match ? { key, start: match.index + match[0].length } : null;
    })
    .filter((item): item is { key: string; start: number } => item !== null)
    .sort((a, b) => a.start - b.start);
  const result: Assessment = {};
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const nextStart = matches[index + 1]?.start;
    const nextMarkerStart = nextStart === undefined ? body.length : nextStart;
    const nextLabel = matches[index + 1]
      ? Object.entries(aliases).find(([key]) => key === matches[index + 1]!.key)?.[1]
      : null;
    const end = nextLabel?.exec(body.slice(current.start))?.index;
    const raw = end === undefined ? body.slice(current.start, nextMarkerStart) : body.slice(current.start, current.start + end);
    result[current.key] = raw.trim();
  }
  return result;
}

function missingForCycle(report: any, cycle: ResolutionCycle, resolutionNotesOverride?: string): string[] {
  const missing: string[] = [];
  const notes = cycle === 'barangay'
    ? (report.barangay_response_notes || report.response_notes || '')
    : (report.mdrrmo_response_notes || report.response_notes || '');
  const assessment = parseAssessment(notes, cycle);
  if (!cleanText(report.incident_type)) missing.push('incident classification');
  if (!cleanText(report.severity)) missing.push('severity');
  if (!cleanText(notes)) missing.push(`${cycle.toUpperCase()} response notes`);
  for (const [key, label] of Object.entries(assessmentLabels)) {
    if (!assessment[key]?.trim()) missing.push(`${cycle.toUpperCase()} field assessment: ${label}`);
  }
  const resolutionNotes = resolutionNotesOverride ?? (cycle === 'barangay'
    ? report.barangay_resolved_notes || (report.barangay_response_status === 'resolved' ? report.resolved_notes : null)
    : report.mdrrmo_resolved_notes || (report.mdrrmo_response_status === 'resolved' ? report.resolved_notes : null));
  if (!cleanText(resolutionNotes)) missing.push(`${cycle.toUpperCase()} resolution notes`);
  const arrivedAt = cycleTimestamp(report, cycle, 'arrived_at', 'arrived_at');
  if (!arrivedAt) missing.push(`${cycle.toUpperCase()} arrival time`);
  return missing;
}

function completedCycles(report: any): ResolutionCycle[] {
  const cycles: ResolutionCycle[] = [];
  if (report.barangay_response_status === 'resolved' || report.barangay_resolved_at) cycles.push('barangay');
  if (report.mdrrmo_response_status === 'resolved' || report.mdrrmo_resolved_at) cycles.push('mdrrmo');
  if (!cycles.length && ['resolved', 'closed'].includes(String(report.status).toLowerCase())) {
    if (report.send_to === 'mdrrmo' || report.mdrrmo_responded_by) cycles.push('mdrrmo');
    else cycles.push('barangay');
  }
  return cycles;
}

function responseCycles(report: any): ResolutionCycle[] {
  const sourceType = String(report.source_type || '').toLowerCase();
  const escalated = sourceType ? sourceType === 'escalated' : isEscalatedForMdrrmo(report);
  if (escalated) return ['barangay', 'mdrrmo'];
  return [sourceType === 'direct' || isDirectMdrrmoReport(report) ? 'mdrrmo' : 'barangay'];
}

async function mdrrmoCycleTimes(reportId: string): Promise<Record<string, string | null>> {
  const { data, error } = await supabaseAdmin
    .from('mdrrmo_report_assignments')
    .select('assigned_at, accepted_at, arrived_at')
    .eq('report_id', reportId)
    .neq('status', 'removed')
    .order('assigned_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const firstValue = (field: string) => rows.map((row: any) => row[field]).find(Boolean) || null;
  return {
    mdrrmo_accepted_at: firstValue('accepted_at'),
    mdrrmo_arrived_at: firstValue('arrived_at'),
  };
}

async function assistanceForReport(reportId: string): Promise<any[]> {
  const [barangayResult, legacyResult, reportResult] = await Promise.all([
    supabaseAdmin
      .from('barangay_assistance_requests')
      .select('id, explanation, needs_more_manpower, needs_resources, needs_equipment, beyond_barangay_capability, status, decision, dispatcher_notes, created_at')
      .eq('incident_report_id', reportId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('resource_requests')
      .select('id, request_type, sub_type, details, status, created_at')
      .eq('incident_id', reportId)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('resource_requests')
      .select('id, request_type, sub_type, details, status, created_at')
      .eq('mdrrmo_report_id', reportId)
      .order('created_at', { ascending: true }),
  ]);
  const firstError = barangayResult.error || legacyResult.error || reportResult.error;
  if (firstError) throw firstError;

  const requestsById = new Map<string, any>();
  for (const request of barangayResult.data || []) {
    requestsById.set(request.id, { ...request, source: 'barangay' });
  }
  for (const request of [...(legacyResult.data || []), ...(reportResult.data || [])]) {
    requestsById.set(request.id, {
      ...request,
      explanation: request.details,
      source: 'mdrrmo',
    });
  }
  return [...requestsById.values()].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function assistanceDetail(request: any): string {
  const barangayNeeds = [
    request.needs_more_manpower ? 'Additional manpower' : '',
    request.needs_resources ? 'Resources' : '',
    request.needs_equipment ? 'Equipment' : '',
    request.beyond_barangay_capability ? 'MDRRMO coordination' : '',
  ].filter(Boolean);
  const requestLabel = barangayNeeds.length
    ? barangayNeeds.join(', ')
    : cleanText(request.sub_type) || (request.request_type === 'goods' ? 'Goods' : 'Assistance');
  const explanation = cleanText(request.explanation);
  const requestDetails = [requestLabel, explanation].filter(Boolean).join(': ');
  return [requestDetails, cleanText(request.dispatcher_notes)]
    .filter(Boolean).join(' - ') || 'Assistance request';
}

function assistanceOutcome(request: any): string {
  if (request.status === 'cancelled') return 'Cancelled';
  if (request.decision === 'dismissed' || request.status === 'rejected') return 'Rejected';
  if (request.source === 'mdrrmo') {
    if (request.status === 'approved') return 'Approved';
    if (request.status === 'fulfilled') return 'Received';
    return 'Pending';
  }
  if (request.decision === 'provide_barangay_assistance') return request.status === 'fulfilled' ? 'Fulfilled' : 'Provided';
  if (request.decision === 'coordinate_mdrrmo') return 'Coordinated with MDRRMO';
  if (request.status === 'fulfilled') return 'Fulfilled';
  if (request.status === 'actioned') return 'Actioned';
  return 'Pending';
}

async function toBuffer(report: any, resident: any, assistance: any[]): Promise<Buffer> {
  const fonts = resolveFonts();
  const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `Incident Resolution - ${report.id}`, Author: 'NorzAgapay' } });
  if (fonts.regularPath) doc.registerFont('Times New Roman', fonts.regularPath);
  if (fonts.boldPath) doc.registerFont('Times New Roman Bold', fonts.boldPath);
  const regular = fonts.regularPath ? 'Times New Roman' : fonts.regular;
  const bold = fonts.boldPath ? 'Times New Roman Bold' : fonts.bold;
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const labelWidth = 142;
  const valueWidth = width - labelWidth - 12;
  const ink = '#1f2937';
  const muted = '#536273';
  const cleanDescription = cleanText(report.description) || cleanText(report.specifics) || 'Not provided';
  const proofCount = Math.max(listOf(report.proof_urls).length, listOf(report.proof_url).length);
  const responderMedia = Array.isArray(report.responder_media) ? report.responder_media : listOf(report.responder_media);
  const received = phDate(report.created_at);
  const occurred = report.incident_time_precision === 'unknown' || !report.incident_occurred_at
    ? 'Incident time unknown'
    : phDate(report.incident_occurred_at);
  const destinationRoute = String(report.source_type || '').toLowerCase() === 'escalated' || isDirectMdrrmoReport(report)
    ? 'MDRRMO'
    : report.send_to === 'barangay' ? 'Barangay' : 'Response team';
  const destination = [destinationRoute, report.barangays?.name].filter(Boolean).join(' - ');

  doc.font(bold).fontSize(18).fillColor(ink).text('Incident Resolution Report', { align: 'center' });
  doc.moveDown(0.2).font(regular).fontSize(9).fillColor(muted).text('NorzAgapay | Official incident record', { align: 'center' });
  doc.moveDown(0.5);

  const section = (title: string) => {
    doc.moveDown(0.55);
    doc.font(bold).fontSize(12).fillColor(ink).text(title);
    const y = doc.y + 3;
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(0.5).strokeColor('#94a3b8').stroke();
    doc.y = y + 8;
  };
  const row = (label: string, value: unknown) => {
    const text = cleanText(value) || 'Not recorded';
    doc.font(regular).fontSize(9.5);
    const left = doc.page.margins.left;
    const y = doc.y;
    const labelHeight = doc.heightOfString(label, { width: labelWidth });
    const valueHeight = doc.heightOfString(text, { width: valueWidth });
    if (y + Math.max(labelHeight, valueHeight) > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const rowY = doc.y;
    doc.font(bold).fillColor(ink).text(label, left, rowY, { width: labelWidth });
    doc.font(regular).fillColor(ink).text(text, left + labelWidth + 12, rowY, { width: valueWidth });
    doc.y = rowY + Math.max(labelHeight, valueHeight) + 5;
    doc.moveTo(left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).lineWidth(0.25).strokeColor('#dbe3ec').stroke();
    doc.y += 4;
  };
  const timelineColumnWidths = {
    label: labelWidth,
    recorded: 190,
    completion: width - labelWidth - 190 - 20,
  };
  const timelineHeader = () => {
    const left = doc.page.margins.left;
    const recordedX = left + timelineColumnWidths.label + 10;
    const completionX = recordedX + timelineColumnWidths.recorded + 10;
    const headerY = doc.y;
    doc.font(bold).fontSize(8.5).fillColor(muted)
      .text('Milestone', left, headerY, { width: timelineColumnWidths.label })
      .text('Recorded at', recordedX, headerY, { width: timelineColumnWidths.recorded })
      .text('Elapsed time', completionX, headerY, { width: timelineColumnWidths.completion });
    doc.y = headerY + 14;
  };
  const timelineRow = (label: string, recordedAt: unknown, duration: string) => {
    const left = doc.page.margins.left;
    const recordedX = left + timelineColumnWidths.label + 10;
    const completionX = recordedX + timelineColumnWidths.recorded + 10;
    const recordedText = phDateTimeWithSeconds(recordedAt);
    doc.font(regular).fontSize(9.5);
    const rowHeight = Math.max(
      doc.heightOfString(label, { width: timelineColumnWidths.label }),
      doc.heightOfString(recordedText, { width: timelineColumnWidths.recorded }),
      doc.heightOfString(duration, { width: timelineColumnWidths.completion }),
    );
    if (doc.y + rowHeight + 9 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const rowY = doc.y;
    doc.font(bold).fillColor(ink).text(label, left, rowY, { width: timelineColumnWidths.label });
    doc.font(regular).fillColor(ink).text(recordedText, recordedX, rowY, { width: timelineColumnWidths.recorded });
    doc.fillColor(muted).text(duration, completionX, rowY, { width: timelineColumnWidths.completion });
    doc.y = rowY + rowHeight + 5;
    doc.moveTo(left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).lineWidth(0.25).strokeColor('#dbe3ec').stroke();
    doc.y += 4;
  };

  const reporterName = cleanText(report.reporter_name || resident?.full_name) || 'Not provided';
  const reporterPhone = cleanText(report.reporter_phone || resident?.phone);
  const reporterEmail = cleanText(report.reporter_email || resident?.email);
  const contact = [reporterName, reporterPhone, reporterEmail].filter(Boolean).join(' | ');

  section('1. Resident Report');
  row('Report reference & status', `${report.id} | ${String(report.status || 'resolved').toUpperCase()}`);
  row('Reporter & contact', contact);
  row('Report title & category', `${cleanText(report.title) || 'Incident report'} | ${cleanText(report.incident_type) || cleanText(report.title) || 'Not classified'}`);
  row('Report destination', destination);
  row('Incident time & received', `Occurred ${occurred} | Received ${received}`);
  row('Location', `${cleanText(report.address) || 'Location not described'} | ${Number(report.latitude).toFixed(6)}, ${Number(report.longitude).toFixed(6)}`);
  row('Resident description', cleanDescription);
  row('Resident evidence', `${proofCount} attachment file(s); not embedded | Evidence status: ${cleanText(report.evidence_status) || 'Not recorded'}`);

  section('2. Dispatch and Response');
  row('Classification & severity', `${cleanText(report.incident_type) || 'Not classified'} | ${cleanText(report.severity) || 'Not recorded'}`);

  const cycles = completedCycles(report);
  for (const cycle of responseCycles(report)) {
    const title = cycle === 'barangay' ? 'Barangay' : 'MDRRMO';
    section(`${title} Response Times`);
    const acceptedAt = cycleTimestamp(report, cycle, 'accepted_at', 'accepted_at');
    const arrivedAt = cycleTimestamp(report, cycle, 'arrived_at', 'arrived_at');
    const receivedAt = cycle === 'mdrrmo'
      ? report.mdrrmo_received_at || report.created_at
      : report.created_at;
    const cycleResolvedAt = cycle === 'barangay'
      ? report.barangay_resolved_at || report.resolved_at
      : report.mdrrmo_resolved_at || report.resolved_at;
    timelineHeader();
    timelineRow('Responder accepted', acceptedAt, `Response to acceptance: ${completionDuration(receivedAt, acceptedAt)}`);
    timelineRow('Arrived at incident area', arrivedAt, `Travel to arrival: ${completionDuration(acceptedAt, arrivedAt)}`);
    timelineRow('Incident resolved', cycleResolvedAt, `Time to resolve: ${completionDuration(arrivedAt, cycleResolvedAt)}`);
    if (cycles.includes(cycle)) {
      const notes = cycle === 'barangay'
        ? (report.barangay_response_notes || report.response_notes || '')
        : (report.mdrrmo_response_notes || report.response_notes || '');
      const assessment = parseAssessment(notes, cycle);
      section(`${title} Field Assessment`);
      for (const [key, label] of Object.entries(assessmentLabels)) row(label, assessment[key]);
      const resolvedNotes = cycle === 'barangay'
        ? report.barangay_resolved_notes || report.resolved_notes
        : report.mdrrmo_resolved_notes || report.resolved_notes;
      const resolvedAt = cycle === 'barangay' ? report.barangay_resolved_at || report.resolved_at : report.mdrrmo_resolved_at || report.resolved_at;
      const elapsed = [
        elapsedLabel(report.created_at, resolvedAt, 'report receipt'),
        elapsedLabel(arrivedAt, resolvedAt, 'arrival'),
      ].filter(Boolean).join(' | ');
      section(`${title} Resolution`);
      row('Resolved status & timing', [phDate(resolvedAt), elapsed].filter(Boolean).join(' | '));
      row('Resolution notes', resolvedNotes);
    }
  }

  section('Assistance and Coordination Requests');
  if (assistance.length) {
    for (const request of assistance) row(assistanceDetail(request), assistanceOutcome(request));
  }
  const coordinationNotes = cleanText(report.mdrrmo_coordination_notes);
  const coordinationAlreadyListed = assistance.some((request) =>
    cleanText(request.explanation).toLowerCase() === coordinationNotes.toLowerCase(),
  );
  if (coordinationNotes && !coordinationAlreadyListed) {
    const outcome = report.mdrrmo_response_status === 'resolved' ? 'Provided' : 'Pending';
    row(coordinationNotes, outcome);
  }
  if (!assistance.length && !coordinationNotes) {
    row('Requests', 'No assistance or coordination requests recorded.');
  }

  section('Response Media');
  row('Responder field photos & videos', `${responderMedia.length} attachment file(s); not embedded`);
  doc.end();
  return completed;
}

export class IncidentResolutionPdfService {
  static missingFields(report: any, cycle: ResolutionCycle, resolutionNotesOverride?: string): string[] {
    const missing = missingForCycle(report, cycle, resolutionNotesOverride);
    if (!cleanText(report.title)) missing.push('report title');
    if (!report.created_at) missing.push('report received time');
    const hasCoordinate = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
    if (!hasCoordinate(report.latitude) || !hasCoordinate(report.longitude)) missing.push('incident location');
    return [...new Set(missing)];
  }

  static async generateAndStore(reportId: string): Promise<{ buffer: Buffer; path: string; generatedAt: string }> {
    let report: any = null;

    // Try mdrrmo_reports first
    const { data: mReport, error: mErr } = await supabaseAdmin
      .from('mdrrmo_reports')
      .select('*')
      .eq('id', reportId)
      .maybeSingle();
    if (mErr) throw mErr;

    if (mReport) {
      report = {
        ...mReport,
        mdrrmo_response_status: mReport.response_status,
        mdrrmo_response_notes: mReport.response_notes,
        mdrrmo_coordination_notes: mReport.coordination_notes,
        mdrrmo_responder_name: mReport.responder_name,
        mdrrmo_responded_by: mReport.responded_by,
        mdrrmo_dispatched_at: mReport.dispatched_at,
        mdrrmo_accepted_at: mReport.accepted_at,
        mdrrmo_arrived_at: mReport.arrived_at,
        mdrrmo_resolved_at: mReport.resolved_at,
        mdrrmo_resolved_notes: mReport.resolved_notes,
        mdrrmo_dispatcher_reviewed_at: mReport.dispatcher_reviewed_at,
        status: mReport.response_status,
        send_to: mReport.source_type === 'direct' ? 'mdrrmo' : mReport.send_to,
        barangays: mReport.barangay_name ? { name: mReport.barangay_name } : null,
      };

      const sourceBarangayReportId = mReport.source_barangay_report_id ||
        (mReport.source_type === 'escalated' ? reportId : null);
      if (mReport.source_type === 'escalated' && sourceBarangayReportId) {
        const { data: barangayReport, error: barangayReportError } = await supabaseAdmin
          .from('barangay_reports')
          .select('*')
          .eq('id', sourceBarangayReportId)
          .maybeSingle();
        if (barangayReportError) throw barangayReportError;
        if (barangayReport) {
          report = {
            ...report,
            barangay_response_status: barangayReport.response_status,
            barangay_response_notes: barangayReport.response_notes,
            mdrrmo_received_at: barangayReport.escalated_at || report.created_at,
            barangay_responded_by: barangayReport.responded_by,
            barangay_dispatcher_reviewed_at: barangayReport.dispatcher_reviewed_at,
            barangay_dispatched_at: barangayReport.dispatched_at,
            barangay_accepted_at: barangayReport.accepted_at,
            barangay_arrived_at: barangayReport.arrived_at,
            barangay_resolved_at: barangayReport.resolved_at,
            barangay_resolved_notes: barangayReport.resolved_notes,
          };
        }
      }
    }

    if (!report) {
      // Try barangay_reports
      const { data: bReport, error: bErr } = await supabaseAdmin
        .from('barangay_reports')
        .select('*')
        .eq('id', reportId)
        .maybeSingle();
      if (bErr) throw bErr;

      if (bReport) {
        report = {
          ...bReport,
          barangay_response_status: bReport.response_status,
          barangay_response_notes: bReport.response_notes,
          barangay_responder_name: bReport.responder_name,
          barangay_responded_by: bReport.responded_by,
          barangay_dispatched_at: bReport.dispatched_at,
          barangay_accepted_at: bReport.accepted_at,
          barangay_arrived_at: bReport.arrived_at,
          barangay_resolved_at: bReport.resolved_at,
          barangay_resolved_notes: bReport.resolved_notes,
          status: bReport.status,
        };
      }
    }

    if (!report) throw new Error('Incident report not found.');
    const mdrrmoTimes = await mdrrmoCycleTimes(reportId);
    report.mdrrmo_accepted_at = report.mdrrmo_accepted_at || mdrrmoTimes.mdrrmo_accepted_at;
    report.mdrrmo_arrived_at = report.mdrrmo_arrived_at || mdrrmoTimes.mdrrmo_arrived_at;
    const cycles = completedCycles(report);
    if (!cycles.length) throw new Error('This report has no resolved response cycle yet.');
    const missing = cycles.flatMap((cycle) => this.missingFields(report, cycle));
    if (missing.length) throw new IncompleteResolutionReportError([...new Set(missing)]);

    let resident: any = null;
    if (report.reporter_id) {
      const { data } = await supabaseAdmin.from('resident_user').select('full_name, phone, email').eq('id', report.reporter_id).maybeSingle();
      resident = data;
    }
    const assistance = await assistanceForReport(reportId);
    const buffer = await toBuffer(report, resident, assistance);
    const storagePath = `resolved-reports/${reportId}/latest.pdf`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(config.resolutionPdfBucketName)
      .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw uploadError;
    const generatedAt = new Date().toISOString();
    const pdfUpdate = { resolution_pdf_path: storagePath, resolution_pdf_generated_at: generatedAt, resolution_pdf_status: 'ready' };
    await Promise.all([
      supabaseAdmin.from('barangay_reports').update(pdfUpdate).eq('id', reportId),
      supabaseAdmin.from('mdrrmo_reports').update(pdfUpdate).eq('id', reportId),
    ]);
    return { buffer, path: storagePath, generatedAt };
  }
}
