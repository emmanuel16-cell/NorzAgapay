-- Keep incident_reports.status aligned with the states written by the mobile
-- response and coordination workflow. The initial enum only contained the
-- resident review states (pending, verified, rejected).
ALTER TYPE public.report_status ADD VALUE IF NOT EXISTS 'responding';
ALTER TYPE public.report_status ADD VALUE IF NOT EXISTS 'escalated';
ALTER TYPE public.report_status ADD VALUE IF NOT EXISTS 'resolved';

-- These fields were added by the barangay response migration. Repeat the
-- idempotent additions here so deployments that missed that migration can
-- still complete the close-report flow.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
