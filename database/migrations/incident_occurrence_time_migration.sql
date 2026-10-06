-- Keep the resident-reported incident time distinct from server receipt time.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS incident_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_time_precision TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'incident_reports_time_precision_check'
      AND conrelid = 'public.incident_reports'::regclass
  ) THEN
    ALTER TABLE public.incident_reports
      ADD CONSTRAINT incident_reports_time_precision_check
      CHECK (incident_time_precision IN ('exact', 'approximate', 'unknown'));
  END IF;
END $$;
