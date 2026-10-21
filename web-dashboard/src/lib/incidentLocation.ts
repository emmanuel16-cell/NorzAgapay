export type IncidentLocationRecord = {
  latitude?: number | string | null;
  longitude?: number | string | null;
  address?: string | null;
  location_name?: string | null;
  barangay_name?: string | null;
};

export function hasIncidentPin(report: IncidentLocationRecord): boolean {
  if (report.latitude == null || report.longitude == null ||
      String(report.latitude).trim() === '' || String(report.longitude).trim() === '') return false;
  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && !(latitude === 0 && longitude === 0);
}

const isGeneralLocation = (value: string) => /^(?:norzagaray(?:,?\s*bulacan)?|bulacan)$/i.test(value);
const isCoordinateLabel = (value: string) => /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(value);

function withMunicipality(value: string): string {
  if (/\bnorzagaray\b/i.test(value)) return /\bbulacan\b/i.test(value) ? value : `${value}, Bulacan`;
  return `${value}, Norzagaray, Bulacan`;
}

export function formatIncidentLocation(report: IncidentLocationRecord): string {
  const barangay = report.barangay_name?.trim().replace(/^(?:(?:barangay|brgy\.?)\s*)/i, '');
  const providedLocation = [report.location_name, report.address]
    .map((value) => value?.trim())
    .find((value) => value && !isGeneralLocation(value) && !isCoordinateLabel(value));
  if (providedLocation) return withMunicipality(providedLocation);
  if (barangay) return withMunicipality(barangay);

  const generalLocation = report.location_name?.trim() || report.address?.trim();
  if (generalLocation) {
    if (isGeneralLocation(generalLocation)) return 'Norzagaray, Bulacan';
    if (!isCoordinateLabel(generalLocation)) return withMunicipality(generalLocation);
  }
  return hasIncidentPin(report) ? 'Pinned incident location' : 'Location not provided';
}

export function incidentMapUrl(report: IncidentLocationRecord): string | null {
  if (!hasIncidentPin(report)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${Number(report.latitude)},${Number(report.longitude)}`;
}
