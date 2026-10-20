import { supabaseAdmin } from '../config/supabase';
import { getVerifiedBarangayIds } from './verifiedBarangayService';
import { getNearestBarangay, type BarangayLocation, type Coordinates } from './nearestBarangay';

export interface ResponseBarangayLocation extends BarangayLocation {
  name: string;
  location_address?: string | null;
  location_icon_url?: string | null;
}

/**
 * Return the same active, MDRRMO-approved barangay destinations used for
 * dispatch. Their configured command locations take precedence over fallback
 * barangay coordinates in getBarangayCoordinates().
 */
export async function getVerifiedResponseBarangays(): Promise<ResponseBarangayLocation[]> {
  const verifiedIds = await getVerifiedBarangayIds();
  if (!verifiedIds.length) return [];

  const { data, error } = await supabaseAdmin
    .from('barangays')
    .select('id, name, latitude, longitude, location_latitude, location_longitude, location_address, location_icon_url')
    .in('id', verifiedIds)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as ResponseBarangayLocation[];
}

export function getNearestResponseBarangayName(
  origin: Coordinates,
  destinations: ResponseBarangayLocation[],
): string | null {
  return getNearestBarangay(origin, destinations)?.name || null;
}

/** Resolve a public-safe label for the closest active dispatch destination. */
export async function findNearestVerifiedResponseBarangayName(origin: Coordinates): Promise<string | null> {
  try {
    return getNearestResponseBarangayName(origin, await getVerifiedResponseBarangays());
  } catch (error) {
    console.warn('Could not resolve the closest response barangay:', error);
    return null;
  }
}
