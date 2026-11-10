-- 102: the new tippers are measured the same way the old ones are.
--
-- WHAT WAS WRONG. PRIMA carried a FIXED Ideal Trip per truck -- 323, 317, 342
-- and so on -- while MAN carried a RATE of 1.5 trips per engine-hour. Two
-- tables side by side, one of them answering a different question.
--
-- A fixed figure does not scale with the window, and the OEE page is read
-- over whatever range somebody picks. The same truck asked for 323 trips over
-- two days, over five days and over thirty-one:
--
--     window          MAN11 ideal      PRIMA-5135 ideal
--     1-2 Nov    (2d)          11                   323
--     1-5 Nov    (5d)          45                   323
--     1-31 Oct  (31d)         424                   323
--
-- So PRIMA Yield was only meaningful over the one period the constants were
-- set for, and meaningless everywhere else: 15.12% over five days against the
-- MAN fleet's 90.08%, which read as a collapsed fleet rather than as a
-- mis-stated denominator.
--
-- WHY A RATE IS THE RIGHT MODEL FOR THEM TOO. Over 1-5 November the ten PRIMA
-- trucks turned between 1.02 and 1.32 trips per engine-hour, against the MAN
-- fleet's 1.35 -- a tight band, and close to MAN's. There is a rate there. The
-- supplied constants, divided by the same engine hours, scatter from 7.11 to
-- 9.24 and have no rate behind them at all, which is why they were kept as
-- constants when this was first built. That was the wrong call: a figure with
-- no rate behind it is not a target, it is a number from a different period.
--
-- They take the same 1.50 the MAN fleet uses, which is the mine's own figure.
-- It is per machine and editable on the Equipment Status Selector, so if the
-- mine judges a PRIMA should turn more or fewer trips an hour than a MAN,
-- that is a number they change rather than a deployment.
--
-- THE CORRECTION IS DATED 2026-10-01, NOT TODAY. This is not the mine
-- changing its mind -- it is a formula that was wrong from the day it shipped,
-- so it is corrected on the seed version and every window reports it. Dating
-- it today would leave October answering with the broken denominator for ever.
--
-- ideal_trip_fixed IS KEPT, not dropped. A truck with a genuinely fixed target
-- -- one on a fixed haul, or a figure the mine insists on -- is still
-- storable, and the service prefers a rate when one is set. The constraint
-- below enforces exactly one of the two, so no row can carry both and leave
-- the reader guessing which applied.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. A TIPPER MAY BE MEASURED EITHER WAY, BUT NOT BOTH
-- ---------------------------------------------------------------------------
-- The two generation-specific checks are replaced by one that does not care
-- which generation a truck belongs to -- which is the whole point of this
-- migration, since old and new are no longer measured differently.

ALTER TABLE oee_equip_status
    DROP CONSTRAINT IF EXISTS oee_equip_status_new_tipper_chk,
    DROP CONSTRAINT IF EXISTS oee_equip_status_old_tipper_chk;

DO $$
BEGIN
    -- Scoped on conrelid as well as the name: a constraint name is unique
    -- per table, not per database, so the name alone would find another
    -- schema's copy and skip creating this one.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'oee_equip_status_tipper_chk'
                     AND conrelid = 'oee_equip_status'::regclass) THEN
        ALTER TABLE oee_equip_status
            ADD CONSTRAINT oee_equip_status_tipper_chk CHECK (
                status <> 'ACTIVE' OR equipment_class <> 'TIPPER'
                OR (ideal_cum_per_hr IS NULL
                    -- Exactly one. `<>` on two booleans is XOR, so a row with
                    -- both, or with neither, is refused.
                    AND (trips_per_engine_hour IS NOT NULL)
                     <> (ideal_trip_fixed IS NOT NULL)));
    END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 2. THE TEN PRIMA TRUCKS MOVE ON TO THE RATE
-- ---------------------------------------------------------------------------
-- Guarded on ideal_trip_fixed IS NOT NULL so a re-run is a no-op and the
-- history is written once. A truck somebody has since put back on a fixed
-- figure deliberately is left alone by the same guard on the next run.

INSERT INTO oee_equip_status_hist
    (equipment_name, effective_from, action, field, old_value, new_value,
     revision, entry_id)
SELECT s.equipment_name, s.effective_from, 'CHANGED', f.field,
       f.old_value, f.new_value, s.revision + 1, 'MIG-102'
FROM   oee_equip_status s
JOIN   oee_equip_master m USING (equipment_name)
CROSS  JOIN LATERAL (VALUES
           ('ideal_trip_fixed',      s.ideal_trip_fixed::text, NULL),
           ('trips_per_engine_hour', NULL,                     '1.50')
       ) AS f(field, old_value, new_value)
WHERE  m.equipment_class = 'TIPPER'
  AND  s.generation = 'NEW'
  AND  s.ideal_trip_fixed IS NOT NULL;

UPDATE oee_equip_status s
SET    trips_per_engine_hour = 1.50,
       ideal_trip_fixed      = NULL,
       entry_id              = 'MIG-102',
       entry_date            = now(),
       revision              = s.revision + 1
FROM   oee_equip_master m
WHERE  m.equipment_name = s.equipment_name
  AND  m.equipment_class = 'TIPPER'
  AND  s.generation = 'NEW'
  AND  s.ideal_trip_fixed IS NOT NULL;

COMMENT ON COLUMN oee_equip_status.ideal_trip_fixed IS
    'A trip target that does NOT scale with the window. Kept for a truck the '
    'mine genuinely measures that way; everything else uses '
    'trips_per_engine_hour, and a row may carry one or the other, never both.';
