-- =====================================================
-- Migration: Create barangay_assistance_requests table
-- Run this in your Supabase SQL Editor
-- =====================================================

CREATE TABLE IF NOT EXISTS barangay_assistance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID NOT NULL REFERENCES barangays(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES barangay_users(id) ON DELETE CASCADE,
  decided_by UUID REFERENCES barangay_users(id) ON DELETE SET NULL,

  -- Incident context
  incident_report_id UUID REFERENCES incident_reports(id) ON DELETE SET NULL,
  incident_title TEXT,

  -- Quick action flags
  needs_more_manpower BOOLEAN NOT NULL DEFAULT false,
  needs_resources BOOLEAN NOT NULL DEFAULT false,
  needs_equipment BOOLEAN NOT NULL DEFAULT false,
  beyond_barangay_capability BOOLEAN NOT NULL DEFAULT false,

  -- Text fields
  explanation TEXT NOT NULL,
  captain_notes TEXT,

  -- Status & decision
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'actioned', 'dismissed')),
  decision TEXT
    CHECK (decision IN ('provide_barangay_assistance', 'coordinate_mdrrmo', 'dismissed')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

-- Index for fast lookups by barangay
CREATE INDEX IF NOT EXISTS idx_assistance_requests_barangay_id
  ON barangay_assistance_requests(barangay_id);

-- Index for status filtering (pending first)
CREATE INDEX IF NOT EXISTS idx_assistance_requests_status
  ON barangay_assistance_requests(status);

-- Row Level Security (optional - backend uses service key so RLS is bypassed)
ALTER TABLE barangay_assistance_requests ENABLE ROW LEVEL SECURITY;
