-- MDRRMO reports now live in mdrrmo_reports. The original report-cycle
-- migration linked assignments to incident_reports, which blocks dispatching
-- newly submitted reports that exist only in the canonical table.
--
-- Apply after separate_report_tables_phase1.sql and
-- mdrrmo_report_cycle_migration.sql. NOT VALID preserves any historical rows
-- that have not been backfilled, while enforcing the canonical relation for
-- new and changed assignments.

BEGIN;

ALTER TABLE public.mdrrmo_report_assignments
  DROP CONSTRAINT IF EXISTS mdrrmo_report_assignments_report_id_fkey;

ALTER TABLE public.mdrrmo_report_assignments
  ADD CONSTRAINT mdrrmo_report_assignments_report_id_fkey
  FOREIGN KEY (report_id)
  REFERENCES public.mdrrmo_reports(id)
  ON DELETE CASCADE
  NOT VALID;

COMMIT;
