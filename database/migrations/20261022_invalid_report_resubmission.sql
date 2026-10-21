-- Review and resubmission lifecycle for canonical MDRRMO and barangay reports.
-- Keep review history when a reporter corrects and resubmits the same report.

BEGIN;

ALTER TABLE public.mdrrmo_reports
  ADD COLUMN IF NOT EXISTS review_outcome TEXT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_by_actor_id UUID,
  ADD COLUMN IF NOT EXISTS reviewed_by_role TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS false_report_review_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resubmission_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resubmitted_at TIMESTAMPTZ;

ALTER TABLE public.barangay_reports
  ADD COLUMN IF NOT EXISTS review_outcome TEXT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by_actor_id UUID,
  ADD COLUMN IF NOT EXISTS reviewed_by_role TEXT,
  ADD COLUMN IF NOT EXISTS false_report_review_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resubmission_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resubmitted_at TIMESTAMPTZ;

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS reviewed_by_role TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by_actor_id UUID,
  ADD COLUMN IF NOT EXISTS false_report_review_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resubmission_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resubmitted_at TIMESTAMPTZ;

-- Assignment closure timestamps are consumed by responder review and assignment feeds.
ALTER TABLE public.mdrrmo_report_barangay_assignments
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mdrrmo_reports_review_outcome_check'
      AND conrelid = 'public.mdrrmo_reports'::regclass
  ) THEN
    ALTER TABLE public.mdrrmo_reports
      ADD CONSTRAINT mdrrmo_reports_review_outcome_check
      CHECK (review_outcome IS NULL OR review_outcome IN ('inconclusive', 'false_report'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'barangay_reports_review_outcome_check'
      AND conrelid = 'public.barangay_reports'::regclass
  ) THEN
    ALTER TABLE public.barangay_reports
      ADD CONSTRAINT barangay_reports_review_outcome_check
      CHECK (review_outcome IS NULL OR review_outcome IN ('inconclusive', 'false_report'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.incident_report_review_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL,
  lifecycle_cycle INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('reviewed', 'resubmitted')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('inconclusive', 'false_report')),
  reason TEXT,
  actor_id UUID,
  actor_role TEXT NOT NULL,
  false_report_review_count INTEGER NOT NULL DEFAULT 0,
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, lifecycle_cycle, event_type)
);

