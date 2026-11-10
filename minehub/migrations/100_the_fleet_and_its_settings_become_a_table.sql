-- 100: the OEE fleet, and the settings that are chosen for it, as tables.
--
-- WHAT THIS REPLACES. Four hardcoded lists that between them decide every
-- figure on the four OEE tables:
--
--   services/oee.py         EXCAVATORS       10 machines: SAP number, ideal
--                                            CuM/hr, breakdown source, hired
--                           NEW_EXCAVATORS   which two count as new
--   services/tipper_oee.py  OLD_TIPPERS      27 MAN trucks
--                           NEW_TIPPER_IDEAL 10 PRIMA trucks and their trips
--
-- Change a capacity in that Python and every Ideal CuM, Performance, OEE and
-- fleet roll-up on the screen moves. The mine owns those decisions and has
-- had to ask for a deployment to make one.
--
-- ── TWO TABLES, BECAUSE A MACHINE IS NOT ITS SETTINGS ──────────────────────
-- oee_equip_master holds what a machine IS: its name, whether it is an
-- excavator or a tipper, whether it is owned or hired, and which systems have
-- ever heard of it. Those are facts about the asset; they do not have a date.
--
-- oee_equip_status holds what the mine has DECIDED about it: in service or
-- not, old fleet or new, and the ideal rate it is measured against. Those do
-- have a date -- the mine asked for a selector where a choice applies from the
-- day it is made until the day it is changed -- so each decision is a row
-- carrying the date it takes effect from, and nothing is ever overwritten.
--
-- ── HOW A DATE IS RESOLVED ─────────────────────────────────────────────────
-- The settings in force on a date are the row with the greatest
-- effective_from that is <= that date. Before the first row, the FIRST row
-- applies; see the note on the seed at the bottom of this file for why that
-- is not a fudge.
--
-- ── WHY THE CHECKS ARE WORTH THE WIDTH ─────────────────────────────────────
-- An excavator is measured in cubic metres an hour and a tipper in trips, so
-- one table holding both has columns that apply to one and not the other. The
-- constraints below make a row that mixes them UNSTORABLE rather than leaving
-- it to be noticed later in a figure nobody can explain:
--
--   * an active excavator must carry a CuM rate and no trip figures;
--   * an active NEW tipper must carry its fixed trips and no rate;
--   * an active OLD tipper must carry a trips-per-engine-hour rate and no
--     fixed trips;
--   * breakdown may be read from SAP only for a machine SAP can be asked
--     about. A hired machine pointed at SAP returns no notifications, which
--     is not zero breakdown -- it reads as 100% Availability, the exact
--     failure the PRIMA table already carries a footnote to explain.
--
-- An INACTIVE machine is exempt from the rate checks: EV 1, EV 2 and
-- TATA-370(6) are in the fleet and have never been given an ideal capacity,
-- which is precisely why they are not reported. Requiring one to store them
-- would mean inventing it.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. THE MACHINE
-- ---------------------------------------------------------------------------
-- oee_equip_master already exists (migration 096) holding the excavators.
-- This widens it to the whole fleet and moves `status` out to the dated table,
-- so there is one place a reader can look to find what is in service.

ALTER TABLE oee_equip_master
    ADD COLUMN IF NOT EXISTS equipment_class varchar(10) NOT NULL DEFAULT 'EXCAVATOR',
    ADD COLUMN IF NOT EXISTS name_shift_log       varchar(60),
    ADD COLUMN IF NOT EXISTS legacy_code          varchar(20),
    ADD COLUMN IF NOT EXISTS sap_equipment_no     varchar(18),
    ADD COLUMN IF NOT EXISTS sap_desc_tech_object varchar(60),
    ADD COLUMN IF NOT EXISTS engine_source        varchar(12),
    ADD COLUMN IF NOT EXISTS bd_source            varchar(12) NOT NULL DEFAULT 'SHIFT_LOG',
    ADD COLUMN IF NOT EXISTS sl_order             integer;

