-- 045: Management — a role that holds everything, and keeps holding it.
--
-- Superadmin already has every permission, but it is the platform's own
-- administrative role: it exists so IT can configure the thing. Management
-- wants the same reach for a different reason — to see and do anything on the
-- system without asking — and lumping them together means one role carries
-- two arguments about who should have it.
--
-- WHY NOT JUST TICK EVERY BOX ON THE SCREEN. Because that is a snapshot. A
-- role given the thirty-one permissions that exist today silently stops being
-- "everything" the first time a thirty-second is added, and nobody finds out
-- until somebody from management is refused something. That already happened
-- once here: the comment on 014 records the owner role going stale when
-- platform.registry.approve arrived, which is why the trigger exists.
--
-- So this is written as a property of the role rather than a list of grants.
-- A role marked grants_everything gets every permission that exists now and
-- every one added later, by the same trigger that already serves Superadmin.
-- The flag also replaces that trigger's hard-coded role code, so the next role
-- that needs this is a flag rather than an edit to a function.

ALTER TABLE role
    ADD COLUMN IF NOT EXISTS grants_everything boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN role.grants_everything IS
    'This role holds every permission, including ones added after it was '
    'created. Enforced by the permission_grants_owner trigger, not by a '
    'stored list, so it cannot go stale. Set it deliberately: a role with '
    'this flag can do anything on the platform, including grant access.';

-- Superadmin has always meant this; now it says so rather than relying on a
-- code string inside a function body.
UPDATE role SET grants_everything = true WHERE code = 'SUPERADMIN';

INSERT INTO role (code, name, description, is_system, grants_everything)
VALUES ('MANAGEMENT', 'Management',
        'Every permission on the platform, including any added in future. '
        'For the management team who need to see and act on anything without '
        'being granted each module in turn. Distinct from Superadmin, which '
        'is IT''s own administrative role, so the two can be given and taken '
        'away for different reasons.',
        FALSE, TRUE)
ON CONFLICT (code) DO UPDATE
    SET grants_everything = TRUE,
        description = EXCLUDED.description;

-- ── the standing grant, now driven by the flag ──────────────────────────────

CREATE OR REPLACE FUNCTION grant_new_permission_to_owner() RETURNS trigger AS $$
BEGIN
    INSERT INTO role_permission (role_id, permission_id)
    SELECT role_id, NEW.permission_id FROM role WHERE grants_everything
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS permission_grants_owner ON permission;
CREATE TRIGGER permission_grants_owner
    AFTER INSERT ON permission
    FOR EACH ROW EXECUTE FUNCTION grant_new_permission_to_owner();

-- A role can also be promoted to everything after the fact, and the grants
-- have to catch up when that happens — the trigger above only fires on new
-- permissions, not on a newly flagged role.
CREATE OR REPLACE FUNCTION catch_up_everything_role() RETURNS trigger AS $$
BEGIN
    IF NEW.grants_everything THEN
        INSERT INTO role_permission (role_id, permission_id)
        SELECT NEW.role_id, permission_id FROM permission
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS role_holds_everything ON role;
CREATE TRIGGER role_holds_everything
    AFTER INSERT OR UPDATE OF grants_everything ON role
    FOR EACH ROW EXECUTE FUNCTION catch_up_everything_role();

-- And catch up the rows that already exist, since the triggers above only
-- fire on writes made after this migration.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM role r, permission p
 WHERE r.grants_everything
ON CONFLICT DO NOTHING;
