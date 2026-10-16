BEGIN;

ALTER TABLE public.barangays
  ADD COLUMN IF NOT EXISTS location_icon_url TEXT,
  ADD COLUMN IF NOT EXISTS location_icon_storage_path TEXT;

ALTER TABLE public.mdrrmo_command_locations
  ADD COLUMN IF NOT EXISTS icon_url TEXT,
  ADD COLUMN IF NOT EXISTS icon_storage_path TEXT;

COMMIT;
