-- ============================================
-- NorzAgapay Emergency Report Target Recipient Migration
-- Adds send_to column to incident_reports table
-- ('barangay' | 'mdrrmo' | 'all')
-- ============================================

ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS send_to TEXT DEFAULT 'all';

CREATE INDEX IF NOT EXISTS idx_incident_reports_send_to ON incident_reports(send_to);
