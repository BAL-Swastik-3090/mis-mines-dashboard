-- ============================================================================
-- MineHub · Migration 001 · Core registry and event log
-- ============================================================================
-- Phase 0 of the platform: the identity spine. Nothing else can be built until
-- a person, a machine, a place, a material and a shift each exist exactly once
-- with a stable key.
--
-- Target: PostgreSQL 18.6, schema `minehub`, on corpappdb.
-- Idempotent — safe to re-run.
--
-- Conventions used throughout:
--   * Surrogate keys are ours and permanent. An external code (SAP EMPID, a
--     contractor number, a telematics name) is never a primary key — it is an
--     *identity*, recorded in a side table, because every one of them is
--     controlled by a system we do not own.
--   * Status and type columns are text with a CHECK rather than a pg enum:
--     adding a value to an enum locks the type, and these lists will grow.
--   * Every table carries created_at / updated_at / created_by for audit.
--   * Nothing is deleted. Rows are closed with a status or an end date.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS minehub;
SET search_path TO minehub, public;

-- pgcrypto is present on this instance; gen_random_uuid() is built in from
-- PG13 so no extension is strictly required, but pg_trgm materially speeds up
-- the name searches the admin screens will do.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Migration bookkeeping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migration (
    migration_id   text PRIMARY KEY,
    applied_at     timestamptz NOT NULL DEFAULT now(),
    description    text
);

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;


-- ===========================================================================
-- 1. ORGANISATION
-- ===========================================================================

CREATE TABLE IF NOT EXISTS org_unit (
    org_unit_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    name           text NOT NULL,
    parent_id      bigint REFERENCES org_unit(org_unit_id),
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);
COMMENT ON TABLE org_unit IS 'Departments and reporting hierarchy. Self-referencing.';


-- ===========================================================================
-- 2. PARTY — every person and organisation, in one table
-- ===========================================================================
-- Deliberately one table for employees, contractor workers, contractors,
-- vendors and transporters. A contractor operator who later joins the rolls
-- keeps the same party_id and his history follows him; three separate tables
-- would lose that, and losing it is how the current estate ended up with two
-- unreconcilable numbering systems.

