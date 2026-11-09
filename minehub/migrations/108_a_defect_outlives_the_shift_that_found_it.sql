-- 108: a defect outlives the shift that found it, and a machine has a state.
--
-- ── WHY A RESPONSE IS NOT A DEFECT ──────────────────────────────────────────
-- `hoto_response` records that an operator found the brakes NOT OK at 13:55 on
-- a Tuesday. That is an observation, and it is finished the moment the
-- handover is filed. A defect is the other thing: it is raised, somebody owns
-- it, somebody repairs it, somebody else checks the repair, and only then is
-- the machine released. It spans shifts, operators and weeks, and it has to
-- stay readable long after everyone who touched it has moved on.
--
-- Without this table the register answers "what did the operator find" and
-- cannot answer "is it fixed", which is the question that actually matters at
-- six in the morning.
--
-- ── WHERE THE OPERATIONAL STATE LIVES ───────────────────────────────────────
-- Not in `asset_lifecycle`. That holds the COMMERCIAL lifecycle -- ACTIVE,
-- OFF_ROAD, SCRAPPED, CANNIBALISED -- which answers "is this machine still
-- part of the fleet", a different question from "can it work this shift". A
-- machine can be commercially ACTIVE and operationally LOCKED.
--
-- `availability_event` (migration 026, never used) is the right home: it is
-- already event-shaped, with started_at, ended_at and released_by. It had no
-- vocabulary at all, so one is added here. It is HOTO's own table, so
-- constraining it disturbs nobody.

-- ── the operational states ──────────────────────────────────────────────────
--   AVAILABLE          ready, not yet taken on
--   RUNNING            an operator has it
--   CAUTION            runs, but something needs watching
--   RESTRICTED         limited operation, acknowledged
--   BREAKDOWN          stopped
--   UNDER_MAINTENANCE  the workshop has it
--   LOCKED             a critical defect, or a supervisor's override
ALTER TABLE availability_event
  DROP CONSTRAINT IF EXISTS availability_event_state_check;

ALTER TABLE availability_event
  ADD CONSTRAINT availability_event_state_check
  CHECK (state IN ('AVAILABLE', 'RUNNING', 'CAUTION', 'RESTRICTED',
                   'BREAKDOWN', 'UNDER_MAINTENANCE', 'LOCKED'));

-- A machine is in ONE state at a time. Without this, two open windows make
-- "what state is this machine in" a question with two answers, and the Shift
-- Board would show whichever the planner happened to read first.
CREATE UNIQUE INDEX IF NOT EXISTS availability_event_one_open_per_asset
    ON availability_event (asset_id)
 WHERE ended_at IS NULL AND asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS availability_event_asset_idx
    ON availability_event (asset_id, started_at DESC);

COMMENT ON TABLE availability_event IS
    'The OPERATIONAL state of a machine or operator, as a window with a start '
    'and an end. Distinct from asset_lifecycle, which is the commercial one. '
    'The open window is the current state. See migration 108.';


