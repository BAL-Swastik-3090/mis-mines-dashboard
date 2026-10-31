-- =====================================================================
--  Electric Vehicle tracking — PostgreSQL schema
--  Database : corpappdb      Schema : minehub
--
--  Two tables:
--    1. minehub.ev_vehicle_master    — one row per electric machine (static)
--    2. minehub.ev_vehicle_tracking  — one row per machine per day (time-series)
--
--  Source: LiuGong telematics "Man-hour fuel consumption" exports, one
--  workbook per machine per month. For EVs the portal reports ENERGY (kWh)
--  in place of diesel litres. The machine serial appears ONLY in the file
--  name, before the first hyphen — never inside the sheet.
--
--  Naming follows the minehub house convention, which carries "mines" in the
--  schema and not in the table name (cf. fuel_issue, vehicle_tare_reading,
--  technoton_rest_equipment_utilization). If you want the literal
--  mines_ev_vehicle_* names instead, it is a find/replace on this file and
--  the backfill.
--
--  Idempotent: safe to run repeatedly.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS minehub;

-- ---------------------------------------------------------------------
-- 1. MASTER — one row per electric vehicle
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS minehub.ev_vehicle_master (
    ev_vehicle_id      integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    serial_no          text        NOT NULL UNIQUE,
    equipment_type     text        NOT NULL,
    product_group      text,
    make               text        DEFAULT 'LiuGong',
    model              text,
    rated_battery_kwh  numeric,
    commissioned_date  date,
    status             char(1)     NOT NULL DEFAULT 'A',
    remarks            text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ev_vehicle_master_status_ck CHECK (status IN ('A', 'I')),
    CONSTRAINT ev_vehicle_master_type_ck
        CHECK (equipment_type IN ('Excavator', 'Grader', 'Loader', 'Dumper', 'Other'))
);

COMMENT ON TABLE  minehub.ev_vehicle_master IS
    'Electric vehicle master — one row per machine. serial_no matches the file-name prefix of the LiuGong export.';
COMMENT ON COLUMN minehub.ev_vehicle_master.serial_no IS
    'Machine serial / VIN, e.g. CLG838TECSL831801. This is the upload key.';
COMMENT ON COLUMN minehub.ev_vehicle_master.rated_battery_kwh IS
    'Rated pack capacity. Not supplied by the telematics export — fill from the OEM spec sheet.';
COMMENT ON COLUMN minehub.ev_vehicle_master.status IS 'A = Active, I = Inactive.';

CREATE INDEX IF NOT EXISTS ev_vehicle_master_type_idx
    ON minehub.ev_vehicle_master (equipment_type);

