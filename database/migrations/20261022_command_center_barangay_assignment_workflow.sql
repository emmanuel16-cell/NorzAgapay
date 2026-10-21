BEGIN;

ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'vehicle_incident';

ALTER TABLE public.mdrrmo_report_barangay_assignments
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL;

ALTER TABLE public.mdrrmo_report_barangay_assignment_events
  DROP CONSTRAINT IF EXISTS mdrrmo_report_barangay_assignment_events_event_type_check;
ALTER TABLE public.mdrrmo_report_barangay_assignment_events
  ADD CONSTRAINT mdrrmo_report_barangay_assignment_events_event_type_check
  CHECK (event_type IN (
    'assigned','reassigned','recalled','dispatched','responding','arrived','resolved','escalated','dismissed'
  ));

-- Keep the existing dispatch procedures and all their locking/validation
-- behavior, while adding the new supported incident category to their allowlists.
DO $$
DECLARE
  v_function RECORD;
  v_definition TEXT;
  v_updated_definition TEXT;
  v_updated_count INTEGER := 0;
  v_v2_seen BOOLEAN := false;
BEGIN
  FOR v_function IN
    SELECT p.oid, p.proname
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('dispatch_mdrrmo_report', 'dispatch_mdrrmo_report_v2')
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated_definition := replace(
      v_definition,
      '''earthquake'', ''medical_emergency''',
      '''earthquake'', ''vehicle_incident'', ''medical_emergency'''
    );
    v_updated_definition := replace(
      v_updated_definition,
      '''earthquake'',''medical_emergency''',
      '''earthquake'',''vehicle_incident'',''medical_emergency'''
    );
    IF v_function.proname = 'dispatch_mdrrmo_report_v2' THEN
      v_v2_seen := true;
    END IF;
    IF v_updated_definition <> v_definition THEN
      EXECUTE v_updated_definition;
      v_updated_count := v_updated_count + 1;
    ELSIF position('vehicle_incident' IN v_definition) > 0 THEN
      v_updated_count := v_updated_count + 1;
    ELSE
      RAISE EXCEPTION 'Could not update the incident-type allowlist in public.%', v_function.proname;
    END IF;
  END LOOP;

  IF NOT v_v2_seen OR v_updated_count = 0 THEN
    RAISE EXCEPTION 'No MDRRMO dispatch function was updated.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_resolved_mdrrmo_report_barangay_assignment_v1(
  p_report_id UUID,
  p_barangay_id UUID,
  p_actor_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.mdrrmo_report_barangay_assignments%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'A Barangay dispatcher is required to close this assignment.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_barangay_assignments
  WHERE report_id = p_report_id AND barangay_id = p_barangay_id
  ORDER BY assigned_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolved report assignment not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_assignment.assignment_status <> 'completed' OR v_assignment.response_status <> 'resolved' THEN
    RAISE EXCEPTION 'Only a resolved Barangay assignment can be closed.' USING ERRCODE = '23514';
  END IF;
  IF v_assignment.closed_at IS NOT NULL THEN
    RETURN v_assignment.id;
  END IF;

  UPDATE public.mdrrmo_report_barangay_assignments
  SET closed_at = v_now, closed_by = p_actor_id, updated_at = v_now
  WHERE id = v_assignment.id;

  INSERT INTO public.mdrrmo_report_barangay_assignment_events (
    report_id, assignment_id, from_barangay_id, event_type, actor_id, actor_role, created_at
  ) VALUES (
    p_report_id, v_assignment.id, p_barangay_id, 'dismissed', p_actor_id, 'dispatcher', v_now
  );

  RETURN v_assignment.id;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_resolved_mdrrmo_report_barangay_assignment_v1(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_resolved_mdrrmo_report_barangay_assignment_v1(UUID, UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
