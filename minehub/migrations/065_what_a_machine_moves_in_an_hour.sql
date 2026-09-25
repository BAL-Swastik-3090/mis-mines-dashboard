-- 065: what a machine can move in an hour, and what stops it.
--
-- The planning office keeps this in a workbook — Productivity_linked_Excavator
-- ___Tipper.xlsx — and the workbook is a good model badly held. It computes,
-- per excavator:
--
--     capacity per scoop = bucket x fill factor x swell
--     cycle time         = dig + lift + swing + lower + tilt + wait + unload
--                          + return
--     Cum/hr             = (3600 / cycle) x capacity per scoop
--     Cum/day            = Cum/hr x running hours at that face
--
-- and per tipper:
--
--     trips/hour  = 60 / (loading + travel + wait + dump)
--     Cum/day     = trips/hour x operating hours x effective capacity
--
-- and then the only line that matters:
--
--     effective excavation at a face = MIN(what the excavator can dig,
--                                          what the tippers can carry away)
--
-- WHY IT IS BEING MOVED HERE. The workbook cannot say which machine it means.
-- It calls one excavator "470-2", and the register holds both a hired machine
-- whose fleet code reads TATA-HITACHI-470-2 and the mine's own Zaxis 470 GI,
-- nicknamed "(Ex-2)", which is the one the plan actually means. Matched on the
-- name, the mine's own long boom becomes a contractor's machine and every
-- figure downstream is about the wrong excavator. A mapping has to be recorded
-- once, by somebody who knows, rather than guessed at each time.
--
-- The workbook also carries six defects that a re-implementation should not
-- inherit — among them a headline "tipper shortage" that reads an empty cell
-- and therefore reports the fleet count as a surplus. They are listed in
-- files/mines plan and Producitivity/Equipment_Plan_Mapping_Analysis_25-09-2026.md.


-- ---------------------------------------------------------------------------
-- 1. The bucket that is on the machine, beside the one it came with
-- ---------------------------------------------------------------------------
--
-- asset.capacity holds 2.5 and 2.8 Cum for the two long-boom 470s. The plan
-- works them at 0.65. Neither is wrong: a long boom reaching deep in a
-- chromite pit is fitted with a small bucket, and the register is recording
-- the machine's standard one. Productivity depends entirely on the fitted
-- bucket, the asset record on the standard one, so both are kept.
--
-- Null means "whatever asset.capacity says" — a machine running its standard
-- bucket needs no second number, and a default that had to be typed for every
-- machine would be typed wrong for some of them.

ALTER TABLE asset ADD COLUMN IF NOT EXISTS fitted_bucket_cum numeric(6,3);
ALTER TABLE asset ADD COLUMN IF NOT EXISTS fitted_bucket_since date;

COMMENT ON COLUMN asset.fitted_bucket_cum IS
    'The bucket currently on the machine, in Cum, when it differs from the '
    'standard bucket in asset.capacity. Null means the standard one is fitted. '
    'This is the number productivity is calculated from.';
COMMENT ON COLUMN asset.fitted_bucket_since IS
    'When the fitted bucket was last changed. A capacity with no date behind '
    'it cannot be questioned later.';

ALTER TABLE asset DROP CONSTRAINT IF EXISTS asset_fitted_bucket_sane;
ALTER TABLE asset ADD CONSTRAINT asset_fitted_bucket_sane CHECK (
    fitted_bucket_cum IS NULL OR (fitted_bucket_cum > 0 AND fitted_bucket_cum < 50));


-- ---------------------------------------------------------------------------
-- 2. The planning office's name for a machine
-- ---------------------------------------------------------------------------

ALTER TABLE asset_identity DROP CONSTRAINT IF EXISTS asset_identity_system_check;
ALTER TABLE asset_identity ADD CONSTRAINT asset_identity_system_check CHECK (
    system IN ('TELEMATICS', 'HOTO', 'WEIGHBRIDGE', 'RFID', 'SAP', 'SECURITY',
               'LEGACY', 'BUSINESS_PLAN'));

COMMENT ON CONSTRAINT asset_identity_system_check ON asset_identity IS
    'BUSINESS_PLAN is what the monthly plan and the productivity workbook call '
    'this machine — "470-2", "Sany", "Ex 350". Recorded because those names '
    'collide with fleet codes that mean other machines.';


