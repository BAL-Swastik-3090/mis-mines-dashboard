-- 112: what the mine has decided to DO about each loss head.
--
-- The Major Controllable Loss Summary names the heads that cost the most and
-- stops there. The mine's own review carries a second panel beside it -- the
-- actions to take -- and reproducing it raised the obvious question of where
-- those sentences should come from.
--
-- ── WHY THIS IS A COLUMN AND NOT A MODEL ──────────────────────────────────
-- An action line cannot be accurate the way a tonnage can. "Audit the face
-- lighting" is not true or false; it is a decision. So the only accuracy
-- available is that it says what the mine actually decided, that it is
-- attached to the head that actually dominated, and that it does not change
-- when the data has not. A sentence generated at render time fails the last
-- two: the same month would read differently on two openings, and nobody
-- could say who authorised an instruction addressed to a named department.
--
-- The vocabulary is closed -- seventeen controllable heads, discovered from
-- the source columns, not invented here -- so a standing remedy per head is
-- a lookup, and the data decides only WHICH of them appears.
--
-- ── THE TEXT BELOW IS A DRAFT, NOT A POLICY ───────────────────────────────
-- These sentences were drafted for the mine to correct, exactly as the KAM
-- names in migration 104 were seeded for the mine to correct. They are dated
-- 2026-10-01 so that editing November does not rewrite October, and they are
-- written onto every existing row rather than the earliest, because the four
-- heads re-decided on 2026-11-01 would otherwise resolve to no action at all
-- in November.
--
-- ── 'other' DELIBERATELY HAS NONE ─────────────────────────────────────────
-- It is a catch-all with no fixed cause. Any remedy written against it is
-- wrong about half the time, and a confident wrong instruction is worse on
-- this page than an honest blank.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. THE COLUMNS
-- ---------------------------------------------------------------------------
ALTER TABLE lcm_loss_head_setting
    ADD COLUMN IF NOT EXISTS action_text     text,
    ADD COLUMN IF NOT EXISTS owning_function varchar(60);

COMMENT ON COLUMN lcm_loss_head_setting.action_text IS
    'The mine''s standing remedy for this loss head, shown beside the '
    'Major Controllable Loss Summary when the head is among the largest. '
    'NULL means no action is offered -- which is the correct answer for a '
    'catch-all head such as other.';

COMMENT ON COLUMN lcm_loss_head_setting.owning_function IS
    'Who carries the action out. Deliberately NOT derived from kam_name: the '
    'KAM answers for the loss, which is not always the same department that '
    'fixes it -- illumination is owned by Engineering and audited by '
    'Electrical.';


-- ---------------------------------------------------------------------------
-- 2. THE DRAFT, ONTO EVERY ROW THAT HAS NONE
-- ---------------------------------------------------------------------------
-- Guarded on action_text IS NULL so re-running this never overwrites a
-- sentence the mine has since rewritten.
WITH draft (column_name, action_text, owning_function) AS (VALUES
    ('idle_safety',
     'Log the specific hazard behind every safety stoppage and close it before the next shift; weekly review by Mines Operation with Safety.',
     'Mines Operation + Safety'),
    ('idle_requ_basic',
     'Issue the shift''s basic requirements -- water, tools, supervision, explosives -- at the face before shift start, not after it.',
     'Mines Operation'),
    ('idle',
     'Hold a standing reallocation plan so an idle machine moves to the next working face instead of waiting for instruction.',
     'Mines Operation'),
    ('job_allocation',
     'Issue the pre-shift job allocation and the face/bench plan before shift start.',
     'Mines Operation'),
    ('breakdown',
     'Close every breakdown notification in SAP on completion, and review repeat offenders weekly against the equipment matrix.',
     'Engineering'),
    ('tipper_shortage',
     'Confirm the next day''s tipper deployment against the plan at the evening meeting; escalate a shortfall to the contractor the same evening.',
     'Engineering'),
    ('illumination_problem',
     'Audit face and dump lighting before every night shift; hold spare lamps and cable at the pit.',
     'Electrical'),
    ('hsd_shortage',
     'Hold minimum HSD stock against the day''s planned running hours and reorder at the reorder level, not at empty.',
     'Store'),
    ('absence_operator',
     'Keep a shift-wise reserve operator roster and fill an absence before the shift opens.',
     'Human Resource'),
    ('lmv_availability',
     'Reserve an LMV per shift for face movement and service it outside production hours.',
     'Human Resource'),
    ('strike',
     'Settle grievances at the weekly works-committee meeting, before they reach a stoppage.',
     'Human Resource'),
    ('trains_truck',
     'Control tipper queueing at the weighbridge and the dump with scheduled despatch slots.',
     'Security'),
    ('dump_jam',
     'Keep a second dump face dressed and available so tipping continues while one is being levelled.',
     'Mines Operation'),
    ('late_start',
     'Start the shift at the face rather than at the gate: stagger bus arrival and hold the tool-box talk before shift time.',
     'Mines Operation'),
    ('early_close',
     'Work the face to shift end; record every early close with its reason and the supervisor''s name.',
     'Mines Operation'),
    ('not_operation',
     'Review every machine standing not-in-operation at the daily meeting and either deploy it or release it from the plan.',
     'Mines Operation')
)
UPDATE lcm_loss_head_setting s
SET    action_text     = d.action_text,
       owning_function = d.owning_function
FROM   draft d
WHERE  s.column_name = d.column_name
  AND  s.action_text IS NULL;
