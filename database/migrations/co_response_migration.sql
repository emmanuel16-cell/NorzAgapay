-- ============================================
-- NorzAgapay Multi-Agency Co-Response Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- Add MDRRMO response tracking columns to incident_reports table
ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS mdrrmo_response_status TEXT DEFAULT 'pending', -- pending | responding | resolved
  ADD COLUMN IF NOT EXISTS mdrrmo_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mdrrmo_responded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mdrrmo_responder_name TEXT,
  ADD COLUMN IF NOT EXISTS mdrrmo_response_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_incident_reports_mdrrmo_status ON incident_reports(mdrrmo_response_status);
