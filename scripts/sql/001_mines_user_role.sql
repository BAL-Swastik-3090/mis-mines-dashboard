-- Mines dashboard access roles.
--
-- Run once against the balcorpdb database:
--     mysql -h <host> -u <user> -p balcorpdb < 001_mines_user_role.sql
--
-- This is the ONLY schema change the login work needs. Sessions and page views
-- go into the existing shared digital_apps_* tables with app_source='MINES'; no
-- change is made to any table another application reads or writes.
--
-- Roles are additive. Anyone with valid intranet credentials is a 'viewer'
-- without a row here, so this table stays small and an empty table is a safe
-- state rather than a lockout.

CREATE TABLE IF NOT EXISTS mines_user_role (
    emp_id      VARCHAR(20)  NOT NULL,
    role        VARCHAR(20)  NOT NULL,           -- viewer | manager | admin
    updated_by  VARCHAR(20)  NULL,               -- EMPID who made the change
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (emp_id),
    CONSTRAINT chk_mines_role CHECK (role IN ('viewer','manager','admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Seed the first admin. Without this nobody can open the Roles screen, because
-- granting admin requires already being admin.
-- ---------------------------------------------------------------------------
INSERT INTO mines_user_role (emp_id, role, updated_by)
VALUES ('3101', 'admin', 'SEED')
ON DUPLICATE KEY UPDATE role = 'admin';

SELECT emp_id, role, updated_at FROM mines_user_role;