-- THE GUARDS BELOW SCOPE ON conrelid AS WELL AS ON THE NAME. A constraint
-- name is unique per TABLE, not per database: checking the name alone found
-- minehub's copy and skipped creating it anywhere else, so this migration
-- stopped being able to build a fresh schema the moment it had been run once.
DO $$
BEGIN
    -- THREE SYSTEMS, THREE SPELLINGS OF THE SAME TRUCK. Telematics says
    -- MAN11, the shift log says MAN-11, SAP says "MAN-11 (TIPPER)". The code
    -- derives these from each other today, and a truck lost to a hyphen reads
    -- as a truck that did no work -- indistinguishable from the real thing.
    -- Written down, they can be corrected without a deployment.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'oee_equip_master_class_chk'
                     AND conrelid = 'oee_equip_master'::regclass) THEN
        ALTER TABLE oee_equip_master
            ADD CONSTRAINT oee_equip_master_class_chk
            CHECK (equipment_class IN ('EXCAVATOR', 'TIPPER'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'oee_equip_master_engine_src_chk'
                     AND conrelid = 'oee_equip_master'::regclass) THEN
        ALTER TABLE oee_equip_master
            ADD CONSTRAINT oee_equip_master_engine_src_chk
            CHECK (engine_source IS NULL
                   OR engine_source IN ('TELEMATICS', 'SHIFT_LOG'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'oee_equip_master_bd_src_chk'
                     AND conrelid = 'oee_equip_master'::regclass) THEN
        ALTER TABLE oee_equip_master
            ADD CONSTRAINT oee_equip_master_bd_src_chk
            CHECK (bd_source IN ('SAP', 'SHIFT_LOG'));
    END IF;

    -- Breakdown from SAP only for a machine SAP can be asked about, by
    -- whichever key that system knows it by.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'oee_equip_master_sap_key_chk'
                     AND conrelid = 'oee_equip_master'::regclass) THEN
        ALTER TABLE oee_equip_master
            ADD CONSTRAINT oee_equip_master_sap_key_chk
            CHECK (bd_source <> 'SAP'
                   OR sap_equipment_no IS NOT NULL
                   OR sap_desc_tech_object IS NOT NULL);
    END IF;

    -- The target of the composite foreign key below, so a settings row can
    -- never claim a class its machine does not have.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'oee_equip_master_name_class_key'
                     AND conrelid = 'oee_equip_master'::regclass) THEN
        ALTER TABLE oee_equip_master
            ADD CONSTRAINT oee_equip_master_name_class_key
            UNIQUE (equipment_name, equipment_class);
    END IF;
END $$;

COMMENT ON COLUMN oee_equip_master.name_shift_log IS
    'equipment_name as mines_tipper_details spells it -- MAN-11 for MAN11.';
COMMENT ON COLUMN oee_equip_master.sap_desc_tech_object IS
    'DESC_TECH_OBJECT in the notification feed, for machines SAP identifies '
    'by description rather than by equipment number.';
COMMENT ON COLUMN oee_equip_master.legacy_code IS
    'Token inside the pre-July 2026 CSV form of equipment_name. Null for '
    'anything that arrived after the mine began writing the full name.';


