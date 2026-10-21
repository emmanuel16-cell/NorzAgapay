export const INCIDENT_TYPE_OPTIONS = [
  { value: 'not_sure', label: 'Not sure' },
  { value: 'flash_flood', label: 'Flood / Flash Flood' },
  { value: 'fire', label: 'Fire' },
  { value: 'earthquake', label: 'Earthquake' },
  { value: 'vehicle_incident', label: 'Vehicle Incident' },
  { value: 'medical_emergency', label: 'Medical Emergency' },
  { value: 'typhoon', label: 'Typhoon / Severe Weather' },
  { value: 'other', label: 'Other Emergency' },
] as const;

export const COMMUNITY_CONCERN_OPTIONS = [
  { value: 'not_sure', label: 'Not sure' },
  { value: 'minor_flooding', label: 'Minor Flooding' },
  { value: 'drainage_blockage', label: 'Drainage Blockage' },
  { value: 'road_damage', label: 'Road Damage' },
  { value: 'illegal_dumping', label: 'Illegal Dumping' },
  { value: 'unsafe_electrical_wiring', label: 'Unsafe Electrical Wiring' },
  { value: 'fallen_tree', label: 'Fallen Tree' },
  { value: 'other', label: 'Other concern' },
] as const;

export const COMMUNITY_CONCERN_INCIDENT_TYPES: Record<string, string> = {
  not_sure: 'not_sure',
  minor_flooding: 'flash_flood',
  drainage_blockage: 'other',
  road_damage: 'other',
  illegal_dumping: 'other',
  unsafe_electrical_wiring: 'other',
  fallen_tree: 'other',
  other: 'other',
};

export const INCIDENT_SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
] as const;

export type IncidentType = (typeof INCIDENT_TYPE_OPTIONS)[number]['value'];
export type IncidentSeverity = (typeof INCIDENT_SEVERITY_OPTIONS)[number]['value'];
