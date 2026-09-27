-- Store the resident's email separately from their phone number on incident reports.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS reporter_email TEXT;

-- Repair legacy resident reports where an email was mistakenly saved as a phone.
UPDATE public.incident_reports
SET reporter_email = COALESCE(NULLIF(reporter_email, ''), reporter_phone),
    reporter_phone = NULL
WHERE reporter_phone LIKE '%@%';

-- Fill known reporter details from resident accounts when a report has a linked account.
UPDATE public.incident_reports AS report
SET reporter_name = COALESCE(NULLIF(report.reporter_name, ''), resident.full_name),
    reporter_email = COALESCE(NULLIF(report.reporter_email, ''), resident.email),
    reporter_phone = COALESCE(NULLIF(report.reporter_phone, ''), NULLIF(resident.phone, ''))
FROM public.resident_user AS resident
WHERE (report.reporter_type = 'resident' AND report.reporter_id = resident.id)
   OR lower(COALESCE(report.reporter_email, '')) = lower(resident.email);