-- ---------------------------------------------------------------------------
-- 2. WHAT THE MINE HAS DECIDED ABOUT IT, AND FROM WHEN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oee_equip_status (
    id              bigserial   PRIMARY KEY,
    equipment_name  varchar(60) NOT NULL,
    equipment_class varchar(10) NOT NULL,
    effective_from  date        NOT NULL,

    status          varchar(10) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
    generation      varchar(3)  NOT NULL CHECK (generation IN ('OLD', 'NEW')),

    --: Excavator. Cubic metres an hour, the mine's engineering figure.
    ideal_cum_per_hr      numeric(6, 2) CHECK (ideal_cum_per_hr > 0),
    --: NEW tipper. A FIXED trip count supplied by the mine, not a rate --
    --: it does not scale with the length of the window, which is the known
    --: cost of the mine's decision of 26 October 2026.
    ideal_trip_fixed      integer       CHECK (ideal_trip_fixed > 0),
    --: OLD tipper. Trips a truck should turn per engine-hour.
    trips_per_engine_hour numeric(4, 2) CHECK (trips_per_engine_hour > 0),

    entry_id        varchar(32) NOT NULL,
    entry_date      timestamptz NOT NULL DEFAULT now(),
    revision        integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),

    -- One decision per machine per date. A second choice on the same day
    -- replaces the first rather than sitting beside it, because two rows with
    -- one effective_from have no order between them and the resolver would
    -- pick whichever the planner returned.
    UNIQUE (equipment_name, effective_from),

    FOREIGN KEY (equipment_name, equipment_class)
        REFERENCES oee_equip_master (equipment_name, equipment_class)
        ON UPDATE CASCADE,

    -- An ACTIVE machine must carry the rate its class is measured in, and
    -- only that one. An INACTIVE one need not: a machine is inactive
    -- precisely because the mine has not settled its figures.
    CONSTRAINT oee_equip_status_excavator_chk CHECK (
        status <> 'ACTIVE' OR equipment_class <> 'EXCAVATOR'
        OR (ideal_cum_per_hr IS NOT NULL
            AND ideal_trip_fixed IS NULL
            AND trips_per_engine_hour IS NULL)),

    CONSTRAINT oee_equip_status_new_tipper_chk CHECK (
        status <> 'ACTIVE' OR NOT (equipment_class = 'TIPPER' AND generation = 'NEW')
        OR (ideal_trip_fixed IS NOT NULL
            AND ideal_cum_per_hr IS NULL
            AND trips_per_engine_hour IS NULL)),

    CONSTRAINT oee_equip_status_old_tipper_chk CHECK (
        status <> 'ACTIVE' OR NOT (equipment_class = 'TIPPER' AND generation = 'OLD')
        OR (trips_per_engine_hour IS NOT NULL
            AND ideal_cum_per_hr IS NULL
            AND ideal_trip_fixed IS NULL))
);

COMMENT ON TABLE oee_equip_status IS
    'The Equipment Status Selector. One row per decision, carrying the date it '
    'takes effect; the settings in force on a date are the latest row on or '
    'before it. Nothing here is ever updated in place -- a change is a new '
    'row, so a figure reported last month can still be explained next year.';

COMMENT ON COLUMN oee_equip_status.effective_from IS
    'The day this choice starts applying. It holds until a later row for the '
    'same machine supersedes it.';

CREATE INDEX IF NOT EXISTS oee_equip_status_lookup_idx
    ON oee_equip_status (equipment_name, effective_from DESC);
CREATE INDEX IF NOT EXISTS oee_equip_status_date_idx
    ON oee_equip_status (effective_from DESC);


-- ---------------------------------------------------------------------------
-- 3. WHO CHANGED WHAT
-- ---------------------------------------------------------------------------
-- Field-level rather than row-level. A machine has six settable attributes and
-- 'CHANGED' on its own would not say which of them moved -- which is the only
-- question anybody asks of a trail like this.

CREATE TABLE IF NOT EXISTS oee_equip_status_hist (
    id             bigserial   PRIMARY KEY,
    -- No foreign key, deliberately: retiring a machine must not erase the
    -- record of what it was once set to.
    equipment_name varchar(60) NOT NULL,
    effective_from date        NOT NULL,
    action         varchar(8)  NOT NULL CHECK (action IN ('ADDED', 'CHANGED', 'REMOVED')),
    field          varchar(40),
    old_value      text,
    new_value      text,
    revision       integer     NOT NULL CHECK (revision >= 1),
    entry_id       varchar(32) NOT NULL,
    entry_date     timestamptz NOT NULL DEFAULT now(),

    -- A change that changed nothing is not history, it is noise.
    CHECK (old_value IS DISTINCT FROM new_value)
);

CREATE INDEX IF NOT EXISTS oee_equip_status_hist_equip_idx
    ON oee_equip_status_hist (equipment_name, effective_from DESC);
CREATE INDEX IF NOT EXISTS oee_equip_status_hist_when_idx
    ON oee_equip_status_hist (entry_date DESC);


-- ---------------------------------------------------------------------------
-- 4. THE FLEET ITSELF
-- ---------------------------------------------------------------------------
-- Generated from the lists in services/oee.py and services/tipper_oee.py on
-- 2026-11-06, so the table starts life identical to the code it replaces. The
-- parity harness proves that claim rather than asserting it: every figure on
-- all four OEE tables is captured before and after the switch and compared
-- leaf by leaf.
--
-- effective_from is 2026-10-01 for every row. That is the month the mine
-- named, and it is NOT a claim that these settings began in October -- they
-- have applied all along. The resolver reads the FIRST version when a date
-- falls before it, so September and July report exactly what they reported
-- yesterday. The date matters from here on: the next change the mine makes
-- carries its own, and October stays as it was.

