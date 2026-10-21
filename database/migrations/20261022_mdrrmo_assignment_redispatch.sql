BEGIN;

-- A report can be reviewed as a false report, corrected, and dispatched again
-- to the same responder. Keep removed assignments as history while enforcing
-- uniqueness for every assignment that is still active or resolved.
ALTER TABLE public.mdrrmo_report_assignments
  DROP CONSTRAINT IF EXISTS mdrrmo_report_assignments_report_id_responder_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS mdrrmo_report_assignments_one_nonremoved_responder_idx
  ON public.mdrrmo_report_assignments (report_id, responder_id)
  WHERE status <> 'removed';

-- Once historical rows can coexist with a new assignment, responder actions
-- must lock the current assignment rather than an older removed row.
DO $$
DECLARE
  v_function RECORD;
  v_definition TEXT;
  v_updated_definition TEXT;
  v_old_query TEXT := 'WHERE report_id = p_report_id AND responder_id = p_responder_id';
BEGIN
  FOR v_function IN
    SELECT p.oid, p.proname
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'accept_mdrrmo_report_with_crew_v1',
        'set_mdrrmo_response_crew_v1',
        'dispatch_mdrrmo_report'
      )
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    IF v_function.proname = 'dispatch_mdrrmo_report' THEN
      v_updated_definition := replace(
        v_definition,
        'ON CONFLICT (report_id, responder_id) DO UPDATE SET',
        'ON CONFLICT (report_id, responder_id) WHERE status <> ''removed'' DO UPDATE SET'
      );
      IF v_updated_definition = v_definition AND position('WHERE status <> ''removed'' DO UPDATE SET' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Could not update assignment upsert in public.dispatch_mdrrmo_report';
      END IF;
    ELSIF v_function.proname = 'accept_mdrrmo_report_with_crew_v1' THEN
      v_updated_definition := replace(
        v_definition,
        v_old_query,
        'WHERE report_id = p_report_id AND responder_id = p_responder_id AND status = ''assigned'''
      );
      IF v_updated_definition = v_definition AND position('AND status = ''assigned''' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Could not update assignment lookup in public.accept_mdrrmo_report_with_crew_v1';
      END IF;
    ELSE
      v_updated_definition := replace(
        v_definition,
        v_old_query,
        'WHERE report_id = p_report_id AND responder_id = p_responder_id AND status = ''responding'''
      );
      IF v_updated_definition = v_definition AND position('AND status = ''responding''' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Could not update assignment lookup in public.set_mdrrmo_response_crew_v1';
      END IF;
    END IF;

    IF v_updated_definition <> v_definition THEN
      EXECUTE v_updated_definition;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
