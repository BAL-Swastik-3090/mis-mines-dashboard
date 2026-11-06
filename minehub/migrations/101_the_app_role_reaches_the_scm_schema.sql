-- 101: let the dashboard read scm, which the PR-to-Payment register needs.
--
-- 095 gave mines_app minehub, sap_odata_api, balcorpdb and public, because
-- that was everything the application read the day it ran. The PR-to-Payment
-- register arrived afterwards and reads six tables in scm -- the purchasing
-- group, and the quotation, RFQ, NFA and technical-evaluation tables behind
-- the quotation columns.
--
-- It was live and failing: every one of the six returned "permission denied
-- for schema scm" in production. The register rendered, because the SAP side
-- of it reads sap_odata_api and that was granted; the quotation side came
-- back empty. A page that is half-populated looks like a mine with no
-- quotations rather than an application that cannot see them, which is the
-- worst shape this kind of failure takes.
--
-- READ ONLY, AND scm IS NOT OURS. The SCM platform owns this schema and
-- writes it. Nothing here grants INSERT, UPDATE or DELETE, and nothing here
-- changes an existing grant -- it only adds mines_app as a reader, which is
-- what balcorpdb and sap_odata_api already are to this role.
--
-- Guarded the same way 095 and 097 are, so the file can be replayed on a
-- server that has no scm schema and no estate roles.

DO $$
DECLARE owner_role text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'scm') THEN
        RAISE NOTICE 'scm schema is not present here; nothing to grant';
        RETURN;
    END IF;

    EXECUTE 'GRANT USAGE ON SCHEMA scm TO mines_app';
    EXECUTE 'GRANT SELECT ON ALL TABLES    IN SCHEMA scm TO mines_app';
    EXECUTE 'GRANT SELECT ON ALL SEQUENCES IN SCHEMA scm TO mines_app';

    -- Tables the SCM platform adds later must reach this role too, or the
    -- next table the register needs is the next outage of this shape.
    FOREACH owner_role IN ARRAY ARRAY['postgres', 'bal_dba', 'bal_balcorpdb'] LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA scm '
            'GRANT SELECT ON TABLES TO mines_app', owner_role);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA scm '
            'GRANT SELECT ON SEQUENCES TO mines_app', owner_role);
    END LOOP;
END
$$;
