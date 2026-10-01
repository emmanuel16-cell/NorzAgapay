-- ==============================================================================
-- Migration: Create Barangay Dispatcher Verifications Table & Supporting Columns
-- Description: Enables authorization certification tracking, prefilled PDF reference
--              linking, document upload storage, review status, and audit history.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS barangay_dispatcher_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, -- References barangay_users(id) once approved by MDRRMO
  barangay_id UUID NOT NULL REFERENCES barangays(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  phone VARCHAR(20),
  position_designation TEXT NOT NULL DEFAULT 'Barangay Dispatcher',
  punong_barangay_name TEXT NOT NULL DEFAULT '',
  punong_barangay_position TEXT NOT NULL DEFAULT 'Punong Barangay',
  reference_no VARCHAR(64) UNIQUE NOT NULL,
  document_url TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_document', -- pending_document | under_review | verified | rejected | needs_correction
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verification_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatcher_verifications_user_id ON barangay_dispatcher_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_dispatcher_verifications_barangay_id ON barangay_dispatcher_verifications(barangay_id);
CREATE INDEX IF NOT EXISTS idx_dispatcher_verifications_status ON barangay_dispatcher_verifications(status);
CREATE INDEX IF NOT EXISTS idx_dispatcher_verifications_ref_no ON barangay_dispatcher_verifications(reference_no);

ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS verification_status VARCHAR(32) DEFAULT 'pending_document';
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS verification_ref_no VARCHAR(64);
ALTER TABLE barangay_users ADD COLUMN IF NOT EXISTS position_designation TEXT;
ALTER TABLE barangay_dispatcher_verifications ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE barangay_users AS bu
SET position_designation = dv.position_designation
FROM barangay_dispatcher_verifications AS dv
WHERE dv.user_id = bu.id
  AND NULLIF(BTRIM(dv.position_designation), '') IS NOT NULL
  AND (
    bu.position_designation IS NULL
    OR BTRIM(bu.position_designation) = ''
    OR LOWER(BTRIM(bu.position_designation)) = 'barangay dispatcher'
  );
