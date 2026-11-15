-- A defect has somebody fixing it, and a date it should be fixed by.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- The defect queue had ten open defects and no column saying who was fixing
-- any of them, and nothing to say when they should be done. Its only measure
-- was age, weighted by severity in the screen, because there was no target
-- to measure against -- and a workshop meeting cannot run on "this one is
-- three days old".
--
-- assigned_to is free text ON PURPOSE. The workshop hands a fault to a fitter,
-- to a team ("hydraulics"), or to a contractor's man who is in no register
-- this system holds. A picker limited to employees would force a wrong name
-- into the record, which is worse than a plain one.
--
-- target_date is set by a person. When none is set the screen still judges
-- the defect by the severity norms it always used (critical 1 day, high 3,
-- medium 7, low 14) and says that is what it is doing -- it does not write a
-- date into the record that nobody chose.
--
-- ── THE HISTORY TAKES MORE THAN STATE CHANGES ───────────────────────────────
-- hoto_defect_event refused any entry whose state did not change, which is
-- right for a state change and wrong for "assigned to Ramesh" or "target
-- moved to Friday": those happen without the defect changing stage, and an
-- owner or a date that changed with no trace is how a missed target gets
-- quietly moved. Each entry now says what kind it is, and the no-op guard
-- applies to state changes only.

ALTER TABLE hoto_defect
  ADD COLUMN IF NOT EXISTS assigned_to   varchar(120),
  ADD COLUMN IF NOT EXISTS assigned_by   varchar(32),
  ADD COLUMN IF NOT EXISTS assigned_at   timestamptz,
  ADD COLUMN IF NOT EXISTS target_date   date,
  ADD COLUMN IF NOT EXISTS target_set_by varchar(32),
  ADD COLUMN IF NOT EXISTS target_set_at timestamptz;

-- Assigned means it says by whom and when, or it is not assigned. Likewise
-- the target.
ALTER TABLE hoto_defect DROP CONSTRAINT IF EXISTS hoto_defect_assigned_who_and_when;
ALTER TABLE hoto_defect ADD CONSTRAINT hoto_defect_assigned_who_and_when
  CHECK ((assigned_to IS NULL) = (assigned_at IS NULL)
         AND (assigned_to IS NULL) = (assigned_by IS NULL));
ALTER TABLE hoto_defect DROP CONSTRAINT IF EXISTS hoto_defect_target_who_and_when;
ALTER TABLE hoto_defect ADD CONSTRAINT hoto_defect_target_who_and_when
  CHECK ((target_date IS NULL) = (target_set_at IS NULL)
         AND (target_date IS NULL) = (target_set_by IS NULL));

COMMENT ON COLUMN hoto_defect.assigned_to IS 'Who is fixing it, as the workshop names them: a person, a team or a contractor. Free text on purpose.';
COMMENT ON COLUMN hoto_defect.target_date IS 'Fix-by date, set by a person. NULL means none was set and the severity norm applies, which the screen says.';

-- ── the history ─────────────────────────────────────────────────────────────
ALTER TABLE hoto_defect_event
  ADD COLUMN IF NOT EXISTS kind varchar(12) NOT NULL DEFAULT 'STATE';

ALTER TABLE hoto_defect_event DROP CONSTRAINT IF EXISTS hoto_defect_event_kind_check;
ALTER TABLE hoto_defect_event ADD CONSTRAINT hoto_defect_event_kind_check
  CHECK (kind IN ('STATE', 'ASSIGNED', 'TARGET'));

-- The guard from migration 117, narrowed to the entries it was meant for.
ALTER TABLE hoto_defect_event DROP CONSTRAINT IF EXISTS hoto_defect_event_check;
ALTER TABLE hoto_defect_event DROP CONSTRAINT IF EXISTS hoto_defect_event_state_changes;
ALTER TABLE hoto_defect_event ADD CONSTRAINT hoto_defect_event_state_changes
  CHECK (kind <> 'STATE' OR from_state IS DISTINCT FROM to_state);