ALTER TABLE public.incident_report_review_history
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE INDEX IF NOT EXISTS incident_report_review_history_report_idx
  ON public.incident_report_review_history (report_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS incident_report_review_history_request_idx
  ON public.incident_report_review_history (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.incident_report_review_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.incident_report_review_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.incident_report_review_history TO service_role;

CREATE OR REPLACE FUNCTION public.record_canonical_incident_review(
  p_report_id UUID,
  p_outcome TEXT,
  p_reason TEXT,
  p_actor_id UUID,
  p_actor_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mdrrmo public.mdrrmo_reports%ROWTYPE;
  v_barangay public.barangay_reports%ROWTYPE;
  v_paired_barangay_id UUID;
  v_is_mdrrmo BOOLEAN := FALSE;
  v_false_count INTEGER := 0;
  v_resident_count INTEGER;
  v_resident_status TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_report JSONB;
  v_existing_cycle INTEGER;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('inconclusive', 'false_report') THEN
    RAISE EXCEPTION 'Invalid report review outcome' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL OR p_actor_role IS NULL THEN
    RAISE EXCEPTION 'A reviewer is required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'inconclusive' AND NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for an inconclusive report' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_mdrrmo
    FROM public.mdrrmo_reports
    WHERE id = p_report_id
    FOR UPDATE;
  IF FOUND THEN
    v_is_mdrrmo := TRUE;
    v_paired_barangay_id := v_mdrrmo.source_barangay_report_id;
    IF v_paired_barangay_id IS NULL THEN
      v_paired_barangay_id := v_mdrrmo.id;
    END IF;
    SELECT * INTO v_barangay
      FROM public.barangay_reports
      WHERE id = v_paired_barangay_id
      FOR UPDATE;
    IF v_mdrrmo.review_outcome IS NOT NULL THEN
      IF v_mdrrmo.review_outcome <> p_outcome THEN
        RAISE EXCEPTION 'This report already has a different review decision' USING ERRCODE = 'P0001';
      END IF;
      IF v_mdrrmo.reviewed_by_actor_id IS DISTINCT FROM p_actor_id
        OR v_mdrrmo.reviewed_by_role IS DISTINCT FROM p_actor_role THEN
        RAISE EXCEPTION 'This report has already been reviewed' USING ERRCODE = 'P0001';
      END IF;
      SELECT false_report_count, status INTO v_resident_count, v_resident_status
        FROM public.resident_user WHERE id = v_mdrrmo.reporter_id;
      RETURN jsonb_build_object(
        'report', to_jsonb(v_mdrrmo),
        'false_report_review_count', COALESCE(v_mdrrmo.false_report_review_count, 0),
        'false_report_count', v_resident_count,
        'resident_status', v_resident_status,
        'already_reviewed', TRUE
      );
    END IF;
    v_false_count := COALESCE(v_mdrrmo.false_report_review_count, 0);
  ELSE
    SELECT * INTO v_barangay
      FROM public.barangay_reports
      WHERE id = p_report_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
    END IF;
    v_paired_barangay_id := v_barangay.id;
    v_false_count := COALESCE(v_barangay.false_report_review_count, 0);
    IF v_barangay.review_outcome IS NOT NULL THEN
      IF v_barangay.review_outcome <> p_outcome THEN
        RAISE EXCEPTION 'This report already has a different review decision' USING ERRCODE = 'P0001';
      END IF;
      IF v_barangay.reviewed_by_actor_id IS DISTINCT FROM p_actor_id
        OR v_barangay.reviewed_by_role IS DISTINCT FROM p_actor_role THEN
        RAISE EXCEPTION 'This report has already been reviewed' USING ERRCODE = 'P0001';
      END IF;
      SELECT false_report_count, status INTO v_resident_count, v_resident_status
        FROM public.resident_user WHERE id = v_barangay.reporter_id;
      RETURN jsonb_build_object(
        'report', to_jsonb(v_barangay),
        'false_report_review_count', COALESCE(v_barangay.false_report_review_count, 0),
        'false_report_count', v_resident_count,
        'resident_status', v_resident_status,
        'already_reviewed', TRUE
      );
    END IF;
  END IF;

  IF p_actor_role = 'responder' THEN
    IF p_outcome <> 'false_report' THEN
      RAISE EXCEPTION 'Responders may only mark an assigned report as false reporter' USING ERRCODE = '22023';
    END IF;
    IF v_is_mdrrmo THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.mdrrmo_report_assignments a
        WHERE a.report_id = v_mdrrmo.id
          AND a.responder_id = p_actor_id
          AND a.status IN ('assigned', 'responding')
          AND a.resolved_at IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM public.mdrrmo_report_barangay_assignments a
        WHERE a.report_id = v_mdrrmo.id
          AND a.assignment_status = 'active'
          AND p_actor_id = ANY(a.responder_ids)
          AND a.resolved_at IS NULL
      ) THEN
        RAISE EXCEPTION 'This responder does not have an active assignment for the report' USING ERRCODE = 'P0001';
      END IF;
      IF v_mdrrmo.resolved_at IS NOT NULL OR v_mdrrmo.map_closed_at IS NOT NULL
        OR v_mdrrmo.response_status = 'resolved' THEN
        RAISE EXCEPTION 'A resolved report cannot be marked false reporter' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF v_barangay.responded_by IS DISTINCT FROM p_actor_id
        OR v_barangay.response_status <> 'responding'
        OR v_barangay.resolved_at IS NOT NULL THEN
        RAISE EXCEPTION 'This responder does not have an active unresolved assignment for the report' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  ELSE
    IF p_actor_role NOT IN ('dispatcher', 'admin', 'master_admin') THEN
      RAISE EXCEPTION 'Only dispatchers can review a pending report' USING ERRCODE = '42501';
    END IF;
    IF (
      (v_is_mdrrmo AND (
        v_mdrrmo.response_status <> 'pending'
        OR v_mdrrmo.dispatched_at IS NOT NULL
        OR v_mdrrmo.accepted_at IS NOT NULL
        OR v_mdrrmo.arrived_at IS NOT NULL
        OR v_mdrrmo.resolved_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.mdrrmo_report_assignments a
          WHERE a.report_id = v_mdrrmo.id AND a.status IN ('assigned', 'responding')
        )
        OR EXISTS (
          SELECT 1 FROM public.mdrrmo_report_barangay_assignments a
          WHERE a.report_id = v_mdrrmo.id AND a.assignment_status = 'active'
        )
      ))
      OR (NOT v_is_mdrrmo AND (
        v_barangay.response_status <> 'pending'
        OR v_barangay.dispatched_at IS NOT NULL
        OR v_barangay.accepted_at IS NOT NULL
        OR v_barangay.arrived_at IS NOT NULL
        OR v_barangay.resolved_at IS NOT NULL
      ))
    ) THEN
      RAISE EXCEPTION 'Only a pending, undispatched report can receive a dispatcher review' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_outcome = 'false_report' THEN
    v_false_count := v_false_count + 1;
    IF v_is_mdrrmo AND v_mdrrmo.reporter_type = 'resident' AND v_mdrrmo.reporter_id IS NOT NULL THEN
      UPDATE public.resident_user
        SET false_report_count = LEAST(COALESCE(false_report_count, 0) + 1, 3),
            status = CASE WHEN COALESCE(false_report_count, 0) + 1 >= 3 THEN 'inactive' ELSE status END,
            updated_at = v_now
        WHERE id = v_mdrrmo.reporter_id
        RETURNING false_report_count, status INTO v_resident_count, v_resident_status;
    ELSIF NOT v_is_mdrrmo AND v_barangay.reporter_type = 'resident' AND v_barangay.reporter_id IS NOT NULL THEN
      UPDATE public.resident_user
        SET false_report_count = LEAST(COALESCE(false_report_count, 0) + 1, 3),
            status = CASE WHEN COALESCE(false_report_count, 0) + 1 >= 3 THEN 'inactive' ELSE status END,
            updated_at = v_now
        WHERE id = v_barangay.reporter_id
        RETURNING false_report_count, status INTO v_resident_count, v_resident_status;
    END IF;
  END IF;

  IF v_is_mdrrmo THEN
    v_existing_cycle := COALESCE(v_mdrrmo.resubmission_count, 0);
    UPDATE public.mdrrmo_reports SET
      review_outcome = p_outcome,
      review_reason = NULLIF(BTRIM(p_reason), ''),
      reviewed_by = CASE WHEN p_actor_role IN ('dispatcher', 'admin', 'master_admin') THEN p_actor_id ELSE NULL END,
      reviewed_by_actor_id = p_actor_id,
      reviewed_by_role = p_actor_role,
      reviewed_at = v_now,
      false_report_review_count = v_false_count,
      response_status = CASE WHEN p_actor_role = 'responder' THEN 'pending' ELSE response_status END,
      lifecycle_revision = COALESCE(lifecycle_revision, 0) + 1,
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = p_actor_role,
      updated_at = v_now
    WHERE id = v_mdrrmo.id
    RETURNING * INTO v_mdrrmo;

    IF v_paired_barangay_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.barangay_reports WHERE id = v_paired_barangay_id
    ) THEN
      UPDATE public.barangay_reports SET
        review_outcome = p_outcome,
        review_reason = NULLIF(BTRIM(p_reason), ''),
        reviewed_by_actor_id = p_actor_id,
        reviewed_by_role = p_actor_role,
        reviewed_at = v_now,
        false_report_review_count = v_false_count,
        response_status = CASE WHEN p_actor_role = 'responder' THEN 'pending' ELSE response_status END,
        status = CASE WHEN p_actor_role = 'responder' THEN 'rejected' ELSE status END,
        lifecycle_revision = COALESCE(lifecycle_revision, 0) + 1,
        lifecycle_actor_id = p_actor_id,
        lifecycle_actor_role = p_actor_role,
        updated_at = v_now
      WHERE id = v_paired_barangay_id;
    END IF;
  ELSE
    v_existing_cycle := COALESCE(v_barangay.resubmission_count, 0);
    UPDATE public.barangay_reports SET
      review_outcome = p_outcome,
      review_reason = NULLIF(BTRIM(p_reason), ''),
      reviewed_by_actor_id = p_actor_id,
      reviewed_by_role = p_actor_role,
      reviewed_at = v_now,
      false_report_review_count = v_false_count,
      status = 'rejected',
      response_status = CASE WHEN p_actor_role = 'responder' THEN 'pending' ELSE response_status END,
      lifecycle_revision = COALESCE(lifecycle_revision, 0) + 1,
      lifecycle_actor_id = p_actor_id,
      lifecycle_actor_role = p_actor_role,
      updated_at = v_now
    WHERE id = v_barangay.id
    RETURNING * INTO v_barangay;
  END IF;

  IF p_actor_role = 'responder' THEN
    IF v_is_mdrrmo THEN
      UPDATE public.mdrrmo_report_assignments
        SET status = 'removed'
        WHERE report_id = v_mdrrmo.id AND status IN ('assigned', 'responding');
      UPDATE public.mdrrmo_report_barangay_assignments
        SET assignment_status = 'recalled', closed_at = v_now
        WHERE report_id = v_mdrrmo.id AND assignment_status = 'active';
      INSERT INTO public.mdrrmo_report_barangay_assignment_events (
        report_id, event_type, actor_id, actor_role, notes, created_at
      ) VALUES (v_mdrrmo.id, 'dismissed', p_actor_id, p_actor_role, 'Responder marked the report as false reporter.', v_now);
    END IF;
  END IF;

  INSERT INTO public.incident_report_review_history (
    report_id, lifecycle_cycle, event_type, outcome, reason, actor_id, actor_role,
    false_report_review_count, created_at
  ) VALUES (
    p_report_id, v_existing_cycle, 'reviewed', p_outcome, NULLIF(BTRIM(p_reason), ''),
    p_actor_id, p_actor_role, v_false_count, v_now
  ) ON CONFLICT (report_id, lifecycle_cycle, event_type) DO NOTHING;

  IF v_is_mdrrmo THEN v_report := to_jsonb(v_mdrrmo); ELSE v_report := to_jsonb(v_barangay); END IF;
  RETURN jsonb_build_object(
    'report', v_report,
    'false_report_review_count', v_false_count,
    'false_report_count', v_resident_count,
    'resident_status', v_resident_status,
    'already_reviewed', FALSE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_incident_report_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN length(phone_digits) = 12 AND left(phone_digits, 2) = '63'
    THEN '0' || substring(phone_digits FROM 3)
    ELSE phone_digits
  END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS phone_digits) normalized
