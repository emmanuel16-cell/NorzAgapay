-- Permanently hide resolved MDRRMO report pins from the Command Center map.
-- This closes only the map marker; it does not delete or alter the report record.
BEGIN;

ALTER TABLE public.mdrrmo_reports
  ADD COLUMN IF NOT EXISTS map_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS map_closed_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.close_resolved_mdrrmo_map_marker_v1(
  p_report_id UUID,
  p_actor_id UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_type TEXT;
  v_source_barangay_report_id UUID;
  v_coordination_notes TEXT;
  v_response_status TEXT;
  v_map_closed_at TIMESTAMPTZ;
BEGIN
  SELECT source_type, source_barangay_report_id, coordination_notes,
         response_status, map_closed_at
    INTO v_source_type, v_source_barangay_report_id, v_coordination_notes,
         v_response_status, v_map_closed_at
  FROM public.mdrrmo_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MDRRMO report not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Make repeated requests harmless and keep the first closure time/actor.
  IF v_map_closed_at IS NOT NULL THEN
    RETURN v_map_closed_at;
  END IF;

  IF lower(COALESCE(v_response_status, '')) <> 'resolved' THEN
    RAISE EXCEPTION 'Only resolved reports can be closed from the map.' USING ERRCODE = 'P0001';
  END IF;

  -- Barangay-origin reports appear as resolved on the map only after both
  -- the barangay response and the MDRRMO response are resolved.
  IF lower(COALESCE(v_source_type, '')) = 'escalated'
     OR NULLIF(btrim(COALESCE(v_coordination_notes, '')), '') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.mdrrmo_report_barangay_assignments AS assignment
      WHERE assignment.report_id = p_report_id
        AND assignment.assignment_status = 'completed'
        AND assignment.response_status = 'resolved'
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.barangay_reports AS source_report
      WHERE source_report.id = v_source_barangay_report_id
        AND source_report.response_status = 'resolved'
    ) THEN
      RAISE EXCEPTION 'The barangay response must also be resolved before closing its map marker.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.mdrrmo_reports
  SET map_closed_at = now(),
      map_closed_by = p_actor_id
  WHERE id = p_report_id
  RETURNING map_closed_at INTO v_map_closed_at;

  RETURN v_map_closed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.close_resolved_mdrrmo_map_marker_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_resolved_mdrrmo_map_marker_v1(UUID, UUID)
  TO service_role;

COMMIT;
