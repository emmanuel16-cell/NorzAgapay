-- Keep the database activation permissions aligned with the Respond Units UI/API.
-- Admins can manage unit rosters and activate available units, just like logistics staff.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_respond_unit_activation_today_v1(
  p_unit_id UUID,
  p_activated_by UUID,
  p_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit public.respond_units%ROWTYPE;
  v_date DATE := timezone('Asia/Manila', now())::DATE;
BEGIN
  IF p_active IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_activated_by
      AND role::TEXT IN ('admin', 'logistics', 'master_admin')
      AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'An active Admin or Staff account is required to change unit activation' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_active THEN
    IF v_unit.status <> 'available' THEN
      RAISE EXCEPTION 'Only available response units can be activated' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.respond_unit_members AS leaders
      JOIN public.users AS leader_accounts ON leader_accounts.id = leaders.responder_user_id
      WHERE leaders.unit_id = p_unit_id AND leaders.is_active
        AND leaders.member_role = 'team_leader'
        AND leader_accounts.role::TEXT = 'responder'
        AND leader_accounts.status::TEXT = 'active'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE unit_id = p_unit_id AND is_active AND member_role = 'driver_responder'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE unit_id = p_unit_id AND is_active AND member_role = 'first_aider_responder'
    ) THEN
      RAISE EXCEPTION 'The unit needs an active Team Leader, a Driver Responder, and a First Aider Responder before activation' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.respond_unit_daily_activations (
      unit_id, activation_date, activated_by, activation_mode, activated_at
    ) VALUES (p_unit_id, v_date, p_activated_by, 'manual', now())
    ON CONFLICT (unit_id, activation_date) DO UPDATE SET
      activated_by = EXCLUDED.activated_by,
      activation_mode = 'manual',
      activated_at = EXCLUDED.activated_at;
  ELSE
    DELETE FROM public.respond_unit_daily_activations
    WHERE unit_id = p_unit_id AND activation_date = v_date;
  END IF;

  RETURN jsonb_build_object(
    'unit_id', p_unit_id,
    'activation_date', v_date,
    'is_active_today', p_active
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.emergency_activate_all_respond_units_today_v1(
  p_activated_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := timezone('Asia/Manila', now())::DATE;
  v_now TIMESTAMPTZ := now();
  v_activated_count INTEGER := 0;
  v_total_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_activated_by
      AND role::TEXT IN ('admin', 'logistics', 'master_admin')
      AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'An active Admin or Staff account is required for emergency activation' USING ERRCODE = '42501';
  END IF;

  PERFORM id FROM public.respond_units ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_total_count FROM public.respond_units;

  INSERT INTO public.respond_unit_daily_activations (
    unit_id, activation_date, activated_by, activation_mode, activated_at
  )
  SELECT units.id, v_date, p_activated_by, 'emergency', v_now
  FROM public.respond_units AS units
  WHERE units.status = 'available'
    AND EXISTS (
      SELECT 1 FROM public.respond_unit_members AS leaders
      JOIN public.users AS leader_accounts ON leader_accounts.id = leaders.responder_user_id
      WHERE leaders.unit_id = units.id AND leaders.is_active
        AND leaders.member_role = 'team_leader'
        AND leader_accounts.role::TEXT = 'responder'
        AND leader_accounts.status::TEXT = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE unit_id = units.id AND is_active AND member_role = 'driver_responder'
    )
    AND EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE unit_id = units.id AND is_active AND member_role = 'first_aider_responder'
    )
  ON CONFLICT (unit_id, activation_date) DO UPDATE SET
    activated_by = EXCLUDED.activated_by,
    activation_mode = 'emergency',
    activated_at = EXCLUDED.activated_at;
  GET DIAGNOSTICS v_activated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'activation_date', v_date,
    'activated_count', v_activated_count,
    'skipped_count', GREATEST(v_total_count - v_activated_count, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_respond_unit_activation_today_v1(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_respond_unit_activation_today_v1(UUID, UUID, BOOLEAN)
  TO service_role;
REVOKE ALL ON FUNCTION public.emergency_activate_all_respond_units_today_v1(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emergency_activate_all_respond_units_today_v1(UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
