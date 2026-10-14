-- Let MDRRMO dashboard accounts sign in with a unique username and no email.
ALTER TABLE public.users
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique_idx
  ON public.users (lower(username))
  WHERE username IS NOT NULL;
