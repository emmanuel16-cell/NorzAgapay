-- Allow one exact local mobile number per account type while permitting the
-- same number once in users, barangay_users, and resident_user.
-- Run 20261017_mobile_number_auth_preflight.sql first.
BEGIN;

LOCK TABLE public.users, public.barangay_users, public.resident_user
  IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.normalize_ph_mobile_number(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_phone TEXT := coalesce(p_phone, '');
BEGIN
  IF v_phone ~ '^09[0-9]{9}$' THEN RETURN v_phone; END IF;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT 'users'::text AS account_table, id, phone FROM public.users
      UNION ALL SELECT 'barangay_users', id, phone FROM public.barangay_users
      UNION ALL SELECT 'resident_user', id, phone FROM public.resident_user
    ) AS accounts
    WHERE public.normalize_ph_mobile_number(phone) IS NULL
  ) THEN
    RAISE EXCEPTION 'Role-scoped mobile migration stopped: every sign-in account must use exact 09XXXXXXXXX format. Run 20261017_mobile_number_auth_preflight.sql.';
  END IF;

  IF EXISTS (
    SELECT account_table, phone FROM (
      SELECT 'users'::text AS account_table, phone FROM public.users
      UNION ALL SELECT 'barangay_users', phone FROM public.barangay_users
      UNION ALL SELECT 'resident_user', phone FROM public.resident_user
    ) AS accounts
    GROUP BY account_table, phone
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Role-scoped mobile migration stopped: a number is assigned to multiple accounts in the same account type. Run 20261017_mobile_number_auth_preflight.sql.';
  END IF;
END;
$$;

UPDATE public.users
SET phone = public.normalize_ph_mobile_number(phone)
WHERE phone IS DISTINCT FROM public.normalize_ph_mobile_number(phone);
UPDATE public.barangay_users
SET phone = public.normalize_ph_mobile_number(phone)
WHERE phone IS DISTINCT FROM public.normalize_ph_mobile_number(phone);
UPDATE public.resident_user
SET phone = public.normalize_ph_mobile_number(phone)
WHERE phone IS DISTINCT FROM public.normalize_ph_mobile_number(phone);

ALTER TABLE public.users ALTER COLUMN phone SET NOT NULL;
ALTER TABLE public.barangay_users ALTER COLUMN phone SET NOT NULL;
ALTER TABLE public.resident_user ALTER COLUMN phone SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.account_mobile_numbers (
  phone_normalized TEXT NOT NULL,
  account_table TEXT NOT NULL CHECK (account_table IN ('users', 'barangay_users', 'resident_user')),
  account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_mobile_numbers_pkey PRIMARY KEY (account_table, phone_normalized),
  CONSTRAINT account_mobile_numbers_account_unique UNIQUE (account_table, account_id)
);

-- If the earlier global registry exists, replace its global phone key with a
-- role-scoped key. Rebuild the table entries from the account rows below.
ALTER TABLE public.account_mobile_numbers
  DROP CONSTRAINT IF EXISTS account_mobile_numbers_pkey;
ALTER TABLE public.account_mobile_numbers
  ADD CONSTRAINT account_mobile_numbers_pkey PRIMARY KEY (account_table, phone_normalized);
ALTER TABLE public.account_mobile_numbers
  DROP CONSTRAINT IF EXISTS account_mobile_numbers_phone_format;
ALTER TABLE public.account_mobile_numbers
  ADD CONSTRAINT account_mobile_numbers_phone_format CHECK (phone_normalized ~ '^09[0-9]{9}$');

ALTER TABLE public.account_mobile_numbers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_mobile_numbers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_mobile_numbers TO service_role;

TRUNCATE TABLE public.account_mobile_numbers;
INSERT INTO public.account_mobile_numbers (phone_normalized, account_table, account_id)
SELECT phone, account_table, account_id
FROM (
  SELECT phone, 'users'::text AS account_table, id::text AS account_id FROM public.users
  UNION ALL
  SELECT phone, 'barangay_users', id::text FROM public.barangay_users
  UNION ALL
  SELECT phone, 'resident_user', id::text FROM public.resident_user
) AS accounts;

CREATE OR REPLACE FUNCTION public.sync_account_mobile_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.account_mobile_numbers
    WHERE account_table = TG_TABLE_NAME AND account_id = OLD.id::text;
    RETURN OLD;
  END IF;

  v_phone := public.normalize_ph_mobile_number(NEW.phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'A mobile number in exact 09XXXXXXXXX format is required for every sign-in account.'
      USING ERRCODE = '23514', CONSTRAINT = 'account_mobile_numbers_phone_format';
  END IF;

  NEW.phone := v_phone;
  INSERT INTO public.account_mobile_numbers (phone_normalized, account_table, account_id)
  VALUES (v_phone, TG_TABLE_NAME, NEW.id::text)
  ON CONFLICT (account_table, account_id)
  DO UPDATE SET phone_normalized = EXCLUDED.phone_normalized;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_account_mobile_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_sync_mobile_number ON public.users;
CREATE TRIGGER users_sync_mobile_number
BEFORE INSERT OR UPDATE OF phone OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.sync_account_mobile_number();
DROP TRIGGER IF EXISTS barangay_users_sync_mobile_number ON public.barangay_users;
CREATE TRIGGER barangay_users_sync_mobile_number
BEFORE INSERT OR UPDATE OF phone OR DELETE ON public.barangay_users
FOR EACH ROW EXECUTE FUNCTION public.sync_account_mobile_number();
DROP TRIGGER IF EXISTS resident_user_sync_mobile_number ON public.resident_user;
CREATE TRIGGER resident_user_sync_mobile_number
BEFORE INSERT OR UPDATE OF phone OR DELETE ON public.resident_user
FOR EACH ROW EXECUTE FUNCTION public.sync_account_mobile_number();

COMMENT ON TABLE public.account_mobile_numbers IS 'Role-scoped mobile reservations. A number may be reserved once per users, barangay_users, and resident_user table.';
COMMIT;
