-- ─────────────────────────────────────────────────────────────────────────────
-- 122 · A handover says which shift it belongs to
--
-- WHAT WAS MISSING
-- `hoto_session.shift_instance_id` has existed since migration 115 and is NULL
-- on all 22 handovers ever filed, because nothing creates a shift_instance row
-- per shift -- there are five of them in total and the newest is from October.
-- So the shift a handover belongs to was never recorded anywhere. The Shift
-- Board works around it by deriving the shift from `shift_calendar` and the
-- clock each time it is read, which is correct for today and wrong in the two
-- cases that matter most:
--
--   * A handover captured offline at 22:40 and synced at 09:00 the next
--     morning is read as belonging to the morning shift. It belonged to
--     the night one, and the night supervisor is the person answerable for it.
--   * A handover at 06:02 and one at 05:58 belong to different shifts, and
--     which side of the line they fall depends on rules that may be edited
--     later. A record that is re-bucketed when somebody changes a shift
--     timing is not a record of what happened.
--
-- A handover is a record of something that occurred at a moment. The shift is
-- a fact about that moment, so it is resolved once, from the device's own
-- captured_at, and stored -- not recomputed by every reader for ever.
--
-- WHY NOT JUST CREATE shift_instance ROWS
-- Because `shift_instance` is the planning table and another part of the
-- platform owns it: it carries a supervisor, planned and actual start and end,
-- and a status somebody closes. Manufacturing a row per handover to satisfy a
-- foreign key would fill somebody else's table with records nobody planned.
-- shift_instance_id stays, and is still attached when a real one exists.
--
-- `production_day` is the part people get wrong, and the reason it is stored
-- rather than derived from the date: a handover at 02:00 on night shift
-- belongs to the day the SHIFT started, not the date on the clock.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE hoto_session
    ADD COLUMN IF NOT EXISTS shift_code     varchar(16),
    ADD COLUMN IF NOT EXISTS production_day date;

COMMENT ON COLUMN hoto_session.shift_code IS
    'The shift this handover belongs to, resolved from the device''s captured_at '
    'against shift_calendar at the moment it was filed. See migration 122.';
COMMENT ON COLUMN hoto_session.production_day IS
    'The day the SHIFT started, which for a night shift is not the date on the '
    'clock. Stored so a report cannot re-bucket it later. See migration 122.';

-- Every report that follows asks "which machines in this shift", so this is
-- the index those queries want.
CREATE INDEX IF NOT EXISTS hoto_session_shift_idx
    ON hoto_session (production_day, shift_code);

COMMIT;
