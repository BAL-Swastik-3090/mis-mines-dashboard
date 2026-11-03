-- 096: put the Equipment Excavation Plan's three tables in the repository.
--
-- They already exist in corpappdb, and the branch that reads and writes them
-- shipped without them. They were created by hand against the live database
-- while the feature was built, which works -- development and production share
-- one schema -- right up until somebody has to stand this platform up
-- somewhere else, or asks what the plan table actually looks like and finds
-- the answer only by connecting to it.
--
-- So this migration adds nothing and changes nothing. Every statement is
-- IF NOT EXISTS against the live definition, verified column by column and
-- constraint by constraint on 2026-11-03. Run against corpappdb it is a no-op;
-- run against an empty database it builds what the code expects.
--
-- The three constraints worth naming, because the calculation leans on them:
--
--   UNIQUE (plan_month, equipment_name) -- one current row per machine per
--   month. A machine appearing twice would have its downtime counted into the
--   ore bucket AND the overburden bucket, and the LCM would still foot,
--   because the multiplying factor is derived from the same hours it divides.
--   The total would look right while every head in the matrix was wrong.
--
--   CHECK (EXTRACT(day FROM plan_month) = 1) -- a month is its first day.
--   Without it, 2026-10-01 and 2026-10-15 are two different months to the
--   unique constraint above, which is the same failure wearing a date.
--
--   FOREIGN KEY ... ON UPDATE CASCADE -- the mine renames machines. A rename
--   in the master should carry the plan and not orphan it.
--
-- History lives in its own table rather than as superseded rows in the plan,
-- so that no reader of the plan can accidentally pick one up. It has no
-- foreign key: a machine removed from the fleet must not take the record of
-- what it was once assigned to with it.

CREATE TABLE IF NOT EXISTS oee_equip_master (
    id             serial PRIMARY KEY,
    equipment_name varchar(60) NOT NULL UNIQUE,
    category       varchar(10) NOT NULL CHECK (category IN ('OWN', 'HIRED')),
    status         varchar(10) NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

COMMENT ON TABLE oee_equip_master IS
    'The excavator fleet. category OWN carries a SAP equipment number and is '
    'reported through SAP; HIRED has none and is read from the shift log.';

CREATE TABLE IF NOT EXISTS oee_equip_exc_plan (
    id             serial PRIMARY KEY,
    plan_month     date NOT NULL CHECK (EXTRACT(day FROM plan_month) = 1),
    equipment_name varchar(60) NOT NULL
                   REFERENCES oee_equip_master (equipment_name) ON UPDATE CASCADE,
    material_type  varchar(3)  NOT NULL CHECK (material_type IN ('ORE', 'OB')),
    entry_id       varchar(32) NOT NULL,
    entry_date     timestamptz NOT NULL DEFAULT now(),
    revision       integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
    UNIQUE (plan_month, equipment_name)
);

COMMENT ON TABLE oee_equip_exc_plan IS
    'What the mine says each excavator digs, one current row per machine per '
    'month. Superseded assignments move to oee_equip_exc_plan_hist; nothing '
    'is deleted without a history row. See migration 096.';

COMMENT ON COLUMN oee_equip_exc_plan.entry_date IS
    'When this assignment was decided -- NOT when the month was last saved. '
    'A re-submission that leaves a row unchanged leaves this date alone.';

CREATE TABLE IF NOT EXISTS oee_equip_exc_plan_hist (
    id             bigserial PRIMARY KEY,
    plan_month     date NOT NULL CHECK (EXTRACT(day FROM plan_month) = 1),
    equipment_name varchar(60) NOT NULL,
    action         varchar(8)  NOT NULL,
    old_material   varchar(3)  CHECK (old_material IN ('ORE', 'OB')),
    new_material   varchar(3)  CHECK (new_material IN ('ORE', 'OB')),
    revision       integer     NOT NULL CHECK (revision >= 1),
    entry_id       varchar(32) NOT NULL,
    entry_date     timestamptz NOT NULL DEFAULT now(),

    CHECK (action IN ('ADDED', 'CHANGED', 'REMOVED')),

    -- A history row has to be readable on its own, years later, by somebody
    -- who was not there. These three say what each action means in terms of
    -- the two material columns, so "ADDED" can never arrive carrying an old
    -- material it never had, and "REMOVED" can never arrive without the one
    -- it lost.
    CHECK (   (action = 'ADDED'   AND old_material IS NULL     AND new_material IS NOT NULL)
           OR (action = 'CHANGED' AND old_material IS NOT NULL AND new_material IS NOT NULL)
           OR (action = 'REMOVED' AND old_material IS NOT NULL AND new_material IS NULL)),

    -- A change that changed nothing is not history, it is noise.
    CHECK (old_material IS DISTINCT FROM new_material)
);

COMMENT ON TABLE oee_equip_exc_plan_hist IS
    'Every change ever made to an excavation plan, with both the old and the '
    'new material. No foreign key on purpose: retiring a machine must not '
    'erase what it was once assigned to dig.';

CREATE INDEX IF NOT EXISTS oee_equip_exc_plan_hist_month_idx
    ON oee_equip_exc_plan_hist (plan_month, entry_date DESC);
CREATE INDEX IF NOT EXISTS oee_equip_exc_plan_hist_equip_idx
    ON oee_equip_exc_plan_hist (equipment_name, plan_month);