-- ---------------------------------------------------------------------------
-- 3. The assumptions, in one place
-- ---------------------------------------------------------------------------
--
-- One row. Every figure here is the same for every machine in the workbook —
-- the eight cycle components are 50/5/10/3/4/20/3/5 seconds on all nine
-- excavators — so holding them per machine would be holding one number nine
-- times and inviting eight of them to drift.
--
-- Where a machine genuinely differs, excavator_cycle below overrides it.

CREATE TABLE IF NOT EXISTS productivity_assumption (
    productivity_assumption_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Assumptions change. A capacity worked out in September should still be
    -- explicable in December, so a new set supersedes rather than overwrites.
    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_to   date,

    -- How full the bucket really comes up, and how much the material swells
    -- once it is loose. Both are ratios, not percentages.
    fill_factor    numeric(4,3) NOT NULL DEFAULT 0.800,
    swell_factor   numeric(4,3) NOT NULL DEFAULT 1.000,

    -- One excavator cycle, in seconds, broken into the parts a supervisor can
    -- actually observe and argue with. A single "100 seconds" would be a
    -- number nobody can check.
    dig_sec        smallint NOT NULL DEFAULT 50,
    lift_sec       smallint NOT NULL DEFAULT 5,
    swing_sec      smallint NOT NULL DEFAULT 10,
    lower_sec      smallint NOT NULL DEFAULT 3,
    tilt_sec       smallint NOT NULL DEFAULT 4,
    wait_sec       smallint NOT NULL DEFAULT 20,
    unload_sec     smallint NOT NULL DEFAULT 3,
    return_sec     smallint NOT NULL DEFAULT 5,

    -- The day the plan is built on. 20 hours, not 24: the workbook's own
    -- Capacity & Plan H2.
    operating_hours numeric(4,1) NOT NULL DEFAULT 20.0,

    -- Ore weighs this much per cubic metre. The workbook multiplies Cum by 3
    -- to reach MT and the factor appears nowhere as a named number.
    ore_t_per_cum  numeric(5,3) NOT NULL DEFAULT 3.000,

    note           text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,

    CONSTRAINT productivity_assumption_dates CHECK (
        effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT productivity_assumption_sane CHECK (
        fill_factor > 0 AND fill_factor <= 1
        AND swell_factor > 0
        AND operating_hours > 0 AND operating_hours <= 24)
);

COMMENT ON TABLE productivity_assumption IS
    'The shared parameters every capacity figure is derived from. One row is '
    'in force at a time; a change supersedes rather than overwrites, so a '
    'number worked out last month can still be explained.';


-- ---------------------------------------------------------------------------
-- 4. Where one machine is not like the others
-- ---------------------------------------------------------------------------
--
-- Sparse on purpose: a row here exists only for a machine whose cycle really
-- differs. Nine rows repeating the same eight numbers would be nine chances
-- for one of them to be edited and the rest forgotten.

CREATE TABLE IF NOT EXISTS excavator_cycle (
    excavator_cycle_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id       bigint NOT NULL UNIQUE REFERENCES asset(asset_id) ON DELETE CASCADE,

    -- Every column nullable: an override that had to restate the whole cycle
    -- to change one number would be a copy, and copies drift.
    fill_factor    numeric(4,3),
    swell_factor   numeric(4,3),
    dig_sec        smallint,
    lift_sec       smallint,
    swing_sec      smallint,
    lower_sec      smallint,
    tilt_sec       smallint,
    wait_sec       smallint,
    unload_sec     smallint,
    return_sec     smallint,

    -- Why this machine is different. Required, because an unexplained override
    -- is indistinguishable from a typo six months later.
    reason         text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);

COMMENT ON TABLE excavator_cycle IS
    'Per-machine departures from productivity_assumption. Every column is '
    'nullable and falls back to the shared row; reason is not, because an '
    'unexplained override cannot be told from a typo later.';


-- ---------------------------------------------------------------------------
-- 5. What a tipper carries
-- ---------------------------------------------------------------------------
--
-- The fleet is not one kind of truck. The workbook models a normal tipper at
-- 5 Cum and a big one at 7.67, from 15 and 23 tonnes at 3 t/Cum, and the
-- difference decides how many trucks a face needs.

CREATE TABLE IF NOT EXISTS tipper_class (
    tipper_class_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    label          text NOT NULL,

    -- What it carries in practice, not what the plate says.
    payload_t      numeric(6,2) NOT NULL,
    effective_cum  numeric(6,2) NOT NULL,

    -- The trip, in minutes. Loading is at the face; the rest is the road.
    loading_min    numeric(5,2) NOT NULL DEFAULT 5,
    travel_min     numeric(5,2) NOT NULL DEFAULT 35,

    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tipper_class_sane CHECK (
        payload_t > 0 AND effective_cum > 0
        AND loading_min > 0 AND travel_min > 0)
);

-- Which class a tipper belongs to. Null until somebody says, and a tipper with
-- no class is counted nowhere rather than counted wrong.
ALTER TABLE asset ADD COLUMN IF NOT EXISTS tipper_class_id bigint
    REFERENCES tipper_class(tipper_class_id);


-- ---------------------------------------------------------------------------
-- 6. The face-by-face plan the MIN() runs over
-- ---------------------------------------------------------------------------
--
-- One row per excavator per face per day: where it is digging, what it is
-- digging, for how long, and how many tippers are under it. This is the table
-- the whole model exists to evaluate, and it is the one the workbook holds as
-- nine hand-edited rows with a comment saying "EDIT Current Tippers to model
-- scenarios".

CREATE TABLE IF NOT EXISTS face_plan (
    face_plan_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    on_date        date NOT NULL,

    asset_id       bigint NOT NULL REFERENCES asset(asset_id),

    -- Where and what. Free text against the mine's own words for a face —
    -- "Bottom", "North East", "Stack Yard / LG Dump / ETP" — because a
    -- location master that did not already hold them would force the planner
    -- to choose between the truth and the dropdown.
    location       text NOT NULL,
    material       text NOT NULL,

    -- Hours this machine works this face today. Not the shift length: the
    -- workbook splits one excavator across bund preparation for 4 hours and
    -- ore for 16.
    running_hours  numeric(4,1) NOT NULL,

    -- The trucks under it, and what kind.
    tippers        smallint NOT NULL DEFAULT 0,
    tipper_class_id bigint REFERENCES tipper_class(tipper_class_id),

    note           text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,

    CONSTRAINT face_plan_sane CHECK (
        running_hours > 0 AND running_hours <= 24 AND tippers >= 0),
    -- One machine, one face, one entry a day. A second row for the same
    -- machine and face is a correction, not a second deployment.
    CONSTRAINT uq_face_plan UNIQUE (on_date, asset_id, location, material)
);

CREATE INDEX IF NOT EXISTS ix_face_plan_day ON face_plan (on_date DESC);
CREATE INDEX IF NOT EXISTS ix_face_plan_asset ON face_plan (asset_id);

COMMENT ON TABLE face_plan IS
    'One excavator at one face on one day, with the tippers under it. The '
    'capacity model is MIN(what it can dig, what they can carry) over these '
    'rows; everything else is an assumption feeding into that.';


-- ---------------------------------------------------------------------------
-- 7. The starting assumptions and the two tipper classes
-- ---------------------------------------------------------------------------
--
-- Exactly the workbook's numbers, so the first thing the screen shows can be
-- checked against the sheet it replaces. Anything that disagrees is then a
-- real difference rather than a transcription error.

INSERT INTO productivity_assumption (note, created_by)
SELECT 'As the productivity workbook of 24-09-2026 had them, so the first '
       'figures can be checked against the sheet they replace.', 'migration 065'
 WHERE NOT EXISTS (SELECT 1 FROM productivity_assumption);

INSERT INTO tipper_class (code, label, payload_t, effective_cum)
SELECT * FROM (VALUES
    ('NORMAL', 'Normal tipper', 15.0::numeric, 5.00::numeric),
    ('BIG',    'Big tipper',    23.0::numeric, 7.67::numeric)
) AS v(code, label, payload_t, effective_cum)
 WHERE NOT EXISTS (SELECT 1 FROM tipper_class);
