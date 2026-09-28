-- A link out of the platform is still a door, and it had no lock.
--
-- PR/PO Status is another team's application; this dashboard only links to it.
-- Because it was a link rather than a page, the sidebar drew it for EVERYONE —
-- the filter read `i.kind === "link" || canOpen(...)`, so links skipped the
-- check entirely. A weighbridge operator given nothing but the gate and the
-- bridge still had procurement one click away.
--
-- Nothing behind that link is ours to protect: it has its own login and its own
-- rules. What is ours is not advertising it to people who have no business
-- there. A door you do not want used should not be signposted.
--
-- GRANTED TO EVERY ROLE THAT EXISTS TODAY, deliberately. Everyone could reach
-- it this morning, and a tidy-up that quietly removes a link somebody uses
-- daily is a tidy-up that gets reverted with bad feeling. The only role left
-- out is the one the request was about.

INSERT INTO permission (code, name, description, module, is_sensitive, sort_order)
SELECT 'link.prpo.view',
       'See the PR/PO Status link',
       'Show the link to the purchase requisition and order status application. '
       'That application has its own login; this only decides whether the '
       'shortcut appears in the sidebar.',
       'Dashboards', FALSE,
       COALESCE((SELECT MAX(sort_order) FROM permission WHERE module = 'Dashboards'), 0) + 1
 WHERE NOT EXISTS (SELECT 1 FROM permission WHERE code = 'link.prpo.view');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM role r, permission p
 WHERE p.code = 'link.prpo.view'
   AND r.status = 'ACTIVE'
   AND r.code <> 'GATE_WEIGHBRIDGE'          -- the one this was asked for
   AND NOT EXISTS (SELECT 1 FROM role_permission rp
                    WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);


-- A role for the people who need to see everything and change nobody's access.
--
-- Asked for as "all modules, so I can add and remove them whenever needed" —
-- a starting point to trim, rather than a fixed shape. So it holds every
-- permission on the platform save two.
--
-- WHAT IT DOES NOT HOLD, and why those two:
--
--   access.users.manage   grant and revoke other people's access
--   access.roles.manage   change what any role means
--
-- Those are not a module. They are the ability to rewrite the access system
-- itself, including one's own rights and everybody else's, and a role holding
-- them is Superadmin whatever it is called. Keeping them out is what makes
-- this a role that can be given to a department head rather than to IT.
--
-- Everything else is in, including the sensitive operational ones — overriding
-- a block, writing a machine off, entering a weight by hand. Those are
-- accountable acts by senior people, which is different from being able to
-- silently widen your own access afterwards.
--
-- Add either of the two with one INSERT if that is wanted; it is a decision,
-- not a limitation.

INSERT INTO role (code, name, description, status, is_system, grants_everything, created_by)
SELECT 'MANAGEMENT', 'Management',
       'See and operate every module: dashboards, registers, operations, the '
       'weighbridge, the organisation and platform usage. Cannot grant or '
       'revoke access, and cannot change what a role means.',
       'ACTIVE', FALSE, FALSE, 'migration-070'
 WHERE NOT EXISTS (SELECT 1 FROM role WHERE code = 'MANAGEMENT');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM role r, permission p
 WHERE r.code = 'MANAGEMENT'
   AND p.code NOT IN ('access.users.manage', 'access.roles.manage')
   AND NOT EXISTS (SELECT 1 FROM role_permission rp
                    WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
