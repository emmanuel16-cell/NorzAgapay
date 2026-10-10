-- Central MDRRMO intake, explicit barangay response assignments, and command
-- location pins. Apply after the existing report and barangay schemas.

BEGIN;

ALTER TABLE public.barangays
  ADD COLUMN IF NOT EXISTS location_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_address TEXT;

CREATE TABLE IF NOT EXISTS public.mdrrmo_command_locations (
  location_key TEXT PRIMARY KEY CHECK (location_key = 'office'),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  address TEXT,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_barangay_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.mdrrmo_reports(id) ON DELETE CASCADE,
  barangay_id UUID NOT NULL REFERENCES public.barangays(id) ON DELETE RESTRICT,
  assignment_status TEXT NOT NULL DEFAULT 'active'
    CHECK (assignment_status IN ('active','completed','reassigned','recalled','escalated')),
  response_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (response_status IN ('pending','responding','resolved')),
  assignment_notes TEXT,
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_by UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  dispatched_at TIMESTAMPTZ,
  responder_ids UUID[] NOT NULL DEFAULT '{}',
  responder_name TEXT,
  incident_type TEXT,
  severity TEXT,
  response_notes TEXT,
  responded_by UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  arrival_method TEXT,
  arrival_latitude DOUBLE PRECISION,
  arrival_longitude DOUBLE PRECISION,
  resolved_by UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_notes TEXT,
  escalated_by UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  escalated_at TIMESTAMPTZ,
  escalation_notes TEXT,
  CHECK (cardinality(responder_ids) <= 20)
);

CREATE UNIQUE INDEX IF NOT EXISTS mdrrmo_report_barangay_one_active_assignment_idx
  ON public.mdrrmo_report_barangay_assignments (report_id)
  WHERE assignment_status = 'active';
CREATE INDEX IF NOT EXISTS mdrrmo_report_barangay_queue_idx
  ON public.mdrrmo_report_barangay_assignments (barangay_id, assignment_status, assigned_at DESC);
CREATE INDEX IF NOT EXISTS mdrrmo_report_barangay_report_idx
  ON public.mdrrmo_report_barangay_assignments (report_id, assigned_at DESC);

