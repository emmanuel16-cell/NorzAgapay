-- Run this first as one query. The new labels must commit before the other
-- role migrations use them.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'master_admin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'logistics';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'dispatcher';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'responder';
