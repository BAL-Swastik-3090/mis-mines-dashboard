-- ============================================================================
-- MineHub · Migration 006 · Standardised reference values
-- ============================================================================
-- Free-text fields are how a register quietly becomes unusable. "Tata",
-- "TATA", "Tata Motors" and "tata " are four makes to a database and one to a
-- human, and no report can group them afterwards.
--
-- The existing estate already shows this: the legacy driver master records
-- equipment types as free text ("Excavator Long Boom 470-") that match none of
-- the thirteen values in the equipment type master.
--
-- So every repeated value comes from this table. A user picks an existing one
-- or adds a new one inline — the point is not to stop them adding, it is to
-- make picking the existing value easier than retyping it.
-- ============================================================================

SET search_path TO minehub, public;

CREATE TABLE IF NOT EXISTS lookup (
    lookup_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category       text NOT NULL,
    value          text NOT NULL,
    -- A parent lets one list depend on another: models belong to a make, so
    -- choosing Tata narrows the model list to Tata's.
    parent_id      bigint REFERENCES lookup(lookup_id),
    -- How often it has been chosen. The list sorts by this, so the values people
    -- actually use rise to the top instead of sitting in alphabetical order.
    usage_count    integer NOT NULL DEFAULT 0,
    is_system      boolean NOT NULL DEFAULT false,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT uq_lookup UNIQUE (category, value)
);

CREATE INDEX IF NOT EXISTS ix_lookup_category ON lookup (category, status, usage_count DESC);
CREATE INDEX IF NOT EXISTS ix_lookup_value    ON lookup USING gin (value gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_lookup_parent   ON lookup (parent_id);

COMMENT ON TABLE lookup IS
    'Every repeated free-text value. Users add to it inline; nothing is rejected, but picking beats retyping.';

-- ---------------------------------------------------------------------------
-- Seed what the mine already uses, so the first user sees a populated list
-- rather than an empty box that invites typing.
-- ---------------------------------------------------------------------------
INSERT INTO lookup (category, value, is_system, created_by)
SELECT v.category, v.value, true, 'MIGRATION_006'
FROM (VALUES
    -- Makes seen in the Technoton feed and the equipment lists
    ('MAKE', 'Tata'), ('MAKE', 'MAN'), ('MAKE', 'CAT'), ('MAKE', 'Komatsu'),
    ('MAKE', 'Volvo'), ('MAKE', 'JCB'), ('MAKE', 'Hitachi'), ('MAKE', 'BEML'),
    ('MAKE', 'Ashok Leyland'), ('MAKE', 'Mahindra'), ('MAKE', 'Atlas Copco'),
    ('MAKE', 'Sany'), ('MAKE', 'L&T'), ('MAKE', 'Escorts'), ('MAKE', 'Kobelco'),

    ('CAPACITY_UOM', 'MT'), ('CAPACITY_UOM', 'm³'), ('CAPACITY_UOM', 'litre'),
    ('CAPACITY_UOM', 'kW'), ('CAPACITY_UOM', 'ton'),

    ('RATE_UOM', 'per hour'), ('RATE_UOM', 'per day'), ('RATE_UOM', 'per month'),
    ('RATE_UOM', 'per tonne'), ('RATE_UOM', 'per trip'), ('RATE_UOM', 'per km'),

    ('CHARGING_TYPE', 'AC slow'), ('CHARGING_TYPE', 'DC fast'),
    ('CHARGING_TYPE', 'Battery swap'), ('CHARGING_TYPE', 'Onboard charger'),

    -- Insurers and issuing offices, so an expiry list can be grouped by provider
    ('INSURER', 'New India Assurance'), ('INSURER', 'Oriental Insurance'),
    ('INSURER', 'United India Insurance'), ('INSURER', 'National Insurance'),
    ('INSURER', 'ICICI Lombard'), ('INSURER', 'Bajaj Allianz'), ('INSURER', 'HDFC Ergo'),
    ('INSURER', 'TATA AIG'),

    ('ISSUING_AUTHORITY', 'RTO Jajpur'), ('ISSUING_AUTHORITY', 'RTO Bhubaneswar'),
    ('ISSUING_AUTHORITY', 'DGMS'), ('ISSUING_AUTHORITY', 'State Pollution Control Board'),
    ('ISSUING_AUTHORITY', 'Directorate of Mines'),

    -- Maintenance names people actually write
    ('SERVICE_NAME', '250 hr service'), ('SERVICE_NAME', '500 hr service'),
    ('SERVICE_NAME', '1000 hr service'), ('SERVICE_NAME', 'Engine oil change'),
    ('SERVICE_NAME', 'Hydraulic oil change'), ('SERVICE_NAME', 'Annual statutory inspection'),
    ('SERVICE_NAME', 'Tyre rotation'), ('SERVICE_NAME', 'Undercarriage inspection'),

    ('DEPARTMENT', 'Mining Operations'), ('DEPARTMENT', 'Mechanical'),
    ('DEPARTMENT', 'Electrical'), ('DEPARTMENT', 'COB Plant'), ('DEPARTMENT', 'Dewatering'),
    ('DEPARTMENT', 'Safety'), ('DEPARTMENT', 'Geology'), ('DEPARTMENT', 'PPIC')
) AS v(category, value)
WHERE NOT EXISTS (SELECT 1 FROM lookup l WHERE l.category = v.category AND l.value = v.value);

INSERT INTO schema_migration (migration_id, description)
VALUES ('006_lookup', 'Standardised reference values, extendable inline by users')
ON CONFLICT (migration_id) DO NOTHING;
