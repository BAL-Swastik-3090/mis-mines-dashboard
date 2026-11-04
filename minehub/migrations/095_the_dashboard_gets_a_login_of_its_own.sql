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

-- Whichever database this is run against, not the one it was written for.
-- Named literally, this line was the reason the whole migration set could not
-- be replayed anywhere else: a rebuild on the development server in November
-- 2026 applied 96 of 100 files and stopped here, on `database "corpappdb"
-- does not exist`, taking 097 down with it for want of the role this creates.
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO mines_app', current_database());
END
$$;

-- ── minehub: the schema this application owns the contents of ───────────────
GRANT USAGE, CREATE ON SCHEMA minehub TO mines_app;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON ALL TABLES IN SCHEMA minehub TO mines_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA minehub TO mines_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA minehub TO mines_app;

-- Tables a DBA adds to minehub later must reach this role too, or the next
-- migration applied as postgres leaves the application unable to read its own
-- new table. Both owners that create objects here are covered.
--
-- EVERY ROLE BELOW IS CHECKED FOR FIRST. The estate roles -- bal_dba, the
-- rp_* reporting roles, pems_sync -- exist on corpappdb and on nothing else.
-- Named unconditionally, this file could be replayed only against the one
-- server it was written on, which was found the first time the migration set
-- was replayed from nothing: 096 of 100 applied, and this one stopped on
-- `role "rp_minehub_ro" does not exist`. A grant to a role that is not there
-- is not an error to raise, it is a grant with nothing to make.
DO $$
DECLARE owner_role text;
BEGIN
    FOREACH owner_role IN ARRAY ARRAY['postgres', 'bal_dba'] LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA minehub '
            'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER '
            'ON TABLES TO mines_app', owner_role);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA minehub '
            'GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO mines_app', owner_role);
    END LOOP;
END
$$;

-- ...and the reverse. Anything mines_app creates in minehub keeps the same
-- audience the rest of the schema has, so reporting does not develop holes.
DO $$
DECLARE
    audience text;
    grants   text[][] := ARRAY[
        ['rp_all_ro',     'SELECT',                            'SELECT'],
        ['rp_minehub_ro', 'SELECT',                            'SELECT'],
        ['rp_all_rw',     'SELECT, INSERT, UPDATE, DELETE',    'USAGE, SELECT'],
        ['pems_sync',     'SELECT, INSERT, UPDATE',            'SELECT']
    ];
    row_no int;
BEGIN
    FOR row_no IN 1 .. array_length(grants, 1) LOOP
        audience := grants[row_no][1];
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = audience);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE mines_app IN SCHEMA minehub '
            'GRANT %s ON TABLES TO %I', grants[row_no][2], audience);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE mines_app IN SCHEMA minehub '
            'GRANT %s ON SEQUENCES TO %I', grants[row_no][3], audience);
    END LOOP;
END
$$;

-- ── the three read-only schemas ─────────────────────────────────────────────
--   sap_odata_api  SAP's feed -- the pipeline writes it, this role never does
--   balcorpdb      intranet_user_login, for authentication
--   public         two views
--
-- A schema that is not present is skipped rather than raising: a rebuild
-- stands minehub up first and the others arrive with their own platforms.
DO $$
DECLARE
    sch        text;
    owner_role text;
BEGIN
    FOREACH sch IN ARRAY ARRAY['sap_odata_api', 'balcorpdb', 'public'] LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = sch);

        EXECUTE format('GRANT USAGE ON SCHEMA %I TO mines_app', sch);
        EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO mines_app', sch);

        FOREACH owner_role IN ARRAY ARRAY['postgres', 'bal_dba', 'bal_balcorpdb'] LOOP
            CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role);
            -- bal_balcorpdb owns objects in balcorpdb and in no other schema.
            -- Looping it across all three granted five default privileges
            -- that would never fire, which a comparison against the deployed
            -- version caught: inert, but a difference nobody asked for.
            CONTINUE WHEN owner_role = 'bal_balcorpdb' AND sch <> 'balcorpdb';
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I '
                'GRANT SELECT ON TABLES TO mines_app', owner_role, sch);
        END LOOP;
    END LOOP;
END
$$;
