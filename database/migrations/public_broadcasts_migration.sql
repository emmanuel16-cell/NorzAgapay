-- ============================================================================
-- Migration: Public Alerts / Broadcasts
-- Supports barangay posts, municipality-wide MDRRMO posts, and persistent reposts.
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

-- MDRRMO-authored posts have no barangay owner or barangay-app author. The
-- dashboard author is stored separately so existing barangay foreign keys
-- and posts remain intact.
ALTER TABLE public_broadcasts ALTER COLUMN barangay_id DROP NOT NULL;
ALTER TABLE public_broadcasts ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS is_mdrrmo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS is_from_mdrrmo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS reposted_by TEXT;
ALTER TABLE public_broadcasts
  ADD COLUMN IF NOT EXISTS reposted_from_id UUID REFERENCES public_broadcasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_public_broadcasts_municipal_feed
  ON public_broadcasts(created_at DESC) WHERE is_mdrrmo = true AND barangay_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_broadcasts_unique_barangay_repost
  ON public_broadcasts(barangay_id, reposted_from_id) WHERE reposted_from_id IS NOT NULL;
