export const INCIDENT_TYPE_OPTIONS = [
  { value: 'flash_flood', label: 'Flood / Flash Flood' },
  { value: 'fire', label: 'Fire' },
  { value: 'earthquake', label: 'Earthquake' },
  { value: 'medical_emergency', label: 'Medical Emergency' },
  { value: 'typhoon', label: 'Typhoon / Severe Weather' },
  { value: 'other', label: 'Other Emergency' },
] as const;

export const INCIDENT_SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
] as const;

export type IncidentType = (typeof INCIDENT_TYPE_OPTIONS)[number]['value'];
export type IncidentSeverity = (typeof INCIDENT_SEVERITY_OPTIONS)[number]['value'];
