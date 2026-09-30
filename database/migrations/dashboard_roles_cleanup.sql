-- Run after dashboard_roles_add.sql and dashboard_roles_singleton.sql.
-- Existing commander accounts are carried forward as one master admin; any
-- additional legacy commanders become admins. All former volunteer/officer
-- accounts become responders, retaining their specialization data.
WITH commander_accounts AS (
  SELECT
    id,
    row_number() OVER (ORDER BY created_at, id) AS account_number,
    EXISTS (SELECT 1 FROM users WHERE role = 'master_admin') AS master_exists
  FROM users
  WHERE role = 'commander'
)
UPDATE users AS account
SET role = CASE
  WHEN NOT legacy.master_exists AND legacy.account_number = 1 THEN 'master_admin'::user_role
  ELSE 'admin'::user_role
END
FROM commander_accounts AS legacy
WHERE account.id = legacy.id;

UPDATE users
SET role = 'responder'
WHERE role IN ('volunteer_specialist', 'volunteer_general', 'professional_unit');

ALTER TABLE users ALTER COLUMN role SET DEFAULT 'responder';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_allowed_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_allowed_check
  CHECK (role IN ('master_admin', 'admin', 'logistics', 'dispatcher', 'responder'));
