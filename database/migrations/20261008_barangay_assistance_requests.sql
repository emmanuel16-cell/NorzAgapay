-- ============================================================
-- Migration: barangay_assistance_requests
-- Run this in your Supabase SQL Editor.
-- Safe to run multiple times (uses CREATE TABLE IF NOT EXISTS).
-- ============================================================

-- 1. Create the table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.barangay_assistance_requests (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id               UUID NOT NULL REFERENCES public.barangays(id) ON DELETE CASCADE,
  requested_by              UUID NOT NULL,
  incident_report_id        UUID REFERENCES public.barangay_reports(id) ON DELETE SET NULL,
  incident_title            TEXT,
  needs_more_manpower       BOOLEAN NOT NULL DEFAULT false,
  needs_resources           BOOLEAN NOT NULL DEFAULT false,
  needs_equipment           BOOLEAN NOT NULL DEFAULT false,
  beyond_barangay_capability BOOLEAN NOT NULL DEFAULT false,
  explanation               TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'actioned', 'rejected', 'fulfilled', 'cancelled')),
  decision TEXT
    CHECK (decision IS NULL OR decision IN ('provide_barangay_assistance', 'coordinate_mdrrmo', 'dismissed')),
  dispatcher_notes          TEXT,
  decided_by                UUID,
  decided_at                TIMESTAMPTZ,
  team_acknowledged         BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT requested_by
    FOREIGN KEY (requested_by) REFERENCES public.barangay_users(id) ON DELETE CASCADE,
  CONSTRAINT decided_by
    FOREIGN KEY (decided_by) REFERENCES public.barangay_users(id) ON DELETE SET NULL,
  CONSTRAINT barangay_assistance_requests_explanation_length_check
    CHECK (char_length(btrim(explanation)) >= 10)
);

-- 2. Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_barangay_assistance_requests_barangay_created
  ON public.barangay_assistance_requests (barangay_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_barangay_assistance_requests_requested_by
  ON public.barangay_assistance_requests (requested_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_barangay_assistance_requests_incident_report
  ON public.barangay_assistance_requests (incident_report_id)
  WHERE incident_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_barangay_assistance_requests_status
  ON public.barangay_assistance_requests (status, created_at DESC);

-- 3. RLS & grants ──────────────────────────────────────────────────────────────
ALTER TABLE public.barangay_assistance_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.barangay_assistance_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.barangay_assistance_requests TO service_role;

-- 4. Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
