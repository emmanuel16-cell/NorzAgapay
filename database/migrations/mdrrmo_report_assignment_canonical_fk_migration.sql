-- MDRRMO assignments must reference the canonical MDRRMO report table.
-- The original report-cycle migration linked report_id to incident_reports,
-- but dispatch_mdrrmo_report_v2 inserts IDs from mdrrmo_reports.
-- NOT VALID preserves historical assignments while enforcing this relation
-- for every new or updated assignment.

BEGIN;

ALTER TABLE public.mdrrmo_report_assignments
  DROP CONSTRAINT IF EXISTS mdrrmo_report_assignments_report_id_fkey;

ALTER TABLE public.mdrrmo_report_assignments
  ADD CONSTRAINT mdrrmo_report_assignments_report_id_fkey
  FOREIGN KEY (report_id)
  REFERENCES public.mdrrmo_reports(id)
  ON DELETE CASCADE
  NOT VALID;

NOTIFY pgrst, 'reload schema';

COMMIT;
