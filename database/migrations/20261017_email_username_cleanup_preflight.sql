-- Read-only inventory before 20261017_email_username_cleanup.sql.
-- Export any values that authorized records owners must retain before cleanup.
SELECT 'users.email' AS field_name, count(*) AS populated_rows
FROM public.users WHERE email IS NOT NULL
UNION ALL SELECT 'users.username', count(*) FROM public.users WHERE username IS NOT NULL
UNION ALL SELECT 'barangay_users.email', count(*) FROM public.barangay_users WHERE email IS NOT NULL
UNION ALL SELECT 'barangay_users.username', count(*) FROM public.barangay_users WHERE username IS NOT NULL
UNION ALL SELECT 'resident_user.email', count(*) FROM public.resident_user WHERE email IS NOT NULL
UNION ALL SELECT 'resident_user.username', count(*) FROM public.resident_user WHERE username IS NOT NULL
UNION ALL SELECT 'officers.email', count(*) FROM public.officers WHERE email IS NOT NULL
UNION ALL SELECT 'barangay_dispatcher_verifications.email', count(*)
  FROM public.barangay_dispatcher_verifications WHERE email IS NOT NULL
UNION ALL SELECT 'incident_reports.reporter_email', count(*)
  FROM public.incident_reports WHERE reporter_email IS NOT NULL
UNION ALL SELECT 'barangay_reports.reporter_email', count(*)
  FROM public.barangay_reports WHERE reporter_email IS NOT NULL
UNION ALL SELECT 'mdrrmo_reports.reporter_email', count(*)
  FROM public.mdrrmo_reports WHERE reporter_email IS NOT NULL;

-- These are reporter_phone values that contain email-like data and will be
-- cleared by the cleanup migration. They cannot be converted into phone numbers.
SELECT 'incident_reports' AS report_table, id, reporter_phone
FROM public.incident_reports WHERE reporter_phone LIKE '%@%'
UNION ALL
SELECT 'barangay_reports', id, reporter_phone
FROM public.barangay_reports WHERE reporter_phone LIKE '%@%'
UNION ALL
SELECT 'mdrrmo_reports', id, reporter_phone
FROM public.mdrrmo_reports WHERE reporter_phone LIKE '%@%'
ORDER BY report_table, id;
