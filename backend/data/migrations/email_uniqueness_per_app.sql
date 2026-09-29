-- Enforce case-insensitive email uniqueness within each app's account table.
-- The same email may exist once in each of resident_user, barangay_users, and users.

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(btrim(email))
    FROM public.resident_user
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate resident_user emails found (case-insensitive). Resolve them before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT lower(btrim(email))
    FROM public.barangay_users
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate barangay_users emails found (case-insensitive). Resolve them before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT lower(btrim(email))
    FROM public.users
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate users emails found (case-insensitive). Resolve them before applying this migration.';
  END IF;

  IF to_regclass('public.barangay_dispatcher_verifications') IS NOT NULL AND EXISTS (
    SELECT lower(btrim(email))
    FROM public.barangay_dispatcher_verifications
    WHERE email IS NOT NULL AND btrim(email) <> '' AND status <> 'rejected'
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active dispatcher verification emails found. Resolve them before applying this migration.';
  END IF;
END $$;

UPDATE public.resident_user SET email = lower(btrim(email)) WHERE email IS NOT NULL;
UPDATE public.barangay_users SET email = lower(btrim(email)) WHERE email IS NOT NULL;
UPDATE public.users SET email = lower(btrim(email)) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS resident_user_email_ci_uidx
  ON public.resident_user (lower(btrim(email)))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS barangay_users_email_ci_uidx
  ON public.barangay_users (lower(btrim(email)))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_uidx
  ON public.users (lower(btrim(email)))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS barangay_dispatcher_verifications_email_active_ci_uidx
  ON public.barangay_dispatcher_verifications (lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '' AND status <> 'rejected';
