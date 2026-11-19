-- 126: the estimated actual moves to this platform's own database.
--
-- WHY IT IS MOVING, and it is not tidiness. mines_prev_day_actual lives in
-- balcorpdb, a MySQL database twenty-five applications share. On 16 November
-- 2026 that server reached 203 threads running with queries fifteen minutes
-- old, and the Executive Summary returned 503 for the better part of an hour:
-- eleven of them against a single 200. The dashboard's MySQL pool is two
-- connections and twelve overflow, and with every query taking minutes those
-- fourteen were gone in seconds.
--
-- The page's SAP half was never affected. pp_production and
-- pp_quality_inspection come through the OData feed on Postgres and answered
-- throughout. What took the page down was this table -- 215 rows -- and four
-- other small ones beside it, because they were on the server that was busy.
--
-- Fifteen concurrent queries were counted against a 215-row table at the
-- height of it, each over nine hundred seconds. They were not slow. They were
-- queued behind somebody else's vendor portal.
--
-- ── THE SHAPE CHANGES, DELIBERATELY ─────────────────────────────────────────
-- A straight port would carry the MySQL spelling across for no reason:
--
--   `Date`  is a reserved word and had to be back-quoted at every call site.
--           It becomes data_date, which is what dewatering_daily_data already
--           calls the same idea.
--   `Plan`  is likewise awkward, and is a quantity: plan_qty.
--   Mixed case becomes lower case, as every other table in this schema is.
--
-- ── AND IT GAINS A HISTORY, WHICH IT NEVER HAD ──────────────────────────────
-- Every table this dashboard owns keeps a trail -- shifting_plan_hist,
-- lcm_loss_head_hist, oee_equip_status_hist. This one kept Updated_By and
-- Updated_At, which say who touched it last and when, and nothing about what
-- the figure was before they did. An estimated actual is corrected often, by
-- more than one person, and "it used to say something else" is exactly the
-- question somebody asks a week later.
--
-- NOTHING IS COPIED HERE. The 215 rows are loaded separately, so that the
-- load can be checked row by row against the source before the application is
-- pointed at it, and re-run if it is wrong. A migration that carries data is
-- a migration nobody can run twice.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. THE FIGURES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prev_day_actual (
    data_date   date        NOT NULL,

    -- The six heads the panel offers. Held as a CHECK rather than a lookup
    -- table because the list is the screen's own vocabulary: a seventh head
    -- means a seventh input, so it is a deployment either way, and a lookup
    -- would only let the two disagree.
    material    varchar(20) NOT NULL
                CHECK (material IN ('ORE', 'OB', 'TOTAL_EXCAVATION',
                                    'COB', 'SILT', 'DESPATCH')),

    -- What was planned for that day. NULL is meaningful: the panel lets a
    -- figure be entered against no plan at all.
    plan_qty    numeric(16,2),

    -- The estimate itself, which is the reason the row exists.
    est_actual  numeric(16,2) NOT NULL,

    -- WHO FIRST FILED IT, and when. Not touched by a correction -- see
    -- updated_by below, which is the pair that makes the two questions
    -- answerable separately.
    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz NOT NULL DEFAULT now(),

    -- WHO LAST CHANGED IT. updated_at is written explicitly by the
    -- application on every save, not by a trigger: a trigger fires only when
    -- a value actually moves, so re-entering a figure that matches what is
    -- stored would not be recorded. A save is a change to the person who
    -- pressed the button, whether or not the digits moved.
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  varchar(32),

    revision    integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),

    PRIMARY KEY (data_date, material)
);

COMMENT ON TABLE prev_day_actual IS
    'The mine''s own estimate of yesterday, per head, filed from the Enter '
    'Est Actual panel. Read by the Executive Summary where SAP has not yet '
    'posted. Moved off balcorpdb by migration 126 -- see the header there for '
    'the outage that prompted it.';

COMMENT ON COLUMN prev_day_actual.est_actual IS
    'The estimate. The Executive Summary prefers SAP''s figure and falls back '
    'to this one, which is why the MIS section can read lower than the '
    'summary mid-month: the gap is exactly this column.';

CREATE INDEX IF NOT EXISTS prev_day_actual_date_idx
    ON prev_day_actual (data_date DESC);
CREATE INDEX IF NOT EXISTS prev_day_actual_updated_idx
    ON prev_day_actual (data_date, updated_at DESC);


-- ---------------------------------------------------------------------------
-- 2. WHAT IT USED TO SAY
-- ---------------------------------------------------------------------------
-- Same shape as lcm_loss_head_hist and oee_equip_status_hist on purpose: one
-- row per field changed, carrying both the old value and the new, so the
-- history panels already written can read this without a second row format to
-- reconcile.
CREATE TABLE IF NOT EXISTS prev_day_actual_hist (
    id          bigserial   PRIMARY KEY,
    data_date   date        NOT NULL,
    material    varchar(20) NOT NULL,
    action      varchar(8)  NOT NULL
                CHECK (action IN ('ADDED', 'CHANGED', 'REMOVED')),
    field       varchar(40),
    old_value   text,
    new_value   text,
    revision    integer     NOT NULL CHECK (revision >= 1),
    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz NOT NULL DEFAULT now(),

    -- A change that changed nothing is not history, it is noise. The same
    -- rule oee_equip_exc_plan_hist applies.
    CHECK (old_value IS DISTINCT FROM new_value)
);

COMMENT ON TABLE prev_day_actual_hist IS
    'Every change ever made to an estimated actual, old value and new. No '
    'foreign key: clearing a figure must not erase the record of what it was.';

CREATE INDEX IF NOT EXISTS prev_day_actual_hist_day_idx
    ON prev_day_actual_hist (data_date, entry_date DESC);
CREATE INDEX IF NOT EXISTS prev_day_actual_hist_entry_idx
    ON prev_day_actual_hist (entry_id, entry_date DESC);
