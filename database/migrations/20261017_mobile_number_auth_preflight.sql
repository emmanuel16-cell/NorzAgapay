-- Read-only preflight before 20261017_role_scoped_mobile_auth.sql.
-- Resolve missing/invalid numbers and duplicates within one account table.
-- Reusing a number across different account tables is allowed.

WITH account_phones AS (
  SELECT 'users'::text AS account_table, id::text AS account_id, phone FROM public.users
  UNION ALL
  SELECT 'barangay_users', id::text, phone FROM public.barangay_users
  UNION ALL
  SELECT 'resident_user', id::text, phone FROM public.resident_user
)
SELECT account_table, account_id, phone,
       CASE
         WHEN nullif(btrim(coalesce(phone, '')), '') IS NULL THEN 'missing'
         WHEN phone ~ '^09[0-9]{9}$' THEN 'valid'
         ELSE 'invalid'
       END AS phone_status
FROM account_phones
ORDER BY phone_status, account_table, account_id;

-- Same-table duplicates block the migration.
WITH account_phones AS (
  SELECT 'users'::text AS account_table, id::text AS account_id, phone FROM public.users
  UNION ALL
  SELECT 'barangay_users', id::text, phone FROM public.barangay_users
  UNION ALL
  SELECT 'resident_user', id::text, phone FROM public.resident_user
), normalized AS (
  SELECT account_table, account_id,
         CASE WHEN phone ~ '^09[0-9]{9}$' THEN phone ELSE NULL END AS phone_normalized
  FROM account_phones
)
SELECT account_table, phone_normalized,
       json_agg(json_build_object('account_table', account_table, 'account_id', account_id)
                ORDER BY account_table, account_id) AS accounts
FROM normalized
WHERE phone_normalized IS NOT NULL
GROUP BY account_table, phone_normalized
HAVING count(*) > 1
ORDER BY account_table, phone_normalized;

-- Informational only: the same number may appear once in each role table.
WITH account_phones AS (
  SELECT 'users'::text AS account_table, id::text AS account_id, phone FROM public.users
  UNION ALL
  SELECT 'barangay_users', id::text, phone FROM public.barangay_users
  UNION ALL
  SELECT 'resident_user', id::text, phone FROM public.resident_user
)
SELECT phone AS phone_normalized,
       json_agg(json_build_object('account_table', account_table, 'account_id', account_id)
                ORDER BY account_table, account_id) AS accounts
FROM account_phones
WHERE phone ~ '^09[0-9]{9}$'
GROUP BY phone
HAVING count(DISTINCT account_table) > 1
ORDER BY phone;
