BEGIN;

CREATE TABLE IF NOT EXISTS public.hospital_directory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  municipality TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT 'Bulacan',
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  source_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hospital_directory_active_idx
  ON public.hospital_directory (active);

ALTER TABLE public.hospital_directory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hospital_directory FROM anon, authenticated;
GRANT SELECT ON TABLE public.hospital_directory TO service_role;

-- Norzagaray facilities are listed first. Nearby San Jose del Monte facilities
-- are included so the automatic five-nearest list has useful choices across
-- Norzagaray's outlying barangays as well.
INSERT INTO public.hospital_directory
  (id, name, address, municipality, province, latitude, longitude, source_url, active)
VALUES
  ('norzagaray-municipal-hospital', 'Norzagaray Municipal Hospital', 'Municipal Compound, Poblacion, Norzagaray, Bulacan', 'Norzagaray', 'Bulacan', 14.904186, 121.042065, 'https://cms-cdn.e.gov.ph/DICT/pdf/DTS_PICS-PP-Phase-2-Region-3-Bulacan-Pampanga.pdf', true),
  ('nodado-general-hospital-norzagaray', 'Nodado General Hospital', '456 Bigte, Quirino Highway, Norzagaray, Bulacan', 'Norzagaray', 'Bulacan', 14.856221, 121.083323, 'https://shop.philcare.com.ph/er-hospitals', true),
  ('ospital-ng-lungsod-ng-san-jose-del-monte', 'Ospital ng Lungsod ng San Jose del Monte', 'Barangay Bagong Buhay I, San Jose del Monte, Bulacan', 'San Jose del Monte', 'Bulacan', 14.854432, 121.056953, 'https://cms-cdn.e.gov.ph/DICT/pdf/DTS_PICS-PP-Phase-2-Region-3-Bulacan-Pampanga.pdf', true),
  ('kairos-maternity-general-hospital', 'Kairos Maternity & General Hospital', 'National Road, Muzon, San Jose del Monte, Bulacan', 'San Jose del Monte', 'Bulacan', 14.8030348, 121.0348628, 'https://www.philhealth.gov.ph/partners/providers/facilities/accredited/HOSP_053126.pdf', true),
  ('skyline-hospital-medical-center', 'Skyline Hospital and Medical Center', 'Skyline Drive corner Quirino Highway, Tungkong Mangga, San Jose del Monte, Bulacan', 'San Jose del Monte', 'Bulacan', 14.7981834, 121.0704843, 'https://skylinehospital.ph/', true),
  ('healthway-qualimed-hospital-sjdm', 'Healthway QualiMed Hospital San Jose del Monte', 'Altaraza Spine Road, Tungkong Mangga, San Jose del Monte, Bulacan', 'San Jose del Monte', 'Bulacan', 14.7882214, 121.0769328, 'https://healthwaymedicalnetwork.com.ph/our-network/healthway-qualimed-hospital-san-jose-del-monte/', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  municipality = EXCLUDED.municipality,
  province = EXCLUDED.province,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  source_url = EXCLUDED.source_url,
  active = EXCLUDED.active,
  updated_at = now();

NOTIFY pgrst, 'reload schema';

COMMIT;
