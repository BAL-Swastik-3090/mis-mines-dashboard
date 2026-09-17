-- Add the 'superadmin' role.
--
-- Run once against the balcorpdb database:
--     mysql -h <host> -u <user> -p balcorpdb < 003_add_superadmin_role.sql
--
-- Superadmin sits above admin and is the only role that reaches the MineHub
-- platform modules (master data registry, migrations, platform administration).
-- The existing three are unchanged:
--
--     viewer      1  read the dashboards allowed by the page matrix
--     manager     2  reserved for elevated operational access
--     admin       3  manages roles and page access
--     superadmin  4  the above, plus the MineHub platform modules
--
-- The role column is constrained by a CHECK, so the constraint has to be
-- widened before any superadmin row can be inserted. This is additive: no
-- existing row changes, and nobody's access is altered by running it.

-- MySQL has no "ALTER CONSTRAINT", so the check is dropped and re-added. Both
-- statements are inside one ALTER so the table is never left unconstrained.
ALTER TABLE mines_user_role
    DROP CHECK chk_mines_role,
    ADD CONSTRAINT chk_mines_role
        CHECK (role IN ('viewer','manager','admin','superadmin'));

-- Page access is per role, so the new role needs its rows or it sees nothing.
-- Seeded open, matching the other roles.
INSERT INTO mines_role_page_access (role, page, allowed, updated_by) VALUES
    ('superadmin','mis',1,'SEED'),
    ('superadmin','oee',1,'SEED'),
    ('superadmin','intelligence',1,'SEED'),
    ('superadmin','fuel-management',1,'SEED'),
    ('superadmin','ev-tracking',1,'SEED')
ON DUPLICATE KEY UPDATE allowed = VALUES(allowed);

SELECT role, COUNT(*) AS pages FROM mines_role_page_access GROUP BY role ORDER BY role;