-- ---------------------------------------------------------------------
-- 2. TRACKING — daily energy & utilisation
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS minehub.ev_vehicle_tracking (
    ev_vehicle_id                integer NOT NULL
        REFERENCES minehub.ev_vehicle_master (ev_vehicle_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    report_date                  date    NOT NULL,

    -- Utilisation (hours)
    operating_hours              numeric,
    idling_hours                 numeric,
    work_hours                   numeric,

    -- Energy (kWh)
    operating_energy_kwh         numeric,
    idling_energy_kwh            numeric,
    total_energy_kwh             numeric,

    -- Averages (kWh per hour)
    avg_operating_kwh_per_h      numeric,
    avg_idling_kwh_per_h         numeric,
    avg_energy_kwh_per_h         numeric,
    avg_energy_recycle_kwh_per_h numeric,

    -- Quality + provenance
    is_suspect  boolean GENERATED ALWAYS AS (
        COALESCE(work_hours, 0) > 0
        AND COALESCE(total_energy_kwh, 0) > COALESCE(work_hours, 0) * 300
    ) STORED,
    source_file text,
    ingested_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (ev_vehicle_id, report_date)
);

COMMENT ON TABLE  minehub.ev_vehicle_tracking IS
    'Electric vehicle daily energy and utilisation. One row per machine per day; re-uploading a month overwrites it.';
COMMENT ON COLUMN minehub.ev_vehicle_tracking.is_suspect IS
    'TRUE when implied kWh/h exceeds 300 — physically impossible for this class of machine. '
    'Two such rows exist in the LiuGong source data (12-Jun-2026 = 30,055 kWh, 21-Apr-2026 = 13,163 kWh, '
    'both on CLG922FECSE735955); together they inflate fleet energy by 74%. Exclude from averages by default.';
COMMENT ON COLUMN minehub.ev_vehicle_tracking.operating_energy_kwh IS
    'Operating(kWh) — the device does not yet report this; currently always 0.';
COMMENT ON COLUMN minehub.ev_vehicle_tracking.idling_energy_kwh IS
    'Idling(kWh) — the device does not yet report this; currently always 0.';
COMMENT ON COLUMN minehub.ev_vehicle_tracking.avg_energy_recycle_kwh_per_h IS
    'Added by LiuGong in the Oct-2026 export format; NULL for anything exported before that.';
COMMENT ON COLUMN minehub.ev_vehicle_tracking.source_file IS
    'Originating workbook name, for lineage when a figure is questioned.';

CREATE INDEX IF NOT EXISTS ev_vehicle_tracking_date_idx
    ON minehub.ev_vehicle_tracking (report_date);
CREATE INDEX IF NOT EXISTS ev_vehicle_tracking_clean_idx
    ON minehub.ev_vehicle_tracking (ev_vehicle_id, report_date)
    WHERE is_suspect = false;

-- ---------------------------------------------------------------------
-- 3. Keep master.updated_at honest
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION minehub.ev_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_vehicle_master_touch ON minehub.ev_vehicle_master;
CREATE TRIGGER ev_vehicle_master_touch
    BEFORE UPDATE ON minehub.ev_vehicle_master
    FOR EACH ROW EXECUTE FUNCTION minehub.ev_touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. Reader view — joined, with the derived rate the API reports
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW minehub.ev_vehicle_daily AS
SELECT m.serial_no,
       m.equipment_type,
       m.model,
       t.report_date,
       t.operating_hours,
       t.idling_hours,
       t.work_hours,
       t.total_energy_kwh,
       t.avg_energy_kwh_per_h,
       t.avg_energy_recycle_kwh_per_h,
       CASE WHEN COALESCE(t.work_hours, 0) > 0
            THEN round(t.total_energy_kwh / t.work_hours, 2) END AS derived_kwh_per_h,
       t.is_suspect,
       t.source_file,
       t.ingested_at
FROM minehub.ev_vehicle_tracking t
JOIN minehub.ev_vehicle_master   m USING (ev_vehicle_id);

COMMENT ON VIEW minehub.ev_vehicle_daily IS
    'Tracking joined to master with kWh/h recomputed from the stored totals, so a bad vendor average cannot hide.';

-- ---------------------------------------------------------------------
-- 5. Seed the master — the four machines currently in service
--     Models/product groups per "Mines Electric Vehicle Details.xlsx".
-- ---------------------------------------------------------------------
INSERT INTO minehub.ev_vehicle_master (serial_no, equipment_type, product_group, make, model)
VALUES
    ('CLG922FECSE735955', 'Excavator', 'Electric Excavator', 'LiuGong', '922FE'),
    ('CLG922FEHSE735953', 'Excavator', 'Electric Excavator', 'LiuGong', '922FE'),
    ('CLG4280DHSL016209', 'Grader',    'Electric Grader',    'LiuGong', '4280DE'),
    ('CLG838TECSL831801', 'Loader',    'Electric Loader',    'LiuGong', '838TE')
ON CONFLICT (serial_no) DO UPDATE SET
    equipment_type = EXCLUDED.equipment_type,
    product_group  = EXCLUDED.product_group,
    make           = EXCLUDED.make,
    model          = EXCLUDED.model;
