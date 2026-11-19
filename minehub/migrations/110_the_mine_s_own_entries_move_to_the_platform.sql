-- 110: the three tables the mine types into move from MySQL to minehub.
--
-- WHAT MOVES, AND WHY IT SHOULD.
--   mines_prev_day_actual   the previous day's estimated actual
--   mines_stock_entry       the stock position by grade and bucket
--   mines_proposed_despatch tomorrow's proposed despatch
--
-- All three are written BY this application and read by nothing else. They sat
-- in balcorpdb, which is a shared MySQL instance this platform does not own:
-- it is at its connection ceiling and refuses connections most days, it is
-- read by every other BAL application, and nothing there is ours to migrate --
-- which is why none of these three has a CREATE TABLE in this repository and
-- a note under scripts/sql stands in for one. Data the platform owns belongs
-- in the database the platform owns, where it has a migration, a schema that
-- is version-controlled, and a backup that is ours.
--
-- ── THE SHAPE IS THE SAME, THE SPELLING IS NOT ───────────────────────────
-- Column names fold to lower case. MySQL compares identifiers case
-- insensitively and the queries were written `Date`, `Est_Actual`; PostgreSQL
-- folds unquoted identifiers down, so keeping the capitals would mean quoting
-- every column in every query forever. The backticks have to come off those
-- queries regardless, so they are being touched either way, and lower case is
-- what every other table in this schema uses.
--
-- Types map across directly: decimal -> numeric with the same precision,
-- varchar lengths unchanged, every CHECK constraint carried over with the
-- same members in the same order. Nothing is widened, nothing is relaxed.
--
-- ── TIMES BECOME timestamptz ─────────────────────────────────────────────
-- MySQL stored these as naive `datetime`, which in practice is India Standard
-- Time -- that is the mine's clock, the server's clock and the application's
-- clock. minehub stores instants, as every other table here does, so the copy
-- interprets the naive values as Asia/Kolkata rather than as UTC. Reading
-- them as UTC would silently move every entry timestamp five and a half hours
-- and make "who filed this, and when" wrong for 2,042 rows.
--
-- ── THE OLD TABLES ARE NOT DROPPED ───────────────────────────────────────
-- They stay in balcorpdb untouched, as they are, so this is reversible by
-- pointing the code back. Nothing here writes to them and nothing here
-- depends on them.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. THE PREVIOUS DAY'S ESTIMATED ACTUAL
-- ---------------------------------------------------------------------------
-- One row per day per material. Read by the Executive Summary, the Lost Cost
-- Matrix, the COB matrix and Reality Check, all of which stand this figure in
-- for a day SAP has not posted -- see services/est_actual.py.
CREATE TABLE IF NOT EXISTS mines_prev_day_actual (
    date        date         NOT NULL,
    material    varchar(20)  NOT NULL,
    plan        numeric(16,2),
    est_actual  numeric(16,2) NOT NULL,

    entry_id    varchar(50)  NOT NULL,
    entry_date  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    updated_by  varchar(50),

    PRIMARY KEY (date, material),
    CONSTRAINT chk_mines_prev_day_material CHECK (material IN (
        'ORE', 'OB', 'TOTAL_EXCAVATION', 'COB', 'SILT', 'DESPATCH'))
);

COMMENT ON TABLE mines_prev_day_actual IS
    'The mine''s own figure for a day, typed on the dashboard before SAP has '
    'posted it. Stood in for the SAP actual while SAP is silent, and replaced '
    'by SAP the moment it speaks -- the row is kept either way, so "what it '
    'was" and "what it is" are both still on disk.';
COMMENT ON COLUMN mines_prev_day_actual.entry_date IS
    'When this day was first filed. See updated_at.';
COMMENT ON COLUMN mines_prev_day_actual.updated_at IS
    'Last changed. entry_date is when it was first filed.';
COMMENT ON COLUMN mines_prev_day_actual.updated_by IS
    'Who last changed it. entry_id is who first filed it.';

