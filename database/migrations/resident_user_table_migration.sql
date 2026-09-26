-- Keep the three account groups in separate tables:
--   users         -> MDRRMO / response staff
--   barangay_users -> barangay staff
--   resident_user  -> resident app accounts
CREATE TABLE IF NOT EXISTS public.resident_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone VARCHAR(15),
  password_hash TEXT NOT NULL,
  barangay_name TEXT NOT NULL DEFAULT 'Poblacion',
  role TEXT NOT NULL DEFAULT 'resident' CHECK (role = 'resident'),
  status TEXT NOT NULL DEFAULT 'active',
  verified BOOLEAN NOT NULL DEFAULT false,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.resident_user ENABLE ROW LEVEL SECURITY;

-- incident_reports.reporter_id is polymorphic: it may identify a staff user
-- or a resident_user. reporter_type distinguishes the account table.
ALTER TABLE public.incident_reports
  DROP CONSTRAINT IF EXISTS incident_reports_reporter_id_fkey;
