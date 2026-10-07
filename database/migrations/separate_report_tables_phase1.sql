-- ============================================================
-- PHASE 1: SEPARATED REPORT TABLES MIGRATION
-- NorzAgapay — Barangay + MDRRMO Report Table Separation
-- 
-- Run in Supabase SQL Editor.
-- Safe to run while incident_reports still exists (additive only).
-- Old table and routes remain active until Phase 5.
-- ============================================================

-- Drop analytics view first so table column types can be altered without view dependency locks
DROP VIEW IF EXISTS public.v_all_reports CASCADE;

-- ============================================================
-- STEP 1: Create barangay_reports
-- ============================================================

CREATE TABLE IF NOT EXISTS public.barangay_reports (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core report metadata
  type                      TEXT NOT NULL DEFAULT 'emergency',
  title                     TEXT NOT NULL,
  specifics                 TEXT,
  description               TEXT,
  latitude                  DOUBLE PRECISION NOT NULL DEFAULT 0,
  longitude                 DOUBLE PRECISION NOT NULL DEFAULT 0,
  address                   TEXT,
  incident_occurred_at      TIMESTAMPTZ,
  incident_time_precision   TEXT NOT NULL DEFAULT 'unknown'
                              CHECK (incident_time_precision IN ('exact','approximate','unknown')),
  incident_type             TEXT,
  severity                  TEXT,

  -- Evidence
  proof_url                 TEXT,
  proof_urls                TEXT[] NOT NULL DEFAULT '{}',
  proof_type                TEXT NOT NULL DEFAULT 'image',
  proof_types               TEXT[] NOT NULL DEFAULT '{}',
  evidence_status           TEXT NOT NULL DEFAULT 'ready',
  responder_media           JSONB NOT NULL DEFAULT '[]',

  -- Reporter
  reporter_id               UUID REFERENCES public.resident_user(id) ON DELETE SET NULL,
  reporter_type             TEXT DEFAULT 'resident',
  reporter_name             TEXT,
  reporter_phone            TEXT,
  reporter_email            TEXT,

  -- Barangay routing
  barangay_id               UUID,

  -- Barangay lifecycle (clean column names, no prefix)
  response_status           TEXT NOT NULL DEFAULT 'pending'
                              CHECK (response_status IN ('pending','responding','resolved')),
  response_notes            TEXT,
  responder_name            TEXT,
  responded_by              UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  responded_at              TIMESTAMPTZ,

  -- Dispatcher timeline
  dispatcher_reviewed_by    UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  dispatcher_reviewed_at    TIMESTAMPTZ,
  dispatched_by             UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  dispatched_at             TIMESTAMPTZ,
  dispatch_notes            TEXT,

  -- Arrival
  accepted_at               TIMESTAMPTZ,
  arrived_at                TIMESTAMPTZ,
  arrival_recorded_at       TIMESTAMPTZ,
  arrival_method            TEXT,
  arrival_latitude          DOUBLE PRECISION,
  arrival_longitude         DOUBLE PRECISION,
  arrival_accuracy_m        DOUBLE PRECISION,
  arrival_distance_m        DOUBLE PRECISION,
  travel_distance_m         DOUBLE PRECISION,
  travel_distance_accuracy_m DOUBLE PRECISION,
  travel_distance_fix_at    TIMESTAMPTZ,

  -- Resolution
  resolved_at               TIMESTAMPTZ,
  resolved_by               UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  resolved_notes            TEXT,
  resolution_pdf_status     TEXT NOT NULL DEFAULT 'missing',
  resolution_pdf_path       TEXT,
  resolution_pdf_generated_at TIMESTAMPTZ,

  -- Dispatcher review / dismissal
  review_outcome            TEXT,
  review_reason             TEXT,
  reviewed_by               UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  reviewed_at               TIMESTAMPTZ,

  -- Escalation to MDRRMO
  escalated_to_mdrrmo       BOOLEAN NOT NULL DEFAULT false,
  escalated_at              TIMESTAMPTZ,
  mdrrmo_coordination_notes TEXT,

  -- Task linkage
  dispatch_incident_id      UUID,

  -- Lifecycle tracking
  lifecycle_revision        BIGINT NOT NULL DEFAULT 0,
  lifecycle_actor_id        UUID,
  lifecycle_actor_role      TEXT,
  client_request_id         UUID,
  client_submitted_at       TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all required columns exist in case barangay_reports already existed
ALTER TABLE public.barangay_reports
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'emergency',
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Incident Report',
  ADD COLUMN IF NOT EXISTS specifics TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS incident_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_time_precision TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS incident_type TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS proof_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS proof_type TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS proof_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS responder_media JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS reporter_id UUID,
  ADD COLUMN IF NOT EXISTS reporter_type TEXT DEFAULT 'resident',
  ADD COLUMN IF NOT EXISTS reporter_name TEXT,
  ADD COLUMN IF NOT EXISTS reporter_phone TEXT,
  ADD COLUMN IF NOT EXISTS reporter_email TEXT,
  ADD COLUMN IF NOT EXISTS barangay_id UUID,
  ADD COLUMN IF NOT EXISTS response_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS response_notes TEXT,
  ADD COLUMN IF NOT EXISTS responder_name TEXT,
  ADD COLUMN IF NOT EXISTS responded_by UUID,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_by UUID,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_notes TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_method TEXT,
  ADD COLUMN IF NOT EXISTS arrival_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS arrival_distance_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS travel_distance_fix_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID,
  ADD COLUMN IF NOT EXISTS resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_status TEXT NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS resolution_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_outcome TEXT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_to_mdrrmo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_coordination_notes TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_incident_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_role TEXT,
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS client_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Reconcile any pre-existing enum columns to TEXT safely
DO $$
BEGIN
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type TYPE TEXT USING type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type SET DEFAULT 'emergency'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_type TYPE TEXT USING incident_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type TYPE TEXT USING proof_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type SET DEFAULT 'image'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status TYPE TEXT USING evidence_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status SET DEFAULT 'ready'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type TYPE TEXT USING reporter_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type SET DEFAULT 'resident'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status TYPE TEXT USING resolution_pdf_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status SET DEFAULT 'missing'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision TYPE TEXT USING incident_time_precision::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision SET DEFAULT 'unknown'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS barangay_reports_client_request_id_uidx
  ON public.barangay_reports (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_barangay_reports_barangay_id
  ON public.barangay_reports (barangay_id, response_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_barangay_reports_created_at
  ON public.barangay_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_barangay_reports_response_status
  ON public.barangay_reports (response_status);

ALTER TABLE public.barangay_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.barangay_reports TO service_role;

-- ============================================================
-- STEP 2: Create barangay_report_assignments
-- ============================================================

CREATE TABLE IF NOT EXISTS public.barangay_report_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES public.barangay_reports(id) ON DELETE CASCADE,
  responder_id  UUID NOT NULL REFERENCES public.barangay_users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'team_leader',
  status        TEXT NOT NULL DEFAULT 'assigned'
                  CHECK (status IN ('assigned','responding','resolved','removed')),
  assigned_by   UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at   TIMESTAMPTZ,
  arrived_at    TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  removed_at    TIMESTAMPTZ,
  removed_by    UUID REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  UNIQUE (report_id, responder_id)
);

CREATE INDEX IF NOT EXISTS idx_barangay_report_assignments_responder
  ON public.barangay_report_assignments (responder_id, status, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_barangay_report_assignments_report
  ON public.barangay_report_assignments (report_id, status);

ALTER TABLE public.barangay_report_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_report_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.barangay_report_assignments TO service_role;

-- ============================================================
-- STEP 3: Create mdrrmo_reports
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mdrrmo_reports (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source tracking
  source_type                 TEXT NOT NULL DEFAULT 'direct'
                                CHECK (source_type IN ('direct','escalated')),
  source_barangay_report_id   UUID REFERENCES public.barangay_reports(id) ON DELETE SET NULL,

  -- Core report metadata
  type                        TEXT NOT NULL DEFAULT 'emergency',
  title                       TEXT NOT NULL,
  specifics                   TEXT,
  description                 TEXT,
  latitude                    DOUBLE PRECISION NOT NULL DEFAULT 0,
  longitude                   DOUBLE PRECISION NOT NULL DEFAULT 0,
  address                     TEXT,
  incident_occurred_at        TIMESTAMPTZ,
  incident_time_precision     TEXT NOT NULL DEFAULT 'unknown'
                                CHECK (incident_time_precision IN ('exact','approximate','unknown')),
  incident_type               TEXT,
  severity                    TEXT,

  -- Evidence
  proof_url                   TEXT,
  proof_urls                  TEXT[] NOT NULL DEFAULT '{}',
  proof_type                  TEXT NOT NULL DEFAULT 'image',
  proof_types                 TEXT[] NOT NULL DEFAULT '{}',
  evidence_status             TEXT NOT NULL DEFAULT 'ready',
  responder_media             JSONB NOT NULL DEFAULT '[]',

  -- Reporter (denormalized for display)
  reporter_id                 UUID,
  reporter_type               TEXT DEFAULT 'resident',
  reporter_name               TEXT,
  reporter_phone              TEXT,
  reporter_email              TEXT,

  -- Barangay context
  barangay_id                 UUID,
  barangay_name               TEXT,

  -- MDRRMO lifecycle (clean column names)
  response_status             TEXT NOT NULL DEFAULT 'pending'
                                CHECK (response_status IN ('pending','responding','resolved')),
  response_notes              TEXT,
  coordination_notes          TEXT,
  responder_name              TEXT,
  responded_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,
  responded_at                TIMESTAMPTZ,

  -- Dispatcher timeline
  dispatcher_reviewed_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  dispatcher_reviewed_at      TIMESTAMPTZ,
  dispatched_by               UUID REFERENCES public.users(id) ON DELETE SET NULL,
  dispatched_at               TIMESTAMPTZ,
  dispatch_notes              TEXT,

  -- Arrival (tracked per-assignment in mdrrmo_report_assignments)
  accepted_at                 TIMESTAMPTZ,
  arrived_at                  TIMESTAMPTZ,

  -- Resolution
  resolved_at                 TIMESTAMPTZ,
  resolved_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_notes              TEXT,
  resolution_pdf_status       TEXT NOT NULL DEFAULT 'missing',
  resolution_pdf_path         TEXT,
  resolution_pdf_generated_at TIMESTAMPTZ,

  -- Task linkage
  dispatch_incident_id        UUID,

  -- Lifecycle tracking
  lifecycle_revision          BIGINT NOT NULL DEFAULT 0,
  lifecycle_actor_id          UUID,
  lifecycle_actor_role        TEXT,
  client_request_id           UUID,
  client_submitted_at         TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all required columns exist in case mdrrmo_reports already existed
ALTER TABLE public.mdrrmo_reports
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS source_barangay_report_id UUID,
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'emergency',
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Incident Report',
  ADD COLUMN IF NOT EXISTS specifics TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS incident_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_time_precision TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS incident_type TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS proof_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS proof_type TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS proof_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS responder_media JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS reporter_id UUID,
  ADD COLUMN IF NOT EXISTS reporter_type TEXT DEFAULT 'resident',
  ADD COLUMN IF NOT EXISTS reporter_name TEXT,
  ADD COLUMN IF NOT EXISTS reporter_phone TEXT,
  ADD COLUMN IF NOT EXISTS reporter_email TEXT,
  ADD COLUMN IF NOT EXISTS barangay_id UUID,
  ADD COLUMN IF NOT EXISTS barangay_name TEXT,
  ADD COLUMN IF NOT EXISTS response_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS response_notes TEXT,
  ADD COLUMN IF NOT EXISTS coordination_notes TEXT,
  ADD COLUMN IF NOT EXISTS responder_name TEXT,
  ADD COLUMN IF NOT EXISTS responded_by UUID,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_by UUID,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_notes TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID,
  ADD COLUMN IF NOT EXISTS resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_status TEXT NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS resolution_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_incident_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_actor_role TEXT,
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS client_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Reconcile any pre-existing enum columns to TEXT safely
DO $$
BEGIN
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type TYPE TEXT USING type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type SET DEFAULT 'emergency'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_type TYPE TEXT USING incident_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type TYPE TEXT USING proof_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type SET DEFAULT 'image'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status TYPE TEXT USING evidence_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status SET DEFAULT 'ready'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type TYPE TEXT USING reporter_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type SET DEFAULT 'resident'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status TYPE TEXT USING resolution_pdf_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status SET DEFAULT 'missing'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type TYPE TEXT USING source_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type SET DEFAULT 'direct'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision TYPE TEXT USING incident_time_precision::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision SET DEFAULT 'unknown'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS mdrrmo_reports_client_request_id_uidx
  ON public.mdrrmo_reports (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mdrrmo_reports_response_status
  ON public.mdrrmo_reports (response_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mdrrmo_reports_created_at
  ON public.mdrrmo_reports (created_at DESC);

ALTER TABLE public.mdrrmo_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mdrrmo_reports TO service_role;

-- ============================================================
-- STEP 4: Lifecycle history tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.barangay_report_lifecycle_history (
  id          BIGSERIAL PRIMARY KEY,
  report_id   UUID NOT NULL REFERENCES public.barangay_reports(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  actor_id    UUID,
  actor_role  TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS barangay_report_lifecycle_history_report_idx
  ON public.barangay_report_lifecycle_history (report_id, occurred_at, id);

ALTER TABLE public.barangay_report_lifecycle_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_report_lifecycle_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.barangay_report_lifecycle_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.barangay_report_lifecycle_history_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_lifecycle_history (
  id          BIGSERIAL PRIMARY KEY,
  report_id   UUID NOT NULL REFERENCES public.mdrrmo_reports(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  actor_id    UUID,
  actor_role  TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS mdrrmo_report_lifecycle_history_report_idx
  ON public.mdrrmo_report_lifecycle_history (report_id, occurred_at, id);

ALTER TABLE public.mdrrmo_report_lifecycle_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_report_lifecycle_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.mdrrmo_report_lifecycle_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mdrrmo_report_lifecycle_history_id_seq TO service_role;

-- ============================================================
-- STEP 5: Event outbox tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.barangay_report_event_outbox (
  id           BIGSERIAL PRIMARY KEY,
  event_id     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  report_id    UUID NOT NULL REFERENCES public.barangay_reports(id) ON DELETE CASCADE,
  revision     BIGINT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error   TEXT,
  UNIQUE (report_id, revision)
);

CREATE INDEX IF NOT EXISTS barangay_report_event_outbox_pending_idx
  ON public.barangay_report_event_outbox (available_at, id)
  WHERE published_at IS NULL;

ALTER TABLE public.barangay_report_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_report_event_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.barangay_report_event_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.barangay_report_event_outbox_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_event_outbox (
  id           BIGSERIAL PRIMARY KEY,
  event_id     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  report_id    UUID NOT NULL REFERENCES public.mdrrmo_reports(id) ON DELETE CASCADE,
  revision     BIGINT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error   TEXT,
  UNIQUE (report_id, revision)
);

CREATE INDEX IF NOT EXISTS mdrrmo_report_event_outbox_pending_idx
  ON public.mdrrmo_report_event_outbox (available_at, id)
  WHERE published_at IS NULL;

ALTER TABLE public.mdrrmo_report_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_report_event_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mdrrmo_report_event_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mdrrmo_report_event_outbox_id_seq TO service_role;

-- ============================================================
-- STEP 6: Lifecycle revision triggers
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_barangay_report_lifecycle_revision()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  old_snap JSONB; new_snap JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.lifecycle_revision := GREATEST(COALESCE(NEW.lifecycle_revision, 0), 1);
    RETURN NEW;
  END IF;
  old_snap := to_jsonb(OLD) - ARRAY['lifecycle_revision','updated_at'];
  new_snap := to_jsonb(NEW) - ARRAY['lifecycle_revision','updated_at'];
  IF old_snap IS DISTINCT FROM new_snap THEN
    NEW.lifecycle_revision := COALESCE(OLD.lifecycle_revision, 0) + 1;
    NEW.updated_at := now();
    INSERT INTO public.barangay_report_event_outbox (report_id, revision, event_type, payload)
    VALUES (NEW.id, NEW.lifecycle_revision, 'barangay_report.updated', to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS barangay_report_lifecycle_revision_before_write ON public.barangay_reports;
CREATE TRIGGER barangay_report_lifecycle_revision_before_write
  BEFORE INSERT OR UPDATE ON public.barangay_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_barangay_report_lifecycle_revision();

CREATE OR REPLACE FUNCTION public.set_mdrrmo_report_lifecycle_revision()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  old_snap JSONB; new_snap JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.lifecycle_revision := GREATEST(COALESCE(NEW.lifecycle_revision, 0), 1);
    RETURN NEW;
  END IF;
  old_snap := to_jsonb(OLD) - ARRAY['lifecycle_revision','updated_at'];
  new_snap := to_jsonb(NEW) - ARRAY['lifecycle_revision','updated_at'];
  IF old_snap IS DISTINCT FROM new_snap THEN
    NEW.lifecycle_revision := COALESCE(OLD.lifecycle_revision, 0) + 1;
    NEW.updated_at := now();
    INSERT INTO public.mdrrmo_report_event_outbox (report_id, revision, event_type, payload)
    VALUES (NEW.id, NEW.lifecycle_revision, 'mdrrmo_report.updated', to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mdrrmo_report_lifecycle_revision_before_write ON public.mdrrmo_reports;
CREATE TRIGGER mdrrmo_report_lifecycle_revision_before_write
  BEFORE INSERT OR UPDATE ON public.mdrrmo_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_mdrrmo_report_lifecycle_revision();

-- ============================================================
-- STEP 7: Outbox claim RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_mdrrmo_report_event_outbox(p_batch_size INT DEFAULT 50)
RETURNS SETOF public.mdrrmo_report_event_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '60 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.mdrrmo_report_event_outbox
  SET locked_until = v_lock_until, attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM public.mdrrmo_report_event_outbox
    WHERE published_at IS NULL
      AND available_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY available_at, id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_mdrrmo_report_event_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.claim_barangay_report_event_outbox(p_batch_size INT DEFAULT 50)
RETURNS SETOF public.barangay_report_event_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '60 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.barangay_report_event_outbox
  SET locked_until = v_lock_until, attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM public.barangay_report_event_outbox
    WHERE published_at IS NULL
      AND available_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY available_at, id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_barangay_report_event_outbox TO service_role;

-- ============================================================
-- STEP 8: New MDRRMO RPC functions (_v2 suffix, new table target)
-- ============================================================

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

-- --

CREATE OR REPLACE FUNCTION public.accept_mdrrmo_report_v2(
  p_report_id    UUID,
  p_responder_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE public.mdrrmo_report_assignments SET
    status      = 'responding',
    accepted_at = v_now,
    accepted_by = p_responder_id
  WHERE report_id = p_report_id AND responder_id = p_responder_id AND status = 'assigned';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found or already accepted' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.mdrrmo_reports SET
    response_status      = 'responding',
    accepted_at          = v_now,
    lifecycle_actor_id   = p_responder_id,
    lifecycle_actor_role = 'responder'
  WHERE id = p_report_id AND response_status = 'pending';

  RETURN jsonb_build_object('accepted_at', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_mdrrmo_report_v2 TO service_role;

-- --

CREATE OR REPLACE FUNCTION public.record_mdrrmo_arrival_v2(
  p_report_id    UUID,
  p_responder_id UUID,
  p_arrived_at   TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_arrived_at, clock_timestamp());
BEGIN
  UPDATE public.mdrrmo_report_assignments SET
    arrived_at = v_now, arrived_by = p_responder_id
  WHERE report_id = p_report_id AND responder_id = p_responder_id
    AND status IN ('assigned','responding') AND arrived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found or arrival already recorded' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.mdrrmo_reports SET
    arrived_at = v_now, lifecycle_actor_id = p_responder_id, lifecycle_actor_role = 'responder'
  WHERE id = p_report_id AND arrived_at IS NULL;

  RETURN jsonb_build_object('arrived_at', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_mdrrmo_arrival_v2 TO service_role;

-- --

CREATE OR REPLACE FUNCTION public.append_mdrrmo_field_media_v2(
  p_report_id    UUID,
  p_responder_id UUID,
  p_media_items  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current JSONB;
BEGIN
  SELECT responder_media INTO v_current FROM public.mdrrmo_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MDRRMO report not found' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.mdrrmo_reports SET
    responder_media      = COALESCE(v_current,'[]'::jsonb) || p_media_items,
    lifecycle_actor_id   = p_responder_id,
    lifecycle_actor_role = 'responder'
  WHERE id = p_report_id;

  RETURN jsonb_build_object('appended', jsonb_array_length(p_media_items));
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_mdrrmo_field_media_v2 TO service_role;

-- --

CREATE OR REPLACE FUNCTION public.close_mdrrmo_report_v2(
  p_report_id        UUID,
  p_actor_id         UUID,
  p_actor_role       TEXT,
  p_resolution_notes TEXT,
  p_response_notes   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE public.mdrrmo_reports SET
    response_status      = 'resolved',
    resolved_at          = v_now,
    resolved_by          = p_actor_id,
    resolved_notes       = p_resolution_notes,
    response_notes       = COALESCE(p_response_notes, response_notes),
    lifecycle_actor_id   = p_actor_id,
    lifecycle_actor_role = p_actor_role
  WHERE id = p_report_id AND response_status IN ('pending','responding');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found or already resolved' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.mdrrmo_report_assignments SET
    status = 'resolved', resolved_at = v_now,
    resolved_by = p_actor_id, resolved_by_role = p_actor_role
  WHERE report_id = p_report_id AND status IN ('assigned','responding');

  RETURN jsonb_build_object('resolved_at', v_now);
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_mdrrmo_report_v2 TO service_role;

-- ============================================================
-- STEP 9: Barangay review RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.review_barangay_report(
  p_report_id UUID,
  p_actor_id  UUID,
  p_outcome   TEXT,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_outcome NOT IN ('approved','rejected','dismissed') THEN
    RAISE EXCEPTION 'Invalid review outcome' USING ERRCODE = '22023';
  END IF;

  UPDATE public.barangay_reports SET
    review_outcome       = p_outcome,
    review_reason        = p_reason,
    reviewed_by          = p_actor_id,
    reviewed_at          = v_now,
    lifecycle_actor_id   = p_actor_id,
    lifecycle_actor_role = 'dispatcher'
  WHERE id = p_report_id AND review_outcome IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found or already reviewed' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('reviewed_at', v_now, 'outcome', p_outcome);
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_barangay_report TO service_role;

-- ============================================================
-- STEP 10: Analytics UNION view
-- ============================================================

-- Drop view first so alter column types are never blocked by view dependencies
DROP VIEW IF EXISTS public.v_all_reports CASCADE;

-- Reconcile column types in case an older table had enum types
DO $$
BEGIN
  -- ── barangay_reports reconciliations ──
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type TYPE TEXT USING type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN type SET DEFAULT 'emergency'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_type TYPE TEXT USING incident_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type TYPE TEXT USING proof_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN proof_type SET DEFAULT 'image'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status TYPE TEXT USING evidence_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN evidence_status SET DEFAULT 'ready'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type TYPE TEXT USING reporter_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN reporter_type SET DEFAULT 'resident'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status TYPE TEXT USING resolution_pdf_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN resolution_pdf_status SET DEFAULT 'missing'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision TYPE TEXT USING incident_time_precision::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN incident_time_precision SET DEFAULT 'unknown'; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- ── mdrrmo_reports reconciliations ──
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type TYPE TEXT USING type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN type SET DEFAULT 'emergency'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_type TYPE TEXT USING incident_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type TYPE TEXT USING proof_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN proof_type SET DEFAULT 'image'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status TYPE TEXT USING evidence_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN evidence_status SET DEFAULT 'ready'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type TYPE TEXT USING reporter_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN reporter_type SET DEFAULT 'resident'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status TYPE TEXT USING resolution_pdf_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN resolution_pdf_status SET DEFAULT 'missing'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type TYPE TEXT USING source_type::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN source_type SET DEFAULT 'direct'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision TYPE TEXT USING incident_time_precision::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN incident_time_precision SET DEFAULT 'unknown'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

CREATE OR REPLACE VIEW public.v_all_reports AS
  SELECT
    id,
    'barangay'::TEXT                 AS table_source,
    type::TEXT                       AS type,
    title::TEXT                      AS title,
    specifics::TEXT                  AS specifics,
    description::TEXT                AS description,
    latitude::DOUBLE PRECISION       AS latitude,
    longitude::DOUBLE PRECISION      AS longitude,
    address::TEXT                    AS address,
    incident_occurred_at             AS incident_occurred_at,
    incident_type::TEXT              AS incident_type,
    severity::TEXT                   AS severity,
    reporter_name::TEXT              AS reporter_name,
    reporter_phone::TEXT             AS reporter_phone,
    barangay_id                      AS barangay_id,
    response_status::TEXT            AS barangay_response_status,
    NULL::TEXT                       AS mdrrmo_response_status,
    review_outcome::TEXT             AS review_outcome,
    escalated_to_mdrrmo::BOOLEAN     AS is_escalated,
    created_at                       AS created_at
  FROM public.barangay_reports

  UNION ALL

  SELECT
    id,
    'mdrrmo'::TEXT                   AS table_source,
    type::TEXT                       AS type,
    title::TEXT                      AS title,
    specifics::TEXT                  AS specifics,
    description::TEXT                AS description,
    latitude::DOUBLE PRECISION       AS latitude,
    longitude::DOUBLE PRECISION      AS longitude,
    address::TEXT                    AS address,
    incident_occurred_at             AS incident_occurred_at,
    incident_type::TEXT              AS incident_type,
    severity::TEXT                   AS severity,
    reporter_name::TEXT              AS reporter_name,
    reporter_phone::TEXT             AS reporter_phone,
    barangay_id                      AS barangay_id,
    NULL::TEXT                       AS barangay_response_status,
    response_status::TEXT            AS mdrrmo_response_status,
    NULL::TEXT                       AS review_outcome,
    (source_type = 'escalated')::BOOLEAN AS is_escalated,
    created_at                       AS created_at
  FROM public.mdrrmo_reports;

GRANT SELECT ON public.v_all_reports TO service_role;

-- ============================================================
-- STEP 11: Backfill from incident_reports
-- Safe & dynamic: introspects existing columns in incident_reports
-- and casts enums to TEXT to avoid any type/value mismatch.
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.has_col(p_col TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incident_reports' AND column_name = p_col
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.col_text(p_col TEXT, p_fallback TEXT DEFAULT 'NULL')
RETURNS TEXT AS $$
BEGIN
  IF pg_temp.has_col(p_col) THEN
    IF p_fallback IS NOT NULL AND p_fallback <> 'NULL' THEN
      RETURN 'COALESCE(' || quote_ident(p_col) || '::TEXT, ' || p_fallback || ')';
    ELSE
      RETURN quote_ident(p_col) || '::TEXT';
    END IF;
  ELSE
    RETURN p_fallback;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.col_raw(p_col TEXT, p_fallback TEXT DEFAULT 'NULL')
RETURNS TEXT AS $$
BEGIN
  IF pg_temp.has_col(p_col) THEN
    IF p_fallback IS NOT NULL AND p_fallback <> 'NULL' THEN
      RETURN 'COALESCE(' || quote_ident(p_col) || ', ' || p_fallback || ')';
    ELSE
      RETURN quote_ident(p_col);
    END IF;
  ELSE
    RETURN p_fallback;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.coalesce_text(p_cols TEXT[], p_fallback TEXT DEFAULT 'NULL')
RETURNS TEXT AS $$
DECLARE
  c TEXT;
  existing TEXT[] := '{}';
BEGIN
  FOREACH c IN ARRAY p_cols LOOP
    IF pg_temp.has_col(c) THEN
      existing := array_append(existing, quote_ident(c) || '::TEXT');
    END IF;
  END LOOP;

  IF array_length(existing, 1) > 0 THEN
    RETURN 'COALESCE(' || array_to_string(existing, ', ') || ', ' || p_fallback || ')';
  ELSE
    RETURN p_fallback;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.coalesce_raw(p_cols TEXT[], p_fallback TEXT DEFAULT 'NULL')
RETURNS TEXT AS $$
DECLARE
  c TEXT;
  existing TEXT[] := '{}';
BEGIN
  FOREACH c IN ARRAY p_cols LOOP
    IF pg_temp.has_col(c) THEN
      existing := array_append(existing, quote_ident(c));
    END IF;
  END LOOP;

  IF array_length(existing, 1) > 0 THEN
    RETURN 'COALESCE(' || array_to_string(existing, ', ') || ', ' || p_fallback || ')';
  ELSE
    RETURN p_fallback;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_sql TEXT;
BEGIN
  -- Reconcile any pre-existing enum columns to TEXT to guarantee insert compatibility
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.barangay_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN severity TYPE TEXT USING severity::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status DROP DEFAULT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status TYPE TEXT USING response_status::TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.mdrrmo_reports ALTER COLUMN response_status SET DEFAULT 'pending'; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- ── 1. Backfill barangay_reports ───────────────────────────────────────────
  v_sql := 'INSERT INTO public.barangay_reports (
      id, type, title, specifics, description,
      latitude, longitude, address,
      incident_occurred_at, incident_time_precision, incident_type, severity,
      proof_url, proof_urls, proof_type, proof_types, evidence_status, responder_media,
      reporter_id, reporter_type, reporter_name, reporter_phone, reporter_email,
      barangay_id,
      response_status, response_notes, responder_name, responded_by,
      dispatcher_reviewed_at, dispatched_at, accepted_at, arrived_at,
      travel_distance_m, travel_distance_accuracy_m, travel_distance_fix_at,
      arrival_recorded_at, arrival_method,
      arrival_latitude, arrival_longitude, arrival_accuracy_m, arrival_distance_m,
      resolved_at, resolved_notes,
      resolution_pdf_status, resolution_pdf_path, resolution_pdf_generated_at,
      review_outcome, review_reason, reviewed_by, reviewed_at,
      escalated_to_mdrrmo, mdrrmo_coordination_notes,
      dispatch_incident_id,
      lifecycle_revision, lifecycle_actor_id, lifecycle_actor_role,
      client_request_id, client_submitted_at, created_at
    )
    SELECT
      id, '
      || pg_temp.col_text('type', '''emergency''') || ', '
      || pg_temp.col_text('title', '''Incident Report''') || ', '
      || pg_temp.col_text('specifics', 'NULL::TEXT') || ', '
      || pg_temp.col_text('description', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('latitude', '0::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('longitude', '0::DOUBLE PRECISION') || ', '
      || pg_temp.col_text('address', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('incident_occurred_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('incident_time_precision', '''unknown''') || ', '
      || pg_temp.col_text('incident_type', 'NULL::TEXT') || ', '
      || pg_temp.col_text('severity', 'NULL::TEXT') || ', '
      || pg_temp.col_text('proof_url', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('proof_urls', 'ARRAY[]::TEXT[]') || ', '
      || pg_temp.col_text('proof_type', '''image''') || ', '
      || pg_temp.col_raw('proof_types', 'ARRAY[]::TEXT[]') || ', '
      || pg_temp.col_text('evidence_status', '''ready''') || ', '
      || pg_temp.col_raw('responder_media', '''[]''::JSONB') || ', '
      || pg_temp.col_raw('reporter_id', 'NULL::UUID') || ', '
      || pg_temp.col_text('reporter_type', '''resident''') || ', '
      || pg_temp.col_text('reporter_name', 'NULL::TEXT') || ', '
      || pg_temp.col_text('reporter_phone', 'NULL::TEXT') || ', '
      || pg_temp.col_text('reporter_email', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('barangay_id', 'NULL::UUID') || ', '
      || 'CASE
        WHEN lower(COALESCE(' || pg_temp.col_text('barangay_response_status', '''pending''') || ', ''pending'')) IN (''responding'', ''in_progress'') THEN ''responding''
        WHEN lower(COALESCE(' || pg_temp.col_text('barangay_response_status', '''pending''') || ', ''pending'')) IN (''resolved'', ''completed'') THEN ''resolved''
        ELSE ''pending''
      END, '
      || pg_temp.col_text('barangay_response_notes', 'NULL::TEXT') || ', '
      || pg_temp.col_text('barangay_responder_name', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('barangay_responded_by', 'NULL::UUID') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_dispatcher_reviewed_at', 'dispatcher_reviewed_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_dispatched_at', 'dispatched_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_accepted_at', 'accepted_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_arrived_at', 'arrived_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_raw('travel_distance_m', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('travel_distance_accuracy_m', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('travel_distance_fix_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_raw('arrival_recorded_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('arrival_method', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('arrival_latitude', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('arrival_longitude', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('arrival_accuracy_m', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('arrival_distance_m', 'NULL::DOUBLE PRECISION') || ', '
      || pg_temp.coalesce_raw(ARRAY['barangay_resolved_at', 'resolved_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_text(ARRAY['barangay_resolved_notes', 'resolved_notes'], 'NULL::TEXT') || ', '
      || pg_temp.col_text('resolution_pdf_status', '''missing''') || ', '
      || pg_temp.col_text('resolution_pdf_path', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('resolution_pdf_generated_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('review_outcome', 'NULL::TEXT') || ', '
      || pg_temp.col_text('review_reason', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('reviewed_by', 'NULL::UUID') || ', '
      || pg_temp.col_raw('reviewed_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['is_escalated', 'beyond_barangay_capability'], 'false') || ', '
      || pg_temp.col_text('mdrrmo_coordination_notes', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('dispatch_incident_id', 'NULL::UUID') || ', '
      || pg_temp.col_raw('lifecycle_revision', '0') || ', '
      || pg_temp.col_raw('lifecycle_actor_id', 'NULL::UUID') || ', '
      || pg_temp.col_text('lifecycle_actor_role', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('client_request_id', 'NULL::UUID') || ', '
      || pg_temp.col_raw('client_submitted_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_raw('created_at', 'now()')
      || ' FROM public.incident_reports
         WHERE ' || CASE
           WHEN pg_temp.has_col('send_to') THEN '(send_to::TEXT IN (''barangay'', ''all'') OR send_to IS NULL)'
           ELSE 'TRUE'
         END || '
         ON CONFLICT (id) DO NOTHING;';

  EXECUTE v_sql;
  RAISE NOTICE 'barangay_reports backfill executed successfully.';

  -- ── 2. Backfill mdrrmo_reports ─────────────────────────────────────────────
  v_sql := 'INSERT INTO public.mdrrmo_reports (
      id, source_type,
      type, title, specifics, description,
      latitude, longitude, address,
      incident_occurred_at, incident_time_precision, incident_type, severity,
      proof_url, proof_urls, proof_type, proof_types, evidence_status, responder_media,
      reporter_id, reporter_type, reporter_name, reporter_phone, reporter_email,
      barangay_id,
      response_status, response_notes, coordination_notes,
      responder_name, responded_by,
      dispatched_at, dispatch_notes, accepted_at, arrived_at,
      resolved_at, resolved_notes,
      resolution_pdf_status, resolution_pdf_path, resolution_pdf_generated_at,
      dispatch_incident_id,
      lifecycle_revision, lifecycle_actor_id, lifecycle_actor_role,
      client_request_id, client_submitted_at, created_at
    )
    SELECT
      id,
      CASE
        WHEN ' ||
          CASE WHEN pg_temp.has_col('status') THEN 'status::TEXT = ''escalated''' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('is_escalated') THEN 'COALESCE(is_escalated, false) = true' ELSE 'FALSE' END || '
          OR ' ||
          CASE WHEN pg_temp.has_col('beyond_barangay_capability') THEN 'COALESCE(beyond_barangay_capability, false) = true' ELSE 'FALSE' END || '
        THEN ''escalated'' ELSE ''direct''
      END, '
      || pg_temp.col_text('type', '''emergency''') || ', '
      || pg_temp.col_text('title', '''Incident Report''') || ', '
      || pg_temp.col_text('specifics', 'NULL::TEXT') || ', '
      || pg_temp.col_text('description', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('latitude', '0::DOUBLE PRECISION') || ', '
      || pg_temp.col_raw('longitude', '0::DOUBLE PRECISION') || ', '
      || pg_temp.col_text('address', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('incident_occurred_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('incident_time_precision', '''unknown''') || ', '
      || pg_temp.col_text('incident_type', 'NULL::TEXT') || ', '
      || pg_temp.col_text('severity', 'NULL::TEXT') || ', '
      || pg_temp.col_text('proof_url', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('proof_urls', 'ARRAY[]::TEXT[]') || ', '
      || pg_temp.col_text('proof_type', '''image''') || ', '
      || pg_temp.col_raw('proof_types', 'ARRAY[]::TEXT[]') || ', '
      || pg_temp.col_text('evidence_status', '''ready''') || ', '
      || pg_temp.col_raw('responder_media', '''[]''::JSONB') || ', '
      || pg_temp.col_raw('reporter_id', 'NULL::UUID') || ', '
      || pg_temp.col_text('reporter_type', '''resident''') || ', '
      || pg_temp.col_text('reporter_name', 'NULL::TEXT') || ', '
      || pg_temp.col_text('reporter_phone', 'NULL::TEXT') || ', '
      || pg_temp.col_text('reporter_email', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('barangay_id', 'NULL::UUID') || ', '
      || 'CASE
        WHEN lower(COALESCE(' || pg_temp.col_text('mdrrmo_response_status', '''pending''') || ', ''pending'')) IN (''responding'', ''in_progress'') THEN ''responding''
        WHEN lower(COALESCE(' || pg_temp.col_text('mdrrmo_response_status', '''pending''') || ', ''pending'')) IN (''resolved'', ''completed'') THEN ''resolved''
        ELSE ''pending''
      END, '
      || pg_temp.col_text('mdrrmo_response_notes', 'NULL::TEXT') || ', '
      || pg_temp.col_text('mdrrmo_coordination_notes', 'NULL::TEXT') || ', '
      || pg_temp.col_text('mdrrmo_responder_name', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('mdrrmo_responded_by', 'NULL::UUID') || ', '
      || pg_temp.coalesce_raw(ARRAY['mdrrmo_dispatched_at', 'dispatched_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_text('mdrrmo_dispatch_notes', 'NULL::TEXT') || ', '
      || pg_temp.coalesce_raw(ARRAY['mdrrmo_accepted_at', 'accepted_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['mdrrmo_arrived_at', 'arrived_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_raw(ARRAY['mdrrmo_resolved_at', 'resolved_at'], 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.coalesce_text(ARRAY['mdrrmo_resolved_notes', 'resolved_notes'], 'NULL::TEXT') || ', '
      || pg_temp.col_text('resolution_pdf_status', '''missing''') || ', '
      || pg_temp.col_text('resolution_pdf_path', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('resolution_pdf_generated_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_raw('dispatch_incident_id', 'NULL::UUID') || ', '
      || pg_temp.col_raw('lifecycle_revision', '0') || ', '
      || pg_temp.col_raw('lifecycle_actor_id', 'NULL::UUID') || ', '
      || pg_temp.col_text('lifecycle_actor_role', 'NULL::TEXT') || ', '
      || pg_temp.col_raw('client_request_id', 'NULL::UUID') || ', '
      || pg_temp.col_raw('client_submitted_at', 'NULL::TIMESTAMPTZ') || ', '
      || pg_temp.col_raw('created_at', 'now()')
      || ' FROM public.incident_reports
         WHERE (' ||
           CASE WHEN pg_temp.has_col('send_to') THEN 'send_to::TEXT = ''mdrrmo''' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('type') THEN 'type::TEXT = ''emergency''' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('status') THEN 'status::TEXT = ''escalated''' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('is_escalated') THEN 'COALESCE(is_escalated, false) = true' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('beyond_barangay_capability') THEN 'COALESCE(beyond_barangay_capability, false) = true' ELSE 'FALSE' END || '
           OR ' ||
           CASE WHEN pg_temp.has_col('mdrrmo_response_status') THEN 'mdrrmo_response_status::TEXT IN (''responding'', ''resolved'')' ELSE 'FALSE' END || '
         )
         ON CONFLICT (id) DO NOTHING;';

  EXECUTE v_sql;
  RAISE NOTICE 'mdrrmo_reports backfill executed successfully.';

  -- Wire escalated mdrrmo_reports back to their barangay source
  UPDATE public.mdrrmo_reports mr
  SET source_barangay_report_id = br.id
  FROM public.barangay_reports br
  WHERE mr.id = br.id
    AND mr.source_type = 'escalated'
    AND mr.source_barangay_report_id IS NULL;

  RAISE NOTICE 'Source backlink wiring completed.';
END;
$$;

-- Clean up temporary helper functions
DROP FUNCTION IF EXISTS pg_temp.has_col(TEXT);
DROP FUNCTION IF EXISTS pg_temp.col_text(TEXT, TEXT);
DROP FUNCTION IF EXISTS pg_temp.col_raw(TEXT, TEXT);
DROP FUNCTION IF EXISTS pg_temp.coalesce_text(TEXT[], TEXT);
DROP FUNCTION IF EXISTS pg_temp.coalesce_raw(TEXT[], TEXT);

-- Verify row counts
SELECT 'incident_reports (old)' AS table_name, count(*) AS total_rows FROM public.incident_reports
UNION ALL SELECT 'barangay_reports (new)', count(*) FROM public.barangay_reports
UNION ALL SELECT 'mdrrmo_reports (new)',   count(*) FROM public.mdrrmo_reports;
