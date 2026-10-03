-- Report response lifecycle timestamps, arrival evidence, and acceptance-time distance.
-- Run in the Supabase SQL Editor before deploying the updated API/mobile app.

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS travel_distance_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_fix_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_method TEXT,
  ADD COLUMN IF NOT EXISTS arrival_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_distance_m DOUBLE PRECISION;

-- The MDRRMO task workflow records acceptance and arrival on tasks as well.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS travel_distance_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_fix_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returning_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_method TEXT,
  ADD COLUMN IF NOT EXISTS arrival_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_distance_m DOUBLE PRECISION;

-- Backfill milestones only where an existing timestamp has the same meaning.
UPDATE public.incident_reports AS report
SET accepted_at = report.barangay_responded_at
WHERE report.accepted_at IS NULL
  AND report.barangay_response_status = 'responding'
  AND report.barangay_responded_at IS NOT NULL;

UPDATE public.incident_reports AS report
SET dispatched_at = report.barangay_responded_at
WHERE report.dispatched_at IS NULL
  AND report.barangay_response_status = 'pending'
  AND report.barangay_responded_at IS NOT NULL;

UPDATE public.incident_reports AS report
SET accepted_at = task.accepted_at
FROM public.tasks AS task
WHERE report.accepted_at IS NULL
  AND report.dispatch_incident_id = task.incident_id
  AND task.accepted_at IS NOT NULL;

UPDATE public.incident_reports AS report
SET travel_distance_m = task.travel_distance_m,
    travel_distance_accuracy_m = task.travel_distance_accuracy_m,
    travel_distance_fix_at = task.travel_distance_fix_at
FROM public.tasks AS task
WHERE report.travel_distance_m IS NULL
  AND report.dispatch_incident_id = task.incident_id
  AND task.travel_distance_m IS NOT NULL;

UPDATE public.incident_reports AS report
SET arrived_at = task.arrived_at,
    arrival_recorded_at = COALESCE(task.arrival_recorded_at, task.arrived_at),
    arrival_method = COALESCE(task.arrival_method, 'manual'),
    arrival_latitude = task.arrival_latitude,
    arrival_longitude = task.arrival_longitude,
    arrival_accuracy_m = task.arrival_accuracy_m,
    arrival_distance_m = task.arrival_distance_m
FROM public.tasks AS task
WHERE report.arrived_at IS NULL
  AND report.dispatch_incident_id = task.incident_id
  AND task.arrived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incident_reports_dispatched_at
  ON public.incident_reports(dispatched_at);
CREATE INDEX IF NOT EXISTS idx_incident_reports_arrived_at
  ON public.incident_reports(arrived_at);

-- Support barangay-origin report history, resolved lists, and resident timing estimates.
CREATE INDEX IF NOT EXISTS idx_incident_reports_barangay_created_at
  ON public.incident_reports(barangay_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_reports_barangay_resolved_at
  ON public.incident_reports(barangay_id, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incident_reports_barangay_timing_samples
  ON public.incident_reports(barangay_id, type, severity, created_at DESC)
  WHERE accepted_at IS NOT NULL
    AND arrived_at IS NOT NULL
    AND resolved_at IS NOT NULL;
