-- Preserve the resident's first submit-attempt time separately from the
-- server-generated created_at value used for receipt time and response SLAs.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS client_submitted_at TIMESTAMPTZ;
