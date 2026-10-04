-- Persist MDRRMO invalid-report decisions and enforce resident false-report strikes.
-- Run after resident_user_table_migration.sql.

ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS review_outcome TEXT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'incident_reports_review_outcome_check'
  ) THEN
    ALTER TABLE public.incident_reports
      ADD CONSTRAINT incident_reports_review_outcome_check
      CHECK (review_outcome IS NULL OR review_outcome IN ('inconclusive', 'false_report'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_incident_reports_review_outcome
  ON public.incident_reports(review_outcome)
  WHERE review_outcome IS NOT NULL;

ALTER TABLE public.resident_user
  ADD COLUMN IF NOT EXISTS false_report_count INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'resident_user_false_report_count_check'
  ) THEN
    ALTER TABLE public.resident_user
      ADD CONSTRAINT resident_user_false_report_count_check CHECK (false_report_count >= 0);
  END IF;
END $$;

-- The report row and resident row are locked in one transaction so retries cannot
-- count the same report twice and concurrent marks cannot lose a strike.
CREATE OR REPLACE FUNCTION public.review_incident_report(
  p_report_id UUID,
  p_review_outcome TEXT,
  p_review_reason TEXT,
  p_reviewed_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.incident_reports%ROWTYPE;
  v_false_report_count INTEGER;
  v_resident_status TEXT;
BEGIN
  IF p_review_outcome NOT IN ('inconclusive', 'false_report') THEN
    RAISE EXCEPTION 'Invalid review outcome' USING ERRCODE = '22023';
  END IF;
  IF p_reviewed_by IS NULL THEN
    RAISE EXCEPTION 'Reviewer is required' USING ERRCODE = '22023';
  END IF;
  IF p_review_outcome = 'inconclusive' AND NULLIF(BTRIM(p_review_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for an inconclusive report' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report
    FROM public.incident_reports
    WHERE id = p_report_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_report.review_outcome IS NOT NULL THEN
    IF v_report.review_outcome <> p_review_outcome THEN
      RAISE EXCEPTION 'Report has already received a different review decision' USING ERRCODE = 'P0001';
    END IF;
    IF v_report.reporter_type = 'resident' AND v_report.reporter_id IS NOT NULL THEN
      SELECT false_report_count, status INTO v_false_report_count, v_resident_status
        FROM public.resident_user WHERE id = v_report.reporter_id;
    END IF;
    RETURN jsonb_build_object(
      'report', to_jsonb(v_report),
      'false_report_count', v_false_report_count,
      'resident_status', v_resident_status,
      'already_reviewed', true
    );
  END IF;

  IF v_report.status::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'Only pending reports can receive an invalid-report decision' USING ERRCODE = 'P0001';
  END IF;
  IF p_review_outcome = 'false_report' AND v_report.reporter_type <> 'resident' THEN
    RAISE EXCEPTION 'False-reporter marks can only be applied to resident reports' USING ERRCODE = '22023';
  END IF;

  IF p_review_outcome = 'false_report' AND v_report.reporter_id IS NOT NULL THEN
    UPDATE public.resident_user
      SET false_report_count = LEAST(COALESCE(false_report_count, 0) + 1, 3),
          status = CASE WHEN COALESCE(false_report_count, 0) + 1 >= 3 THEN 'inactive' ELSE status END,
          updated_at = NOW()
      WHERE id = v_report.reporter_id
      RETURNING false_report_count, status INTO v_false_report_count, v_resident_status;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked resident account was not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE public.incident_reports
    SET review_outcome = p_review_outcome,
        review_reason = NULLIF(BTRIM(p_review_reason), ''),
        reviewed_by = p_reviewed_by,
        reviewed_at = NOW(),
        status = 'rejected'
    WHERE id = p_report_id
    RETURNING * INTO v_report;

  RETURN jsonb_build_object(
    'report', to_jsonb(v_report),
    'false_report_count', v_false_report_count,
    'resident_status', v_resident_status,
    'already_reviewed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_incident_report(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_incident_report(UUID, TEXT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_incident_report(UUID, TEXT, TEXT, UUID) TO service_role;
