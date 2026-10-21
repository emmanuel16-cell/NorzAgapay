-- Add the closure timestamp consumed by responder assignment feeds and review actions.
BEGIN;

ALTER TABLE public.mdrrmo_report_barangay_assignments
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';

COMMIT;