-- The excavators. Ten reported, three in the fleet and not reported.
INSERT INTO oee_equip_master (equipment_name, category, status,
        equipment_class, name_shift_log, legacy_code, sap_equipment_no,
        sap_desc_tech_object, engine_source, bd_source, sl_order)
VALUES
    ('TATA-470(7)', 'OWN', 'ACTIVE', 'EXCAVATOR', 'TATA-470(7)', '470-7', '000000000000700086', NULL, 'SHIFT_LOG', 'SAP', 1),
    ('TATA-470(2)', 'OWN', 'ACTIVE', 'EXCAVATOR', 'TATA-470(2)', '470-2', '000000000000700042', NULL, 'SHIFT_LOG', 'SAP', 2),
    ('TATA-370(5)', 'OWN', 'ACTIVE', 'EXCAVATOR', 'TATA-370(5)', '370-5', '000000000000700064', NULL, 'SHIFT_LOG', 'SAP', 3),
    ('TATA-370(4)', 'OWN', 'ACTIVE', 'EXCAVATOR', 'TATA-370(4)', '370-4', '000000000000700053', NULL, 'SHIFT_LOG', 'SAP', 4),
    ('TATA-220(8)', 'OWN', 'ACTIVE', 'EXCAVATOR', 'TATA-220(8)', '220-8', '000000000000700090', NULL, 'SHIFT_LOG', 'SAP', 5),
    ('TATA-350(1)', 'HIRED', 'ACTIVE', 'EXCAVATOR', 'TATA-350(1)', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 6),
    ('TATA-350(2)', 'HIRED', 'ACTIVE', 'EXCAVATOR', 'TATA-350(2)', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 7),
    ('SANY-2', 'HIRED', 'ACTIVE', 'EXCAVATOR', 'SANY-2', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 8),
    ('TATA-490', 'HIRED', 'ACTIVE', 'EXCAVATOR', 'TATA-490', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 9),
    ('TATA-210', 'HIRED', 'ACTIVE', 'EXCAVATOR', 'TATA-210', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 10),
    ('EV 1', 'OWN', 'INACTIVE', 'EXCAVATOR', 'EV 1', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 11),
    ('EV 2', 'OWN', 'INACTIVE', 'EXCAVATOR', 'EV 2', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 12),
    ('TATA-370(6)', 'OWN', 'INACTIVE', 'EXCAVATOR', 'TATA-370(6)', NULL, '000000000000700075', NULL, 'SHIFT_LOG', 'SAP', 13)
ON CONFLICT (equipment_name) DO UPDATE SET
        category             = EXCLUDED.category,
        equipment_class      = EXCLUDED.equipment_class,
        name_shift_log       = EXCLUDED.name_shift_log,
        legacy_code          = EXCLUDED.legacy_code,
        sap_equipment_no     = EXCLUDED.sap_equipment_no,
        sap_desc_tech_object = EXCLUDED.sap_desc_tech_object,
        engine_source        = EXCLUDED.engine_source,
        bd_source            = EXCLUDED.bd_source,
        sl_order             = EXCLUDED.sl_order;

-- The tippers. MAN is read from Technoton and SAP; PRIMA has neither a
-- telematics unit nor a SAP equipment record, so the shift log is the only
-- place it appears at all. Both spellings are written down rather than
-- derived -- a truck lost to a hyphen reads as a truck that did no work.
INSERT INTO oee_equip_master (equipment_name, category, status,
        equipment_class, name_shift_log, legacy_code, sap_equipment_no,
        sap_desc_tech_object, engine_source, bd_source, sl_order)
