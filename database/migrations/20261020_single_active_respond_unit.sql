-- A normal Activate action selects one team. Emergency activate all remains
-- the explicit operation for making every eligible team active.
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
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_active IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_activated_by
      AND role::TEXT IN ('admin', 'logistics', 'dispatcher', 'master_admin')
      AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'An active authorized staff account is required to change unit activation' USING ERRCODE = '42501';
  END IF;

  -- Lock units in a stable order so simultaneous activation requests cannot
  -- leave more than one manually selected team active.
  PERFORM id FROM public.respond_units ORDER BY id FOR UPDATE;
  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_active THEN
    IF v_unit.status <> 'available' THEN
      RAISE EXCEPTION 'Only available response units can be activated' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.respond_unit_members AS leaders
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

    UPDATE public.respond_units
    SET is_active = false,
        activation_mode = NULL,
        activated_by = NULL,
        activated_at = NULL
    WHERE id <> p_unit_id AND is_active;
  END IF;

  UPDATE public.respond_units
  SET is_active = p_active,
      activation_mode = CASE WHEN p_active THEN 'manual' ELSE NULL END,
      activated_by = CASE WHEN p_active THEN p_activated_by ELSE NULL END,
      activated_at = CASE WHEN p_active THEN v_now ELSE NULL END
  WHERE id = p_unit_id;

  RETURN jsonb_build_object('unit_id', p_unit_id, 'is_active', p_active, 'is_active_today', p_active);
END;
$$;

REVOKE ALL ON FUNCTION public.set_respond_unit_activation_today_v1(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_respond_unit_activation_today_v1(UUID, UUID, BOOLEAN)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
