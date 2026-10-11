-- Dispatches start as accepted responses. Responders manage their own crew
-- roster after dispatch; barangay and MDRRMO rosters stay separate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_barangay_crew_members (
  assignment_id UUID NOT NULL REFERENCES public.mdrrmo_report_barangay_assignments(id) ON DELETE CASCADE,
  barangay_id UUID NOT NULL REFERENCES public.barangays(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES public.barangay_users(id) ON DELETE RESTRICT,
  member_name_snapshot TEXT NOT NULL,
  crew_role TEXT NOT NULL CHECK (crew_role IN ('team_leader','driver','first_aider','radio_operator','member')),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, member_id)
);

ALTER TABLE public.mdrrmo_report_barangay_crew_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_report_barangay_crew_members FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mdrrmo_report_barangay_crew_members TO service_role;
CREATE INDEX IF NOT EXISTS mdrrmo_report_barangay_crew_barangay_idx
  ON public.mdrrmo_report_barangay_crew_members (barangay_id, assignment_id);

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
  v_now TIMESTAMPTZ := clock_timestamp();
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
    ON units.id = leaders.unit_id AND units.status = 'available'
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
  ) AND EXISTS (
    SELECT 1 FROM public.respond_unit_members AS first_aiders
    WHERE first_aiders.unit_id = units.id AND first_aiders.is_active
      AND first_aiders.member_role = 'first_aider_responder'
  );
  IF v_dispatchable_count <> cardinality(p_responder_ids) THEN
    RAISE EXCEPTION 'One or more selected responders do not belong to an available unit activated today with a complete roster' USING ERRCODE = '23514';
  END IF;

  UPDATE public.mdrrmo_reports SET
    incident_type = p_incident_type,
    severity = p_severity,
    dispatch_notes = p_notes,
    responder_name = p_responder_names,
    dispatched_by = p_actor_id,
    dispatched_at = v_now,
    accepted_at = v_now,
    response_status = 'responding',
    lifecycle_actor_id = p_actor_id,
    lifecycle_actor_role = 'dispatcher'
  WHERE id = p_report_id;

  INSERT INTO public.mdrrmo_report_assignments
    (report_id, responder_id, assigned_by, status, assigned_at, accepted_at)
  SELECT p_report_id, selected.responder_id, p_actor_id, 'responding', v_now, v_now
  FROM unnest(p_responder_ids) AS selected(responder_id);

  RETURN jsonb_build_object('dispatched_at', v_now, 'accepted_at', v_now, 'responder_count', cardinality(p_responder_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.dispatch_mdrrmo_report_v2(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_mdrrmo_dispatch_against_barangay_assignment_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('assigned','responding') THEN
    PERFORM 1 FROM public.mdrrmo_reports WHERE id = NEW.report_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.mdrrmo_report_barangay_assignments
      WHERE report_id = NEW.report_id
        AND (assignment_status = 'active'
          OR (assignment_status = 'completed' AND response_status = 'resolved'))
    ) THEN
      RAISE EXCEPTION 'An active barangay assignment or completed barangay response blocks MDRRMO dispatch.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_mdrrmo_dispatch_against_barangay_assignment_v1() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_mdrrmo_response_crew_v1(
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
  v_report public.mdrrmo_reports%ROWTYPE;
  v_assignment public.mdrrmo_report_assignments%ROWTYPE;
  v_unit_id UUID;
  v_leader_member_id UUID;
  v_valid_count INTEGER;
  v_has_driver BOOLEAN;
  v_has_first_aider BOOLEAN;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_report_id IS NULL OR p_responder_id IS NULL OR p_member_ids IS NULL
     OR cardinality(p_member_ids) < 2 OR cardinality(p_member_ids) > 7
     OR cardinality(p_member_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_member_ids) AS selected(id)) THEN
    RAISE EXCEPTION 'Choose a driver and first aider from your unit roster' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report FROM public.mdrrmo_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_report.response_status, 'pending') <> 'responding' THEN
    RAISE EXCEPTION 'Dispatch the report before editing its response crew' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.arrived_at IS NOT NULL OR v_report.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Response crew can no longer be changed after arrival' USING ERRCODE = '23514';
  END IF;

  SELECT id, unit_id INTO v_leader_member_id, v_unit_id
  FROM public.respond_unit_members
  WHERE responder_user_id = p_responder_id AND member_role = 'team_leader' AND is_active;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_responder_id AND role::TEXT = 'responder' AND status::TEXT = 'active'
  ) THEN
    RAISE EXCEPTION 'An active MDRRMO unit Team Leader account is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND responder_id = p_responder_id
  FOR UPDATE;
  IF NOT FOUND OR v_assignment.status <> 'responding' OR v_assignment.arrived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This active response assignment cannot be edited' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*), COALESCE(bool_or(member_role = 'driver_responder'), false),
         COALESCE(bool_or(member_role = 'first_aider_responder'), false)
  INTO v_valid_count, v_has_driver, v_has_first_aider
  FROM public.respond_unit_members
  WHERE id = ANY(p_member_ids) AND unit_id = v_unit_id AND is_active
    AND member_role IN ('radio_operator', 'driver_responder', 'first_aider_responder');
  IF v_valid_count <> cardinality(p_member_ids) OR NOT v_has_driver OR NOT v_has_first_aider THEN
    RAISE EXCEPTION 'Choose active crew members from your unit, including a Driver Responder and First Aider Responder' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.mdrrmo_assignment_crew_members WHERE assignment_id = v_assignment.id;
  INSERT INTO public.mdrrmo_assignment_crew_members
    (assignment_id, unit_member_id, member_name_snapshot, member_role_snapshot, selected_at)
  SELECT v_assignment.id, members.id, officers.name, members.member_role, v_now
  FROM public.respond_unit_members AS members
  JOIN public.officers AS officers ON officers.id = members.officer_id
  WHERE members.id = v_leader_member_id OR members.id = ANY(p_member_ids);

  UPDATE public.mdrrmo_reports SET
    lifecycle_actor_id = p_responder_id,
    lifecycle_actor_role = 'responder'
  WHERE id = p_report_id;
  RETURN jsonb_build_object('assignment_id', v_assignment.id, 'unit_id', v_unit_id, 'crew_count', cardinality(p_member_ids) + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.set_mdrrmo_response_crew_v1(UUID, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_mdrrmo_response_crew_v1(UUID, UUID, UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.audit_mdrrmo_assignment_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type TEXT;
  v_actor_id UUID;
  v_actor_role TEXT;
  v_before JSONB;
  v_after JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := CASE WHEN NEW.status = 'responding' THEN 'mdrrmo.dispatch_auto_accepted' ELSE 'mdrrmo.responder_assigned' END;
    v_actor_id := NEW.assigned_by;
    v_actor_role := 'dispatcher';
    v_before := NULL;
    v_after := to_jsonb(NEW);
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'responding' THEN
      IF NEW.accepted_by IS NULL THEN
        v_event_type := 'mdrrmo.dispatch_auto_accepted';
        v_actor_id := NEW.assigned_by;
        v_actor_role := 'dispatcher';
      ELSE
        v_event_type := 'mdrrmo.responder_accepted';
        v_actor_id := NEW.accepted_by;
        v_actor_role := 'responder';
      END IF;
    ELSIF NEW.arrived_at IS DISTINCT FROM OLD.arrived_at THEN
      v_event_type := 'mdrrmo.responder_arrived';
      v_actor_id := NEW.arrived_by;
      v_actor_role := 'responder';
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'resolved' THEN
      v_event_type := 'mdrrmo.response_resolved';
      v_actor_id := NEW.resolved_by;
      v_actor_role := COALESCE(NEW.resolved_by_role, 'responder');
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'removed' THEN
      v_event_type := 'mdrrmo.assignment_removed';
      v_actor_id := NEW.removed_by;
      v_actor_role := 'dispatcher';
    ELSIF NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
      v_event_type := 'mdrrmo.responder_assigned';
      v_actor_id := NEW.assigned_by;
      v_actor_role := 'dispatcher';
    END IF;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
  END IF;

  IF v_event_type IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.mdrrmo_report_lifecycle_history
    (report_id, event_type, actor_id, actor_role, details)
  VALUES (NEW.report_id, v_event_type, v_actor_id, v_actor_role,
          jsonb_build_object('before', v_before, 'after', v_after));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_mdrrmo_responder_assignment_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_title TEXT;
BEGIN
  IF NEW.status NOT IN ('assigned', 'responding') THEN RETURN NEW; END IF;
  SELECT title INTO v_report_title FROM public.mdrrmo_reports WHERE id = NEW.report_id;
  INSERT INTO public.mdrrmo_responder_push_outbox (assignment_id, report_id, responder_id, report_title)
  VALUES (NEW.id, NEW.report_id, NEW.responder_id, COALESCE(v_report_title, 'Incident report'))
  ON CONFLICT (assignment_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_accept_barangay_report_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assignment_status = 'active' AND NEW.dispatched_at IS NOT NULL THEN
      NEW.response_status := 'responding';
      NEW.accepted_at := COALESCE(NEW.accepted_at, NEW.dispatched_at);
      NEW.responded_at := COALESCE(NEW.responded_at, NEW.dispatched_at);
    END IF;
  ELSIF NEW.assignment_status = 'active' AND NEW.dispatched_at IS NOT NULL
      AND OLD.dispatched_at IS DISTINCT FROM NEW.dispatched_at THEN
    NEW.response_status := 'responding';
    NEW.accepted_at := COALESCE(NEW.accepted_at, NEW.dispatched_at);
    NEW.responded_at := COALESCE(NEW.responded_at, NEW.dispatched_at);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_accept_barangay_report_dispatch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mdrrmo_barangay_dispatch_auto_accept ON public.mdrrmo_report_barangay_assignments;
CREATE TRIGGER mdrrmo_barangay_dispatch_auto_accept
  BEFORE INSERT OR UPDATE OF dispatched_at, assignment_status ON public.mdrrmo_report_barangay_assignments
  FOR EACH ROW EXECUTE FUNCTION public.auto_accept_barangay_report_dispatch();

CREATE OR REPLACE FUNCTION public.set_mdrrmo_report_barangay_crew_v1(
  p_report_id UUID,
  p_barangay_id UUID,
  p_responder_id UUID,
  p_members JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.mdrrmo_report_barangay_assignments%ROWTYPE;
  v_member_count INTEGER;
  v_valid_count INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_members IS NULL OR jsonb_typeof(p_members) <> 'array'
     OR jsonb_array_length(p_members) < 1 OR jsonb_array_length(p_members) > 20 THEN
    RAISE EXCEPTION 'Add at least one member from your barangay roster' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_members) AS item
    WHERE COALESCE(item->>'crew_role','') NOT IN ('team_leader','driver','first_aider','radio_operator','member')
  ) OR jsonb_array_length(p_members) <> (
    SELECT count(DISTINCT item->>'member_id') FROM jsonb_array_elements(p_members) AS item
  ) THEN
    RAISE EXCEPTION 'Choose each roster member once and use a valid crew role' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_barangay_assignments
  WHERE report_id = p_report_id AND barangay_id = p_barangay_id AND assignment_status = 'active'
  FOR UPDATE;
  IF NOT FOUND OR v_assignment.response_status <> 'responding' OR v_assignment.arrived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Crew can be updated only for an active dispatched response before arrival' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (p_responder_id = ANY(v_assignment.responder_ids)) THEN
    RAISE EXCEPTION 'This report is not assigned to your responder account' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_member_count FROM jsonb_array_elements(p_members);
  SELECT count(*) INTO v_valid_count
  FROM jsonb_array_elements(p_members) AS requested
  JOIN public.barangay_users AS member
    ON member.id = (requested->>'member_id')::UUID
   AND member.barangay_id = p_barangay_id
   AND member.is_active = TRUE
   AND member.role IN ('responder','staff');
  IF v_valid_count <> v_member_count THEN
    RAISE EXCEPTION 'Crew members must be active staff or responders from your own barangay' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.mdrrmo_report_barangay_crew_members WHERE assignment_id = v_assignment.id;
  INSERT INTO public.mdrrmo_report_barangay_crew_members
    (assignment_id, barangay_id, member_id, member_name_snapshot, crew_role, selected_at)
  SELECT v_assignment.id, p_barangay_id, member.id, member.full_name,
         requested->>'crew_role', v_now
  FROM jsonb_array_elements(p_members) AS requested
  JOIN public.barangay_users AS member ON member.id = (requested->>'member_id')::UUID
  WHERE member.barangay_id = p_barangay_id AND member.is_active = TRUE;

  UPDATE public.mdrrmo_reports SET
    lifecycle_actor_id = p_responder_id,
    lifecycle_actor_role = 'barangay_responder'
  WHERE id = p_report_id;
  RETURN jsonb_build_object('assignment_id', v_assignment.id, 'crew_count', v_member_count);
END;
$$;

REVOKE ALL ON FUNCTION public.set_mdrrmo_report_barangay_crew_v1(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_mdrrmo_report_barangay_crew_v1(UUID, UUID, UUID, JSONB) TO service_role;

-- Immediately accept already-dispatched work. Keep the audit actor as the
-- dispatcher because no responder action occurred.
UPDATE public.mdrrmo_report_assignments AS assignment
SET status = 'responding',
    accepted_at = COALESCE(assignment.accepted_at, report.dispatched_at, assignment.assigned_at),
    accepted_by = NULL
FROM public.mdrrmo_reports AS report
WHERE report.id = assignment.report_id
  AND assignment.status = 'assigned'
  AND report.dispatched_at IS NOT NULL
  AND report.response_status = 'pending';

UPDATE public.mdrrmo_reports AS report
SET response_status = 'responding',
    accepted_at = COALESCE(report.accepted_at, report.dispatched_at)
WHERE report.response_status = 'pending'
  AND report.dispatched_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.mdrrmo_report_assignments AS assignment
    WHERE assignment.report_id = report.id AND assignment.status = 'responding'
  );

UPDATE public.mdrrmo_report_barangay_assignments
SET response_status = 'responding',
    accepted_at = COALESCE(accepted_at, dispatched_at),
    responded_at = COALESCE(responded_at, dispatched_at),
    updated_at = now()
WHERE assignment_status = 'active' AND dispatched_at IS NOT NULL AND response_status = 'pending';

UPDATE public.barangay_reports
SET response_status = 'responding',
    accepted_at = COALESCE(accepted_at, dispatched_at)
WHERE dispatched_at IS NOT NULL AND response_status = 'pending';

COMMIT;
