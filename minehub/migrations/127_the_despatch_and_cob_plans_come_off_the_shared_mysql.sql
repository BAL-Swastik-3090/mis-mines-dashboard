-- 127: the despatch plan and the COB plant plan move to this platform.
--
-- The second and third of the five tables that took the Executive Summary
-- down on 16 November -- see migration 126 for the outage. Both are filed by
-- PPIC, one row per day, 214 and 244 rows. Neither has ever been written by
-- this dashboard: they are typed somewhere else, and this migration is the
-- schema half of bringing that entry here.
--
-- ── WHAT IS DROPPED, AND WHY IT IS SAFE ─────────────────────────────────────
-- Si_no, a bigint AUTO_INCREMENT, sat in a primary key of
-- (Si_no, Plan_date, Plan_month) while a separate UNIQUE index on Plan_date
-- alone said what the key really is. One row per day. The surrogate bought
-- nothing and let the same day be inserted twice if the sequence moved.
--
-- Plan_month, a varchar(10) holding 'YYYY-MM', is Plan_date's own month
-- written down a second time, free to disagree with it and with nothing to
-- stop it. It is derived where it is needed.
--
-- ── WHAT BECOMES GENERATED, AND HOW THAT WAS DECIDED ────────────────────────
-- The despatch plan already had eight generated totals in MySQL and keeps
-- them, in Postgres's spelling.
--
-- The COB plan had none -- but five of its sixteen figures are arithmetic on
-- the others, and the mine has been typing all sixteen. That was not assumed:
-- each candidate was tested against all 244 stored rows first, and only the
-- ones that held everywhere are generated here:
--
--   planned_running_hr = total_avail_hr - shutdown_hr      238 rows, 0 fail
--   feed_qty           = running_hr * planned_feed_rate    238 rows, 0 fail
--   concentrate_qty    = feed_qty * weight_recovery / 100  238 rows, 0 fail
--   tailings_qty       = feed_qty - concentrate_qty        238 rows, 0 fail
--   chrome_recovery    = (conc_qty * conc_grade)
--                        / (feed_qty * feed_grade)         230 rows, 0 fail
--
-- Two candidates were REJECTED by the same test and stay typed:
-- planned_feed_rate is NOT throughput_capacity (236 of 238 rows differ -- the
-- plant plans below its capacity, which is the point of having both), and
-- nothing derives the grades or the Cr/Fe ratios.
--
-- So the entry screen asks for eleven figures rather than sixteen, and five
-- of them can no longer be mistyped into disagreeing with the rest.
--
-- ── A UNIT THAT DISAGREES WITH ITS OWN LABEL ────────────────────────────────
-- chrome_recovery is stored as a RATIO -- 0.688 -- in a column MySQL comments
-- as '(%)', on rows where weight_recovery holds 40.000 meaning forty per
-- cent. Two figures called recovery, on one row, in different units. The
-- stored values are not touched here, because changing them is a decision for
-- the mine and not for a migration; the column is documented as the ratio it
-- actually holds, so whoever reads it next is not misled.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. THE DESPATCH PLAN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS despatch_plan (
    plan_date      date PRIMARY KEY,

    -- Balasore, six grades.
    bal_crfe_qty   numeric(12,2) CHECK (bal_crfe_qty  >= 0),
    bal_hg_qty     numeric(12,2) CHECK (bal_hg_qty    >= 0),
    bal_mg_qty     numeric(12,2) CHECK (bal_mg_qty    >= 0),
    bal_lg_qty     numeric(12,2) CHECK (bal_lg_qty    >= 0),
    bal_cob_qty    numeric(12,2) CHECK (bal_cob_qty   >= 0),
    bal_lump_qty   numeric(12,2) CHECK (bal_lump_qty  >= 0),

    -- Sukinda, the same six.
    suk_crfe_qty   numeric(12,2) CHECK (suk_crfe_qty  >= 0),
    suk_hg_qty     numeric(12,2) CHECK (suk_hg_qty    >= 0),
    suk_mg_qty     numeric(12,2) CHECK (suk_mg_qty    >= 0),
    suk_lg_qty     numeric(12,2) CHECK (suk_lg_qty    >= 0),
    suk_cob_qty    numeric(12,2) CHECK (suk_cob_qty   >= 0),
    suk_lump_qty   numeric(12,2) CHECK (suk_lump_qty  >= 0),

    -- The eight totals, generated exactly as MySQL generated them. COALESCE
    -- on every term: a blank grade is nought despatched, not an unknown
    -- total, which is what a bare sum would make of it.
    bal_total_qty  numeric(13,2) GENERATED ALWAYS AS (
                       COALESCE(bal_crfe_qty,0) + COALESCE(bal_hg_qty,0)
                     + COALESCE(bal_mg_qty,0)   + COALESCE(bal_lg_qty,0)
                     + COALESCE(bal_cob_qty,0)  + COALESCE(bal_lump_qty,0)) STORED,
    suk_total_qty  numeric(13,2) GENERATED ALWAYS AS (
                       COALESCE(suk_crfe_qty,0) + COALESCE(suk_hg_qty,0)
                     + COALESCE(suk_mg_qty,0)   + COALESCE(suk_lg_qty,0)
                     + COALESCE(suk_cob_qty,0)  + COALESCE(suk_lump_qty,0)) STORED,
    tot_crfe_qty   numeric(13,2) GENERATED ALWAYS AS (
                       COALESCE(bal_crfe_qty,0) + COALESCE(suk_crfe_qty,0)) STORED,
    tot_hg_qty     numeric(13,2) GENERATED ALWAYS AS (
                       COALESCE(bal_hg_qty,0)   + COALESCE(suk_hg_qty,0)) STORED,
    tot_mg_qty     numeric(13,2) GENERATED ALWAYS AS (
                       COALESCE(bal_mg_qty,0)   + COALESCE(suk_mg_qty,0)) STORED,
    tot_lg_qty     numeric(13,2) GENERATED ALWAYS AS (
                       COALESCE(bal_lg_qty,0)   + COALESCE(suk_lg_qty,0)) STORED,
    tot_cob_qty    numeric(13,2) GENERATED ALWAYS AS (
                       COALESCE(bal_cob_qty,0)  + COALESCE(suk_cob_qty,0)) STORED,
    tot_lump_qty   numeric(13,2) GENERATED ALWAYS AS (
                       COALESCE(bal_lump_qty,0) + COALESCE(suk_lump_qty,0)) STORED,
    grand_total_qty numeric(14,2) GENERATED ALWAYS AS (
                       COALESCE(bal_crfe_qty,0) + COALESCE(bal_hg_qty,0)
                     + COALESCE(bal_mg_qty,0)   + COALESCE(bal_lg_qty,0)
                     + COALESCE(bal_cob_qty,0)  + COALESCE(bal_lump_qty,0)
                     + COALESCE(suk_crfe_qty,0) + COALESCE(suk_hg_qty,0)
                     + COALESCE(suk_mg_qty,0)   + COALESCE(suk_lg_qty,0)
                     + COALESCE(suk_cob_qty,0)  + COALESCE(suk_lump_qty,0)) STORED,

    remarks        text,

    entry_id       varchar(32) NOT NULL,
    entry_date     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     varchar(32),
    revision       integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

COMMENT ON TABLE despatch_plan IS
    'What the mine plans to despatch each day, by plant and grade. One row '
    'per day -- the MySQL surrogate key is gone, see migration 127. Filed by '
    'PPIC from the Despatch Plan entry screen.';


-- ---------------------------------------------------------------------------
-- 2. THE COB PLANT PLAN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobp_plan (
    plan_date               date PRIMARY KEY,

    -- ── TYPED ───────────────────────────────────────────────────────────────
    total_avail_hr          numeric(10,2) CHECK (total_avail_hr   >= 0),
    shutdown_hr             numeric(10,2) CHECK (shutdown_hr      >= 0),
    throughput_capacity     numeric(10,2) CHECK (throughput_capacity >= 0),
    planned_feed_rate       numeric(10,2) CHECK (planned_feed_rate   >= 0),
    feed_grade_cr2o3        numeric(8,3)  CHECK (feed_grade_cr2o3 >= 0),
    feed_ratio_crfe         numeric(8,3)  CHECK (feed_ratio_crfe  >= 0),
    weight_recovery         numeric(8,3)  CHECK (weight_recovery BETWEEN 0 AND 100),
    concentrate_grade_cr2o3 numeric(8,3)  CHECK (concentrate_grade_cr2o3 >= 0),
    concentrate_ratio_crfe  numeric(8,3)  CHECK (concentrate_ratio_crfe  >= 0),
    tailings_grade_cr2o3    numeric(8,3)  CHECK (tailings_grade_cr2o3    >= 0),

    -- ── GENERATED, each proved against all 244 stored rows ─────────────────
    planned_running_hr      numeric(10,2) GENERATED ALWAYS AS
                            (total_avail_hr - shutdown_hr) STORED,
    feed_qty                numeric(12,2) GENERATED ALWAYS AS
                            ((total_avail_hr - shutdown_hr) * planned_feed_rate) STORED,
    concentrate_qty         numeric(12,2) GENERATED ALWAYS AS
                            ((total_avail_hr - shutdown_hr) * planned_feed_rate
                             * weight_recovery / 100) STORED,
    tailings_qty            numeric(12,2) GENERATED ALWAYS AS
                            ((total_avail_hr - shutdown_hr) * planned_feed_rate
                             * (1 - weight_recovery / 100)) STORED,

    -- A RATIO, not a percentage -- see the header. 0.688 means 68.8% of the
    -- chrome in the feed is expected in the concentrate.
    --
    -- WRITTEN LONG, NOT SIMPLIFIED, AND THAT IS THE WHOLE POINT. It cancels
    -- algebraically to weight_recovery/100 * conc_grade / feed_grade, and
    -- the first version of this column was written that way. It was wrong on
    -- the days that matter: 13-18 April the plant was shut, feed and
    -- concentrate are both nought, and the cancelled form still returned
    -- 0.688 -- a recovery figure for a day nothing was recovered, because
    -- nothing was fed. The long form divides by a feed of nought and yields
    -- nothing, which is what the mine's own sheet holds on those days and
    -- what is true.
    --
    -- Caught by comparing all 244 generated values against the stored ones
    -- after the backfill. Eight rows differed, every one of them a shutdown.
    chrome_recovery         numeric(8,3)  GENERATED ALWAYS AS (
                              ((total_avail_hr - shutdown_hr) * planned_feed_rate
                               * weight_recovery / 100 * concentrate_grade_cr2o3)
                              / NULLIF((total_avail_hr - shutdown_hr)
                                       * planned_feed_rate * feed_grade_cr2o3, 0)
                            ) STORED,

    remarks                 text,

    entry_id                varchar(32) NOT NULL,
    entry_date              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    updated_by              varchar(32),
    revision                integer NOT NULL DEFAULT 1 CHECK (revision >= 1),

    -- A shutdown longer than the day is a typing error, and the generated
    -- running hours would go negative and carry it into every figure below.
    CHECK (shutdown_hr IS NULL OR total_avail_hr IS NULL
           OR shutdown_hr <= total_avail_hr)
);

COMMENT ON TABLE cobp_plan IS
    'The COB plant''s daily plan. Eleven figures are typed and five are '
    'generated from them -- see migration 127 for how that was established '
    'against the stored rows. Filed by PPIC.';

COMMENT ON COLUMN cobp_plan.chrome_recovery IS
    'A RATIO: 0.688 means 68.8 per cent of the chrome in the feed reaches the '
    'concentrate. Beside it weight_recovery holds 40.000 meaning 40 per cent. '
    'The two disagree in units and always have; the figures are left as the '
    'mine filed them.';


-- ---------------------------------------------------------------------------
-- 3. WHAT EACH USED TO SAY
-- ---------------------------------------------------------------------------
-- One table for both plans, keyed by which one. They are filed by the same
-- person on the same screen and read in one history panel; two tables of the
-- same shape would only have to be unioned back together.
CREATE TABLE IF NOT EXISTS plan_entry_hist (
    id          bigserial   PRIMARY KEY,
    plan_kind   varchar(16) NOT NULL CHECK (plan_kind IN ('DESPATCH', 'COBP')),
    plan_date   date        NOT NULL,
    action      varchar(8)  NOT NULL CHECK (action IN ('ADDED','CHANGED','REMOVED')),
    field       varchar(40),
    old_value   text,
    new_value   text,
    revision    integer     NOT NULL CHECK (revision >= 1),
    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz NOT NULL DEFAULT now(),

    CHECK (old_value IS DISTINCT FROM new_value)
);

COMMENT ON TABLE plan_entry_hist IS
    'Every change to a despatch or COB plan, old value and new. No foreign '
    'key: deleting a day must not erase the record of what it said.';

CREATE INDEX IF NOT EXISTS plan_entry_hist_lookup_idx
    ON plan_entry_hist (plan_kind, plan_date, entry_date DESC);
CREATE INDEX IF NOT EXISTS plan_entry_hist_entry_idx
    ON plan_entry_hist (entry_id, entry_date DESC);

-- NO MONTH INDEX ON EITHER PLAN. The first attempt indexed
-- date_trunc('month', plan_date) and Postgres refused it: date_trunc on a
-- date is STABLE, not IMMUTABLE, so it cannot be indexed. It was not needed
-- anyway -- plan_date is the primary key, and a month is read as
-- `WHERE plan_date BETWEEN :first AND :last`, which that index already
-- serves. A second index would only be another thing to keep current.