-- ── the defect ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hoto_defect (
    defect_id      bigserial PRIMARY KEY,
    defect_ref     varchar(24) UNIQUE,

    asset_id       bigint NOT NULL REFERENCES asset (asset_id),

    -- Where it came from. Nullable because a defect can also be raised by a
    -- fitter who simply found something, with no handover involved.
    raised_session_id  bigint REFERENCES hoto_session (session_id),
    raised_response_id bigint REFERENCES hoto_response (response_id),
    item_id            bigint REFERENCES hoto_checklist_item (item_id),

    -- Copied, not joined -- the same rule hoto_response follows. A retired or
    -- re-worded item must not change what a defect raised eight months ago
    -- says it was about.
    item_label     varchar(120),

    severity       varchar(10) NOT NULL
                   CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    description    text NOT NULL,

    -- RAISED        found, nobody has it yet
    -- ACKNOWLEDGED  the workshop has accepted it
    -- RECTIFIED     somebody says it is repaired
    -- VERIFIED      somebody ELSE agrees, and the machine may be released
    -- CLOSED        done
    -- CANCELLED     withdrawn, with a reason
    state          varchar(14) NOT NULL DEFAULT 'RAISED'
                   CHECK (state IN ('RAISED', 'ACKNOWLEDGED', 'RECTIFIED',
                                    'VERIFIED', 'CLOSED', 'CANCELLED')),

    owner_role     varchar(24),

    -- A critical defect holds the machine until it is VERIFIED. Acknowledging
    -- it does not release anything, and neither does closing the exception
    -- that announced it -- those are both things people do to clear a queue.
    blocks_operation boolean NOT NULL DEFAULT false,

    raised_by      varchar(32) NOT NULL,
    raised_at      timestamptz NOT NULL DEFAULT now(),
    acknowledged_by varchar(32),
    acknowledged_at timestamptz,
    rectified_by   varchar(32),
    rectified_at   timestamptz,
    rectification_note text,
    verified_by    varchar(32),
    verified_at    timestamptz,
    closed_by      varchar(32),
    closed_at      timestamptz,
    cancel_reason  text,

    updated_at     timestamptz NOT NULL DEFAULT now(),

    -- Each stage says both who and when, or neither.
    CHECK ((acknowledged_by IS NULL) = (acknowledged_at IS NULL)),
    CHECK ((rectified_by    IS NULL) = (rectified_at    IS NULL)),
    CHECK ((verified_by     IS NULL) = (verified_at     IS NULL)),
    CHECK ((closed_by       IS NULL) = (closed_at       IS NULL)),

    -- VERIFICATION IS INDEPENDENT, OR IT IS NOT VERIFICATION. The person who
    -- says the brakes are fixed may not also be the person who says the repair
    -- was checked. This is the single most important line in the file: without
    -- it, "verified" means one fitter agreeing with himself, and a machine
    -- goes back to work on it.
    CHECK (verified_by IS NULL OR rectified_by IS NULL
           OR verified_by <> rectified_by),

    -- A repair cannot be verified before it was made, and so on down the line.
    CHECK (rectified_at IS NULL OR acknowledged_at IS NULL
           OR rectified_at >= acknowledged_at),
    CHECK (verified_at IS NULL OR rectified_at IS NULL
           OR verified_at >= rectified_at),

    -- Past RAISED means the earlier stages happened.
    CHECK (state <> 'RECTIFIED' OR rectified_at IS NOT NULL),
    CHECK (state <> 'VERIFIED'  OR verified_at  IS NOT NULL),
    CHECK (state <> 'CLOSED'    OR closed_at    IS NOT NULL),
    CHECK (state <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);

-- ONE OPEN DEFECT PER ITEM PER MACHINE. The brakes being reported NOT OK on
-- Tuesday, Wednesday and Thursday is one defect observed three times, not
-- three defects -- and a workshop queue that says three has lost the ability
-- to say how long this one has been open. Later observations link to the open
-- defect instead.
CREATE UNIQUE INDEX IF NOT EXISTS hoto_defect_one_open_per_item
    ON hoto_defect (asset_id, item_id)
 WHERE state NOT IN ('CLOSED', 'CANCELLED') AND item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hoto_defect_open_idx
    ON hoto_defect (asset_id, severity)
 WHERE state NOT IN ('CLOSED', 'CANCELLED');
CREATE INDEX IF NOT EXISTS hoto_defect_state_idx
    ON hoto_defect (state, raised_at DESC);

COMMENT ON TABLE hoto_defect IS
    'Something wrong with a machine, from raising to verified repair. Outlives '
    'the handover that found it. See migration 108.';

COMMENT ON COLUMN hoto_defect.blocks_operation IS
    'The machine is held until VERIFIED. Acknowledging the defect or closing '
    'the exception that announced it releases nothing.';


-- ── every observation of it ─────────────────────────────────────────────────
-- A defect reported again on a later handover does not create a second row; it
-- adds a sighting here. That is how the register can say "reported on the 3rd,
-- again on the 4th and the 6th, repaired on the 8th".
CREATE TABLE IF NOT EXISTS hoto_defect_sighting (
    sighting_id  bigserial PRIMARY KEY,
    defect_id    bigint NOT NULL REFERENCES hoto_defect (defect_id) ON DELETE CASCADE,
    session_id   bigint REFERENCES hoto_session (session_id),
    response_id  bigint REFERENCES hoto_response (response_id),
    observed_by  varchar(32),
    observed_at  timestamptz NOT NULL DEFAULT now(),
    answer       varchar(12),
    numeric_value numeric(12,3),
    remark       text,

    UNIQUE (defect_id, response_id)
);

CREATE INDEX IF NOT EXISTS hoto_defect_sighting_defect_idx
    ON hoto_defect_sighting (defect_id, observed_at DESC);


-- ── the trail ───────────────────────────────────────────────────────────────
-- Who moved it, when, from what to what, and why. The timestamps on the
-- defect itself say when each stage was reached; this says who did it and
-- what they wrote, including the moves that went backwards -- a repair that
-- failed verification returns to ACKNOWLEDGED, and that is worth seeing.
CREATE TABLE IF NOT EXISTS hoto_defect_event (
    event_id    bigserial PRIMARY KEY,
    defect_id   bigint NOT NULL REFERENCES hoto_defect (defect_id) ON DELETE CASCADE,
    from_state  varchar(14),
    to_state    varchar(14) NOT NULL,
    actor       varchar(32) NOT NULL,
    at          timestamptz NOT NULL DEFAULT now(),
    note        text,
    evidence_ref text,

    CHECK (from_state IS DISTINCT FROM to_state)
);

CREATE INDEX IF NOT EXISTS hoto_defect_event_defect_idx
    ON hoto_defect_event (defect_id, at);


-- ── WHAT THIS MIGRATION DOES NOT DECIDE ─────────────────────────────────────
-- Who may release a blocked machine. hoto.override exists (migration 107) and
-- has no role of its own; the superadmins hold it only because the platform
-- grants every new permission to them. That is question 1 of the three still
-- open in docs/hoto-scope.md section 9, and it is a decision for the mine
-- rather than a default to inherit.
--
-- It also does not create work orders. A defect here is raised, repaired and
-- verified; scheduling the repair belongs to whoever owns maintenance, and
-- pretending otherwise would put a second, worse work-order system next to the
-- real one.