-- Serialize municipal dispatches and barangay assignments on the report row.
-- The dispatch RPC locks mdrrmo_reports before inserting responder assignments;
-- this trigger checks the active barangay path while that same lock is held.
CREATE OR REPLACE FUNCTION public.guard_mdrrmo_dispatch_against_barangay_assignment_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'assigned' THEN
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
DROP TRIGGER IF EXISTS mdrrmo_dispatch_requires_no_barangay_assignment ON public.mdrrmo_report_assignments;
CREATE TRIGGER mdrrmo_dispatch_requires_no_barangay_assignment
  BEFORE INSERT OR UPDATE OF status ON public.mdrrmo_report_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_mdrrmo_dispatch_against_barangay_assignment_v1();

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_barangay_assignment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.mdrrmo_reports(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES public.mdrrmo_report_barangay_assignments(id) ON DELETE SET NULL,
  from_barangay_id UUID REFERENCES public.barangays(id) ON DELETE SET NULL,
  to_barangay_id UUID REFERENCES public.barangays(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'assigned','reassigned','recalled','dispatched','responding','arrived','resolved','escalated'
  )),
  actor_id UUID,
  actor_role TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mdrrmo_report_barangay_events_report_idx
  ON public.mdrrmo_report_barangay_assignment_events (report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_barangay_push_outbox (
  id BIGSERIAL PRIMARY KEY,
  assignment_id UUID NOT NULL UNIQUE REFERENCES public.mdrrmo_report_barangay_assignments(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES public.mdrrmo_reports(id) ON DELETE CASCADE,
  barangay_id UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  delivered_tokens TEXT[] NOT NULL DEFAULT '{}',
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS mdrrmo_report_barangay_push_outbox_pending_idx
  ON public.mdrrmo_report_barangay_push_outbox (available_at, id)
  WHERE processed_at IS NULL;

ALTER TABLE public.mdrrmo_command_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdrrmo_report_barangay_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdrrmo_report_barangay_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mdrrmo_report_barangay_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mdrrmo_command_locations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mdrrmo_report_barangay_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mdrrmo_report_barangay_assignment_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mdrrmo_report_barangay_push_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mdrrmo_command_locations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mdrrmo_report_barangay_assignments TO service_role;
GRANT SELECT, INSERT ON public.mdrrmo_report_barangay_assignment_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mdrrmo_report_barangay_push_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mdrrmo_report_barangay_push_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.claim_mdrrmo_report_barangay_push_outbox(p_batch_size INTEGER DEFAULT 25)
RETURNS SETOF public.mdrrmo_report_barangay_push_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '90 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.mdrrmo_report_barangay_push_outbox AS events
  SET locked_until = v_lock_until, attempts = events.attempts + 1
  WHERE events.id IN (
    SELECT pending.id
    FROM public.mdrrmo_report_barangay_push_outbox AS pending
    WHERE pending.processed_at IS NULL
      AND pending.available_at <= now()
      AND (pending.locked_until IS NULL OR pending.locked_until < now())
    ORDER BY pending.available_at, pending.id
    LIMIT GREATEST(1, LEAST(p_batch_size, 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING events.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_mdrrmo_report_barangay_push_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mdrrmo_report_barangay_push_outbox(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.set_mdrrmo_report_barangay_assignment_v1(
  p_report_id UUID,
  p_barangay_id UUID,
  p_actor_id UUID,
  p_action TEXT,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.mdrrmo_reports%ROWTYPE;
  v_active public.mdrrmo_report_barangay_assignments%ROWTYPE;
  v_new_id UUID;
  v_action TEXT := lower(trim(p_action));
  v_now TIMESTAMPTZ := now();
  v_is_verified BOOLEAN;
BEGIN
  IF v_action NOT IN ('assign','reassign','recall') THEN
    RAISE EXCEPTION 'Unsupported barangay assignment action.' USING ERRCODE = '22023';
  END IF;
  IF v_action IN ('reassign','recall') AND length(trim(COALESCE(p_notes, ''))) < 3 THEN
    RAISE EXCEPTION 'A reason is required to reassign or recall a report.' USING ERRCODE = '22023';
  END IF;
  IF v_action <> 'recall' AND p_barangay_id IS NULL THEN
    RAISE EXCEPTION 'Choose a destination barangay.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report FROM public.mdrrmo_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MDRRMO report not found.' USING ERRCODE = 'P0002'; END IF;
  IF lower(COALESCE(v_report.response_status, 'pending')) <> 'pending' OR v_report.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'This report is already in an MDRRMO response or resolved state.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mdrrmo_report_assignments
    WHERE report_id = p_report_id AND status IN ('assigned','responding')
  ) THEN
    RAISE EXCEPTION 'This report is already dispatched to an MDRRMO responder.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mdrrmo_report_barangay_assignments
    WHERE report_id = p_report_id
      AND assignment_status = 'completed'
      AND response_status = 'resolved'
  ) THEN
    RAISE EXCEPTION 'A report resolved by its assigned barangay cannot be reassigned.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_active FROM public.mdrrmo_report_barangay_assignments
  WHERE report_id = p_report_id AND assignment_status = 'active'
  FOR UPDATE;

  IF v_action = 'assign' AND FOUND THEN
    RAISE EXCEPTION 'This report already has an active barangay assignment.' USING ERRCODE = 'P0001';
  ELSIF v_action IN ('reassign','recall') AND NOT FOUND THEN
    RAISE EXCEPTION 'This report has no active barangay assignment.' USING ERRCODE = 'P0002';
  END IF;

  IF v_action <> 'recall' THEN
    IF NOT EXISTS (SELECT 1 FROM public.barangays WHERE id = p_barangay_id) THEN
      RAISE EXCEPTION 'Destination barangay not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT COALESCE((
      SELECT verification.status = 'verified' AND verification.is_active = TRUE
      FROM public.barangay_dispatcher_verifications AS verification
      JOIN public.barangay_users AS admin
        ON admin.id = verification.user_id
       AND admin.barangay_id = verification.barangay_id
      WHERE verification.barangay_id = p_barangay_id
        AND admin.role = 'admin'
        AND admin.is_active = TRUE
      ORDER BY verification.updated_at DESC, verification.created_at DESC, verification.id DESC
      LIMIT 1
    ), FALSE) INTO v_is_verified;
    IF NOT COALESCE(v_is_verified, FALSE) THEN
      RAISE EXCEPTION 'Destination barangay is not active in NorzAgapay.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_action IN ('reassign','recall') THEN
    UPDATE public.mdrrmo_report_barangay_assignments
    SET assignment_status = CASE WHEN v_action = 'reassign' THEN 'reassigned' ELSE 'recalled' END,
        assignment_notes = concat_ws(E'\n', NULLIF(assignment_notes,''), trim(COALESCE(p_notes,''))),
        updated_at = v_now
    WHERE id = v_active.id;
    INSERT INTO public.mdrrmo_report_barangay_assignment_events
      (report_id, assignment_id, from_barangay_id, to_barangay_id, event_type, actor_id, actor_role, notes, created_at)
    VALUES (p_report_id, v_active.id, v_active.barangay_id,
      CASE WHEN v_action = 'reassign' THEN p_barangay_id ELSE NULL END,
      CASE WHEN v_action = 'reassign' THEN 'reassigned' ELSE 'recalled' END,
      p_actor_id, 'mdrrmo', trim(COALESCE(p_notes,'')), v_now);
  END IF;

  IF v_action = 'recall' THEN
    v_new_id := v_active.id;
  ELSE
    INSERT INTO public.mdrrmo_report_barangay_assignments
      (report_id, barangay_id, assignment_status, response_status, assignment_notes, assigned_by, assigned_at, updated_at)
    VALUES (p_report_id, p_barangay_id, 'active', 'pending', NULLIF(trim(COALESCE(p_notes,'')), ''), p_actor_id, v_now, v_now)
    RETURNING id INTO v_new_id;
    INSERT INTO public.mdrrmo_report_barangay_assignment_events
      (report_id, assignment_id, from_barangay_id, to_barangay_id, event_type, actor_id, actor_role, notes, created_at)
    VALUES (p_report_id, v_new_id, CASE WHEN v_action = 'reassign' THEN v_active.barangay_id ELSE NULL END,
      p_barangay_id, CASE WHEN v_action = 'reassign' THEN 'reassigned' ELSE 'assigned' END,
      p_actor_id, 'mdrrmo', NULLIF(trim(COALESCE(p_notes,'')), ''), v_now);
    INSERT INTO public.mdrrmo_report_barangay_push_outbox (assignment_id, report_id, barangay_id, created_at)
    VALUES (v_new_id, p_report_id, p_barangay_id, v_now)
    ON CONFLICT (assignment_id) DO NOTHING;
  END IF;

  UPDATE public.mdrrmo_reports
  SET lifecycle_revision = COALESCE(lifecycle_revision, 0) + 1,
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = 'mdrrmo_dispatcher',
      updated_at = v_now
  WHERE id = p_report_id;
  INSERT INTO public.resident_push_outbox (
    event_key, report_id, resident_id, source_table, report_title, display_status, revision
  )
  SELECT 'mdrrmo_reports:' || report.id::TEXT || ':' || report.lifecycle_revision::TEXT,
    report.id, report.reporter_id, 'mdrrmo_reports', COALESCE(report.title, 'Incident report'),
    CASE WHEN v_action = 'recall' THEN 'report returned to MDRRMO' ELSE 'assigned to a barangay' END,
    report.lifecycle_revision
  FROM public.mdrrmo_reports AS report
  WHERE report.id = p_report_id AND report.reporter_type = 'resident' AND report.reporter_id IS NOT NULL
  ON CONFLICT (event_key) DO NOTHING;
  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_mdrrmo_report_barangay_lifecycle_v1(
  p_report_id UUID,
  p_barangay_id UUID,
  p_actor_id UUID,
  p_action TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.mdrrmo_report_barangay_assignments%ROWTYPE;
  v_action TEXT := lower(trim(p_action));
  v_now TIMESTAMPTZ := now();
  v_notes TEXT := NULLIF(trim(COALESCE(p_payload->>'notes','')), '');
  v_responder_ids UUID[];
  v_responder_names TEXT;
  v_actor_is_assigned BOOLEAN;
BEGIN
  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_barangay_assignments
  WHERE report_id = p_report_id AND barangay_id = p_barangay_id AND assignment_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active report assignment not found in this barangay.' USING ERRCODE = 'P0002'; END IF;

  IF v_action = 'dispatch' THEN
    IF v_assignment.response_status <> 'pending' THEN
      RAISE EXCEPTION 'Dispatch can only be changed before a barangay responder accepts the assignment.' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT candidate.id), '{}'::UUID[]), string_agg(candidate.full_name, ', ' ORDER BY candidate.full_name)
    INTO v_responder_ids, v_responder_names
    FROM jsonb_array_elements_text(COALESCE(p_payload->'responder_ids','[]'::jsonb)) AS requested(id)
    JOIN public.barangay_users AS candidate ON candidate.id = requested.id::UUID
    WHERE candidate.barangay_id = p_barangay_id AND candidate.role = 'responder' AND candidate.is_active = TRUE;
    IF cardinality(v_responder_ids) = 0 OR cardinality(v_responder_ids) <> jsonb_array_length(COALESCE(p_payload->'responder_ids','[]'::jsonb)) THEN
      RAISE EXCEPTION 'Choose active responders from this barangay.' USING ERRCODE = '42501';
    END IF;
    IF v_assignment.response_status = 'resolved' THEN RAISE EXCEPTION 'Resolved assignments cannot be dispatched.' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.mdrrmo_report_barangay_assignments SET
      responder_ids = v_responder_ids,
      responder_name = v_responder_names,
      incident_type = NULLIF(trim(COALESCE(p_payload->>'incident_type','')), ''),
      severity = NULLIF(trim(COALESCE(p_payload->>'severity','')), ''),
      response_notes = v_notes,
      dispatched_by = p_actor_id,
      dispatched_at = v_now,
      responded_by = NULL,
      responded_at = NULL,
      accepted_at = NULL,
      response_status = 'pending',
      updated_at = v_now
    WHERE id = v_assignment.id;
    INSERT INTO public.mdrrmo_report_barangay_assignment_events
      (report_id, assignment_id, to_barangay_id, event_type, actor_id, actor_role, notes, created_at)
    VALUES (p_report_id, v_assignment.id, p_barangay_id, 'dispatched', p_actor_id, 'barangay_dispatcher', v_notes, v_now);
  ELSIF v_action = 'respond' THEN
    IF v_assignment.response_status <> 'pending' THEN
      RAISE EXCEPTION 'This assignment is no longer waiting for responder acceptance.' USING ERRCODE = 'P0001';
    END IF;
    v_actor_is_assigned := p_actor_id = ANY(v_assignment.responder_ids);
    IF NOT v_actor_is_assigned THEN RAISE EXCEPTION 'This incident has not been assigned to your responder account.' USING ERRCODE = '42501'; END IF;
    UPDATE public.mdrrmo_report_barangay_assignments SET
      response_status = 'responding', responded_by = p_actor_id,
      responded_at = COALESCE(responded_at, v_now), accepted_at = COALESCE(accepted_at, v_now),
      response_notes = COALESCE(v_notes, response_notes), updated_at = v_now
    WHERE id = v_assignment.id;
    INSERT INTO public.mdrrmo_report_barangay_assignment_events
      (report_id, assignment_id, to_barangay_id, event_type, actor_id, actor_role, notes, created_at)
    VALUES (p_report_id, v_assignment.id, p_barangay_id, 'responding', p_actor_id, 'barangay_responder', v_notes, v_now);
  ELSIF v_action = 'arrive' THEN
    IF v_assignment.response_status <> 'responding' THEN
      RAISE EXCEPTION 'Accept the incident before recording arrival.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (p_actor_id = ANY(v_assignment.responder_ids)) THEN RAISE EXCEPTION 'This incident has not been assigned to your responder account.' USING ERRCODE = '42501'; END IF;
    UPDATE public.mdrrmo_report_barangay_assignments SET
      arrived_at = COALESCE(arrived_at, v_now),
      arrival_latitude = NULLIF(p_payload->>'latitude','')::DOUBLE PRECISION,
      arrival_longitude = NULLIF(p_payload->>'longitude','')::DOUBLE PRECISION,
      arrival_method = NULLIF(p_payload->>'method',''), updated_at = v_now
    WHERE id = v_assignment.id;
    INSERT INTO public.mdrrmo_report_barangay_assignment_events
      (report_id, assignment_id, to_barangay_id, event_type, actor_id, actor_role, notes, created_at)
    VALUES (p_report_id, v_assignment.id, p_barangay_id, 'arrived', p_actor_id, 'barangay_responder', v_notes, v_now);
  ELSIF v_action = 'resolve' THEN
    IF NOT (p_actor_id = ANY(v_assignment.responder_ids)) AND COALESCE(p_payload->>'actor_role','') <> 'dispatcher' THEN
      RAISE EXCEPTION 'Only an assigned responder or barangay dispatcher can resolve this incident.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.mdrrmo_report_barangay_assignments SET
      assignment_status = 'completed', response_status = 'resolved',
      resolved_by = p_actor_id, resolved_at = v_now,
      resolved_notes = v_notes, updated_at = v_now
    WHERE id = v_assignment.id;
    INSERT INTO public.mdrrmo_report_barangay_assignment_events
      (report_id, assignment_id, to_barangay_id, event_type, actor_id, actor_role, notes, created_at)
    VALUES (p_report_id, v_assignment.id, p_barangay_id, 'resolved', p_actor_id,
      CASE WHEN COALESCE(p_payload->>'actor_role','') = 'dispatcher' THEN 'barangay_dispatcher' ELSE 'barangay_responder' END,
      v_notes, v_now);
  ELSIF v_action = 'escalate' THEN
    IF length(COALESCE(v_notes,'')) < 3 THEN RAISE EXCEPTION 'Escalation notes are required.' USING ERRCODE = '22023'; END IF;
    IF v_assignment.response_status = 'resolved' THEN RAISE EXCEPTION 'Resolved incidents cannot be escalated.' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.mdrrmo_report_barangay_assignments SET
      assignment_status = 'escalated', escalation_notes = v_notes,
      escalated_by = p_actor_id, escalated_at = v_now, updated_at = v_now
    WHERE id = v_assignment.id;
    UPDATE public.mdrrmo_reports SET
      coordination_notes = concat_ws(E'\n', NULLIF(coordination_notes,''), '[BARANGAY ESCALATION] ' || v_notes),
      lifecycle_revision = COALESCE(lifecycle_revision, 0) + 1,
      lifecycle_actor_id = p_actor_id, lifecycle_actor_role = 'barangay_dispatcher', updated_at = v_now
    WHERE id = p_report_id;
    INSERT INTO public.mdrrmo_report_barangay_assignment_events
      (report_id, assignment_id, from_barangay_id, event_type, actor_id, actor_role, notes, created_at)
    VALUES (p_report_id, v_assignment.id, p_barangay_id, 'escalated', p_actor_id, 'barangay_dispatcher', v_notes, v_now);
  ELSE
    RAISE EXCEPTION 'Unsupported barangay lifecycle action.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mdrrmo_reports
  SET lifecycle_revision = COALESCE(lifecycle_revision, 0) + 1,
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = CASE WHEN v_action IN ('dispatch','escalate') THEN 'barangay_dispatcher' ELSE 'barangay_responder' END,
      updated_at = v_now
  WHERE id = p_report_id AND v_action <> 'escalate';
  INSERT INTO public.resident_push_outbox (
    event_key, report_id, resident_id, source_table, report_title, display_status, revision
  )
  SELECT 'mdrrmo_reports:' || report.id::TEXT || ':' || report.lifecycle_revision::TEXT,
    report.id, report.reporter_id, 'mdrrmo_reports', COALESCE(report.title, 'Incident report'),
    CASE v_action
      WHEN 'dispatch' THEN 'barangay responders dispatched'
      WHEN 'respond' THEN 'barangay responder accepted'
      WHEN 'arrive' THEN 'barangay responder arrived'
      WHEN 'resolve' THEN 'resolved by barangay'
      ELSE 'returned to MDRRMO'
    END,
    report.lifecycle_revision
  FROM public.mdrrmo_reports AS report
  WHERE report.id = p_report_id AND report.reporter_type = 'resident' AND report.reporter_id IS NOT NULL
  ON CONFLICT (event_key) DO NOTHING;
  RETURN v_assignment.id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_mdrrmo_report_barangay_assignment_v1(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_mdrrmo_report_barangay_assignment_v1(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.update_mdrrmo_report_barangay_lifecycle_v1(UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_mdrrmo_report_barangay_lifecycle_v1(UUID, UUID, UUID, TEXT, JSONB) TO service_role;

-- Preserve open legacy local cases in central intake, and retain their current
-- barangay owner as an active assignment. Existing escalations stay in MDRRMO.
INSERT INTO public.mdrrmo_reports (
  id, source_type, source_barangay_report_id, type, title, specifics, description,
  latitude, longitude, address, incident_occurred_at, incident_time_precision,
  incident_type, severity, proof_url, proof_urls, proof_type, proof_types,
  evidence_status, responder_media, reporter_id, reporter_type, reporter_name,
  reporter_phone, reporter_email, barangay_id, barangay_name, response_status,
  coordination_notes, client_request_id, client_submitted_at, created_at, updated_at
)
SELECT
  report.id,
  CASE WHEN COALESCE(report.escalated_to_mdrrmo, FALSE)
      OR lower(COALESCE(report.status,'')) = 'escalated'
    THEN 'escalated' ELSE 'direct' END,
  report.id, report.type, report.title, report.specifics,
  report.description, report.latitude, report.longitude, report.address,
  report.incident_occurred_at, COALESCE(report.incident_time_precision, 'unknown'),
  report.incident_type, COALESCE(NULLIF(report.severity::TEXT, ''), 'moderate'), report.proof_url, COALESCE(report.proof_urls, '{}'),
  COALESCE(report.proof_type, 'image'), COALESCE(report.proof_types, '{}'),
  COALESCE(report.evidence_status, 'ready'), COALESCE(report.responder_media, '[]'::jsonb),
  report.reporter_id, report.reporter_type, report.reporter_name, report.reporter_phone,
  report.reporter_email, report.barangay_id, barangay.name, 'pending',
  CASE WHEN report.escalated_to_mdrrmo THEN report.mdrrmo_coordination_notes ELSE NULL END,
  report.client_request_id, report.client_submitted_at, report.created_at, now()
FROM public.barangay_reports AS report
LEFT JOIN public.barangays AS barangay ON barangay.id = report.barangay_id
WHERE COALESCE(report.response_status, 'pending') <> 'resolved'
  AND lower(COALESCE(report.status,'')) NOT IN ('resolved','closed','rejected','false_report')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.mdrrmo_report_barangay_assignments (
  report_id, barangay_id, assignment_status, response_status, assignment_notes,
  assigned_at, responder_ids, responder_name, incident_type, severity,
  response_notes, responded_by, responded_at, accepted_at, arrived_at
)
SELECT report.id, report.barangay_id, 'active',
  CASE WHEN report.response_status = 'responding' THEN 'responding' ELSE 'pending' END,
  'Existing barangay case transferred to the central MDRRMO intake workflow.',
  report.created_at,
  CASE WHEN cardinality(assignment.assigned_ids) > 0 THEN assignment.assigned_ids
    WHEN report.responded_by IS NULL THEN '{}'::UUID[] ELSE ARRAY[report.responded_by] END,
  report.responder_name, report.incident_type, COALESCE(NULLIF(report.severity::TEXT, ''), 'moderate'), report.response_notes,
  report.responded_by, report.responded_at, report.accepted_at, report.arrived_at
FROM public.barangay_reports AS report
JOIN public.mdrrmo_reports AS mdrrmo ON mdrrmo.id = report.id
LEFT JOIN LATERAL (
  SELECT COALESCE(array_agg(member_id::UUID), '{}'::UUID[]) AS assigned_ids
  FROM unnest(string_to_array(substring(COALESCE(report.response_notes,'') from '^\[ASSIGNED:([^\]]+)\]'), ',')) AS member_id
  WHERE member_id ~* '^[0-9a-f-]{36}$'
) AS assignment ON TRUE
WHERE report.barangay_id IS NOT NULL
  AND COALESCE(report.escalated_to_mdrrmo, FALSE) = FALSE
  AND COALESCE(report.response_status, 'pending') <> 'resolved'
  AND lower(COALESCE(report.status,'')) NOT IN ('escalated','resolved','closed','rejected','false_report')
  AND NOT EXISTS (
    SELECT 1 FROM public.mdrrmo_report_barangay_assignments AS existing
    WHERE existing.report_id = report.id AND existing.assignment_status = 'active'
  )
ON CONFLICT DO NOTHING;

COMMIT;
