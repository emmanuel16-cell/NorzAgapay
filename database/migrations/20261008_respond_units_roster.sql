-- Respond-unit roster and MDRRMO responder assignment support.
-- Run in Supabase SQL Editor for databases initialized before the normalized
-- response-unit roster was added to database/schema.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.respond_unit_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES public.respond_units(id) ON DELETE CASCADE,
  officer_id UUID NOT NULL REFERENCES public.officers(id) ON DELETE RESTRICT,
  responder_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  member_role TEXT NOT NULL DEFAULT 'unassigned'
    CHECK (member_role IN ('team_leader', 'radio_operator', 'driver_responder', 'first_aider_responder', 'unassigned')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_id, officer_id),
  CHECK (member_role <> 'team_leader' OR responder_user_id IS NOT NULL),
  CHECK (member_role = 'team_leader' OR responder_user_id IS NULL)
);

CREATE TABLE IF NOT EXISTS public.respond_unit_daily_activations (
  unit_id UUID NOT NULL REFERENCES public.respond_units(id) ON DELETE CASCADE,
  activation_date DATE NOT NULL,
  activated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  activation_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (activation_mode IN ('manual', 'emergency')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (unit_id, activation_date)
);

CREATE TABLE IF NOT EXISTS public.mdrrmo_assignment_crew_members (
  assignment_id UUID NOT NULL REFERENCES public.mdrrmo_report_assignments(id) ON DELETE CASCADE,
  unit_member_id UUID NOT NULL REFERENCES public.respond_unit_members(id) ON DELETE RESTRICT,
  member_name_snapshot TEXT NOT NULL,
  member_role_snapshot TEXT NOT NULL
    CHECK (member_role_snapshot IN ('team_leader', 'radio_operator', 'driver_responder', 'first_aider_responder')),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, unit_member_id)
);

