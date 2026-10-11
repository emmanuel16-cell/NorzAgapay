BEGIN;

ALTER TYPE public.incident_type ADD VALUE IF NOT EXISTS 'not_sure';

CREATE OR REPLACE FUNCTION public.dispatch_mdrrmo_report_v2(
  p_report_id       UUID,
  p_actor_id        UUID,
  p_incident_type   TEXT,
  p_severity        TEXT,
  p_notes           TEXT,
  p_responder_ids   UUID[],
  p_responder_names TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_report public.mdrrmo_reports%ROWTYPE;
  v_now    TIMESTAMPTZ := clock_timestamp();
  v_active_count INTEGER;
  v_dispatchable_count INTEGER;
BEGIN
  IF p_actor_id IS NULL OR p_incident_type IS NULL
     OR p_incident_type NOT IN ('not_sure','flash_flood','fire','earthquake','medical_emergency','typhoon','other')
     OR p_severity IS NULL OR p_severity NOT IN ('low','moderate','high','critical')
     OR p_responder_ids IS NULL OR cardinality(p_responder_ids) < 1
     OR cardinality(p_responder_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_responder_ids) AS ids(id))
  THEN
    RAISE EXCEPTION 'Invalid dispatch details' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report FROM public.mdrrmo_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MDRRMO report not found' USING ERRCODE = 'P0002'; END IF;
  IF v_report.response_status <> 'pending' THEN
    RAISE EXCEPTION 'Report already dispatched or resolved' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND status <> 'removed';
  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Report already has active assignments' USING ERRCODE = '23514';
  END IF;

  -- Lock the unit rows after the report to serialize with activation and
  -- roster changes without reversing the report-to-unit lock order on accept.
  PERFORM units.id
  FROM public.respond_units AS units
  JOIN public.respond_unit_members AS leaders ON leaders.unit_id = units.id
  WHERE leaders.responder_user_id = ANY(p_responder_ids)
    AND leaders.member_role = 'team_leader'
    AND leaders.is_active
  ORDER BY units.id
  FOR SHARE OF units;

  SELECT count(DISTINCT selected.responder_id) INTO v_dispatchable_count
  FROM unnest(p_responder_ids) AS selected(responder_id)
  JOIN public.respond_unit_members AS leaders
    ON leaders.responder_user_id = selected.responder_id
   AND leaders.member_role = 'team_leader'
   AND leaders.is_active
  JOIN public.respond_units AS units
    ON units.id = leaders.unit_id
   AND units.status = 'available'
  JOIN public.respond_unit_daily_activations AS activations
    ON activations.unit_id = units.id
   AND activations.activation_date = timezone('Asia/Manila', v_now)::DATE
  JOIN public.users AS leader_accounts
    ON leader_accounts.id = leaders.responder_user_id
   AND leader_accounts.role::TEXT = 'responder'
   AND leader_accounts.status::TEXT = 'active'
  WHERE EXISTS (
    SELECT 1 FROM public.respond_unit_members AS drivers
    WHERE drivers.unit_id = units.id AND drivers.is_active
      AND drivers.member_role = 'driver_responder'
  )
    AND EXISTS (
      SELECT 1 FROM public.respond_unit_members AS first_aiders
      WHERE first_aiders.unit_id = units.id AND first_aiders.is_active
        AND first_aiders.member_role = 'first_aider_responder'
    );
  IF v_dispatchable_count <> cardinality(p_responder_ids) THEN
    RAISE EXCEPTION 'One or more selected responders do not belong to an available unit activated today with a complete roster' USING ERRCODE = '23514';
  END IF;

  UPDATE public.mdrrmo_reports SET
    incident_type        = p_incident_type,
    severity             = p_severity,
    dispatch_notes       = p_notes,
    responder_name       = p_responder_names,
    dispatched_by        = p_actor_id,
    dispatched_at        = v_now,
    lifecycle_actor_id   = p_actor_id,
    lifecycle_actor_role = 'dispatcher'
  WHERE id = p_report_id;

  INSERT INTO public.mdrrmo_report_assignments (report_id, responder_id, assigned_by, status, assigned_at)
  SELECT p_report_id, unnest(p_responder_ids), p_actor_id, 'assigned', v_now;

  RETURN jsonb_build_object('dispatched_at', v_now, 'responder_count', cardinality(p_responder_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.dispatch_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT)
  FROM PUBLIC, anon, authenticated;

COMMIT;
