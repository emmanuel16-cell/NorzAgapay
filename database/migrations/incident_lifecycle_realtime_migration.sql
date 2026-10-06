-- Durable, ordered lifecycle events for report changes. The trigger writes the
-- outbox row in the same transaction as the incident_reports change.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS client_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incident_time_precision TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'incident_reports_time_precision_check'
      AND conrelid = 'public.incident_reports'::regclass
  ) THEN
    ALTER TABLE public.incident_reports
      ADD CONSTRAINT incident_reports_time_precision_check
      CHECK (incident_time_precision IN ('exact', 'approximate', 'unknown'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS incident_reports_client_request_id_uidx
  ON public.incident_reports (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.incident_event_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE (report_id, revision)
);

CREATE INDEX IF NOT EXISTS incident_event_outbox_pending_idx
  ON public.incident_event_outbox (available_at, id)
  WHERE published_at IS NULL;

ALTER TABLE public.incident_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.incident_event_outbox FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_incident_lifecycle_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_lifecycle JSONB;
  new_lifecycle JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.lifecycle_revision := GREATEST(COALESCE(NEW.lifecycle_revision, 0), 1);
    RETURN NEW;
  END IF;

  old_lifecycle := jsonb_build_object(
    'status', to_jsonb(OLD)->'status',
    'incident_occurred_at', to_jsonb(OLD)->'incident_occurred_at',
    'incident_time_precision', to_jsonb(OLD)->'incident_time_precision',
    'incident_type', to_jsonb(OLD)->'incident_type',
    'severity', to_jsonb(OLD)->'severity',
    'review_outcome', to_jsonb(OLD)->'review_outcome',
    'dispatcher_reviewed_at', to_jsonb(OLD)->'dispatcher_reviewed_at',
    'barangay_response_status', to_jsonb(OLD)->'barangay_response_status',
    'barangay_response_notes', to_jsonb(OLD)->'barangay_response_notes',
    'barangay_responder_name', to_jsonb(OLD)->'barangay_responder_name',
    'barangay_responded_by', to_jsonb(OLD)->'barangay_responded_by',
    'mdrrmo_response_status', to_jsonb(OLD)->'mdrrmo_response_status',
    'mdrrmo_response_notes', to_jsonb(OLD)->'mdrrmo_response_notes',
    'mdrrmo_dispatch_notes', to_jsonb(OLD)->'mdrrmo_dispatch_notes',
    'mdrrmo_responder_name', to_jsonb(OLD)->'mdrrmo_responder_name',
    'mdrrmo_responded_by', to_jsonb(OLD)->'mdrrmo_responded_by',
    'send_to', to_jsonb(OLD)->'send_to',
    'dispatch_incident_id', to_jsonb(OLD)->'dispatch_incident_id',
    'dispatched_at', to_jsonb(OLD)->'dispatched_at',
    'accepted_at', to_jsonb(OLD)->'accepted_at',
    'arrived_at', to_jsonb(OLD)->'arrived_at',
    'resolved_at', to_jsonb(OLD)->'resolved_at',
    'evidence_status', to_jsonb(OLD)->'evidence_status',
    'responder_media', to_jsonb(OLD)->'responder_media'
  );
  new_lifecycle := jsonb_build_object(
    'status', to_jsonb(NEW)->'status',
    'incident_occurred_at', to_jsonb(NEW)->'incident_occurred_at',
    'incident_time_precision', to_jsonb(NEW)->'incident_time_precision',
    'incident_type', to_jsonb(NEW)->'incident_type',
    'severity', to_jsonb(NEW)->'severity',
    'review_outcome', to_jsonb(NEW)->'review_outcome',
    'dispatcher_reviewed_at', to_jsonb(NEW)->'dispatcher_reviewed_at',
    'barangay_response_status', to_jsonb(NEW)->'barangay_response_status',
    'barangay_response_notes', to_jsonb(NEW)->'barangay_response_notes',
    'barangay_responder_name', to_jsonb(NEW)->'barangay_responder_name',
    'barangay_responded_by', to_jsonb(NEW)->'barangay_responded_by',
    'mdrrmo_response_status', to_jsonb(NEW)->'mdrrmo_response_status',
    'mdrrmo_response_notes', to_jsonb(NEW)->'mdrrmo_response_notes',
    'mdrrmo_dispatch_notes', to_jsonb(NEW)->'mdrrmo_dispatch_notes',
    'mdrrmo_responder_name', to_jsonb(NEW)->'mdrrmo_responder_name',
    'mdrrmo_responded_by', to_jsonb(NEW)->'mdrrmo_responded_by',
    'send_to', to_jsonb(NEW)->'send_to',
    'dispatch_incident_id', to_jsonb(NEW)->'dispatch_incident_id',
    'dispatched_at', to_jsonb(NEW)->'dispatched_at',
    'accepted_at', to_jsonb(NEW)->'accepted_at',
    'arrived_at', to_jsonb(NEW)->'arrived_at',
    'resolved_at', to_jsonb(NEW)->'resolved_at',
    'evidence_status', to_jsonb(NEW)->'evidence_status',
    'responder_media', to_jsonb(NEW)->'responder_media'
  );

  IF old_lifecycle IS DISTINCT FROM new_lifecycle THEN
    NEW.lifecycle_revision := COALESCE(OLD.lifecycle_revision, 0) + 1;
  ELSE
    NEW.lifecycle_revision := COALESCE(OLD.lifecycle_revision, 0);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_incident_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  event_payload JSONB;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.lifecycle_revision = OLD.lifecycle_revision THEN
    RETURN NEW;
  END IF;

  event_payload := jsonb_build_object(
    'status', to_jsonb(NEW)->'status',
    'incident_occurred_at', to_jsonb(NEW)->'incident_occurred_at',
    'incident_time_precision', to_jsonb(NEW)->'incident_time_precision',
    'created_at', to_jsonb(NEW)->'created_at',
    'review_outcome', to_jsonb(NEW)->'review_outcome',
    'barangay_response_status', to_jsonb(NEW)->'barangay_response_status',
    'mdrrmo_response_status', to_jsonb(NEW)->'mdrrmo_response_status',
    'dispatch_incident_id', to_jsonb(NEW)->'dispatch_incident_id',
    'send_to', to_jsonb(NEW)->'send_to',
    'dispatched_at', to_jsonb(NEW)->'dispatched_at',
    'accepted_at', to_jsonb(NEW)->'accepted_at',
    'arrived_at', to_jsonb(NEW)->'arrived_at',
    'resolved_at', to_jsonb(NEW)->'resolved_at',
    'evidence_status', to_jsonb(NEW)->'evidence_status',
    'updated_at', to_jsonb(NEW)->'updated_at'
  );

  INSERT INTO public.incident_event_outbox
    (report_id, revision, event_type, payload)
  VALUES
    (NEW.id, NEW.lifecycle_revision,
     CASE WHEN TG_OP = 'INSERT' THEN 'incident.created' ELSE 'incident.lifecycle_changed' END,
     event_payload)
  ON CONFLICT (report_id, revision) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incident_lifecycle_revision_before_write ON public.incident_reports;
CREATE TRIGGER incident_lifecycle_revision_before_write
  BEFORE INSERT OR UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_incident_lifecycle_revision();

DROP TRIGGER IF EXISTS incident_lifecycle_outbox_after_write ON public.incident_reports;
CREATE TRIGGER incident_lifecycle_outbox_after_write
  AFTER INSERT OR UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_incident_lifecycle_event();

-- Multiple backend instances can safely claim separate rows. Failed publishes
-- are released with a delay by the application and become claimable again.
CREATE OR REPLACE FUNCTION public.claim_incident_event_outbox(p_batch_size INTEGER DEFAULT 50)
RETURNS SETOF public.incident_event_outbox
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.incident_event_outbox
    WHERE published_at IS NULL
      AND available_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY id
    LIMIT LEAST(GREATEST(p_batch_size, 1), 200)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.incident_event_outbox AS events
  SET locked_until = now() + interval '30 seconds',
      attempts = events.attempts + 1
  FROM candidates
  WHERE events.id = candidates.id
  RETURNING events.*;
$$;

REVOKE ALL ON FUNCTION public.claim_incident_event_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_incident_event_outbox(INTEGER) TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.incident_event_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.incident_event_outbox_id_seq TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'incident_event_outbox'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.incident_event_outbox;
  END IF;
END;
$$;