CREATE INDEX IF NOT EXISTS idx_respond_unit_members_unit_active_role
  ON public.respond_unit_members(unit_id, is_active, member_role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_respond_unit_one_active_team_leader
  ON public.respond_unit_members(unit_id)
  WHERE is_active AND member_role = 'team_leader';
CREATE UNIQUE INDEX IF NOT EXISTS idx_respond_unit_one_active_radio_operator
  ON public.respond_unit_members(unit_id)
  WHERE is_active AND member_role = 'radio_operator';
CREATE INDEX IF NOT EXISTS idx_respond_unit_daily_activations_date
  ON public.respond_unit_daily_activations(activation_date, unit_id);

ALTER TABLE public.respond_unit_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.respond_unit_daily_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdrrmo_assignment_crew_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.respond_unit_members, public.respond_unit_daily_activations,
  public.mdrrmo_assignment_crew_members FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.respond_unit_members,
  public.respond_unit_daily_activations, public.mdrrmo_assignment_crew_members TO service_role;

-- Preserve existing legacy officer_ids as unclassified unit roster entries.
INSERT INTO public.respond_unit_members (unit_id, officer_id, member_role, is_active)
SELECT units.id, officers.id, 'unassigned', officers.status = 'active'
FROM public.respond_units AS units
CROSS JOIN LATERAL unnest(COALESCE(units.officer_ids, '{}'::UUID[])) AS legacy(officer_id)
JOIN public.officers AS officers ON officers.id = legacy.officer_id
ON CONFLICT (unit_id, officer_id) DO NOTHING;

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
        AND member_role = 'team_leader' AND is_active
        AND id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'Responder account already leads an active unit' USING ERRCODE = '23505';
    END IF;
  END IF;

  v_limit := CASE NEW.member_role
    WHEN 'team_leader' THEN 1
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
  WHERE unit_id = NEW.unit_id AND member_role = NEW.member_role
    AND is_active AND id IS DISTINCT FROM NEW.id;
  IF v_existing >= v_limit THEN
    RAISE EXCEPTION 'Unit has reached the capacity for role %', NEW.member_role USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_respond_unit_member_role ON public.respond_unit_members;
CREATE TRIGGER trg_enforce_respond_unit_member_role
BEFORE INSERT OR UPDATE OF unit_id, responder_user_id, member_role, is_active
ON public.respond_unit_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_respond_unit_member_role();

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
    WHERE id = p_officer_id AND lower(email) = lower(v_user.email)
  ) THEN
    RAISE EXCEPTION 'Team Leader profile must match the responder account' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.respond_unit_members AS current_leader
    JOIN public.mdrrmo_report_assignments AS assignments
      ON assignments.responder_id = current_leader.responder_user_id
    WHERE current_leader.unit_id = p_unit_id
      AND current_leader.member_role = 'team_leader'
      AND current_leader.is_active
      AND current_leader.responder_user_id <> p_responder_user_id
      AND assignments.status IN ('assigned', 'responding')
  ) THEN
    RAISE EXCEPTION 'Cannot change Team Leader while the current leader has an active dispatch' USING ERRCODE = '23514';
  END IF;

  UPDATE public.respond_unit_members
  SET member_role = 'unassigned', responder_user_id = NULL
  WHERE unit_id = p_unit_id AND is_active AND member_role = 'team_leader'
    AND officer_id <> p_officer_id;

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
    WHERE id = p_activated_by AND role::TEXT IN ('logistics', 'master_admin')
      AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'An active Staff account is required to change unit activation' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002'; END IF;

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

  RETURN jsonb_build_object('unit_id', p_unit_id, 'activation_date', v_date, 'is_active_today', p_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.emergency_activate_all_respond_units_today_v1(p_activated_by UUID)
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
    WHERE id = p_activated_by AND role::TEXT IN ('logistics', 'master_admin')
      AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'An active Staff account is required for emergency activation' USING ERRCODE = '42501';
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

-- Keep dispatch and responder acceptance RPCs aligned with the current schema.
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
     OR p_incident_type NOT IN ('flash_flood','fire','earthquake','medical_emergency','typhoon','other')
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

GRANT EXECUTE ON FUNCTION public.dispatch_mdrrmo_report_v2 TO service_role;

REVOKE ALL ON FUNCTION public.dispatch_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_mdrrmo_report_with_crew_v1(
  p_report_id UUID,
  p_responder_id UUID,
  p_member_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_report public.mdrrmo_reports%ROWTYPE;
  v_assignment public.mdrrmo_report_assignments%ROWTYPE;
  v_unit_id UUID;
  v_leader_member_id UUID;
  v_valid_count INTEGER;
  v_has_driver BOOLEAN;
  v_has_first_aider BOOLEAN;
BEGIN
  IF p_report_id IS NULL OR p_responder_id IS NULL OR p_member_ids IS NULL
     OR cardinality(p_member_ids) < 2 OR cardinality(p_member_ids) > 7
     OR cardinality(p_member_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_member_ids) AS selected(id)) THEN
    RAISE EXCEPTION 'Choose at least one Driver Responder and one First Aider Responder' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report
  FROM public.mdrrmo_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_report.response_status, 'pending') NOT IN ('pending', 'responding') OR v_report.dispatched_at IS NULL THEN
    RAISE EXCEPTION 'Report is not available for responder acceptance' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, unit_id INTO v_leader_member_id, v_unit_id
  FROM public.respond_unit_members
  WHERE responder_user_id = p_responder_id
    AND member_role = 'team_leader'
    AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Responder account is not assigned as an active Team Leader' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_responder_id AND role::TEXT = 'responder' AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'Team Leader responder account is not active' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.respond_units WHERE id = v_unit_id FOR SHARE;

  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND responder_id = p_responder_id
  FOR UPDATE;
  IF NOT FOUND OR v_assignment.status <> 'assigned' THEN
    RAISE EXCEPTION 'Assignment not found or already accepted' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*),
         COALESCE(bool_or(member_role = 'driver_responder'), false),
         COALESCE(bool_or(member_role = 'first_aider_responder'), false)
    INTO v_valid_count, v_has_driver, v_has_first_aider
  FROM public.respond_unit_members
  WHERE id = ANY(p_member_ids)
    AND unit_id = v_unit_id
    AND is_active
    AND member_role IN ('radio_operator', 'driver_responder', 'first_aider_responder');

  IF v_valid_count <> cardinality(p_member_ids) OR NOT v_has_driver OR NOT v_has_first_aider THEN
    RAISE EXCEPTION 'Selected crew must be active members of your unit and include a Driver Responder and a First Aider Responder' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mdrrmo_report_assignments SET
    status = 'responding',
    accepted_at = v_now,
    accepted_by = p_responder_id
  WHERE id = v_assignment.id AND status = 'assigned';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment was accepted by another responder' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.mdrrmo_reports SET
    response_status = 'responding',
    accepted_at = COALESCE(accepted_at, v_now),
    lifecycle_actor_id = p_responder_id,
    lifecycle_actor_role = 'responder'
  WHERE id = p_report_id AND response_status IN ('pending', 'responding');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report status changed before acceptance' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.mdrrmo_assignment_crew_members (
    assignment_id, unit_member_id, member_name_snapshot, member_role_snapshot, selected_at
  )
  SELECT v_assignment.id, members.id, officers.name, members.member_role, v_now
  FROM public.respond_unit_members AS members
  JOIN public.officers AS officers ON officers.id = members.officer_id
  WHERE members.id = v_leader_member_id OR members.id = ANY(p_member_ids);

  RETURN jsonb_build_object('accepted_at', v_now, 'unit_id', v_unit_id, 'crew_count', cardinality(p_member_ids) + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_respond_unit_member_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_respond_unit_team_leader_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_respond_unit_team_leader_v1(UUID, UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.accept_mdrrmo_report_with_crew_v1(UUID, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_mdrrmo_report_with_crew_v1(UUID, UUID, UUID[]) TO service_role;

REVOKE ALL ON FUNCTION public.enforce_respond_unit_member_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_respond_unit_team_leader_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_respond_unit_team_leader_v1(UUID, UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.set_respond_unit_activation_today_v1(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_respond_unit_activation_today_v1(UUID, UUID, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.emergency_activate_all_respond_units_today_v1(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emergency_activate_all_respond_units_today_v1(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

