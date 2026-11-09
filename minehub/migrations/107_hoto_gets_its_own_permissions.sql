-- 107: HOTO gets its own permissions.
--
-- ── WHY NOT REUSE SOMETHING ─────────────────────────────────────────────────
-- The tempting shortcut is to hang HOTO off a permission that already exists
-- and is widely held. PR to Payment does exactly that: its sidebar entry and
-- its router both gate on `link.prpo.view`, which migration 070 created for a
-- shortcut to a SEPARATE application and then granted to every active role bar
-- one. Thirteen of fifteen roles hold it, so that section is effectively open
-- to anyone who can sign in.
--
-- For a register of purchase orders that is arguable. For HOTO it is not:
-- `hoto.admin` decides who may change which checks block a machine from going
-- to work, and `hoto.override` decides who may release one that is blocked.
-- Those cannot sit behind a permission nobody chose.
--
-- ── FOUR PERMISSIONS, NOT ONE ───────────────────────────────────────────────
--   hoto.capture   the mobile app's own. A tablet needs the fleet, the
--                  operator register and the checklists, and nothing else.
--   hoto.view      read the register. Supervisors, workshop, safety,
--                  management.
--   hoto.admin     build and publish checklists; enrol devices.
--   hoto.override  release a blocked machine. The narrow one -- see below.
--
-- ── ON hoto.override ────────────────────────────────────────────────────────
-- It is given no role of its own, deliberately. A block exists to stop a
-- machine with failed brakes going to work, and the mine has not yet decided
-- who may lift one or on what authority -- question 1 of the three still open
-- in docs/hoto-scope.md section 9.
--
-- BUT IT IS NOT HELD BY NOBODY. A trigger, `permission_grants_owner`, grants
-- every new permission to SUPERADMIN on insert. That is this platform's design
-- and this migration does not fight it -- but it means the superadmins can
-- release a blocked machine from the day this lands, before the mine has
-- agreed that they should. Whoever answers question 1 should decide whether
-- that is the right answer or merely the default one.
--
-- ── WHO GETS hoto.admin TODAY ───────────────────────────────────────────────
-- Nobody is granted it by name. Akash (3101) and Swastik Roy Choudhury (3090)
-- both hold SUPERADMIN, and that role carries grants_everything = true, which
-- the access map unions across every permission -- including ones added after
-- it. So both pick these up the moment the rows below exist. Adding explicit
-- user_access rows for them would be redundant and would have to be revoked
-- twice later.
--
-- HOTO_ADMIN exists for the people who come after: somebody who should
-- maintain checklists without being a superadmin of everything.

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order)
VALUES
  ('hoto.capture', 'HOTO', 'Capture a handover',
   'Record a HOTO from the mobile app. Grants the fleet, operator register and '
   'checklists a device needs to work offline, and nothing else.',
   FALSE, 10),

  ('hoto.view', 'HOTO', 'Read the HOTO register',
   'See handovers, their checklists as answered, readings, defects and photos. '
   'This is the record that gets opened when there is an argument.',
   FALSE, 20),

  ('hoto.admin', 'HOTO', 'Administer HOTO',
   'Build and publish checklists, and enrol devices. Decides which checks block '
   'a machine from going to work.',
   TRUE, 30),

  ('hoto.override', 'HOTO', 'Release a blocked machine',
   'Lift a block raised by a failed critical check. Sensitive: a block exists to '
   'stop a machine with failed brakes going to work. No role of its own until '
   'the mine decides who may lift one; superadmins hold it by platform default.',
   TRUE, 40)
ON CONFLICT (code) DO NOTHING;

-- A role for maintaining checklists without being a superadmin of everything.
INSERT INTO role (code, name, description, is_system, status, created_by)
VALUES ('HOTO_ADMIN', 'HOTO Administrator',
        'Build and publish HOTO checklists, enrol devices, read the register. '
        'Does not grant release of a blocked machine.',
        FALSE, 'ACTIVE', 'migration-107')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, 'migration-107'
  FROM role r, permission p
 WHERE r.code = 'HOTO_ADMIN'
   AND p.code IN ('hoto.admin', 'hoto.view', 'hoto.capture')
ON CONFLICT DO NOTHING;

-- ── WHAT THIS MIGRATION DOES NOT DO ─────────────────────────────────────────
-- It grants nothing to any person by name and revokes nothing. hoto.override
-- gets no role of its own; superadmins reach it through the platform's own
-- trigger, which is noted above rather than worked around, because quietly
-- excluding one permission from a rule the whole platform follows would be a
-- worse surprise than the one it prevents.
