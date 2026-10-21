BEGIN;

ALTER TABLE public.resource_requests
  ADD COLUMN IF NOT EXISTS dispatcher_notes TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
