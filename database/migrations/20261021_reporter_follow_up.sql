-- Atomically append reporter follow-up evidence only while no responder has
-- recorded arrival. The API verifies reporter ownership before calling this
-- service-role-only function.

BEGIN;

CREATE OR REPLACE FUNCTION public.append_reporter_follow_up_evidence(
  p_report_id UUID,
  p_table_name TEXT,
  p_proof_urls TEXT[] DEFAULT '{}',
  p_proof_types TEXT[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proof_urls TEXT[] := '{}';
  v_proof_types TEXT[] := '{}';
  v_legacy_proof_url TEXT;
  v_legacy_proof_type TEXT;
  v_arrived_at TIMESTAMPTZ;
  v_mdrrmo_arrived_at TIMESTAMPTZ;
  v_resolved_at TIMESTAMPTZ;
  v_mdrrmo_resolved_at TIMESTAMPTZ;
  v_response_status TEXT;
  v_report_status TEXT;
BEGIN
  IF p_report_id IS NULL OR p_table_name IS NULL OR p_table_name NOT IN ('mdrrmo_reports', 'barangay_reports') THEN
    RAISE EXCEPTION 'Invalid follow-up request details' USING ERRCODE = '22023';
  END IF;
  IF cardinality(COALESCE(p_proof_urls, '{}')) <> cardinality(COALESCE(p_proof_types, '{}')) THEN
    RAISE EXCEPTION 'Evidence URLs and types must match' USING ERRCODE = '22023';
  END IF;

  -- Lock current assignment rows first, matching responder arrival updates.
  PERFORM id FROM public.mdrrmo_report_assignments WHERE report_id = p_report_id FOR SHARE;
  PERFORM id FROM public.mdrrmo_report_barangay_assignments WHERE report_id = p_report_id FOR SHARE;

  IF p_table_name = 'mdrrmo_reports' THEN
    SELECT proof_urls, proof_url, proof_types, proof_type, arrived_at,
           NULL::TIMESTAMPTZ, resolved_at, NULL::TIMESTAMPTZ,
           response_status::TEXT, NULL::TEXT
      INTO v_proof_urls, v_legacy_proof_url, v_proof_types, v_legacy_proof_type,
           v_arrived_at, v_mdrrmo_arrived_at, v_resolved_at, v_mdrrmo_resolved_at,
           v_response_status, v_report_status
      FROM public.mdrrmo_reports
     WHERE id = p_report_id
     FOR UPDATE;
  ELSE
    SELECT proof_urls, proof_url, proof_types, proof_type, arrived_at,
           NULL::TIMESTAMPTZ, resolved_at, NULL::TIMESTAMPTZ,
           response_status::TEXT, status::TEXT
      INTO v_proof_urls, v_legacy_proof_url, v_proof_types, v_legacy_proof_type,
           v_arrived_at, v_mdrrmo_arrived_at, v_resolved_at, v_mdrrmo_resolved_at,
           v_response_status, v_report_status
      FROM public.barangay_reports
     WHERE id = p_report_id
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_arrived_at IS NOT NULL OR v_mdrrmo_arrived_at IS NOT NULL OR
     v_resolved_at IS NOT NULL OR v_mdrrmo_resolved_at IS NOT NULL OR
     lower(COALESCE(v_response_status, '')) IN ('arrived', 'on_scene', 'resolved', 'closed', 'completed') OR
     lower(COALESCE(v_report_status, '')) IN ('arrived', 'on_scene', 'resolved', 'closed', 'completed') OR
     EXISTS (
       SELECT 1 FROM public.mdrrmo_report_assignments
        WHERE report_id = p_report_id
          AND (arrived_at IS NOT NULL OR resolved_at IS NOT NULL OR lower(status) IN ('arrived', 'on_scene', 'resolved'))
     ) OR EXISTS (
       SELECT 1 FROM public.mdrrmo_report_barangay_assignments
        WHERE report_id = p_report_id
          AND (arrived_at IS NOT NULL OR resolved_at IS NOT NULL OR lower(response_status) IN ('arrived', 'on_scene', 'resolved'))
     ) THEN
    RAISE EXCEPTION 'Follow-up requests are unavailable after a responder arrives.' USING ERRCODE = 'P0001';
  END IF;

  v_proof_urls := COALESCE(v_proof_urls, '{}');
  v_proof_types := COALESCE(v_proof_types, '{}');
  IF cardinality(v_proof_urls) = 0 AND NULLIF(trim(v_legacy_proof_url), '') IS NOT NULL THEN
    IF left(trim(v_legacy_proof_url), 1) = '[' THEN
      BEGIN
        SELECT COALESCE(array_agg(value), '{}') INTO v_proof_urls
          FROM jsonb_array_elements_text(v_legacy_proof_url::JSONB) AS item(value);
      EXCEPTION WHEN OTHERS THEN
        v_proof_urls := ARRAY[v_legacy_proof_url];
      END;
    ELSIF position('|||' IN v_legacy_proof_url) > 0 THEN
      v_proof_urls := string_to_array(v_legacy_proof_url, '|||');
    ELSE
      v_proof_urls := ARRAY[v_legacy_proof_url];
    END IF;
  END IF;

  WHILE cardinality(v_proof_types) < cardinality(v_proof_urls) LOOP
    v_proof_types := array_append(v_proof_types, COALESCE(NULLIF(v_legacy_proof_type, ''), 'image'));
  END LOOP;

  v_proof_urls := v_proof_urls || COALESCE(p_proof_urls, '{}');
  v_proof_types := v_proof_types || COALESCE(p_proof_types, '{}');

  IF p_table_name = 'mdrrmo_reports' THEN
    UPDATE public.mdrrmo_reports
       SET proof_urls = v_proof_urls,
           proof_types = v_proof_types,
           proof_url = CASE WHEN cardinality(v_proof_urls) > 1 THEN to_json(v_proof_urls)::TEXT ELSE v_proof_urls[1] END,
           proof_type = COALESCE(v_proof_types[1], 'image')
     WHERE id = p_report_id;
  ELSE
    UPDATE public.barangay_reports
       SET proof_urls = v_proof_urls,
           proof_types = v_proof_types,
           proof_url = CASE WHEN cardinality(v_proof_urls) > 1 THEN to_json(v_proof_urls)::TEXT ELSE v_proof_urls[1] END,
           proof_type = COALESCE(v_proof_types[1], 'image')
     WHERE id = p_report_id;
  END IF;

  RETURN jsonb_build_object('proof_urls', v_proof_urls, 'proof_types', v_proof_types);
END;
$$;

REVOKE ALL ON FUNCTION public.append_reporter_follow_up_evidence(UUID, TEXT, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_reporter_follow_up_evidence(UUID, TEXT, TEXT[], TEXT[]) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
