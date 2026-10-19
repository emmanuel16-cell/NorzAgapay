-- Response unit activation is an explicit persistent state, not a daily flag.
BEGIN;

ALTER TABLE public.respond_units
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activation_mode TEXT,
  ADD COLUMN IF NOT EXISTS activated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.respond_units'::regclass
      AND conname = 'respond_units_activation_mode_check'
  ) THEN
    ALTER TABLE public.respond_units
      ADD CONSTRAINT respond_units_activation_mode_check
      CHECK (activation_mode IS NULL OR activation_mode IN ('manual', 'emergency'));
  END IF;
END;
$$;

-- Preserve units that were active when this migration is applied.
WITH active_today AS (
  SELECT DISTINCT ON (unit_id)
    unit_id, activated_by, activation_mode, activated_at
  FROM public.respond_unit_daily_activations
  WHERE activation_date = timezone('Asia/Manila', now())::DATE
  ORDER BY unit_id, activated_at DESC
)
UPDATE public.respond_units AS units
SET is_active = true,
    activation_mode = active_today.activation_mode,
    activated_by = active_today.activated_by,
    activated_at = active_today.activated_at
FROM active_today
WHERE units.id = active_today.unit_id
  AND NOT units.is_active;

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

  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.emergency_activate_all_respond_units_today_v1(
  p_activated_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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

  UPDATE public.respond_units AS units
  SET is_active = true,
      activation_mode = 'emergency',
      activated_by = p_activated_by,
      activated_at = v_now
  WHERE units.status = 'available'
    AND EXISTS (
      SELECT 1
      FROM public.respond_unit_members AS leaders
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
    );
  GET DIAGNOSTICS v_activated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'activated_count', v_activated_count,
    'skipped_count', GREATEST(v_total_count - v_activated_count, 0)
  );
END;
$$;

-- Update the active MDRRMO dispatch procedure so it checks the persistent flag.
DO $$
DECLARE
  v_definition TEXT;
  v_updated_definition TEXT;
BEGIN
  v_definition := pg_get_functiondef(
    'public.dispatch_mdrrmo_report_v2(uuid, uuid, text, text, text, uuid[], text)'::regprocedure
  );
  v_updated_definition := regexp_replace(
    v_definition,
    'JOIN public\.respond_unit_daily_activations AS activations\s+ON activations\.unit_id = units\.id\s+AND activations\.activation_date = timezone\(''Asia/Manila'', v_now\)::DATE',
    'AND units.is_active'
  );
  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'Could not update MDRRMO dispatch validation for persistent unit activation';
  END IF;
  v_updated_definition := replace(
    v_updated_definition,
    'available unit activated today with a complete roster',
    'active available unit with a complete roster'
  );
  EXECUTE v_updated_definition;
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
