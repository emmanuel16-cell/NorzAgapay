-- Dispatcher push notifications for new resident reports.
-- Run in the Supabase SQL editor after separate_report_tables_phase1.sql.

CREATE TABLE IF NOT EXISTS public.dispatcher_push_tokens (
  fcm_token   TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.barangay_users(id) ON DELETE CASCADE,
  barangay_id UUID NOT NULL,
  platform    TEXT NOT NULL CHECK (platform = 'android'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatcher_push_tokens_barangay_idx
  ON public.dispatcher_push_tokens (barangay_id, user_id);

ALTER TABLE public.dispatcher_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dispatcher_push_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dispatcher_push_tokens TO service_role;

CREATE TABLE IF NOT EXISTS public.dispatcher_push_outbox (
  id           BIGSERIAL PRIMARY KEY,
  report_id    UUID NOT NULL UNIQUE REFERENCES public.barangay_reports(id) ON DELETE CASCADE,
  barangay_id  UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER NOT NULL DEFAULT 0,
  delivered_tokens TEXT[] NOT NULL DEFAULT '{}',
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error   TEXT
);

ALTER TABLE public.dispatcher_push_outbox
  ADD COLUMN IF NOT EXISTS delivered_tokens TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS dispatcher_push_outbox_pending_idx
  ON public.dispatcher_push_outbox (available_at, id)
  WHERE processed_at IS NULL;

ALTER TABLE public.dispatcher_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dispatcher_push_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dispatcher_push_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dispatcher_push_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_dispatcher_report_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reporter_type = 'resident' AND NEW.barangay_id IS NOT NULL THEN
    INSERT INTO public.dispatcher_push_outbox (report_id, barangay_id)
    VALUES (NEW.id, NEW.barangay_id)
    ON CONFLICT (report_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS barangay_report_push_after_insert ON public.barangay_reports;
CREATE TRIGGER barangay_report_push_after_insert
  AFTER INSERT ON public.barangay_reports
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_dispatcher_report_push();

CREATE OR REPLACE FUNCTION public.claim_dispatcher_push_outbox(p_batch_size INTEGER DEFAULT 25)
RETURNS SETOF public.dispatcher_push_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_until TIMESTAMPTZ := now() + interval '90 seconds';
BEGIN
  RETURN QUERY
  UPDATE public.dispatcher_push_outbox AS events
  SET locked_until = v_lock_until,
      attempts = events.attempts + 1
  WHERE events.id IN (
    SELECT pending.id
    FROM public.dispatcher_push_outbox AS pending
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

REVOKE ALL ON FUNCTION public.claim_dispatcher_push_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dispatcher_push_outbox(INTEGER) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'dispatcher_push_outbox'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatcher_push_outbox;
  END IF;
END $$;
