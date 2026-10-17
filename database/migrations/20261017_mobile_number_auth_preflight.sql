-- Read-only preflight before 20261017_mobile_number_registry.sql.
-- Resolve every missing/invalid number and every duplicate normalized number
-- before deploying phone-only authentication.

WITH account_phones AS (
  SELECT 'users'::text AS account_table, id::text AS account_id, phone FROM public.users
  UNION ALL
  SELECT 'barangay_users', id::text, phone FROM public.barangay_users
  UNION ALL
  SELECT 'resident_user', id::text, phone FROM public.resident_user
)
SELECT account_table, account_id, phone,
       CASE
         WHEN nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '') IS NULL THEN 'missing'
         WHEN regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^09[0-9]{9}$' THEN 'valid'
         WHEN regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^639[0-9]{9}$' THEN 'valid_international'
         WHEN regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^9[0-9]{9}$' THEN 'valid_without_leading_zero'
         ELSE 'invalid'
       END AS phone_status
FROM account_phones
ORDER BY phone_status, account_table, account_id;

WITH account_phones AS (
  SELECT 'users'::text AS account_table, id::text AS account_id, phone FROM public.users
  UNION ALL
  SELECT 'barangay_users', id::text, phone FROM public.barangay_users
  UNION ALL
  SELECT 'resident_user', id::text, phone FROM public.resident_user
), normalized AS (
  SELECT account_table, account_id,
         CASE
           WHEN regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^09[0-9]{9}$'
             THEN regexp_replace(coalesce(phone, ''), '\D', '', 'g')
           WHEN regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^639[0-9]{9}$'
             THEN '0' || substr(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 3)
           WHEN regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^9[0-9]{9}$'
             THEN '0' || regexp_replace(coalesce(phone, ''), '\D', '', 'g')
           ELSE NULL
         END AS phone_normalized
  FROM account_phones
)
SELECT phone_normalized,
       json_agg(json_build_object('account_table', account_table, 'account_id', account_id)
                ORDER BY account_table, account_id) AS accounts
FROM normalized
WHERE phone_normalized IS NOT NULL
GROUP BY phone_normalized
HAVING count(*) > 1
ORDER BY phone_normalized;
