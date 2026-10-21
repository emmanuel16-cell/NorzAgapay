BEGIN;

-- A response unit may have several active Team Leaders. Keep each responder
-- account linked to at most one active unit through the roster trigger below.
DROP INDEX IF EXISTS public.idx_respond_unit_one_active_team_leader;

CREATE OR REPLACE FUNCTION public.enforce_respond_unit_member_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_existing INTEGER;
  v_user_role TEXT;
  v_user_status TEXT;
BEGIN
  PERFORM 1 FROM public.respond_units WHERE id = NEW.unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = '23503';
  END IF;

  IF NOT NEW.is_active OR NEW.member_role = 'unassigned' THEN
    RETURN NEW;
  END IF;

  IF NEW.member_role = 'team_leader' THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.responder_user_id::TEXT));
    SELECT role::TEXT, status::TEXT INTO v_user_role, v_user_status
    FROM public.users WHERE id = NEW.responder_user_id;
    IF NOT FOUND OR v_user_role <> 'responder' OR v_user_status <> 'active' THEN
      RAISE EXCEPTION 'Team Leader must have an active responder account' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.respond_unit_members
      WHERE responder_user_id = NEW.responder_user_id
        AND member_role = 'team_leader'
        AND is_active
        AND id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'Responder account already leads an active unit' USING ERRCODE = '23505';
    END IF;

    -- Team Leaders do not consume a crew position capacity slot.
    RETURN NEW;
  END IF;

  v_limit := CASE NEW.member_role
    WHEN 'radio_operator' THEN 1
    WHEN 'driver_responder' THEN 3
    WHEN 'first_aider_responder' THEN 3
    ELSE 0
  END;
  IF v_limit = 0 THEN
    RAISE EXCEPTION 'Invalid active unit member role' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.respond_unit_members
  WHERE unit_id = NEW.unit_id
    AND member_role = NEW.member_role
    AND is_active
    AND id IS DISTINCT FROM NEW.id;
  IF v_existing >= v_limit THEN
    RAISE EXCEPTION 'Unit has reached the capacity for role %', NEW.member_role USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_respond_unit_team_leader_v1(
  p_unit_id UUID,
  p_officer_id UUID,
  p_responder_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_unit public.respond_units%ROWTYPE;
BEGIN
  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_responder_user_id;
  IF NOT FOUND OR v_user.role::TEXT <> 'responder' OR v_user.status::TEXT <> 'active' THEN
    RAISE EXCEPTION 'Team Leader must have an active responder account' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.officers
    WHERE id = p_officer_id
      AND public.normalize_ph_mobile_number(phone) = public.normalize_ph_mobile_number(v_user.phone)
  ) THEN
    RAISE EXCEPTION 'Team Leader profile must match the responder account' USING ERRCODE = '23514';
  END IF;

  -- Adding a leader is additive: existing leaders stay assigned, even when
  -- they currently have an active incident.
  INSERT INTO public.respond_unit_members (unit_id, officer_id, responder_user_id, member_role, is_active)
  VALUES (p_unit_id, p_officer_id, p_responder_user_id, 'team_leader', true)
  ON CONFLICT (unit_id, officer_id) DO UPDATE SET
    responder_user_id = EXCLUDED.responder_user_id,
    member_role = 'team_leader',
    is_active = true;

  UPDATE public.respond_units
  SET officer_ids = ARRAY(
    SELECT DISTINCT officer_id
    FROM unnest(COALESCE(officer_ids, '{}'::UUID[]) || ARRAY[p_officer_id]) AS ids(officer_id)
  )
  WHERE id = p_unit_id;

  RETURN jsonb_build_object('unit_id', p_unit_id, 'responder_user_id', p_responder_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_respond_unit_team_leader_v1(
  p_unit_id UUID,
  p_responder_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit public.respond_units%ROWTYPE;
  v_leader public.respond_unit_members%ROWTYPE;
BEGIN
  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_leader
  FROM public.respond_unit_members
  WHERE unit_id = p_unit_id
    AND responder_user_id = p_responder_user_id
    AND member_role = 'team_leader'
    AND is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Team Leader not found in this response unit' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mdrrmo_report_assignments
    WHERE responder_id = p_responder_user_id AND status IN ('assigned', 'responding')
  ) THEN
    RAISE EXCEPTION 'Cannot remove a Team Leader while they have an active dispatch' USING ERRCODE = '23514';
  END IF;

  UPDATE public.respond_unit_members SET is_active = false WHERE id = v_leader.id;
  RETURN jsonb_build_object('unit_id', p_unit_id, 'responder_user_id', p_responder_user_id, 'team_leader_removed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_respond_unit_member_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_respond_unit_team_leader_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_respond_unit_team_leader_v1(UUID, UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.remove_respond_unit_team_leader_v1(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_respond_unit_team_leader_v1(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
