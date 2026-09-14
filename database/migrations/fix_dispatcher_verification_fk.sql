-- ==============================================================================
-- Migration: Fix Barangay Dispatcher Verifications Foreign Key Constraint
-- Description:
--   Allows pending dispatcher accounts to be created in
--   `barangay_dispatcher_verifications` BEFORE they are approved by MDRRMO into
--   `barangay_users`.
--
-- Instructions: Run this script in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/xtbdzptngsullaxubded/sql/new
-- ==============================================================================

-- 1. Drop the foreign key constraint that blocks inserting unapproved dispatchers
ALTER TABLE barangay_dispatcher_verifications
  DROP CONSTRAINT IF EXISTS barangay_dispatcher_verifications_user_id_fkey;

-- 2. Make user_id nullable or unconstrained so new UUIDs can be inserted before approval
ALTER TABLE barangay_dispatcher_verifications
  ALTER COLUMN user_id DROP NOT NULL;

-- 3. Add password_hash column so pending dispatchers can log in from any client/server instance
ALTER TABLE barangay_dispatcher_verifications
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 4. Reload schema cache in Supabase PostgREST
NOTIFY pgrst, 'reload schema';
