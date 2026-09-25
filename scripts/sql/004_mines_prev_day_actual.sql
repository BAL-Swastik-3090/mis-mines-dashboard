-- Previous day's Plan vs Est Actual, as entered on the MIS dashboard.
--
-- Run once against the balcorpdb database:
--     mysql -h <host> -u <user> -p balcorpdb < 004_mines_prev_day_actual.sql
--
-- WHY THE ACTUAL IS TYPED IN. The MIS Plan vs Actual table used to read its
-- actuals from pp_production. It cannot: on the morning of 24 September,
-- 23 September's ore and OB both still read zero against a plan of 207 MT and
-- 1,091 CuM, because the goods movements had not been posted yet. Rendering
-- that as variance claims the mine produced nothing, which is not what
-- happened. Whoever chairs the morning meeting knows the real figure long
-- before SAP does, so they enter it — hence "Est Actual".
--
-- WHY THE PLAN IS STORED TOO, rather than re-read when the row is displayed.
-- mines_daily_excavation_plan and mines_despatch_plan are revised. A variance
-- agreed in a meeting must keep the plan it was agreed against, or the same
-- row silently reports a different variance next week. The plan is therefore
-- snapshotted at the moment of submission.
--
-- LONG FORMAT, one row per material per day. It matches
-- mines_daily_excavation_plan, which is also long (per shift x location x
-- face), and a sixth material later needs no ALTER.
--
-- This is additive: it creates one new table and changes nothing existing.

CREATE TABLE IF NOT EXISTS mines_prev_day_actual (
    -- The day the figures belong to — the previous day, not the day of entry.
    `Date`       DATE          NOT NULL,

    -- ORE and COB and DESPATCH are in MT; OB and TOTAL_EXCAVATION are in CuM.
    -- The unit is fixed per material by the dashboard and deliberately not
    -- stored: a unit column invites two rows for one material in two units.
    Material     VARCHAR(20)   NOT NULL,

    -- Nullable because a plan genuinely may not exist for a day — despatch
    -- plan rows are missing for some dates. NULL is "no plan", which is not
    -- the same as a plan of zero.
    `Plan`       DECIMAL(16,2)     NULL,

    -- The figure the entrant asserts. NOT NULL: to say "I do not know" the row
    -- is deleted, and the dashboard shows a dash again. A NULL here would be a
    -- third state indistinguishable from the second.
    Est_Actual   DECIMAL(16,2) NOT NULL,

    -- Who to ask about a number disputed in the morning meeting, and when they
    -- entered it. Same two audit columns as the other mines_* tables.
    Entry_Id     VARCHAR(50)   NOT NULL,
    Entry_Date   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

    -- One figure per material per day; re-submitting corrects it in place.
    PRIMARY KEY (`Date`, Material),

    -- Constrained rather than free text, so a typo in one client cannot
    -- quietly create a sixth material that nothing displays.
    CONSTRAINT chk_mines_prev_day_material CHECK (
        Material IN ('ORE', 'OB', 'TOTAL_EXCAVATION', 'COB', 'DESPATCH')
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The dashboard always asks for one day at a time, newest first.
CREATE INDEX idx_mines_prev_day_actual_date ON mines_prev_day_actual (`Date` DESC);
