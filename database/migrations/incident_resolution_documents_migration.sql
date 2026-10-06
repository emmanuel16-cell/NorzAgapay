-- Preserve Barangay and MDRRMO closeouts independently and track the latest
-- generated incident PDF. The PDF bucket is private; downloads go through the
-- authenticated API.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS barangay_resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS barangay_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_resolved_notes TEXT,
  ADD COLUMN IF NOT EXISTS mdrrmo_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS barangay_dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatcher_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS barangay_dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS barangay_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS barangay_arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS resolution_pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_pdf_status TEXT NOT NULL DEFAULT 'missing'
    CHECK (resolution_pdf_status IN ('missing', 'ready', 'failed'));

-- Backfill existing resolved reports to the response channel that most likely
-- owned the recorded resolution. Keep the existing shared resolution fields
-- intact for older clients.
UPDATE public.incident_reports
SET mdrrmo_response_status = 'resolved',
    mdrrmo_resolved_notes = COALESCE(mdrrmo_resolved_notes, resolved_notes),
    mdrrmo_resolved_at = COALESCE(mdrrmo_resolved_at, resolved_at),
    mdrrmo_dispatcher_reviewed_at = COALESCE(mdrrmo_dispatcher_reviewed_at, dispatcher_reviewed_at),
    mdrrmo_dispatched_at = COALESCE(mdrrmo_dispatched_at, dispatched_at),
    mdrrmo_accepted_at = COALESCE(mdrrmo_accepted_at, accepted_at),
    mdrrmo_arrived_at = COALESCE(mdrrmo_arrived_at, arrived_at)
WHERE status::text IN ('resolved', 'closed')
  AND (mdrrmo_responded_by IS NOT NULL OR send_to = 'mdrrmo'
       OR COALESCE(mdrrmo_response_notes, '') ILIKE '%escalated%');

UPDATE public.incident_reports
SET barangay_response_status = 'resolved',
    barangay_resolved_notes = COALESCE(barangay_resolved_notes, resolved_notes),
    barangay_resolved_at = COALESCE(barangay_resolved_at, resolved_at),
    barangay_dispatcher_reviewed_at = COALESCE(barangay_dispatcher_reviewed_at, dispatcher_reviewed_at),
    barangay_dispatched_at = COALESCE(barangay_dispatched_at, dispatched_at),
    barangay_accepted_at = COALESCE(barangay_accepted_at, accepted_at),
    barangay_arrived_at = COALESCE(barangay_arrived_at, arrived_at)
WHERE status::text IN ('resolved', 'closed')
  AND mdrrmo_response_status IS DISTINCT FROM 'resolved'
  AND (barangay_id IS NOT NULL OR barangay_responded_by IS NOT NULL);

UPDATE public.incident_reports
SET barangay_dispatcher_reviewed_at = COALESCE(barangay_dispatcher_reviewed_at, dispatcher_reviewed_at),
    barangay_dispatched_at = COALESCE(barangay_dispatched_at, dispatched_at),
    barangay_accepted_at = COALESCE(barangay_accepted_at, accepted_at),
    barangay_arrived_at = COALESCE(barangay_arrived_at, arrived_at)
WHERE barangay_response_status = 'responding';

UPDATE public.incident_reports
SET mdrrmo_dispatcher_reviewed_at = COALESCE(mdrrmo_dispatcher_reviewed_at, dispatcher_reviewed_at),
    mdrrmo_dispatched_at = COALESCE(mdrrmo_dispatched_at, dispatched_at),
    mdrrmo_accepted_at = COALESCE(mdrrmo_accepted_at, accepted_at),
    mdrrmo_arrived_at = COALESCE(mdrrmo_arrived_at, arrived_at)
WHERE mdrrmo_response_status = 'responding';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'incident-resolution-documents',
  'incident-resolution-documents',
  false,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