CREATE INDEX IF NOT EXISTS idx_mines_prev_day_actual_date
    ON mines_prev_day_actual (date DESC);
CREATE INDEX IF NOT EXISTS idx_mines_prev_day_actual_updated
    ON mines_prev_day_actual (date, updated_at);


-- ---------------------------------------------------------------------------
-- 2. THE STOCK POSITION
-- ---------------------------------------------------------------------------
-- One row per day per grade per bucket.
CREATE TABLE IF NOT EXISTS mines_stock_entry (
    stock_date  date         NOT NULL,
    grade       varchar(8)   NOT NULL,
    bucket      varchar(28)  NOT NULL,
    qty         numeric(14,2) NOT NULL,

    entry_id    varchar(50)  NOT NULL,
    entry_date  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    updated_by  varchar(50),

    PRIMARY KEY (stock_date, grade, bucket),
    CONSTRAINT chk_mines_stock_entry_grade CHECK (grade IN (
        'HG', 'MG', 'COB', 'LG')),
    CONSTRAINT chk_mines_stock_entry_bucket CHECK (bucket IN (
        'MINE_PERMISSION_IN_HAND', 'MINE_AWAITING_PERMISSION',
        'MINE_AWAITING_VERIFICATION', 'MINE_AWAITING_STACKING',
        'BAL_PLANT', 'SUK_PLANT', 'LG_FOR_COB',
        'MINE_AWAIT_ANALYSIS_REPORT', 'MINE_AWAIT_ROYALTY_PAYMENT')),
    -- LG_FOR_COB is low-grade ore set aside for the beneficiation plant, so
    -- it cannot carry any other grade.
    CONSTRAINT chk_mines_stock_entry_lg_for_cob CHECK (
        bucket <> 'LG_FOR_COB' OR grade = 'LG')
);

COMMENT ON TABLE mines_stock_entry IS
    'Mines stock position by grade and bucket, filled in on the dashboard. A '
    'Stock_Date is the MORNING of that day -- what the previous day''s work '
    'left behind.';
COMMENT ON COLUMN mines_stock_entry.entry_date IS
    'When this day was first filed. See updated_at.';
COMMENT ON COLUMN mines_stock_entry.updated_at IS
    'Last changed. entry_date is when it was first filed.';
COMMENT ON COLUMN mines_stock_entry.updated_by IS
    'Who last changed it. entry_id is who first filed it.';

CREATE INDEX IF NOT EXISTS idx_mines_stock_entry_date
    ON mines_stock_entry (stock_date DESC);
CREATE INDEX IF NOT EXISTS idx_mines_stock_entry_updated
    ON mines_stock_entry (stock_date, updated_at);


-- ---------------------------------------------------------------------------
-- 3. TOMORROW'S PROPOSED DESPATCH
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mines_proposed_despatch (
    despatch_date date        NOT NULL,
    destination   varchar(8)  NOT NULL,
    qty           numeric(14,2) NOT NULL,

    entry_id      varchar(50) NOT NULL,
    entry_date    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    varchar(50),

    PRIMARY KEY (despatch_date, destination),
    CONSTRAINT chk_mines_proposed_despatch_destination CHECK (
        destination IN ('SKD', 'BLS')),
    CONSTRAINT chk_mines_proposed_despatch_qty CHECK (qty >= 0)
);

COMMENT ON TABLE mines_proposed_despatch IS
    'The despatch the mine proposes for a day, by destination. SKD is '
    'Sukinda, BLS is Balasore.';
COMMENT ON COLUMN mines_proposed_despatch.entry_date IS
    'When this day was first filed. See updated_at.';
COMMENT ON COLUMN mines_proposed_despatch.updated_at IS
    'Last changed. entry_date is when it was first filed.';
COMMENT ON COLUMN mines_proposed_despatch.updated_by IS
    'Who last changed it. entry_id is who first filed it.';
