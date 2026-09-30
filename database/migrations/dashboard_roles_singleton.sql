-- Run separately after dashboard_roles_add.sql has committed.
-- Normalize pre-existing duplicate master accounts before enforcing the singleton.
WITH ranked_master_admins AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS account_number
  FROM users
  WHERE role = 'master_admin'
)
UPDATE users AS account
SET role = 'admin'
FROM ranked_master_admins AS ranked
WHERE account.id = ranked.id
  AND ranked.account_number > 1;

-- Prevent concurrent initial setup requests from creating multiple master admins.
CREATE UNIQUE INDEX IF NOT EXISTS users_single_master_admin_idx
  ON users (role)
  WHERE role = 'master_admin';
