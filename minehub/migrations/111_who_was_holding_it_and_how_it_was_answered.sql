-- ─────────────────────────────────────────────────────────────────────────────
-- 111 · Who was holding it, and how the checklist was answered
--
-- TWO THINGS THE MINE ASKED FOR, AND ONE THEY DID NOT
--
-- 1. A PHOTO OF THE PERSON TAKING THE MACHINE.
--    `hoto_photo` already carries bytes, a hash and a session; what it could
--    not say is WHAT a photo is of. Every row so far is evidence against a
--    checklist item. An operator's photo is not that -- it has no item_id, it
--    is not evidence of a defect, and it must not appear in a defect's photo
--    list. So photos get a kind.
--
--    Worth saying plainly: this is a photograph of a worker, taken at every
--    handover, kept with the record. That is a different kind of data from a
--    picture of a cracked hose, and the mine should know it is collecting it.
--
-- 2. ONE TAP TO MARK THE ROUTINE CHECKS OK.
--    Twenty-four taps when nothing is wrong is friction, and friction is what
--    sends a shift back to paper. But a checklist that can be completed
--    without looking is the thing a checklist exists to prevent, and a record
--    filled in one tap is INDISTINGUISHABLE from one walked round properly.
--
--    So the shortcut is recorded. `bulk_answered` says the routine checks were
--    answered together, and the office can see it on the record. The items
--    that can stop a machine are never included -- the app answers those one
--    at a time or not at all -- so the shortcut can never pass a brake check
--    nobody made.
--
--    This column is not something anybody asked for. It is here because the
--    alternative is a record that lies by omission.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE hoto_photo
    ADD COLUMN IF NOT EXISTS kind varchar(12) NOT NULL DEFAULT 'ITEM';

ALTER TABLE hoto_photo DROP CONSTRAINT IF EXISTS hoto_photo_kind_check;
ALTER TABLE hoto_photo ADD CONSTRAINT hoto_photo_kind_check
    CHECK (kind IN ('ITEM', 'OPERATOR'));

-- An item photo is evidence against a check and names it. An operator photo
-- is of a person and names no check. Neither may be the other.
ALTER TABLE hoto_photo DROP CONSTRAINT IF EXISTS hoto_photo_kind_matches_item;
ALTER TABLE hoto_photo ADD CONSTRAINT hoto_photo_kind_matches_item
    CHECK (kind <> 'OPERATOR' OR item_id IS NULL);

COMMENT ON COLUMN hoto_photo.kind IS
    'ITEM: evidence against a checklist item. OPERATOR: the person taking the '
    'machine on, photographed at handover. See migration 111.';

-- The operator's photo for a given handover, which is what the register and
-- the defect screens both need to find (or deliberately exclude).
CREATE INDEX IF NOT EXISTS hoto_photo_operator_idx
    ON hoto_photo (session_id) WHERE kind = 'OPERATOR';

ALTER TABLE hoto_session
    ADD COLUMN IF NOT EXISTS bulk_answered boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN hoto_session.bulk_answered IS
    'The routine checks were answered together with one action rather than one '
    'at a time. Items that can stop the machine are never included. Recorded '
    'so a one-tap record is not indistinguishable from a walk-round. '
    'See migration 111.';

COMMIT;
