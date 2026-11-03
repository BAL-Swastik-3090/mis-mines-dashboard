-- 097: close the gaps migration 095 left open for things created LATER.
--
-- 095 gave mines_app what it needed on the objects that existed the day it
-- ran, and default privileges so that TABLES and SEQUENCES added afterwards
-- reach it too. Two kinds of object were left out, and neither fails loudly:
--
--   FUNCTIONS. All 262 in minehub are callable today only because 095 ran
--   GRANT EXECUTE ON ALL FUNCTIONS once. The 263rd would not be. The symptom
--   is "permission denied for function" on one page, months after the commit
--   that caused it.
--
--   SEQUENCES in the read-only schemas. Harmless today -- the application
--   never reads one there -- but a grant that is correct only because nobody
--   has tried is not a grant, it is a coincidence.
--
-- The GRANT ... ON ALL statements are repeated as well. They are not
-- redundant: ON ALL applies to what exists at the moment it runs, so a table
-- created between 095 and now by a role whose default privileges were not yet
-- set would have been missed. Re-running costs nothing and leaves no gap to
-- reason about.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
-- It does not make mines_app an owner, and it does not add it to bal_dba.
-- Being able to ALTER or DROP an existing table is a migration's privilege,
-- not an application's, and migrations here are applied by a DBA role -- 095,
-- 096 and this file all were. Granting ownership to get DDL would hand this
-- application authority over pems, scm, finance and every other schema
-- bal_dba owns, which is the thing 095 existed to stop.
--
-- Verified after applying: every table, view, sequence and function the
-- application reaches is reachable, and writes to SAP's feed, writes to the
-- credential table and CREATE DATABASE are all still refused.

-- ── minehub: everything, including what is added later ──────────────────────
GRANT USAGE, CREATE ON SCHEMA minehub TO mines_app;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON ALL TABLES IN SCHEMA minehub TO mines_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA minehub TO mines_app;
GRANT EXECUTE ON ALL FUNCTIONS  IN SCHEMA minehub TO mines_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA minehub TO mines_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA minehub
    GRANT EXECUTE ON FUNCTIONS TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_dba IN SCHEMA minehub
    GRANT EXECUTE ON FUNCTIONS TO mines_app;

-- ...and the reverse, as 095 did for tables and sequences: a function this
-- role creates keeps the audience the rest of the schema has.
ALTER DEFAULT PRIVILEGES FOR ROLE mines_app IN SCHEMA minehub
    GRANT EXECUTE ON FUNCTIONS TO rp_all_ro, rp_all_rw, rp_minehub_ro;

-- ── sap_odata_api: read, and only read ──────────────────────────────────────
GRANT USAGE ON SCHEMA sap_odata_api TO mines_app;
GRANT SELECT ON ALL TABLES    IN SCHEMA sap_odata_api TO mines_app;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA sap_odata_api TO mines_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sap_odata_api TO mines_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA sap_odata_api
    GRANT SELECT ON SEQUENCES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_dba IN SCHEMA sap_odata_api
    GRANT SELECT ON SEQUENCES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA sap_odata_api
    GRANT EXECUTE ON FUNCTIONS TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_dba IN SCHEMA sap_odata_api
    GRANT EXECUTE ON FUNCTIONS TO mines_app;

-- ── balcorpdb: intranet_user_login, for authentication. Read only ───────────
GRANT USAGE ON SCHEMA balcorpdb TO mines_app;
GRANT SELECT ON ALL TABLES    IN SCHEMA balcorpdb TO mines_app;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA balcorpdb TO mines_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA balcorpdb TO mines_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA balcorpdb
    GRANT SELECT ON SEQUENCES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_dba IN SCHEMA balcorpdb
    GRANT SELECT ON SEQUENCES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_balcorpdb IN SCHEMA balcorpdb
    GRANT SELECT ON SEQUENCES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA balcorpdb
    GRANT EXECUTE ON FUNCTIONS TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_dba IN SCHEMA balcorpdb
    GRANT EXECUTE ON FUNCTIONS TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_balcorpdb IN SCHEMA balcorpdb
    GRANT EXECUTE ON FUNCTIONS TO mines_app;

-- ── public: two views live here ─────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO mines_app;
GRANT SELECT ON ALL TABLES    IN SCHEMA public TO mines_app;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO mines_app;

-- NOT granted in public: EXECUTE ON ALL FUNCTIONS. pg_stat_statements_reset
-- lives here, and an application has no business clearing the server's
-- statement statistics. The application calls nothing in this schema.
