-- Required by Barangay App email-OTP registration, which creates Admin accounts.
-- Existing installations created barangay_role with only captain/team_leader/volunteer.
ALTER TYPE public.barangay_role ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE public.barangay_role ADD VALUE IF NOT EXISTS 'dispatcher';
ALTER TYPE public.barangay_role ADD VALUE IF NOT EXISTS 'responder';
ALTER TYPE public.barangay_role ADD VALUE IF NOT EXISTS 'staff';

-- The registration endpoint saves the user's barangay position with the account.
ALTER TABLE public.barangay_users
  ADD COLUMN IF NOT EXISTS position_designation TEXT;
