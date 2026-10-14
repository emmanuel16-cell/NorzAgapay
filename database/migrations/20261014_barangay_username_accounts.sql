-- Barangay team accounts created by barangay administrators use usernames and
-- do not need an email address. Keep legacy email-based accounts supported.
ALTER TABLE public.barangay_users
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.barangay_users
  ALTER COLUMN email DROP DEFAULT;

ALTER TABLE public.barangay_users
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS barangay_users_username_lower_unique_idx
  ON public.barangay_users (lower(username))
  WHERE username IS NOT NULL;
