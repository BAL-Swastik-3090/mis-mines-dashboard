-- 046: the standing "everything" grant belongs to Superadmin alone.
--
-- 045 created a Management role carrying every permission automatically, on
-- the reasoning that management wants full reach. That was the wrong call and
-- it was mine, not the mine's: it hands a second role the right to grant
-- access — including to itself — and it does so for every permission added in
-- future, without anybody deciding that each time.
--
-- The rule the mine actually wants:
--
--   SUPERADMIN   holds everything, always, including permissions that do not
--                exist yet. That is the point of it — a module still being
--                built must be reachable by the person building it without a
--                grant being remembered first.
--
--   EVERY OTHER  holds exactly what a superadmin has chosen to give it, and
--   ROLE         nothing arrives by itself. An admin role is an ordinary role
--                with a generous list, not a role that cannot be audited
--                because its contents are implicit.
--
-- The flag from 045 stays: it is a better home for this rule than a role code
-- buried in a trigger body, and it keeps Superadmin current with new and
-- in-development permissions. Only its second holder goes.

-- Nobody held it (checked before writing this), so removing it takes no
-- access away from anybody.
DELETE FROM role_permission
 WHERE role_id IN (SELECT role_id FROM role WHERE code = 'MANAGEMENT');

DELETE FROM role WHERE code = 'MANAGEMENT';

-- Belt and braces: whatever else exists, only Superadmin carries the standing
-- grant. A role that gains it later must be a deliberate, named act.
UPDATE role SET grants_everything = FALSE WHERE code <> 'SUPERADMIN';

COMMENT ON COLUMN role.grants_everything IS
    'Superadmin only. This role holds every permission, including ones added '
    'after it was created, so a module under development is reachable without '
    'a grant being remembered first. Every other role holds exactly what a '
    'superadmin has given it: an admin role is an ordinary role with a long '
    'list, not one whose contents are implicit and therefore unauditable.';
