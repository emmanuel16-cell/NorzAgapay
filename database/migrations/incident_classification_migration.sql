-- Store the dispatcher classification separately from the resident's report category.
ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS incident_type TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incident_reports_dispatch_incident_id
  ON public.incident_reports(dispatch_incident_id);
