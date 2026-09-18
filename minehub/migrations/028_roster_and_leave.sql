-- 028: the roster, and the days people are not on it.
--
-- Until now the platform could say who was present this morning, because a gate
-- reader or a supervisor said so. It could not say who was *meant* to be here:
-- that lived in a register, a WhatsApp group and somebody's memory. So a shift
-- opened and the question "who is short today" was answered by looking around.
--
-- A roster answers it before the shift opens. Three things decide whether a
-- person is on duty on a given day:
--
--   the pattern   -- six on, one off, rotating through A, B and C
--   the leave     -- approved, and therefore not a surprise
--   the calendar  -- a national holiday, a festival, a mine closure
--
-- None of it is stored as an answer. "Is Ramesh on duty on the 14th" is worked
-- out on read from these three, the same way readiness is worked out rather
-- than kept, because a stored answer is one that goes stale the moment a leave
-- is approved and nobody re-runs the job that wrote it.
--
-- WHAT THIS DOES NOT DO. It does not pay anybody. Leave balance here is what
-- the mine chooses to track for planning; payroll remains SAP's, and this never
-- writes there. If the two disagree about a balance, SAP is right.

-- -- the pattern --------------------------------------------------------------
-- A cycle rather than a weekly grid, because a mine's week is not seven days.
-- slots is an array as long as cycle_days: each entry is a shift code the
-- person works that day of the cycle, or REST. Position 0 is the anchor date.
CREATE TABLE IF NOT EXISTS roster_pattern (
    pattern_id      bigserial PRIMARY KEY,
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    description     text,
    cycle_days      integer NOT NULL CHECK (cycle_days BETWEEN 1 AND 90),
    slots           jsonb NOT NULL,          -- ["A","A","A","A","A","A","REST"]
    is_active       boolean NOT NULL DEFAULT TRUE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text,
    CHECK (jsonb_typeof(slots) = 'array'),
    CHECK (jsonb_array_length(slots) = cycle_days)
);

COMMENT ON COLUMN roster_pattern.slots IS
    'One entry per day of the cycle: a shift_calendar code, or REST.';

