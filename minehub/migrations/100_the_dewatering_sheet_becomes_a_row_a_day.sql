-- 099: put the two dewatering tables in the repository.
--
-- Same story as 096 and 098, and the rule exists now because of them: the
-- tables were created by hand against corpappdb while the Enter Daily
-- Dewatering Data form was built, and a branch that reads and writes them
-- must carry their definition. Nothing here is new. Every statement is
-- IF NOT EXISTS against the live definition, built into a throwaway schema
-- inside one transaction and compared to minehub column by column, constraint
-- by constraint, before being committed to the repository.
--
-- ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
-- `mines_dewatering_daily_data` on balcorpdb (MySQL) held ONE ROW PER KPI PER
-- DAY: twelve rows to describe one morning, every figure on the screen
-- reconstructed by MAX(CASE WHEN kpi_id = 33 ...), and the derived figures
-- stored as ordinary columns beside the inputs they came from -- by which
-- point they had already drifted from them by 0.02 M3. It took its last row
-- on 15 October 2026 and nothing reads it any more.
--
-- ── WHY ONE ROW PER DAY, NOT ONE PER KPI ────────────────────────────────────
-- Opening stock is the previous day's closing stock. On one row per day that
-- chain is a self-join on one table; across twenty-seven rows per day it is a
-- correlated lookup for every figure. The PRIMARY KEY on the date then makes
-- a duplicated day impossible, numbers keep numeric types while the reason
-- texts keep text, and a day cannot exist with some of its KPIs and not
-- others.
--
-- ── WHY SIX COLUMNS ARE GENERATED ───────────────────────────────────────────
-- GENERATED ALWAYS ... STORED means an inconsistent row cannot be written by
-- anyone, through any route -- not the screen, not a backfill script, not a
-- hand-written UPDATE. The old table's drift is unrepresentable here rather
-- than merely unlikely. The formulas are October 2026's, which the mine
-- confirmed as the correct form:
--
--     Rain Water      = Rain fall mm   x rain factor
--     PLAN Disposal   = PLAN Pump Hr   x Adjusted Pump Capacity
--     ACTUAL Disposal = ACTUAL Pump Hr x Adjusted Pump Capacity
--     Variance        = ACTUAL Disposal - PLAN Disposal
--     Day Closing     = Opening + Seepage + Rain Water - ACTUAL Disposal
--     Plan Compliance = ACTUAL Pump Hr / PLAN Pump Hr
--
-- NULL propagates deliberately: a day missing its capacity has no disposal
-- figure, and a zero there would read as "nothing was pumped".
--
-- ── WHY THE CAPACITY AND THE RAIN FACTOR ARE COLUMNS, NOT CONSTANTS ─────────
-- Both have already changed inside the mine's own sheet -- the capacity reads
-- 250 in October 2025 and 300 in October 2026, and the rain factor moved from
-- 300 to 280 M3 per mm during October 2025. A figure that has changed once
-- will change again. Held as data, a new value is an entry rather than a
-- schema change, and every past day keeps the factor it was actually filed
-- under, so recomputing 2025 next year still gives 2025's answer.


