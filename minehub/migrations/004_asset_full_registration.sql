-- ============================================================================
-- MineHub · Migration 004 · Full equipment registration
-- ============================================================================
-- The first asset table carried only what the identity spine needed. A machine
-- actually has to be registered once, properly, because every later module
-- reads it:
--
--   HOTO           needs the hour meter and the current operator-facing name
--   Compliance     needs insurance, fitness, PUC, road tax and permit expiry
--   Maintenance    needs the service interval and when it was last done
--   Fuel / OEE     need fuel type, rated consumption and rated output
--   Cost           needs purchase value, supplier and ownership
--
-- Capturing them at registration is far cheaper than chasing them later, when
-- the machine is in the pit and the paperwork is in someone's drawer.
-- ============================================================================

SET search_path TO minehub, public;

-- ---------------------------------------------------------------------------
-- 1. asset — the fields a real registration needs
-- ---------------------------------------------------------------------------
ALTER TABLE asset
    -- What people actually call it on the radio. The fleet code is the system's
    -- name; this is the mine's. HOTO screens show this, not the code.
    ADD COLUMN IF NOT EXISTS nickname         text,
    ADD COLUMN IF NOT EXISTS chassis_no       text,
    ADD COLUMN IF NOT EXISTS engine_no        text,
    -- Hour meter or odometer: the reading every handover and service is against.
    ADD COLUMN IF NOT EXISTS reading_uom      text DEFAULT 'HOURS'
        CHECK (reading_uom IN ('HOURS','KM')),
    ADD COLUMN IF NOT EXISTS current_reading  numeric(12,2),
    ADD COLUMN IF NOT EXISTS reading_as_on    date,
    -- Power and consumption
    ADD COLUMN IF NOT EXISTS fuel_type        text
        CHECK (fuel_type IN ('DIESEL','PETROL','ELECTRIC','HYBRID','CNG','NONE')),
    ADD COLUMN IF NOT EXISTS tank_capacity_l  numeric(10,2),
    -- Electric vehicles: rated battery and range, so an EV can be planned on the
    -- same footing as a diesel machine instead of being a special case.
    ADD COLUMN IF NOT EXISTS battery_kwh      numeric(10,2),
    ADD COLUMN IF NOT EXISTS range_km         numeric(10,2),
    ADD COLUMN IF NOT EXISTS charging_type    text,
    ADD COLUMN IF NOT EXISTS charge_time_hrs  numeric(6,2),
    -- Commercial
    ADD COLUMN IF NOT EXISTS purchase_date    date,
    ADD COLUMN IF NOT EXISTS purchase_cost    numeric(14,2),
    ADD COLUMN IF NOT EXISTS supplier_party_id bigint REFERENCES party(party_id),
    ADD COLUMN IF NOT EXISTS hire_rate        numeric(12,2),
    ADD COLUMN IF NOT EXISTS hire_rate_uom    text,
    -- Deployment
    ADD COLUMN IF NOT EXISTS org_unit_id      bigint REFERENCES org_unit(org_unit_id),
    ADD COLUMN IF NOT EXISTS tyre_count       smallint,
    ADD COLUMN IF NOT EXISTS seating_capacity smallint;

COMMENT ON COLUMN asset.nickname IS
    'The name the mine uses out loud. Shown in operational screens; fleet_code stays the system key.';
COMMENT ON COLUMN asset.current_reading IS
    'Hour meter or odometer. Every handover and service interval is measured against this.';

