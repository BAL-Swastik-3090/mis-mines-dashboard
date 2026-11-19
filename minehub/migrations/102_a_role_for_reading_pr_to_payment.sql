-- 102: a role that reads PR to Payment, and one person who holds it.
--
-- Asked for on 6 November 2026, the day the module went to UAT: a viewer
-- role for the PR to Payment register, and Deepak Kaibart (2812) in it.
--
-- ── WHAT THIS ROLE ACTUALLY GATES, AND WHAT IT DOES NOT ─────────────────────
-- The sidebar entry for PR to Payment checks `link.prpo.view`, so that is the
-- permission this role carries. It is worth knowing where that code came
-- from: migration 070 created it for a SHORTCUT to a separate PR/PO
-- application that had its own login, and it says so in its own description
-- -- "this only decides whether the shortcut appears in the sidebar". 070
-- then granted it to every active role except GATE_WEIGHBRIDGE.
--
-- The internal register was later hung on the same permission. So thirteen of
-- the fifteen roles can already reach PR to Payment, and this role does not
-- narrow that for anybody else -- it only gives one more person a way in
-- without making them a Dashboard Viewer.
--
-- That is a reasonable thing to want and a poor thing to mistake for a
-- restriction. If procurement values and payment status should be held more
-- closely than "anyone who can sign in", the sidebar's `need` has to move to
-- `mines.prpo.view` -- the code the router already accepts and which no
-- permission row exists for -- and that code granted to this role alone.
-- That is a change to AppSidebar.tsx as much as to the database, so it is
-- not done here.
--
-- Matched on the employee number, never the name, as 082 did.

INSERT INTO role (code, name, description, is_system, status, created_by)
VALUES ('PRPO_VIEWER', 'PR to Payment Viewer',
        'Read the PR to Payment register -- requisitions, purchase orders, '
        'NFA status and payment position. Grants nothing else.',
        FALSE, 'ACTIVE', 'migration-102')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, 'migration-102'
  FROM role r, permission p
 WHERE r.code = 'PRPO_VIEWER' AND p.code = 'link.prpo.view'
ON CONFLICT DO NOTHING;

-- Deepak Kaibart, 2812.
INSERT INTO user_access (emp_id, role_id, valid_from, granted_by)
SELECT '2812', r.role_id, CURRENT_DATE, 'migration-102'
  FROM role r
 WHERE r.code = 'PRPO_VIEWER'
   AND NOT EXISTS (
       SELECT 1 FROM user_access ua
        WHERE ua.emp_id = '2812' AND ua.role_id = r.role_id
          AND ua.valid_to IS NULL);

-- ── WHAT THIS MIGRATION DOES NOT DO ─────────────────────────────────────────
-- It revokes nothing. No existing role loses a permission and no existing
-- person loses access. Holding a permission is the only thing that lets
-- somebody sign in at all, so for anyone who had no access before, this is
-- also their way through the door -- and it opens onto exactly one screen.
