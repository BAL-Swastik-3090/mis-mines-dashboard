-- Seeing who used the platform should not mean being able to change who may.
--
-- The Usage screen was gated on `access.users.view`, which was right on the
-- day it was built — the only people who had it were administrators, and the
-- argument was that seeing a colleague's activity is seeing a colleague's
-- details. That argument still holds. What does not hold is the consequence:
-- `access.users.view` is the Access Control screen, so the only way to let a
-- department head read the usage figures was to hand them the user list, the
-- role grid and the people who can revoke each other.
--
-- A "Usage Viewer" built that way would be an Access Manager wearing a
-- different name, and the first person to notice would be right to ask why.
--
-- So usage gets its own permission. It is marked sensitive because it is:
-- these pages name individuals, say how long each was at a screen and what
-- they changed, and that is not a thing to hand out because somebody asked for
-- "the dashboard". Anybody who already holds access.users.view keeps their
-- view of it, so no administrator loses anything today.

INSERT INTO permission (code, name, description, module, is_sensitive, sort_order)
SELECT 'usage.view',
       'View platform usage',
       'See who signs in, which screens they open and what they change. '
       'Names individuals, so it is granted deliberately rather than as part '
       'of a general dashboard role.',
       'Access', TRUE,
       COALESCE((SELECT MAX(sort_order) FROM permission WHERE module = 'Access'), 0) + 1
 WHERE NOT EXISTS (SELECT 1 FROM permission WHERE code = 'usage.view');


-- The role. Deliberately holds ONE permission.
--
-- A role that grows extra permissions "while we are here" is how Dashboard
-- Viewer ends up able to edit a roster. This one does what its name says and
-- nothing else, so that granting it needs no explanation and revoking it
-- breaks nothing else.
INSERT INTO role (code, name, description, status, is_system, grants_everything, created_by)
SELECT 'USAGE_VIEWER', 'Usage Viewer',
       'Read the Usage screen: who signs in, what they open, what they change. '
       'No access to user management, roles, or any register.',
       'ACTIVE', FALSE, FALSE, 'migration-068'
 WHERE NOT EXISTS (SELECT 1 FROM role WHERE code = 'USAGE_VIEWER');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM role r, permission p
 WHERE r.code = 'USAGE_VIEWER' AND p.code = 'usage.view'
   AND NOT EXISTS (SELECT 1 FROM role_permission rp
                    WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);


-- Superadmin needs no row: it is grants_everything. Access Manager does get
-- one, so that the people who could already read Usage through
-- access.users.view keep reading it after the gate changes, without anybody
-- having to notice and fix it.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM role r, permission p
 WHERE r.code = 'ACCESS_MANAGER' AND p.code = 'usage.view'
   AND NOT EXISTS (SELECT 1 FROM role_permission rp
                    WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