CREATE TABLE IF NOT EXISTS party (
    party_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    party_type     text NOT NULL CHECK (party_type IN ('PERSON','ORGANISATION')),
    legal_name     text NOT NULL,
    display_name   text,
    -- PERSON attributes
    gender         text CHECK (gender IN ('M','F','O')),
    date_of_birth  date,
    blood_group    text,
    -- ORGANISATION attributes
    org_category   text CHECK (org_category IN ('CONTRACTOR','VENDOR','TRANSPORTER','CUSTOMER','INTERNAL')),
    gstin          text,
    -- common
    phone          text,
    email          text,
    photo_ref      text,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLACKLISTED')),
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT party_person_has_no_gstin
        CHECK (party_type = 'ORGANISATION' OR gstin IS NULL)
);
CREATE INDEX IF NOT EXISTS ix_party_name_trgm ON party USING gin (legal_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_party_type_status ON party (party_type, status);
COMMENT ON TABLE party IS 'Every person and organisation. One row per real-world entity, forever.';

-- --- external identities ---------------------------------------------------
-- The table that reconciles systems we do not control. SAP issues 4-digit
-- EMPIDs; the contractor driver register uses 5-digit codes; HRMS, RFID and
-- biometric each have their own. None of them becomes the key.

CREATE TABLE IF NOT EXISTS party_identity (
    party_identity_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    party_id       bigint NOT NULL REFERENCES party(party_id),
    system         text NOT NULL CHECK (system IN
                     ('SAP','HRMS','CONTRACTOR','RFID','BIOMETRIC','AADHAAR_LAST4','LEGACY_DRIVER_MASTER')),
    external_code  text NOT NULL,
    is_primary     boolean NOT NULL DEFAULT false,
    valid_from     date NOT NULL DEFAULT CURRENT_DATE,
    valid_to       date,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    -- one code in one system points at exactly one party, ever
    CONSTRAINT uq_party_identity UNIQUE (system, external_code)
);
CREATE INDEX IF NOT EXISTS ix_party_identity_party ON party_identity (party_id);
COMMENT ON CONSTRAINT uq_party_identity ON party_identity IS
    'Prevents two people claiming the same SAP EMPID or RFID card.';

-- --- employment over time --------------------------------------------------
CREATE TABLE IF NOT EXISTS party_employment (
    party_employment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    party_id       bigint NOT NULL REFERENCES party(party_id),
    employer_party_id bigint NOT NULL REFERENCES party(party_id),  -- BAL or a contractor
    org_unit_id    bigint REFERENCES org_unit(org_unit_id),
    designation    text,
    employment_type text CHECK (employment_type IN ('PERMANENT','CONTRACT','TRAINEE','CONSULTANT')),
    valid_from     date NOT NULL,
    valid_to       date,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT employment_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS ix_employment_party ON party_employment (party_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS ix_employment_employer ON party_employment (employer_party_id);


-- ===========================================================================
-- 3. LOCATION — a real hierarchy
-- ===========================================================================
-- site → pit → bench → face, plus stockyards, plants, gates, workshops.
--
-- NOTE ON GEOMETRY: PostGIS is NOT installed on this instance (checked
-- 2026-09-17: only btree_gist, pg_trgm, pgcrypto, uuid-ossp are available).
-- Geometry is therefore held as GeoJSON in `boundary_geojson` with a numeric
-- centroid, which supports display and manual survey import today. When PostGIS
-- is installed, migration 0xx adds a `geom geometry(Polygon,4326)` column and
-- backfills it from this JSON — additive, no data loss. Geofencing and area
-- calculations wait for that; nothing else does.

CREATE TABLE IF NOT EXISTS location (
    location_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    name           text NOT NULL,
    location_type  text NOT NULL CHECK (location_type IN
                     ('SITE','PIT','BENCH','FACE','STOCKYARD','STOCKPILE','ROM','PLANT',
                      'GATE','WEIGHBRIDGE','WORKSHOP','FUEL_POINT','DUMP','SUMP','ROAD')),
    parent_id      bigint REFERENCES location(location_id),
    rl_metres      numeric(8,2),                 -- reduced level, for benches
    centroid_lat   numeric(10,7),
    centroid_lon   numeric(10,7),
    boundary_geojson jsonb,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','EXHAUSTED')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);
CREATE INDEX IF NOT EXISTS ix_location_parent ON location (parent_id);
CREATE INDEX IF NOT EXISTS ix_location_type ON location (location_type, status);


-- ===========================================================================
-- 4. MATERIAL
-- ===========================================================================

CREATE TABLE IF NOT EXISTS material (
    material_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    name           text NOT NULL,
    material_class text NOT NULL CHECK (material_class IN
                     ('ORE','WASTE','OB','LG','MG','HG','CONCENTRATE','TAILING','SILT','BOULDER','OTHER')),
    sap_material_no text,
    uom            text NOT NULL DEFAULT 'MT',
    is_saleable    boolean NOT NULL DEFAULT false,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);

-- Grade bands: the Cr2O3 / Fe ranges a material must fall within to be
-- classified as such. Grade travels with the lot, but the specification lives
-- here so classification is consistent across every screen.
CREATE TABLE IF NOT EXISTS grade_spec (
    grade_spec_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id    bigint NOT NULL REFERENCES material(material_id),
    analyte        text NOT NULL CHECK (analyte IN
                     ('CR2O3','FE','FEO','SIO2','AL2O3','MGO','P','S','CR_FE_RATIO','MOISTURE')),
    min_value      numeric(8,4),
    max_value      numeric(8,4),
    valid_from     date NOT NULL DEFAULT CURRENT_DATE,
    valid_to       date,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT grade_spec_range CHECK (min_value IS NULL OR max_value IS NULL OR max_value >= min_value)
);
CREATE INDEX IF NOT EXISTS ix_grade_spec_material ON grade_spec (material_id);


-- ===========================================================================
-- 5. ASSET — every machine, own or hired
-- ===========================================================================

CREATE TABLE IF NOT EXISTS asset_type (
    asset_type_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    name           text NOT NULL,
    category       text NOT NULL CHECK (category IN
                     ('EXCAVATION','HAULAGE','DRILLING','DOZING','GRADING','LIFTING',
                      'WATER','SUPPORT','PUMP','LIGHTING','LMV','OTHER')),
    -- the ideal operating model (blueprint stage 01), per type
    rated_output_per_hr numeric(10,3),
    rated_output_uom    text,
    rated_fuel_lph      numeric(8,3),
    standard_crew       smallint,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);
COMMENT ON COLUMN asset_type.rated_output_per_hr IS
    'Sets every capacity-gap figure the platform reports. Requires sign-off by the owner named in the plan.';

CREATE TABLE IF NOT EXISTS asset (
    asset_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fleet_code     text NOT NULL UNIQUE,          -- the name people actually use: MAN-18
    registration_no text,                          -- statutory registration: OD04L0327
    asset_type_id  bigint NOT NULL REFERENCES asset_type(asset_type_id),
    make           text,
    model          text,
    year_of_make   smallint,
    capacity       numeric(10,3),                  -- bucket m3, deck tonnes, etc.
    capacity_uom   text,
    -- ownership: this single column is the own / hired split
    ownership      text NOT NULL DEFAULT 'OWN' CHECK (ownership IN ('OWN','HIRED')),
    owner_party_id bigint REFERENCES party(party_id),
    sap_asset_no   text,                           -- null for hired: SAP is an identity, not the key
    -- overrides of the type-level rating, where a specific machine differs
    rated_output_per_hr numeric(10,3),
    rated_fuel_lph      numeric(8,3),
    commissioned_on date,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN
                     ('ACTIVE','MAINTENANCE','STANDBY','IDLE','DISPOSED')),
    home_location_id bigint REFERENCES location(location_id),
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT hired_asset_has_owner
        CHECK (ownership = 'OWN' OR owner_party_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_asset_type ON asset (asset_type_id);
CREATE INDEX IF NOT EXISTS ix_asset_owner ON asset (owner_party_id);
CREATE INDEX IF NOT EXISTS ix_asset_status ON asset (status);
CREATE INDEX IF NOT EXISTS ix_asset_fleet_trgm ON asset USING gin (fleet_code gin_trgm_ops);

-- --- the alias table that unblocks everything ------------------------------
-- Telematics calls it MAN18. The handover register calls it MAN-18. The
-- weighbridge may call it MAN 18. Two rows here and they are the same machine
-- forever, without any system being asked to change.

CREATE TABLE IF NOT EXISTS asset_identity (
    asset_identity_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id       bigint NOT NULL REFERENCES asset(asset_id),
    system         text NOT NULL CHECK (system IN
                     ('TELEMATICS','HOTO','WEIGHBRIDGE','RFID','SAP','SECURITY','LEGACY')),
    external_code  text NOT NULL,
    valid_from     date NOT NULL DEFAULT CURRENT_DATE,
    valid_to       date,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT uq_asset_identity UNIQUE (system, external_code)
);
CREATE INDEX IF NOT EXISTS ix_asset_identity_asset ON asset_identity (asset_id);


-- ===========================================================================
-- 6. CALENDAR — shift definitions, versioned
-- ===========================================================================
-- Production logs a shift and HRMS keeps its own shift master. The platform
-- resolves that here, once. `production_day_rule` records which day a shift
-- crossing midnight belongs to — the commonest source of disputed daily totals.

CREATE TABLE IF NOT EXISTS shift_calendar (
    shift_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL,                 -- A, B, C, GEN
    name           text NOT NULL,
    location_id    bigint REFERENCES location(location_id),  -- null = all sites
    start_time     time NOT NULL,
    end_time       time NOT NULL,
    crosses_midnight boolean NOT NULL DEFAULT false,
    production_day_rule text NOT NULL DEFAULT 'START_DATE'
                     CHECK (production_day_rule IN ('START_DATE','END_DATE')),
    planned_hours  numeric(4,2) NOT NULL,
    hrms_shift_code text,                         -- maps to ASHF / BSHF / CSHF / GEN
    valid_from     date NOT NULL DEFAULT CURRENT_DATE,
    valid_to       date,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT uq_shift_code_from UNIQUE (code, location_id, valid_from)
);


-- ===========================================================================
-- 7. COMPETENCY & COMPLIANCE — the registers with legal weight
-- ===========================================================================
-- Every one of the 133 rows in the legacy driver master has DL_No and
-- Valid_Upto empty. In a DGMS-regulated mine an expired licence on a running
-- machine is a statutory exposure. With valid_upto populated the platform can
-- refuse the deployment instead of reporting it afterwards.

CREATE TABLE IF NOT EXISTS competency (
    competency_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    party_id       bigint NOT NULL REFERENCES party(party_id),
    asset_type_id  bigint REFERENCES asset_type(asset_type_id),  -- null = general competency
    competency_type text NOT NULL CHECK (competency_type IN
                     ('DRIVING_LICENCE','OPERATOR_CERT','BLASTING_LICENCE','FIRST_AID',
                      'SAFETY_TRAINING','STATUTORY_CERT','OTHER')),
    document_no    text,
    issuing_authority text,
    valid_from     date,
    valid_upto     date,
    certified_by   text,
    certified_on   date,
    document_ref   text,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','EXPIRED','REVOKED')),
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT competency_dates CHECK (valid_upto IS NULL OR valid_from IS NULL OR valid_upto >= valid_from)
);
CREATE INDEX IF NOT EXISTS ix_competency_party ON competency (party_id);
CREATE INDEX IF NOT EXISTS ix_competency_expiry ON competency (valid_upto) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS asset_compliance (
    asset_compliance_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id       bigint NOT NULL REFERENCES asset(asset_id),
    document_type  text NOT NULL CHECK (document_type IN
                     ('FITNESS','INSURANCE','PUC','PERMIT','ROAD_TAX','STATUTORY_INSPECTION','OTHER')),
    document_no    text,
    issuing_authority text,
    valid_from     date,
    valid_upto     date,
    document_ref   text,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','NOT_APPLICABLE')),
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT asset_compliance_dates CHECK (valid_upto IS NULL OR valid_from IS NULL OR valid_upto >= valid_from)
);
CREATE INDEX IF NOT EXISTS ix_asset_compliance_asset ON asset_compliance (asset_id);
CREATE INDEX IF NOT EXISTS ix_asset_compliance_expiry ON asset_compliance (valid_upto) WHERE status = 'ACTIVE';


-- ===========================================================================
-- 8. EVENT LOG — the spine
-- ===========================================================================
-- Append-only. Nothing is ever updated in place: a correction is a new row
-- pointing at what it corrects, which is what makes the platform auditable.
--
-- Partitioned by month from the start. Converting a large unpartitioned table
-- later means rewriting it; declaring it now costs nothing.

CREATE TABLE IF NOT EXISTS event (
    event_id       uuid NOT NULL DEFAULT gen_random_uuid(),
    event_type     text NOT NULL,
    -- when it happened in the world, vs when we heard about it. Separating them
    -- makes late entry measurable instead of invisible.
    occurred_at    timestamptz NOT NULL,
    recorded_at    timestamptz NOT NULL DEFAULT now(),
    source         text NOT NULL CHECK (source IN
                     ('RFID','WEIGHBRIDGE','TELEMATICS','BIOMETRIC','MOBILE','WEB',
                      'SAP','HRMS','LAB','SURVEY','SENSOR','IMOS','SYSTEM')),
    -- the five dimensions almost every mine fact carries; all nullable because
    -- not every event has all of them
    party_id       bigint REFERENCES party(party_id),
    asset_id       bigint REFERENCES asset(asset_id),
    location_id    bigint REFERENCES location(location_id),
    material_id    bigint REFERENCES material(material_id),
    shift_id       bigint REFERENCES shift_calendar(shift_id),
    production_day date,
    -- forward references, added by later migrations as those objects appear
    work_order_id  bigint,
    lot_id         bigint,
    payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- replay safety: an adapter re-running must not double-count
    idempotency_key text,
    recorded_by    text,
    correction_of  uuid,
    PRIMARY KEY (event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

COMMENT ON COLUMN event.idempotency_key IS
    'Natural key from the source system. Unique per partition, so replaying an adapter is safe.';
COMMENT ON COLUMN event.correction_of IS
    'Set when this event corrects an earlier one. The original is never modified.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_idempotency
    ON event (source, idempotency_key, occurred_at)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_event_type_time  ON event (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_event_asset_time ON event (asset_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_event_party_time ON event (party_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_event_prod_day   ON event (production_day, event_type);

-- Catch-all so an insert can never fail for want of a partition. The monthly
-- partitions below are created ahead of time; a maintenance job adds more.
CREATE TABLE IF NOT EXISTS event_default PARTITION OF event DEFAULT;

DO $$
DECLARE
    m date := date_trunc('month', CURRENT_DATE - interval '3 months')::date;
    stop date := date_trunc('month', CURRENT_DATE + interval '6 months')::date;
    part text;
BEGIN
    WHILE m < stop LOOP
        part := format('event_%s', to_char(m, 'YYYY_MM'));
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part) THEN
            EXECUTE format(
                'CREATE TABLE minehub.%I PARTITION OF minehub.event FOR VALUES FROM (%L) TO (%L)',
                part, m, (m + interval '1 month')::date);
        END IF;
        m := (m + interval '1 month')::date;
    END LOOP;
END $$;


-- ===========================================================================
-- 9. updated_at triggers
-- ===========================================================================
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['org_unit','party','location','material','asset_type','asset',
                             'shift_calendar','competency','asset_compliance']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON minehub.%I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON minehub.%I
                        FOR EACH ROW EXECUTE FUNCTION minehub.set_updated_at()', t, t);
    END LOOP;
END $$;


-- ===========================================================================
-- 10. Seed: the organisation itself, and the asset types the mine already uses
-- ===========================================================================
-- BAL must exist as a party before any owned asset can reference it.

INSERT INTO party (party_type, legal_name, display_name, org_category, status, created_by)
SELECT 'ORGANISATION', 'Balasore Alloys Limited', 'BAL', 'INTERNAL', 'ACTIVE', 'MIGRATION_001'
WHERE NOT EXISTS (SELECT 1 FROM party WHERE legal_name = 'Balasore Alloys Limited');

-- The 13 equipment types already defined in the legacy vehicle type master,
-- mapped to a category. Ratings are deliberately left NULL — they must be
-- signed off, not guessed.
INSERT INTO asset_type (code, name, category, created_by)
SELECT v.code, v.name, v.category, 'MIGRATION_001'
FROM (VALUES
    ('TIPPER',      'Man (Tipper)',             'HAULAGE'),
    ('EXCAVATOR',   'Excavator',                'EXCAVATION'),
    ('DOZER',       'Dozer',                    'DOZING'),
    ('DRILL',       'Drill',                    'DRILLING'),
    ('JCB',         'JCB',                      'EXCAVATION'),
    ('CAT',         'CAT',                      'EXCAVATION'),
    ('GRADER',      'Grader',                   'GRADING'),
    ('SPRINKLER',   'Water Sprinkler',          'WATER'),
    ('HYDRA',       'Hydra',                    'LIFTING'),
    ('LOADER',      'Loader',                   'EXCAVATION'),
    ('COMPACTOR',   'Soil Compactor (Roller)',  'SUPPORT'),
    ('MIST_CANNON', 'Mist Cannon (Sprinkler)',  'WATER'),
    ('CHAIN',       'Chain',                    'SUPPORT')
) AS v(code, name, category)
WHERE NOT EXISTS (SELECT 1 FROM asset_type a WHERE a.code = v.code);

-- The site itself.
INSERT INTO location (code, name, location_type, created_by)
SELECT 'KALIAPANI', 'Kaliapani Chromite Mines', 'SITE', 'MIGRATION_001'
WHERE NOT EXISTS (SELECT 1 FROM location WHERE code = 'KALIAPANI');


INSERT INTO schema_migration (migration_id, description)
VALUES ('001_core_registry', 'Party, asset, location, material, calendar, competency, compliance, event log')
ON CONFLICT (migration_id) DO NOTHING;