$$;

CREATE OR REPLACE FUNCTION public.resubmit_reviewed_incident_report(
  p_report_id UUID,
  p_reporter_type TEXT,
  p_reporter_id UUID,
  p_contact_phone TEXT,
  p_patch JSONB,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mdrrmo public.mdrrmo_reports%ROWTYPE;
  v_barangay public.barangay_reports%ROWTYPE;
  v_paired_barangay_id UUID;
  v_is_mdrrmo BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_cycle INTEGER;
  v_prior_cycle INTEGER;
  v_report JSONB;
BEGIN
  IF p_reporter_type IS NULL OR p_reporter_type NOT IN ('resident', 'guest') THEN
    RAISE EXCEPTION 'Only resident and guest reports can be resubmitted' USING ERRCODE = '22023';
  END IF;
  IF p_reporter_type = 'guest' AND p_reporter_id IS NOT NULL THEN
    RAISE EXCEPTION 'Guest reports must remain separate from resident accounts' USING ERRCODE = '22023';
  END IF;
  IF p_patch IS NULL OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Enter updated report details before resubmitting' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A resubmission request identifier is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_mdrrmo FROM public.mdrrmo_reports WHERE id = p_report_id FOR UPDATE;
  IF FOUND THEN
    v_is_mdrrmo := TRUE;
    v_paired_barangay_id := COALESCE(v_mdrrmo.source_barangay_report_id, v_mdrrmo.id);
    SELECT * INTO v_barangay FROM public.barangay_reports WHERE id = v_paired_barangay_id FOR UPDATE;
    IF v_mdrrmo.reporter_type IS DISTINCT FROM p_reporter_type THEN
      RAISE EXCEPTION 'Report ownership could not be verified' USING ERRCODE = '42501';
    END IF;
    IF p_reporter_type = 'resident' THEN
      IF p_reporter_id IS NULL OR v_mdrrmo.reporter_id IS DISTINCT FROM p_reporter_id THEN
        RAISE EXCEPTION 'Report ownership could not be verified' USING ERRCODE = '42501';
      END IF;
    ELSIF v_mdrrmo.reporter_id IS NOT NULL
      OR NULLIF(public.normalize_incident_report_phone(p_contact_phone), '') IS NULL
      OR public.normalize_incident_report_phone(p_contact_phone) IS DISTINCT FROM public.normalize_incident_report_phone(v_mdrrmo.reporter_phone) THEN
      RAISE EXCEPTION 'Report ownership could not be verified' USING ERRCODE = '42501';
    END IF;
    SELECT lifecycle_cycle INTO v_prior_cycle
      FROM public.incident_report_review_history
      WHERE report_id = p_report_id AND event_type = 'resubmitted' AND request_id = p_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'report', to_jsonb(v_mdrrmo),
        'resubmission_count', v_prior_cycle,
        'false_report_review_count', COALESCE(v_mdrrmo.false_report_review_count, 0),
        'already_resubmitted', TRUE
      );
    END IF;
    IF v_mdrrmo.review_outcome IS NULL OR v_mdrrmo.review_outcome NOT IN ('inconclusive', 'false_report') THEN
      RAISE EXCEPTION 'Only a report marked inconclusive or false reporter can be resubmitted' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.mdrrmo_report_assignments a
      WHERE a.report_id = v_mdrrmo.id AND a.status IN ('assigned', 'responding'))
      OR EXISTS (SELECT 1 FROM public.mdrrmo_report_barangay_assignments a
      WHERE a.report_id = v_mdrrmo.id AND a.assignment_status = 'active') THEN
      RAISE EXCEPTION 'Close the active responder assignment before resubmitting this report' USING ERRCODE = 'P0001';
    END IF;
    v_cycle := COALESCE(v_mdrrmo.resubmission_count, 0) + 1;

    UPDATE public.mdrrmo_reports SET
      type = CASE WHEN p_patch ? 'type' THEN p_patch->>'type' ELSE type END,
      title = CASE WHEN p_patch ? 'title' THEN p_patch->>'title' ELSE title END,
      specifics = CASE WHEN p_patch ? 'specifics' THEN p_patch->>'specifics' ELSE specifics END,
      description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description' ELSE description END,
      incident_type = CASE WHEN p_patch ? 'incident_type' THEN p_patch->>'incident_type' ELSE incident_type END,
      severity = CASE WHEN p_patch ? 'severity' THEN p_patch->>'severity' ELSE severity END,
      address = CASE WHEN p_patch ? 'address' THEN p_patch->>'address' ELSE address END,
      latitude = CASE WHEN p_patch ? 'latitude' THEN (p_patch->>'latitude')::DOUBLE PRECISION ELSE latitude END,
      longitude = CASE WHEN p_patch ? 'longitude' THEN (p_patch->>'longitude')::DOUBLE PRECISION ELSE longitude END,
      incident_occurred_at = CASE WHEN p_patch ? 'incident_occurred_at' THEN NULLIF(p_patch->>'incident_occurred_at', '')::TIMESTAMPTZ ELSE incident_occurred_at END,
      incident_time_precision = CASE WHEN p_patch ? 'incident_time_precision' THEN p_patch->>'incident_time_precision' ELSE incident_time_precision END,
      proof_urls = CASE WHEN p_patch ? 'proof_urls' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'proof_urls')) ELSE proof_urls END,
      proof_types = CASE WHEN p_patch ? 'proof_types' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'proof_types')) ELSE proof_types END,
      proof_url = CASE WHEN p_patch ? 'proof_urls' THEN
        CASE WHEN jsonb_array_length(p_patch->'proof_urls') > 1 THEN (p_patch->'proof_urls')::TEXT
          WHEN jsonb_array_length(p_patch->'proof_urls') = 1 THEN p_patch->'proof_urls'->>0 ELSE NULL END ELSE proof_url END,
      proof_type = CASE WHEN p_patch ? 'proof_types' AND jsonb_array_length(p_patch->'proof_types') > 0 THEN p_patch->'proof_types'->>0 ELSE proof_type END,
      evidence_status = CASE WHEN p_patch ? 'proof_urls' THEN 'ready' ELSE evidence_status END,
      response_status = 'pending',
      dispatcher_reviewed_at = NULL,
      dispatched_by = NULL,
      dispatched_at = NULL,
      accepted_at = NULL,
      arrived_at = NULL,
      responded_by = NULL,
      responded_at = NULL,
      resolved_at = NULL,
      resolved_by = NULL,
      resolved_notes = NULL,
      review_outcome = NULL,
      review_reason = NULL,
      reviewed_by = NULL,
      reviewed_by_actor_id = NULL,
      reviewed_by_role = NULL,
      reviewed_at = NULL,
      resubmission_count = v_cycle,
      resubmitted_at = v_now,
      lifecycle_revision = COALESCE(lifecycle_revision, 0) + 1,
      lifecycle_actor_id = p_reporter_id,
      lifecycle_actor_role = p_reporter_type,
      updated_at = v_now
    WHERE id = v_mdrrmo.id
    RETURNING * INTO v_mdrrmo;

    IF v_paired_barangay_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.barangay_reports WHERE id = v_paired_barangay_id
    ) THEN
      UPDATE public.barangay_reports SET
        type = v_mdrrmo.type,
        title = v_mdrrmo.title,
        specifics = v_mdrrmo.specifics,
        description = v_mdrrmo.description,
        incident_type = v_mdrrmo.incident_type,
        severity = v_mdrrmo.severity,
        address = v_mdrrmo.address,
        latitude = v_mdrrmo.latitude,
        longitude = v_mdrrmo.longitude,
        incident_occurred_at = v_mdrrmo.incident_occurred_at,
        incident_time_precision = v_mdrrmo.incident_time_precision,
        proof_url = v_mdrrmo.proof_url,
        proof_urls = v_mdrrmo.proof_urls,
        proof_type = v_mdrrmo.proof_type,
        proof_types = v_mdrrmo.proof_types,
        evidence_status = v_mdrrmo.evidence_status,
        response_status = 'pending',
        dispatcher_reviewed_at = NULL,
        dispatched_by = NULL,
        dispatched_at = NULL,
        accepted_at = NULL,
        arrived_at = NULL,
        responded_by = NULL,
        responded_at = NULL,
        resolved_at = NULL,
        resolved_by = NULL,
        resolved_notes = NULL,
        status = 'pending',
        review_outcome = NULL,
        review_reason = NULL,
        reviewed_by = NULL,
        reviewed_by_actor_id = NULL,
        reviewed_by_role = NULL,
        reviewed_at = NULL,
        resubmission_count = v_cycle,
        resubmitted_at = v_now,
        lifecycle_revision = COALESCE(lifecycle_revision, 0) + 1,
        lifecycle_actor_id = p_reporter_id,
        lifecycle_actor_role = p_reporter_type,
        updated_at = v_now
      WHERE id = v_paired_barangay_id;
    END IF;
  ELSE
    SELECT * INTO v_barangay FROM public.barangay_reports WHERE id = p_report_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002'; END IF;
    IF v_barangay.reporter_type IS DISTINCT FROM p_reporter_type THEN
      RAISE EXCEPTION 'Report ownership could not be verified' USING ERRCODE = '42501';
    END IF;
    IF p_reporter_type = 'resident' THEN
      IF p_reporter_id IS NULL OR v_barangay.reporter_id IS DISTINCT FROM p_reporter_id THEN
        RAISE EXCEPTION 'Report ownership could not be verified' USING ERRCODE = '42501';
      END IF;
    ELSIF v_barangay.reporter_id IS NOT NULL
      OR NULLIF(public.normalize_incident_report_phone(p_contact_phone), '') IS NULL
      OR public.normalize_incident_report_phone(p_contact_phone) IS DISTINCT FROM public.normalize_incident_report_phone(v_barangay.reporter_phone) THEN
      RAISE EXCEPTION 'Report ownership could not be verified' USING ERRCODE = '42501';
    END IF;
    SELECT lifecycle_cycle INTO v_prior_cycle
      FROM public.incident_report_review_history
      WHERE report_id = p_report_id AND event_type = 'resubmitted' AND request_id = p_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'report', to_jsonb(v_barangay),
        'resubmission_count', v_prior_cycle,
        'false_report_review_count', COALESCE(v_barangay.false_report_review_count, 0),
        'already_resubmitted', TRUE
      );
    END IF;
    IF v_barangay.review_outcome IS NULL OR v_barangay.review_outcome NOT IN ('inconclusive', 'false_report') THEN
      RAISE EXCEPTION 'Only a report marked inconclusive or false reporter can be resubmitted' USING ERRCODE = 'P0001';
    END IF;
    IF v_barangay.responded_by IS NOT NULL AND v_barangay.response_status = 'responding' THEN
      RAISE EXCEPTION 'Close the active responder assignment before resubmitting this report' USING ERRCODE = 'P0001';
    END IF;
    v_cycle := COALESCE(v_barangay.resubmission_count, 0) + 1;
    UPDATE public.barangay_reports SET
      type = CASE WHEN p_patch ? 'type' THEN p_patch->>'type' ELSE type END,
      title = CASE WHEN p_patch ? 'title' THEN p_patch->>'title' ELSE title END,
      specifics = CASE WHEN p_patch ? 'specifics' THEN p_patch->>'specifics' ELSE specifics END,
      description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description' ELSE description END,
      incident_type = CASE WHEN p_patch ? 'incident_type' THEN p_patch->>'incident_type' ELSE incident_type END,
      severity = CASE WHEN p_patch ? 'severity' THEN p_patch->>'severity' ELSE severity END,
      address = CASE WHEN p_patch ? 'address' THEN p_patch->>'address' ELSE address END,
      latitude = CASE WHEN p_patch ? 'latitude' THEN (p_patch->>'latitude')::DOUBLE PRECISION ELSE latitude END,
      longitude = CASE WHEN p_patch ? 'longitude' THEN (p_patch->>'longitude')::DOUBLE PRECISION ELSE longitude END,
      incident_occurred_at = CASE WHEN p_patch ? 'incident_occurred_at' THEN NULLIF(p_patch->>'incident_occurred_at', '')::TIMESTAMPTZ ELSE incident_occurred_at END,
      incident_time_precision = CASE WHEN p_patch ? 'incident_time_precision' THEN p_patch->>'incident_time_precision' ELSE incident_time_precision END,
      proof_urls = CASE WHEN p_patch ? 'proof_urls' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'proof_urls')) ELSE proof_urls END,
      proof_types = CASE WHEN p_patch ? 'proof_types' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'proof_types')) ELSE proof_types END,
      proof_url = CASE WHEN p_patch ? 'proof_urls' THEN
        CASE WHEN jsonb_array_length(p_patch->'proof_urls') > 1 THEN (p_patch->'proof_urls')::TEXT
          WHEN jsonb_array_length(p_patch->'proof_urls') = 1 THEN p_patch->'proof_urls'->>0 ELSE NULL END ELSE proof_url END,
      proof_type = CASE WHEN p_patch ? 'proof_types' AND jsonb_array_length(p_patch->'proof_types') > 0 THEN p_patch->'proof_types'->>0 ELSE proof_type END,
      evidence_status = CASE WHEN p_patch ? 'proof_urls' THEN 'ready' ELSE evidence_status END,
      response_status = 'pending',
      dispatcher_reviewed_at = NULL,
      dispatched_by = NULL,
      dispatched_at = NULL,
      accepted_at = NULL,
      arrived_at = NULL,
      responded_by = NULL,
      responded_at = NULL,
      resolved_at = NULL,
      resolved_by = NULL,
      resolved_notes = NULL,
      status = 'pending',
      review_outcome = NULL,
      review_reason = NULL,
      reviewed_by = NULL,
      reviewed_by_actor_id = NULL,
      reviewed_by_role = NULL,
      reviewed_at = NULL,
      resubmission_count = v_cycle,
      resubmitted_at = v_now,
      lifecycle_revision = COALESCE(lifecycle_revision, 0) + 1,
      lifecycle_actor_id = p_reporter_id,
      lifecycle_actor_role = p_reporter_type,
      updated_at = v_now
    WHERE id = v_barangay.id
    RETURNING * INTO v_barangay;
  END IF;

  INSERT INTO public.incident_report_review_history (
    report_id, lifecycle_cycle, event_type, actor_id, actor_role,
    false_report_review_count, request_id, created_at
  ) VALUES (
    p_report_id, v_cycle, 'resubmitted', p_reporter_id, p_reporter_type,
    COALESCE(v_mdrrmo.false_report_review_count, v_barangay.false_report_review_count, 0), p_request_id, v_now
  ) ON CONFLICT (report_id, lifecycle_cycle, event_type) DO NOTHING;

  IF v_is_mdrrmo THEN v_report := to_jsonb(v_mdrrmo); ELSE v_report := to_jsonb(v_barangay); END IF;
  RETURN jsonb_build_object(
    'report', v_report,
    'resubmission_count', v_cycle,
    'false_report_review_count', COALESCE(v_mdrrmo.false_report_review_count, v_barangay.false_report_review_count, 0),
    'already_resubmitted', FALSE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_false_report_review_count_on_response()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.false_report_review_count, 0) > 0 AND (
    (OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NOT NULL) OR
    (OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL) OR
    (OLD.response_status IS DISTINCT FROM 'responding' AND NEW.response_status = 'responding')
  ) THEN
    NEW.false_report_review_count := 0;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_mdrrmo_dispatch_against_barangay_assignment_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review_outcome TEXT;
