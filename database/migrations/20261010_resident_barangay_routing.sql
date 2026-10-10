BEGIN;

-- Reuse the same validated assignment transaction for resident-selected local
-- routing, then record who initiated the assignment accurately in its audit.
CREATE OR REPLACE FUNCTION public.assign_mdrrmo_report_to_barangay_from_resident_v1(
  p_report_id UUID,
  p_barangay_id UUID,
  p_notes TEXT DEFAULT 'Resident selected the closest active barangay when submitting this report.'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_id UUID;
BEGIN
  IF length(trim(COALESCE(p_notes, ''))) < 3 THEN
    RAISE EXCEPTION 'Resident routing notes are required.' USING ERRCODE = '22023';
  END IF;

  v_assignment_id := public.set_mdrrmo_report_barangay_assignment_v1(
    p_report_id, p_barangay_id, NULL, 'assign', p_notes
  );

  UPDATE public.mdrrmo_report_barangay_assignment_events
  SET actor_role = 'resident'
  WHERE assignment_id = v_assignment_id
    AND event_type = 'assigned'
    AND actor_id IS NULL;

  UPDATE public.mdrrmo_reports
  SET lifecycle_actor_id = NULL,
      lifecycle_actor_role = 'resident_router'
  WHERE id = p_report_id;

  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_mdrrmo_report_to_barangay_from_resident_v1(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_mdrrmo_report_to_barangay_from_resident_v1(UUID, UUID, TEXT)
  TO service_role;

COMMIT;
