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

-- ── everything below is conditional on the role or schema being there ───────
-- The estate roles exist on corpappdb and nowhere else, and a rebuild stands
-- minehub up before the other schemas arrive. Named unconditionally, this
-- file could only ever be replayed against the server it was written on --
-- see the note in 095, which failed the same way the first time the set was
-- replayed from nothing.
DO $$
DECLARE
    sch        text;
    owner_role text;
    audience   text;
BEGIN
    -- Functions a DBA adds to minehub later must stay callable.
    FOREACH owner_role IN ARRAY ARRAY['postgres', 'bal_dba'] LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA minehub '
            'GRANT EXECUTE ON FUNCTIONS TO mines_app', owner_role);
    END LOOP;

    -- ...and a function this role creates keeps the audience the rest of the
    -- schema has, exactly as 095 arranged for tables and sequences.
    FOREACH audience IN ARRAY ARRAY['rp_all_ro', 'rp_all_rw', 'rp_minehub_ro'] LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = audience);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE mines_app IN SCHEMA minehub '
            'GRANT EXECUTE ON FUNCTIONS TO %I', audience);
    END LOOP;

    -- The read-only schemas: sequences and functions, now and in future.
    FOREACH sch IN ARRAY ARRAY['sap_odata_api', 'balcorpdb', 'public'] LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = sch);

        EXECUTE format('GRANT USAGE ON SCHEMA %I TO mines_app', sch);
        EXECUTE format('GRANT SELECT ON ALL TABLES    IN SCHEMA %I TO mines_app', sch);
        EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO mines_app', sch);

        -- NOT public. pg_stat_statements_reset lives there, and an
        -- application has no business clearing the server's statement
        -- statistics. Nothing in this application calls into that schema.
        IF sch <> 'public' THEN
            EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO mines_app', sch);
        END IF;

        FOREACH owner_role IN ARRAY ARRAY['postgres', 'bal_dba', 'bal_balcorpdb'] LOOP
            CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role);
            -- bal_balcorpdb owns objects in balcorpdb only; see 095.
            CONTINUE WHEN owner_role = 'bal_balcorpdb' AND sch <> 'balcorpdb';
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I '
                'GRANT SELECT ON SEQUENCES TO mines_app', owner_role, sch);
            IF sch <> 'public' THEN
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I '
                    'GRANT EXECUTE ON FUNCTIONS TO mines_app', owner_role, sch);
            END IF;
        END LOOP;
    END LOOP;
END
$$;