BEGIN
  IF NEW.status IN ('assigned','responding') THEN
    SELECT review_outcome INTO v_review_outcome
      FROM public.mdrrmo_reports WHERE id = NEW.report_id FOR UPDATE;
    IF v_review_outcome IS NOT NULL THEN
      RAISE EXCEPTION 'A report marked for review cannot be dispatched until it is resubmitted' USING ERRCODE = '23514';
    END IF;
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

CREATE OR REPLACE FUNCTION public.guard_reviewed_report_from_barangay_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review_outcome TEXT;
  v_should_check BOOLEAN;
BEGIN
  v_should_check := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    v_should_check := OLD.assignment_status IS DISTINCT FROM 'active'
      OR NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at;
  END IF;
  IF NEW.assignment_status = 'active' AND v_should_check THEN
    SELECT review_outcome INTO v_review_outcome
      FROM public.mdrrmo_reports WHERE id = NEW.report_id FOR UPDATE;
    IF v_review_outcome IS NOT NULL THEN
      RAISE EXCEPTION 'A report marked for review cannot be dispatched until it is resubmitted' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mdrrmo_barangay_dispatch_review_guard ON public.mdrrmo_report_barangay_assignments;
CREATE TRIGGER mdrrmo_barangay_dispatch_review_guard
  BEFORE INSERT OR UPDATE OF assignment_status, dispatched_at ON public.mdrrmo_report_barangay_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_reviewed_report_from_barangay_dispatch();