CREATE INDEX IF NOT EXISTS ix_asset_nickname ON asset USING gin (nickname gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. Maintenance schedules
-- ---------------------------------------------------------------------------
-- A machine can carry several: a 250-hour service, a 500-hour service, an annual
-- statutory inspection. Each is due on its own clock, which is why this is a
-- table rather than a pair of columns.
CREATE TABLE IF NOT EXISTS asset_maintenance_schedule (
    schedule_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id       bigint NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    schedule_type  text NOT NULL CHECK (schedule_type IN
                     ('PREVENTIVE','SERVICE','OIL_CHANGE','INSPECTION','OVERHAUL','TYRE_ROTATION','OTHER')),
    name           text NOT NULL,
    -- Due on usage, on time, or on whichever comes first.
    interval_value numeric(10,2),
    interval_uom   text CHECK (interval_uom IN ('HOURS','KM','DAYS','MONTHS')),
    last_done_on   date,
    last_done_reading numeric(12,2),
    -- Derived on save so a due list is a plain query rather than arithmetic in
    -- every screen that asks.
    next_due_on    date,
    next_due_reading numeric(12,2),
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','RETIRED')),
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);
CREATE INDEX IF NOT EXISTS ix_maint_asset ON asset_maintenance_schedule (asset_id);
CREATE INDEX IF NOT EXISTS ix_maint_due   ON asset_maintenance_schedule (next_due_on)
    WHERE status = 'ACTIVE';

DROP TRIGGER IF EXISTS trg_maint_updated ON asset_maintenance_schedule;
CREATE TRIGGER trg_maint_updated BEFORE UPDATE ON asset_maintenance_schedule
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Compliance document types the registration form captures
-- ---------------------------------------------------------------------------
-- The original CHECK predates knowing which documents this mine actually holds.
ALTER TABLE asset_compliance DROP CONSTRAINT IF EXISTS asset_compliance_document_type_check;
ALTER TABLE asset_compliance ADD CONSTRAINT asset_compliance_document_type_check
    CHECK (document_type IN (
        'INSURANCE','FITNESS','PUC','ROAD_TAX','PERMIT','NATIONAL_PERMIT',
        'STATUTORY_INSPECTION','EXPLOSIVE_LICENCE','POLLUTION_NOC','OTHER'));

ALTER TABLE asset_compliance
    ADD COLUMN IF NOT EXISTS provider   text,          -- insurer, issuing office
    ADD COLUMN IF NOT EXISTS amount     numeric(14,2), -- premium or tax paid
    ADD COLUMN IF NOT EXISTS reminder_days smallint DEFAULT 30;

COMMENT ON COLUMN asset_compliance.reminder_days IS
    'How far ahead of expiry this document should start being flagged.';

-- ---------------------------------------------------------------------------
-- 4. A view that answers "what is expiring or due", which is the whole point
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW asset_alert AS
SELECT a.asset_id,
       a.fleet_code,
       a.nickname,
       'COMPLIANCE'                                   AS alert_kind,
       c.document_type                                AS alert_type,
       c.valid_upto                                   AS due_on,
       (c.valid_upto - CURRENT_DATE)                  AS days_left,
       CASE WHEN c.valid_upto < CURRENT_DATE THEN 'EXPIRED'
            WHEN c.valid_upto <= CURRENT_DATE + COALESCE(c.reminder_days, 30) THEN 'DUE'
            ELSE 'OK' END                             AS severity
FROM asset a
JOIN asset_compliance c ON c.asset_id = a.asset_id
WHERE c.status = 'ACTIVE' AND c.valid_upto IS NOT NULL
UNION ALL
SELECT a.asset_id,
       a.fleet_code,
       a.nickname,
       'MAINTENANCE',
       m.name,
       m.next_due_on,
       (m.next_due_on - CURRENT_DATE),
       CASE WHEN m.next_due_on < CURRENT_DATE THEN 'EXPIRED'
            WHEN m.next_due_on <= CURRENT_DATE + 15 THEN 'DUE'
            ELSE 'OK' END
FROM asset a
JOIN asset_maintenance_schedule m ON m.asset_id = a.asset_id
WHERE m.status = 'ACTIVE' AND m.next_due_on IS NOT NULL;

COMMENT ON VIEW asset_alert IS
    'Everything expiring or falling due, across documents and services, in one shape.';

INSERT INTO schema_migration (migration_id, description)
VALUES ('004_asset_full_registration',
        'Full registration: nickname, readings, EV, commercial, maintenance schedules, compliance')
ON CONFLICT (migration_id) DO NOTHING;
