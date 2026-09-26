-- Legacy resident assignment column and user update timestamp.
-- New resident accounts are stored in resident_user; barangay_name on users
-- remains only for backwards compatibility with existing deployments.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS barangay_name TEXT;

-- Used by account updates and password changes in the backend.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