-- ---------------------------------------------------------------------------
-- 1. THE DAY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dewatering_daily_data (
    -- THE DAY IS THE KEY. Named data_date because entry_date below is when it
    -- was typed, and the mine types in arrears -- the two are routinely
    -- different days, and collapsing them would misdate the whole chain.
    data_date                date          PRIMARY KEY,

    -- ── typed: water management ────────────────────────────────────────
    rainfall_mm              numeric(10,3) CHECK (rainfall_mm >= 0),

    -- The sheet's "Adjusted Pump Capacity". Both disposals derive from it, so
    -- a wrong value here moves four other figures.
    pump_capacity_m3_hr      numeric(10,3) CHECK (pump_capacity_m3_hr >= 0),

    rain_factor_m3_per_mm    numeric(10,3) NOT NULL DEFAULT 280
                             CHECK (rain_factor_m3_per_mm >= 0),

    -- Carried from the previous day's closing stock by the application, and
    -- editable: the chain has to be startable somewhere, and a day the mine
    -- re-measures after a survey must be able to override it.
    opening_stock_m3         numeric(14,3),
    seepage_m3               numeric(14,3) CHECK (seepage_m3 >= 0),
    plan_pump_hr             numeric(8,2)  CHECK (plan_pump_hr  >= 0),
    actual_pump_hr           numeric(8,2)  CHECK (actual_pump_hr >= 0),

    -- ── derived, AND THE DATABASE DOES THE ARITHMETIC ──────────────────
    -- TYPED, not generated. The mine's sheet carries "Add Day Rain Water"
    -- as a literal on more than half its days, and computing it from
    -- millimetres got 1-4 October 2025 wrong by 0.1 M3 each. The form fills
    -- it from rainfall x factor; the figure may be typed over. Migration 108
    -- made this change on a database already built from the old shape.
    rain_water_m3            numeric(14,3) CHECK (rain_water_m3 >= 0),

    plan_disposal_m3         numeric(14,3)
                             GENERATED ALWAYS AS
                             (plan_pump_hr * pump_capacity_m3_hr) STORED,

    actual_disposal_m3       numeric(14,3)
                             GENERATED ALWAYS AS
                             (actual_pump_hr * pump_capacity_m3_hr) STORED,

    variance_m3              numeric(14,3)
                             GENERATED ALWAYS AS
                             (actual_pump_hr * pump_capacity_m3_hr
                              - plan_pump_hr * pump_capacity_m3_hr) STORED,

    closing_stock_m3         numeric(14,3)
                             GENERATED ALWAYS AS
                             (opening_stock_m3
                              + seepage_m3
                              + rain_water_m3
                              - actual_pump_hr * pump_capacity_m3_hr) STORED,

    -- NULLIF guards the division: a day planned at nought has no compliance
    -- figure, which is not the same as zero per cent.
    plan_compliance_pct      numeric(9,3)
                             GENERATED ALWAYS AS
                             (actual_pump_hr / NULLIF(plan_pump_hr, 0) * 100)
                             STORED,

    -- ── typed: pond levels ─────────────────────────────────────────────
    -- No CHECK >= 0 on any level: these are reduced levels and the mine's own
    -- sheet records -3.5 Mrl in the east pit.
    west_water_level_mrl     numeric(8,2),
    west_silt_level_mrl      numeric(8,2),
    east_water_level_mrl     numeric(8,2),
    east_silt_level_mrl      numeric(8,2),
    dewatering_reason        text,

    -- ── typed: slurry ──────────────────────────────────────────────────
    slurry_pump_east_1_hr    numeric(8,2)  CHECK (slurry_pump_east_1_hr >= 0),
    slurry_pump_west_1_hr    numeric(8,2)  CHECK (slurry_pump_west_1_hr >= 0),
    east_pit_water_level_mrl numeric(8,2),
    slurry_challenges        text,

    -- ── typed: silt / eddy ─────────────────────────────────────────────
    -- EDDY Day and the two discharge totals are TYPED, not derived. The sheet
    -- has no formula behind any of them in any column, and the mine confirmed
    -- they stay typed -- deriving Day as A + B would be this application
    -- inventing a rule the mine has never applied.
    eddy_a_shift_min         numeric(8,2)  CHECK (eddy_a_shift_min >= 0),
    eddy_b_shift_min         numeric(8,2)  CHECK (eddy_b_shift_min >= 0),
    eddy_day_min             numeric(8,2)  CHECK (eddy_day_min >= 0),
    eddy_discharge_m3        numeric(14,3) CHECK (eddy_discharge_m3 >= 0),
    total_slurry_discharge_m3 numeric(14,3)
                             CHECK (total_slurry_discharge_m3 >= 0),
    eddy_challenges          text,

    -- ── who, and when ──────────────────────────────────────────────────
    -- entry_id is the employee id of whoever was signed in; entry_date is
    -- when the day was first stored and is never overwritten. updated_* hold
    -- the last edit, NULL until there has been one.
    revision                 integer       NOT NULL DEFAULT 1
                             CHECK (revision >= 1),
    entry_id                 varchar(32)   NOT NULL,
    entry_date               timestamptz   NOT NULL DEFAULT now(),
    updated_id               varchar(32),
    updated_date             timestamptz,
    CHECK ((updated_id IS NULL) = (updated_date IS NULL))
);