CREATE OR REPLACE FUNCTION public.reset_false_report_review_count_on_barangay_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_barangay_report_id UUID;
  v_is_dispatch_event BOOLEAN;
BEGIN
  v_is_dispatch_event := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    v_is_dispatch_event := OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NOT NULL
      OR OLD.response_status IS DISTINCT FROM 'responding' AND NEW.response_status = 'responding';
  END IF;
  IF NEW.assignment_status = 'active' AND NEW.dispatched_at IS NOT NULL AND v_is_dispatch_event THEN
    UPDATE public.mdrrmo_reports
      SET false_report_review_count = 0
      WHERE id = NEW.report_id AND COALESCE(false_report_review_count, 0) > 0
      RETURNING source_barangay_report_id INTO v_source_barangay_report_id;
    IF v_source_barangay_report_id IS NULL THEN v_source_barangay_report_id := NEW.report_id; END IF;
    UPDATE public.barangay_reports
      SET false_report_review_count = 0
      WHERE id = v_source_barangay_report_id AND COALESCE(false_report_review_count, 0) > 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mdrrmo_barangay_dispatch_reset_false_count ON public.mdrrmo_report_barangay_assignments;
CREATE TRIGGER mdrrmo_barangay_dispatch_reset_false_count
  AFTER INSERT OR UPDATE OF dispatched_at, response_status, assignment_status ON public.mdrrmo_report_barangay_assignments
  FOR EACH ROW EXECUTE FUNCTION public.reset_false_report_review_count_on_barangay_dispatch();

