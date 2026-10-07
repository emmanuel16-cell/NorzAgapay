-- Android push notifications for meaningful resident incident-report status changes.
-- Run after separate_report_tables_phase1.sql and resident_user_table_migration.sql.

ALTER TABLE public.barangay_reports
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.mdrrmo_reports
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.resident_push_tokens (
  fcm_token  TEXT PRIMARY KEY,
  resident_id UUID NOT NULL REFERENCES public.resident_user(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL CHECK (platform = 'android'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resident_push_tokens_resident_idx
  ON public.resident_push_tokens (resident_id);

ALTER TABLE public.resident_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.resident_push_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resident_push_tokens TO service_role;

CREATE TABLE IF NOT EXISTS public.resident_push_outbox (
  id               BIGSERIAL PRIMARY KEY,
  event_key        TEXT NOT NULL UNIQUE,
  report_id        UUID NOT NULL,
  resident_id      UUID NOT NULL REFERENCES public.resident_user(id) ON DELETE CASCADE,
  source_table     TEXT NOT NULL CHECK (source_table IN ('barangay_reports', 'mdrrmo_reports')),
  report_title     TEXT NOT NULL,
  display_status   TEXT NOT NULL,
  revision         BIGINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts         INTEGER NOT NULL DEFAULT 0,
  available_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until     TIMESTAMPTZ,
  delivered_tokens TEXT[] NOT NULL DEFAULT '{}',
  processed_at     TIMESTAMPTZ,
  last_error       TEXT
);

ALTER TABLE public.resident_push_outbox
  ADD COLUMN IF NOT EXISTS delivered_tokens TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS resident_push_outbox_pending_idx
  ON public.resident_push_outbox (available_at, id)
  WHERE processed_at IS NULL;

ALTER TABLE public.resident_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.resident_push_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.resident_push_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.resident_push_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_resident_report_status_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new JSONB := to_jsonb(NEW);
  v_old JSONB;
  v_source_type TEXT;
  v_escalated BOOLEAN;
  v_is_status_change BOOLEAN := FALSE;
  v_display_status TEXT;
  v_revision BIGINT;
  v_event_key TEXT;
BEGIN
  v_source_type := COALESCE(v_new->>'source_type', 'direct');
  v_escalated := COALESCE((v_new->>'escalated_to_mdrrmo')::BOOLEAN, FALSE);

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_is_status_change :=
      (v_new->>'status') IS DISTINCT FROM (v_old->>'status') OR
      (v_new->>'response_status') IS DISTINCT FROM (v_old->>'response_status') OR
      (v_new->>'review_outcome') IS DISTINCT FROM (v_old->>'review_outcome') OR
      (v_new->>'dispatcher_reviewed_at') IS DISTINCT FROM (v_old->>'dispatcher_reviewed_at') OR
      (v_new->>'dispatched_at') IS DISTINCT FROM (v_old->>'dispatched_at') OR
      (v_new->>'accepted_at') IS DISTINCT FROM (v_old->>'accepted_at') OR
      (v_new->>'arrived_at') IS DISTINCT FROM (v_old->>'arrived_at') OR
      (v_new->>'resolved_at') IS DISTINCT FROM (v_old->>'resolved_at') OR
      (v_new->>'source_type') IS DISTINCT FROM (v_old->>'source_type') OR
      (v_new->>'escalated_to_mdrrmo') IS DISTINCT FROM (v_old->>'escalated_to_mdrrmo');
  ELSIF TG_TABLE_NAME = 'mdrrmo_reports' AND v_source_type = 'escalated' THEN
    -- Escalation can be the first insert into mdrrmo_reports. Direct report
    -- creation is intentionally not a status push.
    v_is_status_change := TRUE;
  END IF;

  IF NOT v_is_status_change OR
     COALESCE(v_new->>'reporter_type', '') <> 'resident' OR
     NULLIF(v_new->>'reporter_id', '') IS NULL THEN
    RETURN NEW;
  END IF;

  -- Once a barangay report is escalated, its MDRRMO copy is the canonical
  -- lifecycle source. Suppress the paired barangay update to prevent a double push.
  IF TG_TABLE_NAME = 'barangay_reports' AND v_escalated THEN
    RETURN NEW;
  END IF;

  IF NULLIF(v_new->>'review_outcome', '') = 'inconclusive' THEN
    v_display_status := 'marked inconclusive';
  ELSIF NULLIF(v_new->>'review_outcome', '') = 'false_report' THEN
    v_display_status := 'marked as a false report';
  ELSIF NULLIF(v_new->>'resolved_at', '') IS NOT NULL OR
        lower(COALESCE(v_new->>'response_status', '')) IN ('resolved', 'closed') OR
        lower(COALESCE(v_new->>'status', '')) IN ('resolved', 'closed') THEN
    v_display_status := 'resolved';
  ELSIF NULLIF(v_new->>'arrived_at', '') IS NOT NULL THEN
    v_display_status := 'responder arrived';
  ELSIF NULLIF(v_new->>'accepted_at', '') IS NOT NULL THEN
    v_display_status := 'responder accepted';
  ELSIF NULLIF(v_new->>'dispatched_at', '') IS NOT NULL THEN
    v_display_status := 'responder dispatched';
  ELSIF NULLIF(v_new->>'dispatcher_reviewed_at', '') IS NOT NULL THEN
    v_display_status := 'under review';
  ELSIF v_source_type = 'escalated' OR v_escalated THEN
    v_display_status := 'now being handled by MDRRMO';
  ELSIF lower(COALESCE(v_new->>'response_status', '')) = 'responding' THEN
    v_display_status := 'responding';
  ELSE
    v_display_status := COALESCE(NULLIF(v_new->>'status', ''), 'updated');
  END IF;

  v_revision := COALESCE(NULLIF(v_new->>'lifecycle_revision', '')::BIGINT, 0);
  v_event_key := TG_TABLE_NAME || ':' || (v_new->>'id') || ':' || v_revision::TEXT;

  INSERT INTO public.resident_push_outbox (
    event_key, report_id, resident_id, source_table, report_title,
    display_status, revision
  ) VALUES (
    v_event_key,
    (v_new->>'id')::UUID,
    (v_new->>'reporter_id')::UUID,
    TG_TABLE_NAME,
    COALESCE(NULLIF(v_new->>'title', ''), 'Incident report'),
    v_display_status,
    v_revision
  ) ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS barangay_report_resident_status_push ON public.barangay_reports;
CREATE TRIGGER barangay_report_resident_status_push
  AFTER UPDATE ON public.barangay_reports
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_resident_report_status_push();

DROP TRIGGER IF EXISTS mdrrmo_report_resident_status_push ON public.mdrrmo_reports;
CREATE TRIGGER mdrrmo_report_resident_status_push
  AFTER INSERT OR UPDATE ON public.mdrrmo_reports
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_resident_report_status_push();

CREATE OR REPLACE FUNCTION public.claim_resident_push_outbox(p_batch_size INTEGER DEFAULT 25)
RETURNS SETOF public.resident_push_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '90 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.resident_push_outbox AS events
  SET locked_until = v_lock_until,
      attempts = events.attempts + 1
  WHERE events.id IN (
    SELECT pending.id
    FROM public.resident_push_outbox AS pending
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

REVOKE ALL ON FUNCTION public.claim_resident_push_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_resident_push_outbox(INTEGER) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'resident_push_outbox'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.resident_push_outbox;
  END IF;
END $$;
