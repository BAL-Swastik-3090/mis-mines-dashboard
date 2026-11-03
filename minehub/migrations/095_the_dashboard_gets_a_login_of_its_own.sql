-- 095: the dashboard stops signing in as the superuser.
--
-- Until now this application connected to corpappdb as `postgres` -- the
-- superuser that owns the database, bypasses row security, and can drop any
-- schema on the server. Nothing in the dashboard needs any of that. It reads
-- SAP's feed, reads one credential table, and reads and writes its own
-- schema. Three of those are read-only and the fourth is `minehub`.
--
-- The cost of the superuser was never a hypothetical privilege: it was that
-- the estate could not tell this application's connections apart from a DBA's
-- or a migration script's. A connection count on 2026-11-03 found 55 sessions
-- on corpappdb, 49 of them with no application_name and 23 of them logged in
-- as `postgres`. "How much of this is the dashboard?" had no answer. A named
-- role answers it, and so does the application_name the code now sets.
--
-- PEMS already works this way -- `pems_sync` is its own login, with USAGE on
-- the four schemas it touches and nothing else. This follows that precedent.
--
-- ── WHY NOT TRANSFER OWNERSHIP OF minehub ───────────────────────────────────
-- The obvious tidy move is to make the new role own the schema it writes.
-- It is not done here. `minehub` is owned by bal_dba and shared: pems_sync
-- holds INSERT/SELECT/UPDATE on its tables, and three reporting roles read
-- them. Reassigning the owner changes whose ALTER DEFAULT PRIVILEGES apply to
-- new objects, which would quietly strand the next table those roles need.
-- The application does no DDL at runtime -- migrations are applied by hand by
-- someone holding a DBA role -- so ownership buys it nothing it would use.
--
-- What it does get is CREATE on the schema, so a migration CAN be run as this
-- role when that is convenient; the default privileges at the bottom make
-- sure anything it creates stays readable by the roles that read the rest.
--
-- ── THE PASSWORD IS NOT IN THIS FILE ────────────────────────────────────────
-- CREATE ROLE here is passwordless and cannot log in until a password is set
-- out of band, on the server, straight into the deployment's .env. A password
-- committed to a migration is a password in the repository's history forever.

-- ── the role ────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mines_app') THEN
        CREATE ROLE mines_app LOGIN;
    END IF;
END
$$;

COMMENT ON ROLE mines_app IS
    'Kaliapani Mines dashboard (mis-mines-dashboard). Read/write on minehub; '
    'read-only on sap_odata_api, balcorpdb and public. Not a superuser, owns '
    'nothing. See migration 095.';

GRANT CONNECT ON DATABASE corpappdb TO mines_app;

-- ── minehub: the schema this application owns the contents of ───────────────
GRANT USAGE, CREATE ON SCHEMA minehub TO mines_app;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON ALL TABLES IN SCHEMA minehub TO mines_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA minehub TO mines_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA minehub TO mines_app;

-- Tables a DBA adds to minehub later must reach this role too, or the next
-- migration applied as postgres leaves the application unable to read its own
-- new table. Both owners that create objects here are covered.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA minehub
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_dba IN SCHEMA minehub
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA minehub
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_dba IN SCHEMA minehub
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO mines_app;

-- ...and the reverse. Anything mines_app creates in minehub keeps the same
-- audience the rest of the schema has, so reporting does not develop holes.
ALTER DEFAULT PRIVILEGES FOR ROLE mines_app IN SCHEMA minehub
    GRANT SELECT ON TABLES TO rp_all_ro, rp_minehub_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE mines_app IN SCHEMA minehub
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rp_all_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE mines_app IN SCHEMA minehub
    GRANT SELECT, INSERT, UPDATE ON TABLES TO pems_sync;
ALTER DEFAULT PRIVILEGES FOR ROLE mines_app IN SCHEMA minehub
    GRANT SELECT ON SEQUENCES TO rp_all_ro, rp_minehub_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE mines_app IN SCHEMA minehub
    GRANT USAGE, SELECT ON SEQUENCES TO rp_all_rw;

-- ── sap_odata_api: SAP's feed. Read only -- the pipeline writes it ──────────
GRANT USAGE ON SCHEMA sap_odata_api TO mines_app;
GRANT SELECT ON ALL TABLES IN SCHEMA sap_odata_api TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA sap_odata_api
    GRANT SELECT ON TABLES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_dba IN SCHEMA sap_odata_api
    GRANT SELECT ON TABLES TO mines_app;

-- ── balcorpdb: intranet_user_login, for authentication. Read only ───────────
GRANT USAGE ON SCHEMA balcorpdb TO mines_app;
GRANT SELECT ON ALL TABLES IN SCHEMA balcorpdb TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA balcorpdb
    GRANT SELECT ON TABLES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_dba IN SCHEMA balcorpdb
    GRANT SELECT ON TABLES TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bal_balcorpdb IN SCHEMA balcorpdb
    GRANT SELECT ON TABLES TO mines_app;

-- ── public: two views live here ─────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO mines_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mines_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT ON TABLES TO mines_app;
