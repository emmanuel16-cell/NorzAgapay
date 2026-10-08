-- Record completion of MDRRMO dispatcher review when the report is dispatched.
-- Existing dispatched reports are backfilled from their dispatch timestamp.

BEGIN;

ALTER TABLE public.mdrrmo_reports
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatcher_reviewed_at TIMESTAMPTZ;

UPDATE public.mdrrmo_reports
SET dispatcher_reviewed_by = COALESCE(dispatcher_reviewed_by, dispatched_by),
    dispatcher_reviewed_at = COALESCE(dispatcher_reviewed_at, dispatched_at)
WHERE dispatched_at IS NOT NULL
  AND (dispatcher_reviewed_at IS NULL OR dispatcher_reviewed_by IS NULL);

CREATE OR REPLACE FUNCTION public.capture_mdrrmo_dispatch_review_time()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.dispatched_at IS NOT NULL
     AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN
    NEW.dispatcher_reviewed_by := NEW.dispatched_by;
    NEW.dispatcher_reviewed_at := NEW.dispatched_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mdrrmo_dispatch_review_time_before_update ON public.mdrrmo_reports;
CREATE TRIGGER mdrrmo_dispatch_review_time_before_update
  BEFORE UPDATE OF dispatched_at ON public.mdrrmo_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_mdrrmo_dispatch_review_time();

NOTIFY pgrst, 'reload schema';

COMMIT;
