import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';

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
  const notes = cycle === 'barangay' ? report.barangay_response_notes : report.mdrrmo_response_notes;
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

async function responderNames(report: any): Promise<{ barangay: string; mdrrmo: string }> {
  const barangayIds = new Set<string>();
  const assignedMatch = String(report.barangay_response_notes || '').match(/^\[ASSIGNED:([^\]]+)\]/);
  if (assignedMatch?.[1]) assignedMatch[1].split(',').forEach((id) => barangayIds.add(id.trim()));
  if (report.barangay_responded_by) barangayIds.add(String(report.barangay_responded_by));

  const barangayNames: string[] = [];
  if (barangayIds.size) {
    const { data } = await supabaseAdmin.from('barangay_users').select('id, full_name').in('id', [...barangayIds]);
    for (const row of data || []) if (row.full_name) barangayNames.push(row.full_name);
  }

  const { data: mdrrmoAssignments } = await supabaseAdmin
    .from('mdrrmo_report_assignments')
    .select('responder_id')
    .eq('report_id', report.id)
    .neq('status', 'removed');
  const mdrrmoIds = [...new Set((mdrrmoAssignments || []).map((item: any) => item.responder_id).filter(Boolean))];
  const mdrrmoNames: string[] = [];
  if (mdrrmoIds.length) {
    const { data } = await supabaseAdmin.from('users').select('id, full_name').in('id', mdrrmoIds);
    for (const row of data || []) if (row.full_name) mdrrmoNames.push(row.full_name);
  }
  return { barangay: [...new Set(barangayNames)].join(', '), mdrrmo: [...new Set(mdrrmoNames)].join(', ') };
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
  const { data, error } = await supabaseAdmin
    .from('barangay_assistance_requests')
    .select('explanation, needs_more_manpower, needs_resources, needs_equipment, beyond_barangay_capability, status, decision, dispatcher_notes')
    .eq('incident_report_id', reportId)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('Could not load assistance requests for resolution PDF:', error.message);
    return [];
  }
  return data || [];
}

function assistanceDetail(request: any): string {
  const requested = [
    request.needs_more_manpower ? 'Additional manpower' : '',
    request.needs_resources ? 'Resources' : '',
    request.needs_equipment ? 'Equipment' : '',
    request.beyond_barangay_capability ? 'MDRRMO coordination' : '',
  ].filter(Boolean);
  const explanation = cleanText(request.explanation);
  return [requested.join(', '), explanation, cleanText(request.dispatcher_notes)]
    .filter(Boolean).join(' - ') || 'Assistance request';
}

function assistanceOutcome(request: any): string {
  if (request.status === 'cancelled') return 'Cancelled';
  if (request.status !== 'actioned') return 'Pending';
  if (request.decision === 'provide_barangay_assistance') return 'Provided';
  if (request.decision === 'coordinate_mdrrmo') return 'Coordinated';
  return 'Actioned';
}

async function toBuffer(report: any, resident: any, assistance: any[], names: { barangay: string; mdrrmo: string }): Promise<Buffer> {
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
  const destination = [report.send_to === 'mdrrmo' ? 'MDRRMO' : report.send_to === 'barangay' ? 'Barangay' : 'Response team', report.barangays?.name].filter(Boolean).join(' - ');

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
  for (const cycle of (['barangay', 'mdrrmo'] as ResolutionCycle[])) {
    const status = cycle === 'barangay' ? report.barangay_response_status : report.mdrrmo_response_status;
    const title = cycle === 'barangay' ? 'Barangay' : 'MDRRMO';
    section(`${title} Response Cycle`);
    row('Cycle status', String(status || 'pending').toUpperCase());
    const reviewedAt = cycleTimestamp(report, cycle, 'dispatcher_reviewed_at', 'dispatcher_reviewed_at');
    const dispatchedAt = cycleTimestamp(report, cycle, 'dispatched_at', 'dispatched_at');
    const acceptedAt = cycleTimestamp(report, cycle, 'accepted_at', 'accepted_at');
    const arrivedAt = cycleTimestamp(report, cycle, 'arrived_at', 'arrived_at');
    row('Dispatcher review', phDate(reviewedAt));
    row('Responder dispatched', phDate(dispatchedAt));
    row('Responder accepted', phDate(acceptedAt));
    row('Arrived at incident area', phDate(arrivedAt));
    row('Assigned responder(s)', cycle === 'barangay' ? names.barangay : names.mdrrmo);
    if (cycles.includes(cycle)) {
      const notes = cycle === 'barangay' ? report.barangay_response_notes : report.mdrrmo_response_notes;
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
    const { data: report, error } = await supabaseAdmin
      .from('incident_reports')
      .select('*, barangays(name)')
      .eq('id', reportId)
      .maybeSingle();
    if (error) throw error;
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
    const [assistance, names] = await Promise.all([
      assistanceForReport(reportId),
      responderNames(report),
    ]);
    const buffer = await toBuffer(report, resident, assistance, names);
    const storagePath = `resolved-reports/${reportId}/latest.pdf`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(config.resolutionPdfBucketName)
      .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw uploadError;
    const generatedAt = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('incident_reports')
      .update({ resolution_pdf_path: storagePath, resolution_pdf_generated_at: generatedAt, resolution_pdf_status: 'ready' })
      .eq('id', reportId);
    if (updateError) throw updateError;
    return { buffer, path: storagePath, generatedAt };
  }
}
