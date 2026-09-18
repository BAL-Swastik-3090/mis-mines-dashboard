-- 029: the platform does not have an owner.
--
-- The top role was called PLATFORM_OWNER / "Platform Owner". Migration 002
-- argued that naming roles for capability rather than seniority was the right
-- instinct, and it was — but "owner" is not a capability. It says the platform
-- belongs to whoever holds the role, and it does not. The platform belongs to
-- the mine. The people holding this role administer it on the mine's behalf,
-- which is what "superadmin" has always meant and what the legacy dashboard
-- already called the same thing.
--
-- So the role becomes SUPERADMIN / "Superadmin", which is also what the users
-- being migrated from the old system were called — the importer was already
-- translating superadmin into PLATFORM_OWNER on the way in, and now has
-- nothing to translate.
--
-- Nothing about who can do what changes. Same role_id, same grants, same
-- people. Only the word.

UPDATE role
   SET code = 'SUPERADMIN',
       name = 'Superadmin',
       description = 'Administers the whole platform: the registry, the roster, '
                     'settings, and the roles other people hold.'
 WHERE code = 'PLATFORM_OWNER';

-- The standing grant from 014 names the role in its body, so it has to be
-- rewritten rather than left pointing at a code nothing matches — a trigger
-- that silently grants nothing is worse than no trigger, because the first
-- symptom is a permission added months later that nobody can use.
CREATE OR REPLACE FUNCTION grant_new_permission_to_owner() RETURNS trigger AS $$
BEGIN
    INSERT INTO role_permission (role_id, permission_id)
    SELECT role_id, NEW.permission_id FROM role WHERE code = 'SUPERADMIN'
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS permission_grants_owner ON permission;
CREATE TRIGGER permission_grants_owner
    AFTER INSERT ON permission
    FOR EACH ROW EXECUTE FUNCTION grant_new_permission_to_owner();

-- And make sure the role still holds everything, in case a permission landed
-- between the rename above and the trigger being rebuilt.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE r.code = 'SUPERADMIN'
ON CONFLICT DO NOTHING;
