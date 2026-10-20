export type IncidentTimeChoice = 'just_now' | 'earlier' | 'unknown';
export type IncidentTimePrecision = 'exact' | 'approximate' | 'unknown';

export type IncidentTimeValue = {
  choice: IncidentTimeChoice;
  occurredAt: string | null;
  precision: IncidentTimePrecision;
};

export function createInitialIncidentTime(): IncidentTimeValue {
  return {
    choice: 'just_now',
    occurredAt: new Date().toISOString(),
    precision: 'exact',
  };
}
