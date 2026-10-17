-- Globally reserve normalized Philippine mobile numbers across all sign-in
-- account tables. Run the preflight and resolve every result first.
BEGIN;

LOCK TABLE public.users, public.barangay_users, public.resident_user
  IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.normalize_ph_mobile_number(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits TEXT := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
BEGIN
  IF v_digits ~ '^09[0-9]{9}$' THEN RETURN v_digits; END IF;
  IF v_digits ~ '^639[0-9]{9}$' THEN RETURN '0' || substr(v_digits, 3); END IF;
  IF v_digits ~ '^9[0-9]{9}$' THEN RETURN '0' || v_digits; END IF;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT id, phone FROM public.users
      UNION ALL SELECT id, phone FROM public.barangay_users
      UNION ALL SELECT id, phone FROM public.resident_user
    ) AS accounts
    WHERE public.normalize_ph_mobile_number(phone) IS NULL
  ) THEN
    RAISE EXCEPTION 'Mobile-number registry migration stopped: every sign-in account must have a valid Philippine mobile number. Run 20261017_mobile_number_auth_preflight.sql.';
  END IF;

  IF EXISTS (
    SELECT phone_normalized FROM (
      SELECT public.normalize_ph_mobile_number(phone) AS phone_normalized FROM public.users
      UNION ALL SELECT public.normalize_ph_mobile_number(phone) FROM public.barangay_users
      UNION ALL SELECT public.normalize_ph_mobile_number(phone) FROM public.resident_user
    ) AS account_phones
    GROUP BY phone_normalized HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Mobile-number registry migration stopped: normalized mobile numbers are shared by multiple accounts. Run 20261017_mobile_number_auth_preflight.sql.';
  END IF;
END;
$$;

-- Canonicalize all verified existing account numbers before the first lookup
-- or future account write, so +639XXXXXXXXX and 09XXXXXXXXX resolve identically.
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
  phone_normalized TEXT PRIMARY KEY CHECK (phone_normalized ~ '^09[0-9]{9}$'),
  account_table TEXT NOT NULL CHECK (account_table IN ('users', 'barangay_users', 'resident_user')),
  account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_mobile_numbers_account_unique UNIQUE (account_table, account_id)
);
ALTER TABLE public.account_mobile_numbers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_mobile_numbers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_mobile_numbers TO service_role;

INSERT INTO public.account_mobile_numbers (phone_normalized, account_table, account_id)
SELECT public.normalize_ph_mobile_number(phone), account_table, account_id
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
    RAISE EXCEPTION 'A valid Philippine mobile number is required for every sign-in account.'
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

COMMENT ON TABLE public.account_mobile_numbers IS 'Global normalized phone reservations for resident, barangay, and MDRRMO sign-in accounts.';
COMMIT;
