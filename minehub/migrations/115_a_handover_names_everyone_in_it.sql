-- A handover names everyone in it.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- A handover has up to three people in it, and the record had room for one:
--
--   THE OPERATOR      whose handover this is -- coming on for a takeover,
--                     going off for a handover, at the machine for a mid-shift
--                     check. operator_id, unchanged.
--   THE OTHER SIDE    who handed the machine over, or who it was handed to.
--                     Never asked. "Taking over" was the session TYPE, not a
--                     person, so a takeover said nothing about who it was
--                     taken from.
--   WHO FILLED IT IN  the person holding the tablet. A supervisor completing
--                     a handover for an operator who cannot read is normal on
--                     this site, and nothing said so: the operator's name went
--                     on the record as though they had done it themselves.
--
-- So one name stood for everybody, and the first question asked of a disputed
-- handover -- "who actually said this machine was fine?" -- had no answer.
--
-- ── THE OTHER SIDE HAS THREE STATES, NOT TWO ────────────────────────────────
-- Named; explicitly nobody (first start of the day, a parked machine); and not
-- recorded. The last is every record filed before this migration, and it must
-- stay distinguishable from "nobody": a register that showed old handovers as
-- unattended would be inventing a fact. Hence a flag rather than reading
-- meaning into a NULL.
--
-- ── PAIRING ─────────────────────────────────────────────────────────────────
-- counterpart_session_id has existed since migration 106 and was never set.
-- The server now pairs a takeover with the handover it follows when it files
-- either one -- see hoto_capture.pair(). That is what lets anybody ask the
-- question a handover exists to answer: did the person going off and the
-- person coming on say the same thing about this machine?

ALTER TABLE hoto_session
  ADD COLUMN IF NOT EXISTS counterpart_operator_id bigint REFERENCES operator (operator_id),
  ADD COLUMN IF NOT EXISTS counterpart_emp_id      varchar(32),
  ADD COLUMN IF NOT EXISTS counterpart_absent      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recorded_by_operator_id bigint REFERENCES operator (operator_id),
  ADD COLUMN IF NOT EXISTS recorded_by_emp_id      varchar(32);

COMMENT ON COLUMN hoto_session.counterpart_operator_id IS 'The other side of the handover as this record names them: who handed over (START_HANDOVER) or who took over (END_HANDOVER). NULL with counterpart_absent false means not recorded, which is every record filed before migration 115.';
COMMENT ON COLUMN hoto_session.counterpart_absent IS 'True when the operator stated nobody was on the other side, for a first start or a parked machine. Distinct from not recorded.';
COMMENT ON COLUMN hoto_session.recorded_by_operator_id IS 'Who held the tablet and filled the record in. Equal to operator_id when the operator did it themself. NULL only on records filed before migration 115.';

-- The other side is either named or stated absent, never both.
ALTER TABLE hoto_session DROP CONSTRAINT IF EXISTS hoto_session_counterpart_named_or_absent;
ALTER TABLE hoto_session ADD CONSTRAINT hoto_session_counterpart_named_or_absent
  CHECK (NOT (counterpart_absent AND counterpart_operator_id IS NOT NULL));

-- A mid-shift check has one party. Same rule migration 106 applies to the
-- paired session, now applied to the named person too.
ALTER TABLE hoto_session DROP CONSTRAINT IF EXISTS hoto_session_mid_shift_has_no_other_side;
ALTER TABLE hoto_session ADD CONSTRAINT hoto_session_mid_shift_has_no_other_side
  CHECK (session_type <> 'MID_SHIFT'
         OR (counterpart_operator_id IS NULL AND NOT counterpart_absent));

-- Pairing looks for the unpaired session of the opposite type on the same
-- machine near the same moment, on every filing.
CREATE INDEX IF NOT EXISTS hoto_session_pairing_idx
  ON hoto_session (asset_id, session_type, captured_at)
  WHERE counterpart_session_id IS NULL;
