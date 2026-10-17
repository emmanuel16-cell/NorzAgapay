-- Remove the retired email and username data model after phone-only clients
-- and authentication APIs are deployed. Run the two 20261017 preflights first.
BEGIN;

-- Update the only database routine that linked a responder account to a roster
-- profile before removing the columns it used.
CREATE OR REPLACE FUNCTION public.assign_respond_unit_team_leader_v1(
  p_unit_id UUID,
  p_officer_id UUID,
  p_responder_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_unit public.respond_units%ROWTYPE;
BEGIN
  SELECT * INTO v_unit FROM public.respond_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Respond unit not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = p_responder_user_id;
  IF NOT FOUND OR v_user.role::TEXT <> 'responder' OR v_user.status::TEXT <> 'active' THEN
    RAISE EXCEPTION 'Team Leader must have an active responder account' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.officers
    WHERE id = p_officer_id
      AND public.normalize_ph_mobile_number(phone) = public.normalize_ph_mobile_number(v_user.phone)
  ) THEN
    RAISE EXCEPTION 'Team Leader profile must match the responder account mobile number' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.respond_unit_members AS current_leader
    JOIN public.mdrrmo_report_assignments AS assignments
      ON assignments.responder_id = current_leader.responder_user_id
    WHERE current_leader.unit_id = p_unit_id
      AND current_leader.member_role = 'team_leader'
      AND current_leader.is_active
      AND current_leader.responder_user_id <> p_responder_user_id
      AND assignments.status IN ('assigned', 'responding')
  ) THEN
    RAISE EXCEPTION 'Cannot change Team Leader while the current leader has an active dispatch' USING ERRCODE = '23514';
  END IF;

  UPDATE public.respond_unit_members
  SET member_role = 'unassigned', responder_user_id = NULL
  WHERE unit_id = p_unit_id AND is_active AND member_role = 'team_leader'
    AND officer_id <> p_officer_id;

  INSERT INTO public.respond_unit_members (unit_id, officer_id, responder_user_id, member_role, is_active)
  VALUES (p_unit_id, p_officer_id, p_responder_user_id, 'team_leader', true)
  ON CONFLICT (unit_id, officer_id) DO UPDATE SET
    responder_user_id = EXCLUDED.responder_user_id,
    member_role = 'team_leader',
    is_active = true;

  UPDATE public.respond_units
  SET officer_ids = ARRAY(
    SELECT DISTINCT officer_id
    FROM unnest(COALESCE(officer_ids, '{}'::UUID[]) || ARRAY[p_officer_id]) AS ids(officer_id)
  )
  WHERE id = p_unit_id;

  RETURN jsonb_build_object('unit_id', p_unit_id, 'responder_user_id', p_responder_user_id);
END;
$$;

-- Email-like strings may have been stored in reporter_phone before the
-- reporter_email column was introduced. Clear only those malformed values.
UPDATE public.incident_reports SET reporter_phone = NULL WHERE reporter_phone LIKE '%@%';
UPDATE public.barangay_reports SET reporter_phone = NULL WHERE reporter_phone LIKE '%@%';
UPDATE public.mdrrmo_reports SET reporter_phone = NULL WHERE reporter_phone LIKE '%@%';

DROP TRIGGER IF EXISTS users_sync_username_registry ON public.users;
DROP TRIGGER IF EXISTS barangay_users_sync_username_registry ON public.barangay_users;
DROP TRIGGER IF EXISTS resident_user_sync_username_registry ON public.resident_user;
DROP FUNCTION IF EXISTS public.sync_account_username_registry();
DROP TABLE IF EXISTS public.account_usernames;

DROP INDEX IF EXISTS public.users_username_lower_unique_idx;
DROP INDEX IF EXISTS public.barangay_users_username_lower_unique_idx;
DROP INDEX IF EXISTS public.resident_user_username_lower_unique_idx;
DROP INDEX IF EXISTS public.idx_users_email;
DROP INDEX IF EXISTS public.idx_barangay_users_email;

ALTER TABLE public.users DROP COLUMN IF EXISTS username, DROP COLUMN IF EXISTS email;
ALTER TABLE public.barangay_users DROP COLUMN IF EXISTS username, DROP COLUMN IF EXISTS email;
ALTER TABLE public.resident_user DROP COLUMN IF EXISTS username, DROP COLUMN IF EXISTS email;
ALTER TABLE public.officers DROP COLUMN IF EXISTS email;
ALTER TABLE public.barangay_dispatcher_verifications DROP COLUMN IF EXISTS email;
ALTER TABLE public.incident_reports DROP COLUMN IF EXISTS reporter_email;
ALTER TABLE public.barangay_reports DROP COLUMN IF EXISTS reporter_email;
ALTER TABLE public.mdrrmo_reports DROP COLUMN IF EXISTS reporter_email;

COMMIT;
