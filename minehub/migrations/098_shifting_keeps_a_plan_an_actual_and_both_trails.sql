-- 098: put the four shifting tables in the repository.
--
-- Same story as 096, and the second time in two days: the tables exist in
-- corpappdb, the branch that reads and writes them shipped without them, and
-- they were created by hand against the live database while the feature was
-- built. That works only for as long as there is exactly one database, and
-- it means nobody can answer "what does shifting_plan look like?" without
-- connecting to production to find out.
--
-- Nothing here is new. Every statement is IF NOT EXISTS against the live
-- definition, built into a throwaway schema inside one transaction and
-- compared to minehub column by column before being committed to the repo.
--
-- ── WHY FOUR TABLES AND NOT TWO ─────────────────────────────────────────────
-- The plan arrives as one Excel a month and REPLACES the month; the actual is
-- typed a day at a time and edited. Both therefore destroy a figure somebody
-- gave earlier, and a mine that reports 126 CuM on the 14th and 96 on the
-- 15th will be asked which it was and when it changed. The _hist tables carry
-- BOTH the old and the new quantity, because knowing a figure changed without
-- knowing what it changed from is no trail at all.
--
-- ── WHY material IS A CODE ──────────────────────────────────────────────────
-- CHECK (material IN ('LG','TAILINGS','REHANDLING')). The workbook heads its
-- column "Tailings Shifting" and the mine's own form says "Tailing Shifting";
-- "Other Rehandling" against "Rehandling (others)". Keyed on either spelling,
-- the plan and the actual would never join. The headings are matched to these
-- codes on upload and a heading matching none is named in the error, because
-- a column silently ignored is a plan silently half-loaded.
--
-- ── WHY qty_cum IS numeric(14,4) AND NOT AN INTEGER ─────────────────────────
-- LG is 3,500 CuM over 30 days -- 116.6666 -- and the mine's cell merely
-- FORMATS that as 117. Rounding on the way in would make the month 3,510.
--
-- ── WHY THE GRAIN IS A DAY ──────────────────────────────────────────────────
-- UNIQUE (date, material). The sheet is not flat: Tailings reads 126 CuM on
-- most days and 96 every Wednesday. A monthly total would lose that, and the
-- actual is reported daily, so both tables share a grain or the two cannot be
-- compared at all.

-- ── the plan: one Excel a month, replacing the month ────────────────────────
CREATE TABLE IF NOT EXISTS shifting_plan (
    id           bigserial PRIMARY KEY,
    plan_date    date NOT NULL,
    material     varchar(12) NOT NULL
                 CHECK (material IN ('LG', 'TAILINGS', 'REHANDLING')),
    qty_cum      numeric(14,4) NOT NULL CHECK (qty_cum >= 0),
    revision     integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    entry_id     varchar(32) NOT NULL,
    entry_date   timestamptz NOT NULL DEFAULT now(),
    updated_id   varchar(32),
    updated_date timestamptz,
    UNIQUE (plan_date, material),

    -- Either a row has been edited and says by whom and when, or it has not
    -- been edited at all. Half of that pair alone is a row nobody can read.
    CHECK ((updated_id IS NULL) = (updated_date IS NULL))
);

COMMENT ON COLUMN shifting_plan.entry_date IS
    'When the figure was FIRST given. A re-upload that leaves a day unchanged '
    'leaves this alone; updated_date carries the later edit.';

-- ── the actual: typed a day at a time against the plan ──────────────────────
CREATE TABLE IF NOT EXISTS shifting_actual (
    id           bigserial PRIMARY KEY,
    actual_date  date NOT NULL,
    material     varchar(12) NOT NULL
                 CHECK (material IN ('LG', 'TAILINGS', 'REHANDLING')),
    qty_cum      numeric(14,4) NOT NULL CHECK (qty_cum >= 0),
    revision     integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    entry_id     varchar(32) NOT NULL,
    entry_date   timestamptz NOT NULL DEFAULT now(),
    updated_id   varchar(32),
    updated_date timestamptz,
    UNIQUE (actual_date, material),
    CHECK ((updated_id IS NULL) = (updated_date IS NULL))
);

-- ── the two trails ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifting_plan_hist (
    id          bigserial PRIMARY KEY,
    plan_date   date NOT NULL,
    material    varchar(12) NOT NULL,
    action      varchar(8)  NOT NULL
                CHECK (action IN ('ADDED', 'CHANGED', 'REMOVED')),
    old_qty_cum numeric(14,4),
    new_qty_cum numeric(14,4),
    revision    integer NOT NULL CHECK (revision >= 1),
    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz NOT NULL DEFAULT now(),

    -- A history row has to be readable on its own, years later, by somebody
    -- who was not there: these say what each action means in terms of the two
    -- quantity columns.
    CHECK (   (action = 'ADDED'   AND old_qty_cum IS NULL     AND new_qty_cum IS NOT NULL)
           OR (action = 'CHANGED' AND old_qty_cum IS NOT NULL AND new_qty_cum IS NOT NULL)
           OR (action = 'REMOVED' AND old_qty_cum IS NOT NULL AND new_qty_cum IS NULL)),

    -- A change that changed nothing is not history, it is noise.
    CHECK (old_qty_cum IS DISTINCT FROM new_qty_cum)
);

CREATE TABLE IF NOT EXISTS shifting_actual_hist (
    id          bigserial PRIMARY KEY,
    actual_date date NOT NULL,
    material    varchar(12) NOT NULL,
    action      varchar(8)  NOT NULL
                CHECK (action IN ('ADDED', 'CHANGED', 'REMOVED')),
    old_qty_cum numeric(14,4),
    new_qty_cum numeric(14,4),
    revision    integer NOT NULL CHECK (revision >= 1),
    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz NOT NULL DEFAULT now(),
    CHECK (   (action = 'ADDED'   AND old_qty_cum IS NULL     AND new_qty_cum IS NOT NULL)
           OR (action = 'CHANGED' AND old_qty_cum IS NOT NULL AND new_qty_cum IS NOT NULL)
           OR (action = 'REMOVED' AND old_qty_cum IS NOT NULL AND new_qty_cum IS NULL)),
    CHECK (old_qty_cum IS DISTINCT FROM new_qty_cum)
);

-- Neither trail carries a foreign key, on purpose: a day removed from the
-- plan must not take the record of what it once said away with it.
CREATE INDEX IF NOT EXISTS shifting_plan_hist_date_idx
    ON shifting_plan_hist (plan_date, entry_date DESC);
CREATE INDEX IF NOT EXISTS shifting_plan_hist_material_idx
    ON shifting_plan_hist (material, plan_date);
CREATE INDEX IF NOT EXISTS shifting_actual_hist_date_idx
    ON shifting_actual_hist (actual_date, entry_date DESC);
CREATE INDEX IF NOT EXISTS shifting_actual_hist_material_idx
    ON shifting_actual_hist (material, actual_date);
