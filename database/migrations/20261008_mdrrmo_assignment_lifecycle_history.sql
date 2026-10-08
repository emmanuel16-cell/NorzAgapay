-- Store MDRRMO assignment lifecycle events against canonical MDRRMO report IDs.
-- incident_report_lifecycle_history references incident_reports and cannot hold
-- IDs from the separate mdrrmo_reports table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mdrrmo_report_lifecycle_history (
  id BIGSERIAL PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.mdrrmo_reports(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_role TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS mdrrmo_report_lifecycle_history_report_idx
  ON public.mdrrmo_report_lifecycle_history(report_id, occurred_at, id);

ALTER TABLE public.mdrrmo_report_lifecycle_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mdrrmo_report_lifecycle_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.mdrrmo_report_lifecycle_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mdrrmo_report_lifecycle_history_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.audit_mdrrmo_assignment_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type TEXT;
  v_actor_id UUID;
  v_actor_role TEXT;
  v_before JSONB;
  v_after JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'mdrrmo.responder_assigned';
    v_actor_id := NEW.assigned_by;
    v_actor_role := 'dispatcher';
    v_before := NULL;
    v_after := to_jsonb(NEW);
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'responding' THEN
      v_event_type := 'mdrrmo.responder_accepted';
      v_actor_id := NEW.accepted_by;
      v_actor_role := 'responder';
    ELSIF NEW.arrived_at IS DISTINCT FROM OLD.arrived_at THEN
      v_event_type := 'mdrrmo.responder_arrived';
      v_actor_id := NEW.arrived_by;
      v_actor_role := 'responder';
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'resolved' THEN
      v_event_type := 'mdrrmo.response_resolved';
      v_actor_id := NEW.resolved_by;
      v_actor_role := COALESCE(NEW.resolved_by_role, 'responder');
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'removed' THEN
      v_event_type := 'mdrrmo.assignment_removed';
      v_actor_id := NEW.removed_by;
      v_actor_role := 'dispatcher';
    ELSIF NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
      v_event_type := 'mdrrmo.responder_assigned';
      v_actor_id := NEW.assigned_by;
      v_actor_role := 'dispatcher';
    END IF;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
  END IF;

  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.mdrrmo_report_lifecycle_history
    (report_id, event_type, actor_id, actor_role, details)
  VALUES
    (NEW.report_id, v_event_type, v_actor_id, v_actor_role,
     jsonb_build_object('before', v_before, 'after', v_after));

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