VALUES
    ('MAN11', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-11', NULL, NULL, 'MAN-11 (TIPPER)', 'TELEMATICS', 'SAP', 1),
    ('MAN12', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-12', NULL, NULL, 'MAN-12 (TIPPER)', 'TELEMATICS', 'SAP', 2),
    ('MAN14', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-14', NULL, NULL, 'MAN-14 (TIPPER)', 'TELEMATICS', 'SAP', 3),
    ('MAN18', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-18', NULL, NULL, 'MAN-18 (TIPPER)', 'TELEMATICS', 'SAP', 4),
    ('MAN20', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-20', NULL, NULL, 'MAN-20 (TIPPER)', 'TELEMATICS', 'SAP', 5),
    ('MAN41', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-41', NULL, NULL, 'MAN-41 (TIPPER)', 'TELEMATICS', 'SAP', 6),
    ('MAN43', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-43', NULL, NULL, 'MAN-43 (TIPPER)', 'TELEMATICS', 'SAP', 7),
    ('MAN49', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-49', NULL, NULL, 'MAN-49 (TIPPER)', 'TELEMATICS', 'SAP', 8),
    ('MAN50', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-50', NULL, NULL, 'MAN-50 (TIPPER)', 'TELEMATICS', 'SAP', 9),
    ('MAN51', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-51', NULL, NULL, 'MAN-51 (TIPPER)', 'TELEMATICS', 'SAP', 10),
    ('MAN52', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-52', NULL, NULL, 'MAN-52 (TIPPER)', 'TELEMATICS', 'SAP', 11),
    ('MAN53', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-53', NULL, NULL, 'MAN-53 (TIPPER)', 'TELEMATICS', 'SAP', 12),
    ('MAN55', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-55', NULL, NULL, 'MAN-55 (TIPPER)', 'TELEMATICS', 'SAP', 13),
    ('MAN56', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-56', NULL, NULL, 'MAN-56 (TIPPER)', 'TELEMATICS', 'SAP', 14),
    ('MAN57', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-57', NULL, NULL, 'MAN-57 (TIPPER)', 'TELEMATICS', 'SAP', 15),
    ('MAN58', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-58', NULL, NULL, 'MAN-58 (TIPPER)', 'TELEMATICS', 'SAP', 16),
    ('MAN65', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-65', NULL, NULL, 'MAN-65 (TIPPER)', 'TELEMATICS', 'SAP', 17),
    ('MAN66', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-66', NULL, NULL, 'MAN-66 (TIPPER)', 'TELEMATICS', 'SAP', 18),
    ('MAN67', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-67', NULL, NULL, 'MAN-67 (TIPPER)', 'TELEMATICS', 'SAP', 19),
    ('MAN69', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-69', NULL, NULL, 'MAN-69 (TIPPER)', 'TELEMATICS', 'SAP', 20),
    ('MAN71', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-71', NULL, NULL, 'MAN-71 (TIPPER)', 'TELEMATICS', 'SAP', 21),
    ('MAN72', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-72', NULL, NULL, 'MAN-72 (TIPPER)', 'TELEMATICS', 'SAP', 22),
    ('MAN74', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-74', NULL, NULL, 'MAN-74 (TIPPER)', 'TELEMATICS', 'SAP', 23),
    ('MAN75', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-75', NULL, NULL, 'MAN-75 (TIPPER)', 'TELEMATICS', 'SAP', 24),
    ('MAN77', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-77', NULL, NULL, 'MAN-77 (TIPPER)', 'TELEMATICS', 'SAP', 25),
    ('MAN80', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-80', NULL, NULL, 'MAN-80 (TIPPER)', 'TELEMATICS', 'SAP', 26),
    ('MAN81', 'OWN', 'ACTIVE', 'TIPPER', 'MAN-81', NULL, NULL, 'MAN-81 (TIPPER)', 'TELEMATICS', 'SAP', 27),
    ('PRIMA - 5135', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-5135', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 28),
    ('PRIMA - 5235', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-5235', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 29),
    ('PRIMA - 5335', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-5335', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 30),
    ('PRIMA - 5435', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-5435', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 31),
    ('PRIMA - 5535', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-5535', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 32),
    ('PRIMA - 5635', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-5635', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 33),
    ('PRIMA - 5735', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-5735', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 34),
    ('PRIMA - 5835', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-5835', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 35),
    ('PRIMA - 5935', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-5935', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 36),
    ('PRIMA - 6035', 'OWN', 'ACTIVE', 'TIPPER', 'PRIMA-6035', NULL, NULL, NULL, 'SHIFT_LOG', 'SHIFT_LOG', 37)
ON CONFLICT (equipment_name) DO UPDATE SET
        category             = EXCLUDED.category,
        equipment_class      = EXCLUDED.equipment_class,
        name_shift_log       = EXCLUDED.name_shift_log,
        sap_equipment_no     = EXCLUDED.sap_equipment_no,
        sap_desc_tech_object = EXCLUDED.sap_desc_tech_object,
        engine_source        = EXCLUDED.engine_source,
        bd_source            = EXCLUDED.bd_source,
        sl_order             = EXCLUDED.sl_order;

-- The settings in force. Old or new is the mine's own designation of
-- 26 October 2026 and is NOT the same as hired: TATA-350(1), SANY-2 and
-- TATA-210 are hired and belong with the old machines.
INSERT INTO oee_equip_status (equipment_name, equipment_class,
        effective_from, status, generation, ideal_cum_per_hr,
        ideal_trip_fixed, trips_per_engine_hour, entry_id)
VALUES
    ('TATA-470(7)', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'OLD', 17.00, NULL, NULL, 'SEED-100'),
    ('TATA-470(2)', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'OLD', 17.00, NULL, NULL, 'SEED-100'),
    ('TATA-370(5)', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'OLD', 39.00, NULL, NULL, 'SEED-100'),
    ('TATA-370(4)', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'OLD', 39.00, NULL, NULL, 'SEED-100'),
    ('TATA-220(8)', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'OLD', 29.00, NULL, NULL, 'SEED-100'),
    ('TATA-350(1)', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'OLD', 58.00, NULL, NULL, 'SEED-100'),
    ('TATA-350(2)', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'NEW', 58.00, NULL, NULL, 'SEED-100'),
    ('SANY-2', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'OLD', 17.00, NULL, NULL, 'SEED-100'),
    ('TATA-490', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'NEW', 26.00, NULL, NULL, 'SEED-100'),
    ('TATA-210', 'EXCAVATOR', DATE '2026-10-01', 'ACTIVE', 'OLD', 29.00, NULL, NULL, 'SEED-100'),
    ('EV 1', 'EXCAVATOR', DATE '2026-10-01', 'INACTIVE', 'OLD', NULL, NULL, NULL, 'SEED-100'),
    ('EV 2', 'EXCAVATOR', DATE '2026-10-01', 'INACTIVE', 'OLD', NULL, NULL, NULL, 'SEED-100'),
    ('TATA-370(6)', 'EXCAVATOR', DATE '2026-10-01', 'INACTIVE', 'OLD', NULL, NULL, NULL, 'SEED-100'),
    ('MAN11', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN12', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN14', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN18', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN20', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN41', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN43', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN49', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN50', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN51', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN52', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN53', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN55', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN56', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN57', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN58', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN65', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN66', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN67', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN69', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN71', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN72', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN74', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN75', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN77', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN80', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('MAN81', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'OLD', NULL, NULL, 1.50, 'SEED-100'),
    ('PRIMA - 5135', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 323, NULL, 'SEED-100'),
    ('PRIMA - 5235', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 317, NULL, 'SEED-100'),
    ('PRIMA - 5335', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 342, NULL, 'SEED-100'),
    ('PRIMA - 5435', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 328, NULL, 'SEED-100'),
    ('PRIMA - 5535', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 338, NULL, 'SEED-100'),
    ('PRIMA - 5635', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 304, NULL, 'SEED-100'),
    ('PRIMA - 5735', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 246, NULL, 'SEED-100'),
    ('PRIMA - 5835', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 332, NULL, 'SEED-100'),
    ('PRIMA - 5935', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 352, NULL, 'SEED-100'),
    ('PRIMA - 6035', 'TIPPER', DATE '2026-10-01', 'ACTIVE', 'NEW', NULL, 325, NULL, 'SEED-100')
ON CONFLICT (equipment_name, effective_from) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 5. ONE PLACE TO LOOK
-- ---------------------------------------------------------------------------
-- status now lives on the dated table, where a change to it carries the day
-- it took effect. Leaving a copy on the master would give a reader two
-- answers to one question, and sooner or later two different ones.

ALTER TABLE oee_equip_master DROP COLUMN IF EXISTS status;
