-- ─────────────────────────────────────────────────────────────────────────────
-- 112 · A yes/no item says which answer is the finding
--
-- THE GAP
-- `isAdverse` has always been a property of the ANSWER: NOT_OK and CAUTION are
-- findings, everything else is not. That works for the three-way items, where
-- the words carry their own meaning. It does not work for yes/no, where the
-- meaning is in the question:
--
--     Exhaust smoke (excessive)     YES is the finding
--     Cuts / bulges visible         YES is the finding
--     ROPS / FOPS visible damage    YES is the finding, and it stops the machine
--     Grease points done            NO  is the finding
--
-- So every yes/no answer was recorded and none of them ever raised a defect.
-- A tipper could be handed over with excessive exhaust smoke, visible cuts in
-- its tyres and tread below the limit, and the workshop would never hear about
-- any of it. Found on a tablet, 12 Nov 2026.
--
-- WHY A COLUMN AND NOT A CONVENTION
-- The obvious shortcut is "YES means a problem", because five of the six items
-- above read that way. "Grease points done" is the sixth, and under that rule a
-- machine that HAD been greased would raise a defect while one that had not
-- would pass. A convention that is wrong one time in six is worse than no
-- convention, because it is wrong quietly.
--
-- NULL keeps the old behaviour: no answer is a finding. That is the safe
-- default for an item nobody has classified yet -- it records the answer and
-- raises nothing, rather than guessing and raising the wrong thing.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE hoto_checklist_item
    ADD COLUMN IF NOT EXISTS adverse_answer varchar(10);

ALTER TABLE hoto_checklist_item DROP CONSTRAINT IF EXISTS hoto_checklist_item_adverse_answer_check;
ALTER TABLE hoto_checklist_item ADD CONSTRAINT hoto_checklist_item_adverse_answer_check
    CHECK (adverse_answer IS NULL OR adverse_answer IN ('YES', 'NO'));

-- Only a yes/no item may carry one. The three-way items already say what they
-- mean, and letting them set this would create two sources of truth for the
-- same question.
ALTER TABLE hoto_checklist_item DROP CONSTRAINT IF EXISTS hoto_checklist_item_adverse_is_yes_no;
ALTER TABLE hoto_checklist_item ADD CONSTRAINT hoto_checklist_item_adverse_is_yes_no
    CHECK (adverse_answer IS NULL OR response_type = 'YES_NO');

COMMENT ON COLUMN hoto_checklist_item.adverse_answer IS
    'For a YES_NO item, which answer is a finding. NULL means neither is, '
    'which records the answer and raises nothing. See migration 112.';

-- ── classify the items the mine already has ─────────────────────────────────
-- Phrased as a problem: answering YES reports it.
UPDATE hoto_checklist_item SET adverse_answer = 'YES'
 WHERE response_type = 'YES_NO'
   AND adverse_answer IS NULL
   AND (label ILIKE '%excessive%' OR label ILIKE '%visible%'
        OR label ILIKE '%abnormal%' OR label ILIKE '%below limit%'
        OR label ILIKE '%damage%' OR label ILIKE '%leak%');

-- Phrased as a task: answering NO reports that it was not done.
UPDATE hoto_checklist_item SET adverse_answer = 'NO'
 WHERE response_type = 'YES_NO'
   AND adverse_answer IS NULL
   AND (label ILIKE '%done%' OR label ILIKE '%checked%' OR label ILIKE '%present%');

COMMIT;
