-- Give MDRRMO incident reports a normalized responder assignment and notes.
-- Apply this migration before deploying the MDRRMO report-cycle API/mobile app.

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS mdrrmo_dispatch_notes TEXT;

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  responder_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'responding', 'resolved', 'removed')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  UNIQUE (report_id, responder_id)
);

CREATE INDEX IF NOT EXISTS idx_mdrrmo_report_assignments_responder_status
  ON public.mdrrmo_report_assignments(responder_id, status, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_mdrrmo_report_assignments_report
  ON public.mdrrmo_report_assignments(report_id, status);

ALTER TABLE public.mdrrmo_report_assignments ENABLE ROW LEVEL SECURITY;

-- The backend uses the service role for these operations. Direct client access
-- remains unavailable; all role and assignment checks are enforced by the API.
