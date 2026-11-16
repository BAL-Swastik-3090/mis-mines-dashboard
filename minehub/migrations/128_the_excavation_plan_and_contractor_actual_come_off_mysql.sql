-- 128: the excavation plan and the contractor excavation move to this platform.
--
-- The last two of the five tables behind the 16 November outage. See
-- migration 126 for what happened and 127 for the two before these.
--
-- ── TWO QUANTITIES WERE STORED AS TEXT ──────────────────────────────────────
-- mines_daily_excavation_plan.OB_QTY_Cum is varchar(50) and
-- mines_day_wise_excavation.Qty is varchar(50). A column that accepts text
-- accepts anything, and over 6,470 rows it did:
--
--   '146cum'   one row,  2 January 2026
--   '292 cum'  two rows, 2 January 2026
--   '312 '     one row,  3 January 2026   (trailing space)
--   '240 '     one row,  3 January 2026   (trailing space)
--
-- Five rows out of 6,470, and every one of them silently wrong in a sum: in
-- MySQL '146cum' + 0 is 146 and '292 cum' + 0 is 292, so the figures happened
-- to total correctly while the column held something that was not a number.
-- The unit typed into the value is the reading nobody noticed because nothing
-- ever refused it.
--
-- Both are numeric here. The five rows are cleaned on the way in -- see the
-- loader, which strips the unit and the whitespace rather than guessing -- and
-- the column cannot take a unit again.
--
-- ── AND AN EMPTY STRING USED AS A VALUE ─────────────────────────────────────
-- mines_day_wise_excavation.Agency is NOT NULL varchar(20) and five rows hold
-- ''. That is a missing agency written in a way that no IS NULL test finds and
-- no NOT NULL constraint stops. It becomes NULL, and agency is nullable here,
-- which is what the data was saying all along.
--
-- ── WHAT IS NOT GENERATED, AND WHY ──────────────────────────────────────────
-- ORE_QTY looks like HG + MG + LG and nearly is: it holds on 4,142 of the
-- 4,151 rows. The nine that differ are roundings -- 340.00 stored where the
-- three grades total 340.05 -- not disagreements. Generating it would quietly
-- move nine figures the mine has already reported, so it stays typed, unlike
-- the five COB figures in migration 127 which held exactly on every row.
-- The same test, the opposite answer.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. THE SHIFT-WISE EXCAVATION PLAN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS excavation_plan (
    prod_date   date        NOT NULL,
    shift       varchar(1)  NOT NULL CHECK (shift IN ('A', 'B', 'C')),
    loc_id      integer     NOT NULL,

    face_desc   varchar(60),

    -- WAS varchar(50). See the header for the three rows that held a unit.
    ob_qty_cum  numeric(13,3) CHECK (ob_qty_cum >= 0),

    ore_qty     numeric(13,3) CHECK (ore_qty >= 0),
    hg_qty      numeric(13,3) CHECK (hg_qty  >= 0),
    mg_qty      numeric(13,3) CHECK (mg_qty  >= 0),
    lg_qty      numeric(13,3) CHECK (lg_qty  >= 0),

    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  varchar(32),
    revision    integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),

    PRIMARY KEY (prod_date, shift, loc_id)
);

COMMENT ON TABLE excavation_plan IS
    'What each face is planned to yield, per shift. Filed by Geology. Moved '
    'off balcorpdb by migration 128.';

COMMENT ON COLUMN excavation_plan.ore_qty IS
    'Typed, not generated. It equals HG + MG + LG on 4,142 of 4,151 rows; the '
    'nine that differ are roundings of 0.05, and generating it would move '
    'figures the mine has already reported.';

CREATE INDEX IF NOT EXISTS excavation_plan_date_idx
    ON excavation_plan (prod_date DESC);


-- ---------------------------------------------------------------------------
-- 2. WHAT THE CONTRACTORS ACTUALLY MOVED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS day_wise_excavation (
    prod_date    date        NOT NULL,
    shift        varchar(1)  NOT NULL CHECK (shift IN ('A', 'B', 'C')),
    loc_id       integer     NOT NULL,
    variant      varchar(5)  NOT NULL,

    -- NULLABLE, which the data already was. Five rows held '' under a NOT
    -- NULL constraint -- a missing agency written so that no IS NULL test
    -- finds it. They are loaded as NULL.
    --
    -- It stays in the key: a day, shift, location and variant can be worked
    -- by more than one agency, and the empty rows are the ones with none
    -- recorded. COALESCE in the key rather than the column, so the two
    -- cannot collide.
    agency       varchar(20),

    no_of_trips  integer     CHECK (no_of_trips >= 0),

    units        varchar(10) CHECK (units IN ('CuM', 'Mt')),

    -- WAS varchar(50). Two rows held a trailing space.
    qty          numeric(13,3) CHECK (qty >= 0),

    entry_id     varchar(32) NOT NULL,
    entry_date   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   varchar(32),
    revision     integer     NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

-- The key MySQL used was (Prod_date, Shift, Loc_Id, Variant, Agency) with
-- Agency NOT NULL. Here agency may be NULL, and NULLs do not collide in a
-- Postgres unique index -- so the five agency-less rows could be inserted
-- twice without it noticing. COALESCE gives them a value for key purposes
-- only, which restores exactly the behaviour MySQL had.
CREATE UNIQUE INDEX IF NOT EXISTS day_wise_excavation_key
    ON day_wise_excavation (prod_date, shift, loc_id, variant,
                            COALESCE(agency, ''));

COMMENT ON TABLE day_wise_excavation IS
    'The CONTRACTOR half of overburden, per shift, face and agency. BAL''s own '
    'OB comes from SAP, so the OB section keeps showing a figure when this '
    'stops -- just a smaller one than the mine actually moved. Migration 128.';

CREATE INDEX IF NOT EXISTS day_wise_excavation_date_idx
    ON day_wise_excavation (prod_date DESC);


-- ---------------------------------------------------------------------------
-- 3. THE AGENCIES, BECAUSE A JOIN CANNOT CROSS TWO DATABASES
-- ---------------------------------------------------------------------------
-- Four rows, and they would not have moved on their own merits. ob.py joins
-- day_wise_excavation to mines_agency_master to put a name against a code,
-- and once the first is on Postgres that join has one leg on each server --
-- which does not fail over, it simply cannot run.
--
-- Found by checking every query that reads the two tables above for a join to
-- something still on MySQL, before repointing any of them. This was the only
-- one.
--
-- Agency_Id keeps its stored values: day_wise_excavation.variant and the
-- agency codes in the data refer to them, so renumbering would break the
-- reference the move exists to preserve.
CREATE TABLE IF NOT EXISTS agency_master (
    agency_id   integer     PRIMARY KEY,
    agency_desc varchar(50) NOT NULL UNIQUE,
    status      varchar(1)  NOT NULL DEFAULT 'A' CHECK (status IN ('A', 'I')),
    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE agency_master IS
    'The contractors who move overburden. Moved with day_wise_excavation in '
    'migration 128 because the two are joined and a join cannot span two '
    'databases.';
