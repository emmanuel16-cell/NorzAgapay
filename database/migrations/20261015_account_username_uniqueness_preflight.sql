-- Run before 20261015_global_account_username_registry.sql.
-- Results: (1) username-less legacy accounts may remain temporarily;
-- (2) invalid non-empty usernames and (3) duplicate normalized names must be
-- resolved with the affected account owners before applying the registry.
SELECT 'users'::text AS account_table, id::text AS account_id, username
FROM public.users
WHERE nullif(btrim(username), '') IS NULL
UNION ALL
SELECT 'barangay_users', id::text, username
FROM public.barangay_users
WHERE nullif(btrim(username), '') IS NULL
UNION ALL
SELECT 'resident_user', id::text, username
FROM public.resident_user
WHERE nullif(btrim(username), '') IS NULL
ORDER BY account_table, account_id;

SELECT 'users'::text AS account_table, id::text AS account_id, username
FROM public.users
WHERE nullif(btrim(username), '') IS NOT NULL
  AND lower(btrim(username)) !~ '^[a-z0-9_.-]{3,32}$'
UNION ALL
SELECT 'barangay_users', id::text, username
FROM public.barangay_users
WHERE nullif(btrim(username), '') IS NOT NULL
  AND lower(btrim(username)) !~ '^[a-z0-9_.-]{3,32}$'
UNION ALL
SELECT 'resident_user', id::text, username
FROM public.resident_user
WHERE nullif(btrim(username), '') IS NOT NULL
  AND lower(btrim(username)) !~ '^[a-z0-9_.-]{3,32}$'
ORDER BY account_table, account_id;

-- The query below reports any names that collide after trimming and case
-- normalization.
WITH usernames AS (
  SELECT 'users'::text AS account_table, id::text AS account_id, lower(btrim(username)) AS username_normalized
  FROM public.users
  WHERE nullif(btrim(username), '') IS NOT NULL
  UNION ALL
  SELECT 'barangay_users', id::text, lower(btrim(username))
  FROM public.barangay_users
  WHERE nullif(btrim(username), '') IS NOT NULL
  UNION ALL
  SELECT 'resident_user', id::text, lower(btrim(username))
  FROM public.resident_user
  WHERE nullif(btrim(username), '') IS NOT NULL
)
SELECT username_normalized, json_agg(json_build_object('account_table', account_table, 'account_id', account_id) ORDER BY account_table, account_id) AS accounts
FROM usernames
GROUP BY username_normalized
HAVING count(*) > 1
ORDER BY username_normalized;
