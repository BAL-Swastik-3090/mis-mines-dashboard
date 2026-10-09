-- 082: AMIRA Accounting stops riding on the MIS dashboard's permission.
--
-- AMIRA has never had a permission of its own. pageAccess.ts gated it on
-- dashboard.mis and said so plainly:
--
--     "GATED ON THE MIS DASHBOARD'S OWN PERMISSION, not one of its own...
--      Promote it to its own page permission when the mine wants the two
--      audiences separated."
--
-- The mine now wants them separated. Thirty-eight people hold dashboard.mis,
-- and every one of them can open AMIRA and read what the contained chromium
-- is worth from mine to plant. It is to be four: the three superadmins and
-- Sudip Hajra.
--
-- WHY A PERMISSION AND NOT THE LEGACY ROLE TABLE. mines_role_page_access gates
-- by the old mines role -- superadmin / admin / manager / viewer -- and cannot
-- express "this one man". Sudip Hajra is 'admin', and so are all three
-- superadmins and others besides; that layer cannot tell them apart. The
-- middleware in main.py checks a PERMISSION against the person, which can.
--
-- THE SUPERADMINS NEED NOTHING HERE. access.py unions their permissions with a
-- CROSS JOIN over the whole permission table, precisely "so it picks up
-- permissions added later". Granting them this row by hand would be a second
-- source of truth that could later disagree with the first.

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order)
VALUES ('dashboard.amira', 'Dashboards', 'AMIRA Accounting',
        'Contained chromium followed from mine to plant, and what it is worth',
        -- Sensitive: it is the metal balance, not a production count.
        TRUE, 32)
ON CONFLICT (code) DO NOTHING;


-- A role of exactly one permission.
--
-- Not added to an existing role: every role that already exists is held by
-- people who are meant to lose this screen, so widening one would put the
-- permission straight back where it is being taken from.
INSERT INTO role (code, name, description, is_system, status, created_by)
VALUES ('AMIRA_VIEWER', 'AMIRA Accounting',
        'Read the AMIRA chromium accounting screen. Grants nothing else.',
        FALSE, 'ACTIVE', 'migration-082')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, 'migration-082'
  FROM role r, permission p
 WHERE r.code = 'AMIRA_VIEWER' AND p.code = 'dashboard.amira'
ON CONFLICT DO NOTHING;


-- Sudip Hajra, 2627 (PPIC, Dy General Manager) -- the one person outside the
-- superadmins who keeps it. Matched on the employee number, never the name.
INSERT INTO user_access (emp_id, role_id, valid_from, granted_by)
SELECT '2627', r.role_id, CURRENT_DATE, 'migration-082'
  FROM role r
 WHERE r.code = 'AMIRA_VIEWER'
   AND NOT EXISTS (
       SELECT 1 FROM user_access ua
        WHERE ua.emp_id = '2627' AND ua.role_id = r.role_id
          AND ua.valid_to IS NULL);


-- ---------------------------------------------------------------------------
-- What this migration does NOT do
-- ---------------------------------------------------------------------------
-- It does not revoke anything. Nobody is losing a permission row, because
-- nobody ever had one for AMIRA -- they reached it through dashboard.mis, which
-- they keep, because they still need the MIS dashboard.
--
-- The separation happens in the code that reads these rows: main.py maps the
-- page to dashboard.amira, auth.py maps /api/amira to the amira page rather
-- than to mis, and pageAccess.ts asks for dashboard.amira before drawing the
-- sidebar entry. Without those three edits this migration changes nothing at
-- all, and with them the door closes for everyone not named above.
