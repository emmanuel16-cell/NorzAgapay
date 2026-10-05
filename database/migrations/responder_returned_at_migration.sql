-- Track the responder's return-to-base completion separately from on-scene resolution.
-- Run this migration in Supabase before deploying the updated API/mobile app.

ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'returning';

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS returning_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

-- Do not backfill returned_at from completed_at. Historical completed_at values
-- represent the old on-scene completion action, not a confirmed return to base.
