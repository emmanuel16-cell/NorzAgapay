BEGIN;

CREATE TABLE IF NOT EXISTS public.public_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID REFERENCES public.barangays(id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.barangay_users(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'safety_advisory',
  content TEXT NOT NULL,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_mdrrmo BOOLEAN NOT NULL DEFAULT false,
  is_from_mdrrmo BOOLEAN NOT NULL DEFAULT false,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  reposted_by TEXT,
  reposted_from_id UUID REFERENCES public.public_broadcasts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.public_broadcasts
  ALTER COLUMN barangay_id DROP NOT NULL,
  ALTER COLUMN author_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_mdrrmo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_from_mdrrmo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reposted_by TEXT,
  ADD COLUMN IF NOT EXISTS reposted_from_id UUID REFERENCES public.public_broadcasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_public_broadcasts_barangay
  ON public.public_broadcasts(barangay_id);
CREATE INDEX IF NOT EXISTS idx_public_broadcasts_created_at
  ON public.public_broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_broadcasts_municipal_feed
  ON public.public_broadcasts(created_at DESC)
  WHERE is_mdrrmo = true AND barangay_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_broadcasts_unique_barangay_repost
  ON public.public_broadcasts(barangay_id, reposted_from_id)
  WHERE reposted_from_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
