-- Preserve actor attribution for the MDRRMO response cycle and keep an
-- append-only record of lifecycle transitions and resident content edits.
-- Apply after mdrrmo_report_cycle_migration.sql, incident_resolution_documents_migration.sql,
-- incident_report_review_migration.sql, report_resolution_status_migration.sql,
-- and incident_lifecycle_realtime_migration.sql.

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatcher_reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatched_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_arrived_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_role TEXT;

ALTER TABLE public.mdrrmo_report_assignments
  ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS arrived_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by_role TEXT,
  ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.incident_report_lifecycle_history (
  id BIGSERIAL PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_role TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS incident_report_lifecycle_history_report_idx
  ON public.incident_report_lifecycle_history(report_id, occurred_at, id);

ALTER TABLE public.incident_report_lifecycle_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.incident_report_lifecycle_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.incident_report_lifecycle_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.incident_report_lifecycle_history_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.audit_incident_report_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type TEXT;
  v_actor_id UUID;
  v_actor_role TEXT;
  v_details JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'incident.received';
    v_actor_id := NEW.reporter_id;
    v_actor_role := NEW.reporter_type;
    v_details := jsonb_build_object(
      'send_to', NEW.send_to,
      'status', NEW.status,
      'created_at', NEW.created_at,
      'incident_occurred_at', NEW.incident_occurred_at,
      'incident_time_precision', NEW.incident_time_precision
    );
  ELSE
    IF NEW.review_outcome IS DISTINCT FROM OLD.review_outcome THEN
      v_event_type := 'incident.reviewed';
    ELSIF NEW.barangay_dispatched_at IS DISTINCT FROM OLD.barangay_dispatched_at THEN
      v_event_type := 'barangay.responders_assigned';
    ELSIF NEW.barangay_accepted_at IS DISTINCT FROM OLD.barangay_accepted_at THEN
      v_event_type := 'barangay.responder_accepted';
    ELSIF NEW.barangay_arrived_at IS DISTINCT FROM OLD.barangay_arrived_at THEN
      v_event_type := 'barangay.responder_arrived';
    ELSIF NEW.barangay_resolved_at IS DISTINCT FROM OLD.barangay_resolved_at THEN
      v_event_type := 'barangay.response_resolved';
    ELSIF NEW.mdrrmo_dispatched_at IS DISTINCT FROM OLD.mdrrmo_dispatched_at THEN
      v_event_type := 'mdrrmo.responders_assigned';
    ELSIF NEW.mdrrmo_accepted_at IS DISTINCT FROM OLD.mdrrmo_accepted_at THEN
      v_event_type := 'mdrrmo.responder_accepted';
    ELSIF NEW.mdrrmo_accepted_by IS DISTINCT FROM OLD.mdrrmo_accepted_by THEN
      v_event_type := 'mdrrmo.responder_accepted';
    ELSIF NEW.mdrrmo_arrived_at IS DISTINCT FROM OLD.mdrrmo_arrived_at THEN
      v_event_type := 'mdrrmo.responder_arrived';
    ELSIF NEW.mdrrmo_resolved_at IS DISTINCT FROM OLD.mdrrmo_resolved_at THEN
      v_event_type := 'mdrrmo.response_resolved';
    ELSIF NEW.mdrrmo_response_notes IS DISTINCT FROM OLD.mdrrmo_response_notes THEN
      v_event_type := 'mdrrmo.field_assessment_updated';
    ELSIF NEW.mdrrmo_coordination_notes IS DISTINCT FROM OLD.mdrrmo_coordination_notes THEN
      v_event_type := 'mdrrmo.coordination_updated';
    ELSIF to_jsonb(NEW)->'responder_media' IS DISTINCT FROM to_jsonb(OLD)->'responder_media' THEN
      v_event_type := 'response.field_media_added';
    ELSIF NEW.description IS DISTINCT FROM OLD.description
       OR NEW.specifics IS DISTINCT FROM OLD.specifics
       OR NEW.proof_url IS DISTINCT FROM OLD.proof_url
       OR NEW.proof_type IS DISTINCT FROM OLD.proof_type
       OR to_jsonb(NEW)->'proof_urls' IS DISTINCT FROM to_jsonb(OLD)->'proof_urls'
       OR to_jsonb(NEW)->'proof_types' IS DISTINCT FROM to_jsonb(OLD)->'proof_types' THEN
      v_event_type := 'incident.edited';
    ELSIF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.mdrrmo_response_status IS DISTINCT FROM OLD.mdrrmo_response_status
       OR NEW.barangay_response_status IS DISTINCT FROM OLD.barangay_response_status THEN
      v_event_type := 'incident.status_changed';
    END IF;

    IF v_event_type IS NULL THEN
      RETURN NEW;
    END IF;

    v_actor_id := COALESCE(
      NEW.lifecycle_actor_id,
      NEW.mdrrmo_resolved_by,
      NEW.mdrrmo_arrived_by,
      NEW.mdrrmo_accepted_by,
      NEW.mdrrmo_dispatched_by,
      NEW.mdrrmo_dispatcher_reviewed_by,
      NEW.reviewed_by,
      NEW.reporter_id
    );
    v_actor_role := COALESCE(
      NEW.lifecycle_actor_role,
      CASE
        WHEN v_event_type = 'incident.edited' AND NEW.reporter_type = 'resident' THEN 'resident'
        WHEN v_event_type = 'incident.reviewed' THEN 'dispatcher'
        WHEN v_event_type LIKE 'mdrrmo.%' THEN 'responder'
        ELSE 'operations'
      END
    );
    v_details := jsonb_build_object(
      'before', jsonb_build_object(
        'status', OLD.status,
        'review_outcome', OLD.review_outcome,
        'review_reason', OLD.review_reason,
        'reviewed_at', OLD.reviewed_at,
        'mdrrmo_response_status', OLD.mdrrmo_response_status,
        'barangay_response_status', OLD.barangay_response_status,
        'barangay_dispatched_at', OLD.barangay_dispatched_at,
        'barangay_accepted_at', OLD.barangay_accepted_at,
        'barangay_arrived_at', OLD.barangay_arrived_at,
        'barangay_resolved_at', OLD.barangay_resolved_at,
        'dispatcher_reviewed_at', OLD.dispatcher_reviewed_at,
        'dispatched_at', OLD.dispatched_at,
        'accepted_at', OLD.accepted_at,
        'arrived_at', OLD.arrived_at,
        'resolved_at', OLD.resolved_at,
        'mdrrmo_response_notes', OLD.mdrrmo_response_notes,
        'mdrrmo_coordination_notes', OLD.mdrrmo_coordination_notes,
        'responder_media', to_jsonb(OLD)->'responder_media',
        'description', OLD.description,
        'specifics', OLD.specifics,
        'proof_url', OLD.proof_url,
        'proof_type', OLD.proof_type,
        'proof_urls', to_jsonb(OLD)->'proof_urls',
        'proof_types', to_jsonb(OLD)->'proof_types'
      ),
      'after', jsonb_build_object(
        'status', NEW.status,
        'review_outcome', NEW.review_outcome,
        'review_reason', NEW.review_reason,
        'reviewed_at', NEW.reviewed_at,
        'mdrrmo_response_status', NEW.mdrrmo_response_status,
        'barangay_response_status', NEW.barangay_response_status,
        'barangay_dispatched_at', NEW.barangay_dispatched_at,
        'barangay_accepted_at', NEW.barangay_accepted_at,
        'barangay_arrived_at', NEW.barangay_arrived_at,
        'barangay_resolved_at', NEW.barangay_resolved_at,
        'dispatcher_reviewed_at', NEW.dispatcher_reviewed_at,
        'dispatched_at', NEW.dispatched_at,
        'accepted_at', NEW.accepted_at,
        'arrived_at', NEW.arrived_at,
        'resolved_at', NEW.resolved_at,
        'mdrrmo_response_notes', NEW.mdrrmo_response_notes,
        'mdrrmo_coordination_notes', NEW.mdrrmo_coordination_notes,
        'responder_media', to_jsonb(NEW)->'responder_media',
        'description', NEW.description,
        'specifics', NEW.specifics,
        'proof_url', NEW.proof_url,
        'proof_type', NEW.proof_type,
        'proof_urls', to_jsonb(NEW)->'proof_urls',
        'proof_types', to_jsonb(NEW)->'proof_types'
      )
    );
  END IF;

  INSERT INTO public.incident_report_lifecycle_history
    (report_id, event_type, actor_id, actor_role, details)
  VALUES
    (NEW.id, v_event_type, v_actor_id, v_actor_role, COALESCE(v_details, '{}'::jsonb));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incident_report_lifecycle_history_after_write ON public.incident_reports;
CREATE TRIGGER incident_report_lifecycle_history_after_write
  AFTER INSERT OR UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.audit_incident_report_lifecycle();

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
    v_event_type := 'mdrrmo.responder_assigned';
    v_actor_id := NEW.assigned_by;
    v_actor_role := 'dispatcher';
    v_before := NULL;
    v_after := to_jsonb(NEW);
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'responding' THEN
      v_event_type := 'mdrrmo.responder_accepted';
      v_actor_id := NEW.accepted_by;
      v_actor_role := 'responder';
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

  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.incident_report_lifecycle_history
    (report_id, event_type, actor_id, actor_role, details)
  VALUES
    (NEW.report_id, v_event_type, v_actor_id, v_actor_role,
     jsonb_build_object('before', v_before, 'after', v_after));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mdrrmo_assignment_lifecycle_history_after_write ON public.mdrrmo_report_assignments;
CREATE TRIGGER mdrrmo_assignment_lifecycle_history_after_write
  AFTER INSERT OR UPDATE ON public.mdrrmo_report_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_mdrrmo_assignment_lifecycle();

-- Serialize each MDRRMO transition with its responder assignment changes. The
-- backend still performs role, report-visibility, and evidence validation.
CREATE OR REPLACE FUNCTION public.dispatch_mdrrmo_report(
  p_report_id UUID,
  p_actor_id UUID,
  p_incident_type TEXT,
  p_severity TEXT,
  p_notes TEXT,
  p_responder_ids UUID[],
  p_responder_names TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_active_count INTEGER;
BEGIN
  IF p_actor_id IS NULL OR p_incident_type IS NULL
     OR p_incident_type NOT IN ('flash_flood', 'fire', 'earthquake', 'medical_emergency', 'typhoon', 'other')
     OR p_severity IS NULL OR p_severity NOT IN ('low', 'moderate', 'high', 'critical')
     OR p_responder_ids IS NULL OR cardinality(p_responder_ids) < 1
     OR cardinality(p_responder_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_responder_ids) AS ids(id)) THEN
    RAISE EXCEPTION 'Invalid dispatch details' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.review_outcome IS NOT NULL
     OR v_report.mdrrmo_response_status NOT IN ('pending')
     OR (v_report.mdrrmo_response_status IS NULL
         AND NOT (v_report.status::TEXT = 'escalated' OR COALESCE(v_report.is_escalated, false)
           OR COALESCE(v_report.beyond_barangay_capability, false))
         AND v_report.status::TEXT IN ('resolved', 'closed'))
     OR v_report.mdrrmo_accepted_at IS NOT NULL
     OR v_report.mdrrmo_arrived_at IS NOT NULL
     OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Dispatch can only be changed before MDRRMO responder acceptance' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(DISTINCT id) INTO v_active_count
  FROM public.users
  WHERE id = ANY(p_responder_ids) AND role = 'responder' AND status = 'active';
  IF v_active_count <> cardinality(p_responder_ids) THEN
    RAISE EXCEPTION 'One or more selected MDRRMO responders are no longer active' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND status = 'responding'
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'Dispatch cannot be changed after a responder accepts the report' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.mdrrmo_report_assignments
  SET status = 'removed', removed_by = p_actor_id, removed_at = v_now
  WHERE report_id = p_report_id AND status = 'assigned';

  INSERT INTO public.mdrrmo_report_assignments (
    report_id, responder_id, assigned_by, status, assigned_at,
    accepted_at, arrived_at, resolved_at, accepted_by, arrived_by,
    resolved_by, resolved_by_role, removed_by, removed_at
  )
  SELECT p_report_id, selected.responder_id, p_actor_id, 'assigned', v_now,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM unnest(p_responder_ids) AS selected(responder_id)
  ON CONFLICT (report_id, responder_id) DO UPDATE SET
    assigned_by = EXCLUDED.assigned_by,
    status = 'assigned',
    assigned_at = EXCLUDED.assigned_at,
    accepted_at = NULL,
    arrived_at = NULL,
    resolved_at = NULL,
    accepted_by = NULL,
    arrived_by = NULL,
    resolved_by = NULL,
    resolved_by_role = NULL,
    removed_by = NULL,
    removed_at = NULL;

  UPDATE public.incident_reports
  SET incident_type = p_incident_type,
      severity = p_severity,
      status = (CASE
        WHEN status::TEXT = 'escalated' OR COALESCE(is_escalated, false) OR COALESCE(beyond_barangay_capability, false)
          THEN 'escalated'
        ELSE 'verified'
      END)::public.report_status,
      mdrrmo_response_status = 'pending',
      mdrrmo_dispatch_notes = NULLIF(BTRIM(p_notes), ''),
      mdrrmo_responded_by = NULL,
      mdrrmo_responded_at = NULL,
      mdrrmo_accepted_by = NULL,
      mdrrmo_responder_name = p_responder_names,
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = 'dispatcher',
      mdrrmo_dispatcher_reviewed_by = p_actor_id,
      mdrrmo_dispatched_by = p_actor_id,
      dispatcher_reviewed_at = COALESCE(dispatcher_reviewed_at, v_now),
      mdrrmo_dispatcher_reviewed_at = v_now,
      dispatched_at = COALESCE(dispatched_at, v_now),
      mdrrmo_dispatched_at = v_now
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  RETURN to_jsonb(v_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_mdrrmo_report(
  p_report_id UUID,
  p_responder_id UUID,
  p_responder_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_assignment public.mdrrmo_report_assignments%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_responder_id IS NULL THEN
    RAISE EXCEPTION 'Responder is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.mdrrmo_dispatched_at IS NULL
     OR v_report.mdrrmo_response_status IS NULL
     OR v_report.mdrrmo_response_status NOT IN ('pending', 'responding')
     OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'A dispatcher must assign this report before responder acceptance' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_responder_id AND role = 'responder' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'MDRRMO responder account is not active' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND responder_id = p_responder_id AND status = 'assigned'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This report is not waiting for acceptance by your account' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.mdrrmo_report_assignments
  SET status = 'responding', accepted_at = v_now, accepted_by = p_responder_id
  WHERE id = v_assignment.id;

  UPDATE public.incident_reports
  SET status = 'responding',
      mdrrmo_response_status = 'responding',
      mdrrmo_responded_by = COALESCE(mdrrmo_responded_by, p_responder_id),
      mdrrmo_responder_name = COALESCE(mdrrmo_responder_name, p_responder_name),
      lifecycle_actor_id = p_responder_id,
      lifecycle_actor_role = 'responder',
      mdrrmo_accepted_by = COALESCE(mdrrmo_accepted_by, p_responder_id),
      mdrrmo_responded_at = COALESCE(mdrrmo_responded_at, v_now),
      accepted_at = COALESCE(accepted_at, v_now),
      mdrrmo_accepted_at = COALESCE(mdrrmo_accepted_at, v_now)
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  RETURN to_jsonb(v_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_mdrrmo_arrival(
  p_report_id UUID,
  p_responder_id UUID,
  p_arrival_at TIMESTAMPTZ,
  p_recorded_at TIMESTAMPTZ,
  p_method TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_accuracy_m DOUBLE PRECISION,
  p_distance_m DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_assignment public.mdrrmo_report_assignments%ROWTYPE;
BEGIN
  IF p_responder_id IS NULL OR p_arrival_at IS NULL OR p_recorded_at IS NULL
     OR p_method IS NULL OR p_method NOT IN ('manual', 'gps') THEN
    RAISE EXCEPTION 'Invalid arrival details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.mdrrmo_response_status IS DISTINCT FROM 'responding' OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Accept the report before recording arrival' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_assignment
  FROM public.mdrrmo_report_assignments
  WHERE report_id = p_report_id AND responder_id = p_responder_id AND status = 'responding'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This report is not assigned to an active response for your account' USING ERRCODE = 'P0001';
  END IF;
  IF v_assignment.arrived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Arrival has already been recorded for this responder' USING ERRCODE = 'P0001';
  END IF;

  IF v_report.mdrrmo_arrived_at IS NULL THEN
    UPDATE public.incident_reports
    SET arrived_at = COALESCE(arrived_at, p_arrival_at),
        mdrrmo_arrived_at = p_arrival_at,
        arrival_recorded_at = CASE WHEN arrived_at IS NULL THEN p_recorded_at ELSE arrival_recorded_at END,
        arrival_method = CASE WHEN arrived_at IS NULL THEN p_method ELSE arrival_method END,
        arrival_latitude = CASE WHEN arrived_at IS NULL THEN p_latitude ELSE arrival_latitude END,
        arrival_longitude = CASE WHEN arrived_at IS NULL THEN p_longitude ELSE arrival_longitude END,
        arrival_accuracy_m = CASE WHEN arrived_at IS NULL THEN p_accuracy_m ELSE arrival_accuracy_m END,
        arrival_distance_m = CASE WHEN arrived_at IS NULL THEN p_distance_m ELSE arrival_distance_m END,
        lifecycle_actor_id = p_responder_id,
        lifecycle_actor_role = 'responder',
        mdrrmo_arrived_by = p_responder_id
    WHERE id = p_report_id
    RETURNING * INTO v_report;
  END IF;

  UPDATE public.mdrrmo_report_assignments
  SET arrived_at = p_arrival_at, arrived_by = p_responder_id
  WHERE id = v_assignment.id;

  RETURN to_jsonb(v_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_mdrrmo_report(
  p_report_id UUID,
  p_actor_id UUID,
  p_actor_role TEXT,
  p_resolved_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_assignment public.mdrrmo_report_assignments%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_is_escalated BOOLEAN;
  v_direct_to_mdrrmo BOOLEAN;
  v_barangay_engaged BOOLEAN;
  v_barangay_open BOOLEAN;
  v_overall_status TEXT;
  v_actor_role TEXT;
BEGIN
  IF p_actor_id IS NULL OR NULLIF(BTRIM(p_resolved_notes), '') IS NULL
     OR p_actor_role IS NULL OR p_actor_role NOT IN ('dispatcher', 'responder', 'admin', 'master_admin') THEN
    RAISE EXCEPTION 'A valid response summary and actor are required' USING ERRCODE = '22023';
  END IF;
  v_actor_role := CASE WHEN p_actor_role = 'responder' THEN 'responder' ELSE 'dispatcher' END;
  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.mdrrmo_response_status IS DISTINCT FROM 'responding' OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'The MDRRMO response is no longer active' USING ERRCODE = 'P0001';
  END IF;

  IF v_actor_role = 'responder' THEN
    SELECT * INTO v_assignment
    FROM public.mdrrmo_report_assignments
    WHERE report_id = p_report_id AND responder_id = p_actor_id AND status = 'responding'
      AND arrived_at IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Record arrival on an active assigned response before closing' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_report.mdrrmo_arrived_at IS NULL
     AND (v_report.barangay_arrived_at IS NOT NULL OR v_report.arrived_at IS NULL) THEN
    RAISE EXCEPTION 'A responder must record MDRRMO arrival before closing' USING ERRCODE = 'P0001';
  END IF;

  v_is_escalated := v_report.status::TEXT = 'escalated'
    OR COALESCE(v_report.is_escalated, false)
    OR COALESCE(v_report.beyond_barangay_capability, false);
  v_direct_to_mdrrmo := COALESCE(LOWER(BTRIM(v_report.send_to)), '') = 'mdrrmo'
    OR LOWER(COALESCE(v_report.specifics, '') || ' ' || COALESCE(v_report.description, '')) ~ '\[send_to:mdrrmo\]';
  v_barangay_engaged := NOT v_direct_to_mdrrmo AND (
    v_is_escalated OR v_report.barangay_dispatched_at IS NOT NULL
    OR v_report.barangay_responded_by IS NOT NULL
    OR COALESCE(v_report.barangay_response_status, '') IN ('pending', 'responding', 'resolved')
  );
  v_barangay_open := COALESCE(v_barangay_engaged, false)
    AND COALESCE(v_report.barangay_response_status, '') <> 'resolved';
  v_overall_status := CASE
    WHEN NOT v_barangay_open THEN 'resolved'
    WHEN v_report.barangay_response_status = 'responding' THEN 'responding'
    WHEN v_is_escalated THEN 'escalated'
    WHEN v_report.status::TEXT IN ('resolved', 'closed') THEN
      CASE WHEN v_report.barangay_dispatched_at IS NOT NULL THEN 'verified' ELSE 'pending' END
    ELSE v_report.status::TEXT
  END;

  UPDATE public.incident_reports
  SET status = v_overall_status::public.report_status,
      mdrrmo_response_status = 'resolved',
      mdrrmo_resolved_notes = BTRIM(p_resolved_notes),
      mdrrmo_resolved_at = v_now,
      mdrrmo_resolved_by = p_actor_id,
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = v_actor_role,
      resolved_notes = CASE WHEN v_overall_status = 'resolved' THEN BTRIM(p_resolved_notes) ELSE NULL END,
      resolved_at = CASE WHEN v_overall_status = 'resolved' THEN v_now ELSE NULL END
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  UPDATE public.mdrrmo_report_assignments
  SET status = 'resolved', resolved_at = v_now, resolved_by = p_actor_id, resolved_by_role = v_actor_role
  WHERE report_id = p_report_id AND status <> 'removed';

  RETURN to_jsonb(v_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.append_mdrrmo_field_media(
  p_report_id UUID,
  p_actor_id UUID,
  p_actor_role TEXT,
  p_media_item JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_actor_role TEXT;
BEGIN
  IF p_actor_id IS NULL OR p_actor_role IS NULL
     OR p_actor_role NOT IN ('dispatcher', 'responder', 'admin', 'master_admin')
     OR p_media_item IS NULL OR jsonb_typeof(p_media_item) <> 'object' THEN
    RAISE EXCEPTION 'Invalid field media details' USING ERRCODE = '22023';
  END IF;
  v_actor_role := CASE WHEN p_actor_role = 'responder' THEN 'responder' ELSE 'dispatcher' END;
  SELECT * INTO v_report
  FROM public.incident_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_report.mdrrmo_response_status IS DISTINCT FROM 'responding' OR v_report.mdrrmo_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Field media can only be added during an active MDRRMO response' USING ERRCODE = 'P0001';
  END IF;
  IF v_actor_role = 'responder' AND NOT EXISTS (
    SELECT 1 FROM public.mdrrmo_report_assignments
    WHERE report_id = p_report_id AND responder_id = p_actor_id AND status = 'responding'
  ) THEN
    RAISE EXCEPTION 'Field media can only be added during your active response' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.incident_reports
  SET responder_media = COALESCE(responder_media, '[]'::jsonb) || jsonb_build_array(p_media_item),
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = v_actor_role
  WHERE id = p_report_id
  RETURNING * INTO v_report;
  RETURN to_jsonb(v_report);
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_mdrrmo_report(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_mdrrmo_report(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_mdrrmo_arrival(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_mdrrmo_report(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_mdrrmo_field_media(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_mdrrmo_report(UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_mdrrmo_report(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mdrrmo_arrival(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_mdrrmo_report(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_mdrrmo_field_media(UUID, UUID, TEXT, JSONB) TO service_role;