-- -- who is on which pattern, and from when -----------------------------------
-- Dated rather than replaced: a person who moved from general shift to rotation
-- in April still worked general shift in March, and a roster that forgets that
-- cannot explain last quarter's attendance.
CREATE TABLE IF NOT EXISTS roster_assignment (
    roster_assignment_id bigserial PRIMARY KEY,
    operator_id     bigint NOT NULL REFERENCES operator (operator_id) ON DELETE CASCADE,
    pattern_id      bigint NOT NULL REFERENCES roster_pattern (pattern_id),
    anchor_date     date NOT NULL,           -- the day this person sits at slot 0
    effective_from  date NOT NULL,
    effective_to    date,                    -- null = still current
    plant_id        bigint REFERENCES plant (plant_id),
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text,
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- One pattern at a time. Overlapping rosters are not a richer answer, they are
-- two answers, and the shift board cannot choose between them.
CREATE INDEX IF NOT EXISTS roster_assignment_operator_idx
    ON roster_assignment (operator_id, effective_from DESC);
CREATE UNIQUE INDEX IF NOT EXISTS roster_assignment_one_open_idx
    ON roster_assignment (operator_id) WHERE effective_to IS NULL;

-- -- kinds of leave -----------------------------------------------------------
-- Deliberately unseeded. Every mine's leave rules are its own, and a list
-- invented here would be quietly wrong in a way nobody notices until somebody
-- is refused a day they were entitled to.
CREATE TABLE IF NOT EXISTS leave_type (
    leave_type_id   bigserial PRIMARY KEY,
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    description     text,
    is_paid         boolean NOT NULL DEFAULT TRUE,
    annual_quota    numeric(5, 1),           -- null = not counted against a quota
    -- Whether somebody on this leave can still be put on a machine. Training
    -- is leave on paper and presence in the pit; medical hold is neither.
    blocks_deployment boolean NOT NULL DEFAULT TRUE,
    needs_approval  boolean NOT NULL DEFAULT TRUE,
    colour          text,                    -- how the calendar draws it
    is_active       boolean NOT NULL DEFAULT TRUE,
    sort_order      integer NOT NULL DEFAULT 100,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);

-- -- the request --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_request (
    leave_request_id bigserial PRIMARY KEY,
    leave_ref       text UNIQUE,
    operator_id     bigint NOT NULL REFERENCES operator (operator_id) ON DELETE CASCADE,
    leave_type_id   bigint NOT NULL REFERENCES leave_type (leave_type_id),
    from_date       date NOT NULL,
    to_date         date NOT NULL,
    -- Half days are the common case for a mine that runs three shifts, so they
    -- are columns rather than a note somebody has to read.
    half_day_start  boolean NOT NULL DEFAULT FALSE,
    half_day_end    boolean NOT NULL DEFAULT FALSE,
    days            numeric(5, 1),           -- worked out on save, kept for totals
    reason          text,
    status          text NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
    applied_by      text,
    applied_at      timestamptz,
    decided_by      text,
    decided_at      timestamptz,
    decision_note   text,
    -- A leave taken without asking first is still a fact about the roster.
    is_retrospective boolean NOT NULL DEFAULT FALSE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS leave_request_operator_idx
    ON leave_request (operator_id, from_date DESC);
CREATE INDEX IF NOT EXISTS leave_request_window_idx
    ON leave_request (from_date, to_date) WHERE status = 'APPROVED';

-- The same person cannot be approved for two leaves over one day. Enforced
-- rather than checked in the application, because two supervisors approving at
-- the same moment is exactly when an application check does not hold.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE leave_request DROP CONSTRAINT IF EXISTS leave_request_no_overlap;
ALTER TABLE leave_request ADD CONSTRAINT leave_request_no_overlap
    EXCLUDE USING gist (
        operator_id WITH =,
        daterange(from_date, to_date, '[]') WITH &&
    ) WHERE (status = 'APPROVED');

CREATE OR REPLACE FUNCTION next_leave_ref() RETURNS text AS $$
DECLARE
    yr   text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
    last integer;
BEGIN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(leave_ref, '^LV-\d{4}-', ''), '')::integer), 0)
      INTO last
      FROM leave_request
     WHERE leave_ref LIKE 'LV-' || yr || '-%';
    RETURN 'LV-' || yr || '-' || lpad((last + 1)::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- -- the calendar -------------------------------------------------------------
-- A mine does not close on every national holiday, and closes on some days that
-- are nobody else's holiday. So each entry says what it actually means for
-- work rather than only naming the day.
CREATE TABLE IF NOT EXISTS holiday (
    holiday_id      bigserial PRIMARY KEY,
    holiday_date    date NOT NULL,
    name            text NOT NULL,
    plant_id        bigint REFERENCES plant (plant_id),   -- null = every site
    kind            text NOT NULL DEFAULT 'PUBLIC'
        CHECK (kind IN ('PUBLIC', 'FESTIVAL', 'MINE_CLOSURE', 'RESTRICTED', 'MAINTENANCE')),
    -- A restricted holiday is one people may take; a closure is one nobody
    -- works. Only the second stops the roster.
    stops_work      boolean NOT NULL DEFAULT TRUE,
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);

CREATE UNIQUE INDEX IF NOT EXISTS holiday_date_plant_idx
    ON holiday (holiday_date, plant_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS holiday_date_idx ON holiday (holiday_date);

-- -- who may do this ----------------------------------------------------------
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
    ('ops.roster.view',    'Operations', 'View the roster',
     'See who is rostered, on leave, and what the holiday calendar says', FALSE, 450),
    ('ops.roster.manage',  'Operations', 'Manage the roster',
     'Set patterns, put people on them, and maintain the holiday calendar', TRUE, 460),
    ('ops.leave.apply',    'Operations', 'Apply for leave',
     'Raise a leave request on behalf of an operator', FALSE, 470),
    ('ops.leave.approve',  'Operations', 'Approve leave',
     'Approve or reject leave, and cancel an approved leave', TRUE, 480)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE (r.code = 'SHIFT_SUPERVISOR'
        AND p.code IN ('ops.roster.view', 'ops.roster.manage',
                       'ops.leave.apply', 'ops.leave.approve'))
   OR (r.code = 'SHIFT_VIEWER' AND p.code IN ('ops.roster.view'))
ON CONFLICT DO NOTHING;
