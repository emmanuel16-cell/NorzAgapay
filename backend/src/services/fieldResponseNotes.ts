export type FieldResponseChannel = 'mdrrmo' | 'barangay';
export type TriageOutcome = 'safe' | 'mild_injuries' | 'severe_injuries';
export type TransportStatus = 'not_required' | 'in_transit' | 'delivered';

export interface TransportDestination {
  hospital_name?: string;
  hospital_address?: string;
  hospital_latitude?: number | null;
  hospital_longitude?: number | null;
  transport_status?: TransportStatus;
  transport_started_at?: string | null;
  transport_completed_at?: string | null;
}

const assessmentLabels: Record<string, string> = {
  situation: 'Situation',
  affected_people: 'People affected / urgency',
  actions_taken: 'Actions taken',
  risks_resources: 'Risks / resources',
};

export function fieldAssessmentMarker(channel: FieldResponseChannel): string {
  return channel === 'barangay' ? '[BARANGAY FIELD ASSESSMENT]' : '[MDRRMO FIELD ASSESSMENT]';
}

function cleanLine(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

export function readFieldResponseValues(notesValue: unknown, channel: FieldResponseChannel): Record<string, string> {
  const notes = typeof notesValue === 'string' ? notesValue : '';
  const marker = fieldAssessmentMarker(channel);
  const start = notes.toUpperCase().lastIndexOf(marker);
  if (start < 0) return {};
  const values: Record<string, string> = {};
  notes.slice(start + marker.length).split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(':');
    if (separator < 1) return;
    values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  });
  return values;
}

export function upsertFieldAssessmentNotes(
  previousValue: unknown,
  channel: FieldResponseChannel,
  assessment: { situation: string; affected_people: string; actions_taken: string; risks_resources: string; triage_outcome: TriageOutcome },
): string {
  const previous = typeof previousValue === 'string' ? previousValue.trim() : '';
  const marker = fieldAssessmentMarker(channel);
  let start = previous.toUpperCase().lastIndexOf(marker);
  if (start < 0) {
    const legacyMarker = channel === 'barangay' ? '[BARANGAY FIELD NOTES]' : 'FIELD ASSESSMENT';
    start = previous.toUpperCase().lastIndexOf(legacyMarker);
  }
  const coordination = start >= 0 ? previous.slice(0, start).trim() : previous;
  const old = readFieldResponseValues(previous, channel);
  const transportLines = [
    ['Transport status', old['transport status']],
    ['Hospital destination', old['hospital destination']],
    ['Hospital address', old['hospital address']],
    ['Hospital latitude', old['hospital latitude']],
    ['Hospital longitude', old['hospital longitude']],
    ['Transport started at', old['transport started at']],
    ['Transport completed at', old['transport completed at']],
  ].filter(([, value]) => value !== undefined).map(([label, value]) => `${label}: ${value}`);
  const content = [
    marker,
    `Triage outcome: ${assessment.triage_outcome}`,
    ...Object.entries(assessmentLabels).map(([key, label]) => `${label}: ${cleanLine(assessment[key as keyof typeof assessment])}`),
    ...transportLines,
  ].join('\n');
  return [coordination, content].filter(Boolean).join('\n\n');
}

export function upsertTransportNotes(
  previousValue: unknown,
  channel: FieldResponseChannel,
  transport: TransportDestination,
): string {
  const previous = typeof previousValue === 'string' ? previousValue.trim() : '';
  const marker = fieldAssessmentMarker(channel);
  const start = previous.toUpperCase().lastIndexOf(marker);
  const values = readFieldResponseValues(previous, channel);
  if (start < 0) return previous;
  const before = previous.slice(0, start).trim();
  const keep = previous.slice(start).split(/\r?\n/).slice(0, 1)
    .concat(previous.slice(start).split(/\r?\n/).slice(1).filter((line) => !/^(?:Transport status|Hospital destination|Hospital address|Hospital latitude|Hospital longitude|Transport started at|Transport completed at):/i.test(line.trim())));
  const lines = keep;
  const set = (label: string, value: unknown) => {
    const clean = value === undefined || value === null || value === '' ? '' : cleanLine(value);
    if (clean) lines.push(`${label}: ${clean}`);
  };
  if (transport.transport_status) set('Transport status', transport.transport_status);
  else if (values['transport status']) set('Transport status', values['transport status']);
  set('Hospital destination', transport.hospital_name ?? values['hospital destination']);
  set('Hospital address', transport.hospital_address ?? values['hospital address']);
  set('Hospital latitude', transport.hospital_latitude ?? values['hospital latitude']);
  set('Hospital longitude', transport.hospital_longitude ?? values['hospital longitude']);
  set('Transport started at', transport.transport_started_at ?? values['transport started at']);
  set('Transport completed at', transport.transport_completed_at ?? values['transport completed at']);
  return [before, lines.join('\n')].filter(Boolean).join('\n\n');
}

export function parseTransportDestination(notesValue: unknown, channel: FieldResponseChannel): TransportDestination & { triage_outcome?: string } {
  const values = readFieldResponseValues(notesValue, channel);
  const latitude = Number(values['hospital latitude']);
  const longitude = Number(values['hospital longitude']);
  return {
    triage_outcome: values['triage outcome'],
    transport_status: values['transport status'] as TransportStatus | undefined,
    hospital_name: values['hospital destination'],
    hospital_address: values['hospital address'],
    hospital_latitude: Number.isFinite(latitude) ? latitude : null,
    hospital_longitude: Number.isFinite(longitude) ? longitude : null,
    transport_started_at: values['transport started at'] || null,
    transport_completed_at: values['transport completed at'] || null,
  };
}

export function requiredTriageClosureFields(notesValue: unknown, channel: FieldResponseChannel): string[] {
  const values = readFieldResponseValues(notesValue, channel);
  const missing: string[] = [];
  const triage = values['triage outcome'];
  if (!['safe', 'mild_injuries', 'severe_injuries'].includes(triage || '')) missing.push('triage outcome');
  if (values['transport status'] === 'in_transit') missing.push('transport completion');
  if (triage === 'severe_injuries') {
    if (!values['hospital destination']) missing.push('transport destination');
    if (!values['hospital latitude'] || !values['hospital longitude'] ||
        !Number.isFinite(Number(values['hospital latitude'])) || !Number.isFinite(Number(values['hospital longitude']))) {
      missing.push('transport destination map location');
    }
    if (values['transport status'] !== 'delivered' && values['transport status'] !== 'in_transit') missing.push('transport status');
  }
  return missing;
}
