-- ============================================================================
-- Migration: Public Alerts / Broadcasts
-- Allows barangay dispatchers and leaders to broadcast emergency advisories
-- ============================================================================

CREATE TABLE IF NOT EXISTS public_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID NOT NULL REFERENCES barangays(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES barangay_users(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL DEFAULT 'safety_advisory',
  content TEXT NOT NULL,
  links JSONB DEFAULT '[]'::jsonb,
  media JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_broadcasts_barangay ON public_broadcasts(barangay_id);
CREATE INDEX IF NOT EXISTS idx_public_broadcasts_created_at ON public_broadcasts(created_at DESC);