COMMENT ON TABLE dewatering_daily_data IS
    'One row per day of the mine''s dewatering sheet. The six derived columns '
    'are GENERATED, so a stored row can never disagree with its own inputs.';
COMMENT ON COLUMN dewatering_daily_data.data_date IS
    'The day the readings describe, not the day they were typed';
COMMENT ON COLUMN dewatering_daily_data.opening_stock_m3 IS
    'Carried from the previous day''s closing stock; editable';
COMMENT ON COLUMN dewatering_daily_data.rain_factor_m3_per_mm IS
    'M3 of water per mm of rain. 280 in October 2026; was 300 earlier';


-- ---------------------------------------------------------------------------
-- 2. THE EDIT LOG
-- ---------------------------------------------------------------------------
-- FIELD BY FIELD, WITH BOTH VALUES. The day's row says what the figures are
-- now and updated_date says when they last moved; neither says what they
-- moved FROM, which is the only question anybody brings to a log.
--
-- IT ALSO RECORDS THE DAYS NOBODY EDITED. Opening stock chains, so correcting
-- one day's pump hours moves the closing stock of every day after it. Those
-- days are rewritten by the application and logged as CHAINED, which is how
-- somebody reading a figure that moved without being touched finds out why.
--
-- NO FOREIGN KEY, DELIBERATELY: a log must survive the deletion of the row it
-- describes.
CREATE TABLE IF NOT EXISTS dewatering_history_log (
    id            bigserial    PRIMARY KEY,
    data_date     date         NOT NULL,

    -- The column that changed, exactly as it is named in the table above.
    field         varchar(40)  NOT NULL,

    -- ADDED    the day, or this figure, was not there before
    -- CHANGED  the figure moved; both values are below
    -- REMOVED  the figure was cleared
    -- CHAINED  nobody touched this day -- an earlier day's edit moved its
    --          opening stock, and everything downstream of it
    action        varchar(8)   NOT NULL
                  CHECK (action IN ('ADDED', 'CHANGED', 'REMOVED', 'CHAINED')),

    -- Held as text so one log covers the numeric fields and the reason texts
    -- without a column per type. Nothing reads these back as numbers; they
    -- are read by people.
    old_value     text,
    new_value     text,

    -- Shared by every row written in one save, so an edit touching six fields
    -- and re-chaining twelve days reads as one event rather than eighteen.
    revision      integer      NOT NULL CHECK (revision >= 1),

    entry_id      varchar(32)  NOT NULL,
    entry_date    timestamptz  NOT NULL DEFAULT now(),

    -- A log row recording no change is noise.
    CHECK (old_value IS DISTINCT FROM new_value)
);

-- The two questions anybody actually asks of this log, and neither is
-- answerable from the primary key. "What changed on the 3rd?" scans by date
-- and reads newest first, which is the ORDER BY the history endpoint issues.
-- "When has the pump capacity ever moved?" scans by field. Without these the
-- log is a sequential scan that grows with every edit ever made.
CREATE INDEX IF NOT EXISTS dewatering_history_log_date_idx
    ON dewatering_history_log (data_date, entry_date DESC);
CREATE INDEX IF NOT EXISTS dewatering_history_log_field_idx
    ON dewatering_history_log (field, data_date);
