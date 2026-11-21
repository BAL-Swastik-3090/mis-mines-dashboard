-- ===========================================================================
-- 131 — WHAT IS STILL IN THE GROUND
-- ===========================================================================
-- The mine's total resource reserve: how much chrome ore remains, by grade,
-- with the in-situ assay of each band. Until now it lived in one spreadsheet
-- on one person's machine, re-typed each time a survey restated it.
--
-- THIS IS A DECLARATION, NOT A MEASUREMENT TAKEN HERE. Nobody computes the
-- reserve on this dashboard. A survey states it, somebody types it, and from
-- that moment the dashboard's only job is to subtract what has since come out
-- of the ground and say what is left.
--
-- WHY IT IS DATED AND NEVER OVERWRITTEN BY THE NEXT SURVEY. A reserve is
-- restated whenever the geology is re-surveyed, and the restatement is not a
-- correction of the old figure — both were true, on their own dates. So a new
-- survey files a NEW as_on_date and the earlier rows stay. The balance shown
-- for any date resolves the latest declaration on or before it, which is the
-- same effective-dating lcm_loss_head_setting and royalty_rate already use.
--
-- A row IS editable in place, because a typo on the day of entry is a
-- different thing from a resurvey. Every such edit is written to the log table
-- below: this figure backs a valuation of several thousand crore, and a
-- tonnage that can change with no trace of who changed it or what it was
-- before is not a figure anyone can defend in a meeting.
--
-- NO BALANCE IS STORED. The closing position is
--     declaration − production since the declaration
-- and is computed on read in services/resource_reserve.py. Storing it would
-- mean a chain, and a chain is a thing that breaks: the dewatering sheet
-- chains closing to opening, and one stale pump-hour figure on 11 Nov 2026
-- silently falsified every day after it until the whole run was re-chained.
-- Nothing here reads its own previous output, so nothing here can drift. When
-- a persisted end-of-day snapshot is wanted it is one more table that CACHES
-- this computation and can always be rebuilt from it — never the source.
-- ===========================================================================
SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. THE DECLARATION
-- ---------------------------------------------------------------------------
-- One row per grade per survey date. Three rows is a complete declaration.
CREATE TABLE IF NOT EXISTS mines_resource_reserve (
    as_on_date  date          NOT NULL,
    grade       varchar(8)    NOT NULL,
    tonnage_mt  numeric(16,2) NOT NULL,
    cr2o3_pct   numeric(6,3)  NOT NULL,
    remarks     text,

    entry_id    varchar(50)   NOT NULL,
    entry_date  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),
    updated_by  varchar(50),

    PRIMARY KEY (as_on_date, grade),

    -- The same three-letter vocabulary as mines_stock_entry and the SAP
    -- material map in services/executive_summary.py. COB is deliberately NOT
    -- here: concentrate is made in the plant out of low-grade ore that has
    -- already left the ground, so a COB reserve would double-count LG.
    CONSTRAINT chk_mines_resource_reserve_grade
        CHECK (grade IN ('HG', 'MG', 'LG')),
    CONSTRAINT chk_mines_resource_reserve_tonnage
        CHECK (tonnage_mt >= 0),
    -- An assay is a percentage. The upper bound catches the commonest typo of
    -- all — a tonnage pasted into the grade column.
    CONSTRAINT chk_mines_resource_reserve_cr2o3
        CHECK (cr2o3_pct >= 0 AND cr2o3_pct <= 100)
);

COMMENT ON TABLE mines_resource_reserve IS
    'The mine''s declared resource reserve by grade, as stated by a survey on '
    'as_on_date. Effective-dated: a resurvey files a new date and the earlier '
    'declaration is kept. What remains today is this minus production since.';
COMMENT ON COLUMN mines_resource_reserve.as_on_date IS
    'The date the survey declares the reserve FOR, not the day it was typed. '
    'Depletion is counted from the day after this.';
COMMENT ON COLUMN mines_resource_reserve.cr2o3_pct IS
    'The in-situ assay of the band. Held fixed as the band depletes, by the '
    'mine''s instruction — see services/resource_reserve.py.';
COMMENT ON COLUMN mines_resource_reserve.entry_date IS
    'When this row was first filed. See updated_at.';
COMMENT ON COLUMN mines_resource_reserve.updated_at IS
    'Last changed. entry_date is when it was first filed.';

CREATE INDEX IF NOT EXISTS idx_mines_resource_reserve_as_on
    ON mines_resource_reserve (as_on_date DESC);


-- ---------------------------------------------------------------------------
-- 2. WHAT THE FIGURE USED TO BE
-- ---------------------------------------------------------------------------
-- Written by the service on every insert, edit and deletion. Not a trigger:
-- the actor is an application identity the database never sees, and a trigger
-- that logged 'postgres' for every change would be an audit trail in form
-- only.
--
-- Nothing reads this on the dashboard today. It exists so that the question
-- "this said 14,01,756 last month, who changed it and to what?" has an answer
-- at the moment it is asked rather than a month later.
CREATE TABLE IF NOT EXISTS mines_resource_reserve_log (
    log_id          bigserial     PRIMARY KEY,
    as_on_date      date          NOT NULL,
    grade           varchar(8)    NOT NULL,
    action          varchar(10)   NOT NULL,

    old_tonnage_mt  numeric(16,2),
    new_tonnage_mt  numeric(16,2),
    old_cr2o3_pct   numeric(6,3),
    new_cr2o3_pct   numeric(6,3),

    changed_by      varchar(50)   NOT NULL,
    changed_at      timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT chk_mines_resource_reserve_log_action
        CHECK (action IN ('INSERT', 'UPDATE', 'DELETE'))
);

COMMENT ON TABLE mines_resource_reserve_log IS
    'Every change to mines_resource_reserve, with the value before and after. '
    'Written by the application, which is the only layer that knows who the '
    'actor is.';

CREATE INDEX IF NOT EXISTS idx_mines_resource_reserve_log_row
    ON mines_resource_reserve_log (as_on_date, grade, changed_at DESC);
