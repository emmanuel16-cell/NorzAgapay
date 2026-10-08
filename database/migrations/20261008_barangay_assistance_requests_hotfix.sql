-- Repair assistance-request constraints on databases created from the earlier
-- schema that linked incident_report_id to incident_reports instead of the
-- Barangay incident table used by the API.
-- Run this migration in Supabase SQL Editor after
-- 20261008_barangay_assistance_requests.sql.

BEGIN;

-- Do not silently discard existing links. If any request points to a source
-- incident without a matching Barangay report, stop and resolve that link
-- before replacing the foreign key.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.barangay_assistance_requests AS request
    WHERE request.incident_report_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.barangay_reports AS report
        WHERE report.id = request.incident_report_id
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot repair barangay_assistance_requests.incident_report_id: existing request rows do not match public.barangay_reports. Map or clear those links, then rerun this migration.';
  END IF;
END;
$$;

ALTER TABLE public.barangay_assistance_requests
  DROP CONSTRAINT IF EXISTS barangay_assistance_requests_incident_report_id_fkey;

ALTER TABLE public.barangay_assistance_requests
  ADD CONSTRAINT barangay_assistance_requests_incident_report_id_fkey
  FOREIGN KEY (incident_report_id)
  REFERENCES public.barangay_reports(id)
  ON DELETE SET NULL;

-- Match the decisions/statuses written by the API, including dismissal.
ALTER TABLE public.barangay_assistance_requests
  DROP CONSTRAINT IF EXISTS barangay_assistance_requests_status_check;

ALTER TABLE public.barangay_assistance_requests
  ADD CONSTRAINT barangay_assistance_requests_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'actioned'::text,
    'rejected'::text,
    'fulfilled'::text,
    'cancelled'::text
  ]));

ALTER TABLE public.barangay_assistance_requests
  DROP CONSTRAINT IF EXISTS barangay_assistance_requests_decision_check;

ALTER TABLE public.barangay_assistance_requests
  ADD CONSTRAINT barangay_assistance_requests_decision_check
  CHECK (decision IS NULL OR decision = ANY (ARRAY[
    'provide_barangay_assistance'::text,
    'coordinate_mdrrmo'::text,
    'dismissed'::text
  ]));

NOTIFY pgrst, 'reload schema';

COMMIT;