DROP TRIGGER IF EXISTS mdrrmo_reports_reset_false_review_count ON public.mdrrmo_reports;
CREATE TRIGGER mdrrmo_reports_reset_false_review_count
  BEFORE UPDATE ON public.mdrrmo_reports
  FOR EACH ROW EXECUTE FUNCTION public.reset_false_report_review_count_on_response();

DROP TRIGGER IF EXISTS barangay_reports_reset_false_review_count ON public.barangay_reports;
CREATE TRIGGER barangay_reports_reset_false_review_count
  BEFORE UPDATE ON public.barangay_reports
  FOR EACH ROW EXECUTE FUNCTION public.reset_false_report_review_count_on_response();

REVOKE ALL ON FUNCTION public.record_canonical_incident_review(UUID, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_canonical_incident_review(UUID, TEXT, TEXT, UUID, TEXT) TO service_role;
DROP FUNCTION IF EXISTS public.resubmit_reviewed_incident_report(UUID, TEXT, UUID, TEXT, JSONB);
REVOKE ALL ON FUNCTION public.resubmit_reviewed_incident_report(UUID, TEXT, UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_reviewed_incident_report(UUID, TEXT, UUID, TEXT, JSONB, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.reset_false_report_review_count_on_response() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_incident_report_phone(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_reviewed_report_from_barangay_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_false_report_review_count_on_barangay_dispatch() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
