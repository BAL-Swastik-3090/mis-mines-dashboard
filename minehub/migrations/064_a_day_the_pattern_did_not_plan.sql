-- A day the pattern did not plan for.
--
-- A pattern answers "what does this man normally work", and that is the right
-- question almost every day. It cannot answer the other one: somebody is short
-- on C tonight, a fitter is wanted on general shift on Thursday, a crew swaps a
-- rest day. Until now the only way to say that was to move the man onto a
-- different pattern, which changes every day thereafter to fix one.
--
-- This is the exception, one row per person per day, sitting above the pattern
-- and below the things that decide whether he is available at all: a mine
-- closure and approved leave still win, because a supervisor typing a shift
-- into a box does not bring somebody back from leave.
--
-- It also stands on its own. An override needs no pattern underneath it, which
-- matters here because all 204 operators are on no pattern at all: the mine can
-- roster directly, day by day, and adopt patterns later without redoing it.

CREATE TABLE IF NOT EXISTS roster_day (
    roster_day_id   bigserial PRIMARY KEY,
    operator_id     bigint      NOT NULL REFERENCES operator(operator_id) ON DELETE CASCADE,
    on_date         date        NOT NULL,

    -- The shift worked that day, or NULL for a rest day deliberately given.
    -- NULL here is not "unknown": a row exists because somebody decided, and
    -- deciding somebody rests is a decision. "Unknown" is the absence of a row,
    -- which falls through to the pattern.
    shift_code      text,

    reason          text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text,

    -- One decision per person per day. A second click on the same cell changes
    -- the first rather than leaving two answers and letting the reader pick.
    CONSTRAINT roster_day_one_per_day UNIQUE (operator_id, on_date)
);

COMMENT ON TABLE roster_day IS
    'A single day set by hand, overriding whatever pattern the operator is on. '
    'Sits above the pattern and below leave and mine closures. Absence of a row '
    'means the pattern decides; a row with a NULL shift_code means a rest day '
    'somebody chose.';

COMMENT ON COLUMN roster_day.shift_code IS
    'The shift worked, from shift_calendar, or NULL for a rest day given on '
    'purpose.';


-- A shift this mine does not run cannot be written here.
--
-- Not a foreign key: shift_calendar is unique on (code, location_id,
-- valid_from), not on code, because the same shift is redefined when its hours
-- change and both versions stay on file. A key would need all three columns,
-- and a roster day does not have an opinion about which revision of C shift it
-- means — it means C shift.
--
-- Not a CHECK either. A CHECK cannot read another table, and the list of shifts
-- is data the mine edits, not a constant to be frozen into the schema. The same
-- reasoning as migration 062 and the identity systems.
CREATE OR REPLACE FUNCTION roster_day_names_a_real_shift() RETURNS trigger AS $$
BEGIN
    IF NEW.shift_code IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM shift_calendar s WHERE s.code = NEW.shift_code) THEN
        RAISE EXCEPTION 'This mine has no shift called %. A roster cannot put '
                        'somebody on a shift that does not exist.', NEW.shift_code
              USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roster_day_shift_is_known ON roster_day;
CREATE TRIGGER roster_day_shift_is_known
    BEFORE INSERT OR UPDATE ON roster_day
    FOR EACH ROW EXECUTE FUNCTION roster_day_names_a_real_shift();

-- The board reads a window of dates for a set of people, every time it paints.
CREATE INDEX IF NOT EXISTS roster_day_by_date
    ON roster_day (on_date, operator_id);

CREATE INDEX IF NOT EXISTS roster_day_by_operator
    ON roster_day (operator_id, on_date);
