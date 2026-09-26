-- Keep resident barangay assignment separate from users.unit_type, which is
-- an enum for responder specialties (police, fire, medical, etc.).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS barangay_name TEXT;

-- Used by account updates and password changes in the backend.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
