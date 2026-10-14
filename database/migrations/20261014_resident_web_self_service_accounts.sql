-- Allow residents to create and access web accounts using a username and
-- verified mobile number without providing an email address.
ALTER TABLE public.resident_user
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.resident_user
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS resident_user_username_lower_unique_idx
  ON public.resident_user (lower(username))
  WHERE username IS NOT NULL;
