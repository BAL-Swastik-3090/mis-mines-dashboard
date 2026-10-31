-- 091: mines_user_role and mines_role_page_access get a home in Postgres.
--
-- These two are the only tables the login path uses that NOTHING ELSE OWNS.
-- The other four are shared estate:
--
--   intranet_user_login         the intranet's credentials, ~25 apps read it
--   sap_employee_details        SAP's, and already live in sap_odata_api
--   digital_apps_user_sessions  every intranet app's sessions, one table
--   digital_apps_page_views     the same
--
-- These two carry the word "mines" in their names because they are this
-- dashboard's own: who was invited, and which pages their role may open. No
-- other application reads or writes them. That is what makes them safe to move
-- while the rest stays where it is, and it is why they move first.
--
-- ── THE COLUMNS ARE THE ONES THE CODE ALREADY WRITES ────────────────────────
-- Taken from the queries rather than from the MySQL DDL, because MySQL was
-- unreachable when this was written (80.9.2.78 refusing on 3306, from this
-- host and from the production host alike -- usage_sync recorded the same
-- failure at 18:26). The write sites are:
--
--   roles.py  INSERT INTO mines_user_role (emp_id, role, updated_by, updated_at)
--   roles.py  INSERT INTO mines_role_page_access (role, page, allowed,
--                                                 updated_by, updated_at)
--
-- and the read sites select role; and role, page, allowed. If the MySQL table
-- carries columns beyond these, nothing in this application reads them.
--
-- ── THESE TABLES ARRIVE EMPTY AND THAT IS DANGEROUS ─────────────────────────
-- The dashboard is invite-only: explicit_role() returning None means "not
-- invited", and a login is refused. An empty mines_user_role therefore does
-- not degrade access, it removes it from EVERYONE, including the people who
-- would have to put it back.
--
-- So creating these tables is not the switch. The switch is the copy, and the
-- copy needs MySQL. Until scripts/migrate/copy_access_tables.py has run and
-- been checked row for row, the application must keep reading MySQL. This
-- migration is deliberately safe to apply early and on its own: it adds two
-- tables nothing yet queries.

CREATE TABLE IF NOT EXISTS mines_user_role (
    emp_id      VARCHAR(20)  PRIMARY KEY,
    role        VARCHAR(32)  NOT NULL,
    updated_by  VARCHAR(20),
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE mines_user_role IS
    'Mines dashboard access role per employee. This app only. A row here is '
    'the invitation -- no row means no access, not a demoted one.';

-- The role is free text on the MySQL side and auth._known_role() already
-- trims and lowercases before comparing, so no CHECK constraint is imposed
-- here. A role this build does not recognise must cost privileges, never
-- access -- see the note in explicit_role() about the day 'superadmin' was
-- granted to someone while the server still ran a build that knew only three
-- names. A CHECK would have turned that into a locked door.

CREATE TABLE IF NOT EXISTS mines_role_page_access (
    role        VARCHAR(32)  NOT NULL,
    page        VARCHAR(40)  NOT NULL,
    allowed     BOOLEAN      NOT NULL DEFAULT FALSE,
    updated_by  VARCHAR(20),
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role, page)
);

COMMENT ON TABLE mines_role_page_access IS
    'Which pages each Mines role may open. Empty means every role sees every '
    'page -- the pre-table behaviour _page_access_map() falls back to.';

-- allowed is BOOLEAN here where MySQL had TINYINT(1). The read does
-- `if row["allowed"]`, which is true for 1 and for TRUE alike, so the
-- application cannot tell the difference. The copy casts on the way in.
