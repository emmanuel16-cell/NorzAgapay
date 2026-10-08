-- Persist the responder-to-incident distance captured when an MDRRMO dispatch
-- is accepted. Resident ETA estimates use this distance with historical
-- responder travel times.
ALTER TABLE public.mdrrmo_reports
  ADD COLUMN IF NOT EXISTS travel_distance_m DOUBLE PRECISION;

NOTIFY pgrst, 'reload schema';
