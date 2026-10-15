-- Enforce case-insensitive username uniqueness across MDRRMO, barangay, and
-- resident accounts. Run 20261015_account_username_uniqueness_preflight.sql
-- first and resolve invalid usernames or duplicates before applying this migration.
-- Username-less legacy accounts may remain until an account owner sets one.

-- Prevent account writes between the collision check, backfill, and trigger
-- installation so every new username is covered by the registry on commit.
LOCK TABLE public.users, public.barangay_users, public.resident_user
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    WITH usernames AS (
      SELECT lower(btrim(username)) AS username_normalized FROM public.users WHERE nullif(btrim(username), '') IS NOT NULL
      UNION ALL
      SELECT lower(btrim(username)) FROM public.barangay_users WHERE nullif(btrim(username), '') IS NOT NULL
      UNION ALL
      SELECT lower(btrim(username)) FROM public.resident_user WHERE nullif(btrim(username), '') IS NOT NULL
    )
    SELECT 1 FROM usernames GROUP BY username_normalized HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Global username registry migration stopped: cross-account username collisions exist. Run 20261015_account_username_uniqueness_preflight.sql and resolve them first.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE nullif(btrim(username), '') IS NOT NULL AND lower(btrim(username)) !~ '^[a-z0-9_.-]{3,32}$'
    UNION ALL
    SELECT 1 FROM public.barangay_users
    WHERE nullif(btrim(username), '') IS NOT NULL AND lower(btrim(username)) !~ '^[a-z0-9_.-]{3,32}$'
    UNION ALL
    SELECT 1 FROM public.resident_user
    WHERE nullif(btrim(username), '') IS NOT NULL AND lower(btrim(username)) !~ '^[a-z0-9_.-]{3,32}$'
  ) THEN
    RAISE EXCEPTION 'Global username registry migration stopped: existing usernames outside the supported 3–32 character format exist. Run 20261015_account_username_uniqueness_preflight.sql and resolve them first.';
  END IF;
END;
$$;

-- Canonicalize existing values after the collision guard. Login lookups are
-- case-insensitive at the UI/API boundary, so stored names must use the same
-- trimmed lowercase representation.
UPDATE public.users
SET username = lower(nullif(btrim(username), ''))
WHERE username IS DISTINCT FROM lower(nullif(btrim(username), ''));

UPDATE public.barangay_users
SET username = lower(nullif(btrim(username), ''))
WHERE username IS DISTINCT FROM lower(nullif(btrim(username), ''));

UPDATE public.resident_user
SET username = lower(nullif(btrim(username), ''))
WHERE username IS DISTINCT FROM lower(nullif(btrim(username), ''));

CREATE TABLE IF NOT EXISTS public.account_usernames (
  username_normalized TEXT PRIMARY KEY,
  account_table TEXT NOT NULL CHECK (account_table IN ('users', 'barangay_users', 'resident_user')),
  account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_usernames_account_unique UNIQUE (account_table, account_id)
);

ALTER TABLE public.account_usernames ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.account_usernames TO service_role;

INSERT INTO public.account_usernames (username_normalized, account_table, account_id)
SELECT lower(btrim(username)), account_table, account_id
FROM (
  SELECT username, 'users'::text AS account_table, id::text AS account_id FROM public.users
  UNION ALL
  SELECT username, 'barangay_users', id::text FROM public.barangay_users
  UNION ALL
  SELECT username, 'resident_user', id::text FROM public.resident_user
) AS all_accounts
WHERE nullif(btrim(username), '') IS NOT NULL
ON CONFLICT (username_normalized) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_account_username_registry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_username TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.account_usernames
    WHERE account_table = TG_TABLE_NAME AND account_id = OLD.id::text;
    RETURN OLD;
  END IF;

  normalized_username := lower(nullif(btrim(NEW.username), ''));
  IF normalized_username IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'A username is required for new sign-in accounts.'
        USING ERRCODE = '23502', CONSTRAINT = 'account_username_required';
    ELSIF nullif(btrim(OLD.username), '') IS NOT NULL THEN
      RAISE EXCEPTION 'A username is required for new sign-in accounts.'
        USING ERRCODE = '23502', CONSTRAINT = 'account_username_required';
    END IF;
    RETURN NEW;
  END IF;

  IF normalized_username !~ '^[a-z0-9_.-]{3,32}$' THEN
    RAISE EXCEPTION 'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.'
      USING ERRCODE = '23514', CONSTRAINT = 'account_username_format_check';
  END IF;

  NEW.username := normalized_username;
  INSERT INTO public.account_usernames (username_normalized, account_table, account_id)
  VALUES (normalized_username, TG_TABLE_NAME, NEW.id::text)
  ON CONFLICT (account_table, account_id)
  DO UPDATE SET username_normalized = EXCLUDED.username_normalized;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_sync_username_registry ON public.users;
CREATE TRIGGER users_sync_username_registry
BEFORE INSERT OR UPDATE OF username OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.sync_account_username_registry();

DROP TRIGGER IF EXISTS barangay_users_sync_username_registry ON public.barangay_users;
CREATE TRIGGER barangay_users_sync_username_registry
BEFORE INSERT OR UPDATE OF username OR DELETE ON public.barangay_users
FOR EACH ROW EXECUTE FUNCTION public.sync_account_username_registry();

DROP TRIGGER IF EXISTS resident_user_sync_username_registry ON public.resident_user;
CREATE TRIGGER resident_user_sync_username_registry
BEFORE INSERT OR UPDATE OF username OR DELETE ON public.resident_user
FOR EACH ROW EXECUTE FUNCTION public.sync_account_username_registry();

COMMENT ON TABLE public.account_usernames IS 'Internal global username reservations synchronized transactionally from sign-in account tables.';
