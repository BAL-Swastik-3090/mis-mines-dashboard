-- =====================================================================
--  Electric Vehicles (EV) Tracking — schema
--  Database : balcorpdb
--  Author   : Mines Dashboard
--
--  Two tables:
--    1. mines_ev_equipment_master   — one row per electric machine (static)
--    2. mines_ev_equipment_tracking — daily energy / utilisation (time-series)
--
--  Source data: LiuGong telematics "Man-hour fuel consumption" exports.
--  For EVs, "fuel" is reported as ENERGY (kWh) instead of diesel litres.
--  Convention mirrors the existing mines_technoton_* telemetry tables:
--  snake_case, column comments, created_at/updated_at, InnoDB.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MASTER — one row per electric vehicle
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mines_ev_equipment_master (
    ev_equipment_id   INT           NOT NULL AUTO_INCREMENT COMMENT 'Surrogate primary key',
    serial_no         VARCHAR(40)   NOT NULL                 COMMENT 'Machine serial / VIN from telematics (e.g. CLG922FECSE735955)',
    equipment_type    VARCHAR(30)   NOT NULL                 COMMENT 'Excavator | Grader | Loader',
    make              VARCHAR(40)       NULL                 COMMENT 'Manufacturer, e.g. LiuGong',
    model             VARCHAR(40)       NULL                 COMMENT 'Model code, e.g. 922F-E',
    rated_battery_kwh DECIMAL(10,2)     NULL                 COMMENT 'Rated battery capacity in kWh (fill when known)',
    commissioned_date DATE              NULL                 COMMENT 'Date the machine entered service',
    status            CHAR(1)       NOT NULL DEFAULT 'A'     COMMENT 'A = Active, I = Inactive (mirrors mines_equipment_master.Status)',
    remarks           VARCHAR(255)      NULL                 COMMENT 'Free-text notes',
    created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP                          COMMENT 'Row insert timestamp',
    updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Row last-update timestamp',
    PRIMARY KEY (ev_equipment_id),
    UNIQUE KEY uq_ev_serial_no (serial_no),
    KEY idx_ev_type (equipment_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Electric vehicle master — one row per electric machine';

-- ---------------------------------------------------------------------
-- 2. TRACKING — daily energy / utilisation per vehicle (one row / machine / day)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mines_ev_equipment_tracking (
    tracking_id             BIGINT        NOT NULL AUTO_INCREMENT COMMENT 'Surrogate primary key',
    ev_equipment_id         INT           NOT NULL                COMMENT 'FK -> mines_ev_equipment_master.ev_equipment_id',
    report_date             DATE          NOT NULL                COMMENT 'Calendar day the metrics belong to (source "Date")',

    -- ── Utilisation (hours) ──────────────────────────────────────────
    operating_hours         DECIMAL(6,2)  NOT NULL DEFAULT 0      COMMENT 'Operating Hrs(h)',
    idling_hours            DECIMAL(6,2)  NOT NULL DEFAULT 0      COMMENT 'Idling Hrs(h)',
    work_hours              DECIMAL(6,2)  NOT NULL DEFAULT 0      COMMENT 'Work Hrs(h) = operating + idling',

    -- ── Energy (kWh) ─────────────────────────────────────────────────
    operating_energy_kwh    DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT 'Operating(kWh) — not yet reported by device (currently 0)',
    idling_energy_kwh       DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT 'Idling(kWh) — not yet reported by device (currently 0)',
    total_energy_kwh        DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT 'Total Energy(kWh) consumed for the day',

    -- ── Averages (kWh per hour) ──────────────────────────────────────
    avg_operating_kwh_per_h DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT 'Avg. Operating (kWh/h) — not yet reported (currently 0)',
    avg_idling_kwh_per_h    DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT 'Avg. Idling(kWh/h) — not yet reported (currently 0)',
    avg_energy_kwh_per_h    DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT 'Avg. Energy(kWh/h) for the day',

    -- ── ETL provenance / audit ───────────────────────────────────────
    source_file             VARCHAR(150)      NULL               COMMENT 'Name of the source export file (data lineage)',
    created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP                          COMMENT 'Row insert timestamp',
    updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Row last-update timestamp',

    PRIMARY KEY (tracking_id),
    UNIQUE KEY uq_ev_day (ev_equipment_id, report_date),   -- one row per machine per day (idempotent upsert)
    KEY idx_report_date (report_date),
    CONSTRAINT fk_ev_tracking_master
        FOREIGN KEY (ev_equipment_id)
        REFERENCES mines_ev_equipment_master (ev_equipment_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Electric vehicle daily energy & utilisation time-series';

-- ---------------------------------------------------------------------
-- 3. Seed the master with the 4 machines found in the data folder
--    (idempotent — INSERT IGNORE keyed on the unique serial_no)
-- ---------------------------------------------------------------------
INSERT IGNORE INTO mines_ev_equipment_master (serial_no, equipment_type, make, model) VALUES
    ('CLG922FECSE735955', 'Excavator', 'LiuGong', '922F-E'),
    ('CLG922FEHSE735953', 'Excavator', 'LiuGong', '922F-EH'),
    ('CLG4280DHSL016209', 'Grader',    'LiuGong', '4280D'),
    ('CLG838TECSL831801', 'Loader',    'LiuGong', '838TEC');
