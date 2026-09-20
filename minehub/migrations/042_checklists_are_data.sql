-- 042: the things you assess against are rows, not a list in the source.
--
-- The fifteen competency dimensions — overall, controls, pre-start, safety
-- systems, emergency shutdown and the rest — were an array in a React file.
-- That is fine for a vocabulary nobody changes and wrong for this one: the
-- mine will add a dimension the first time an auditor asks for one, or when a
-- new class of machine arrives with a check the others do not have. Today that
-- means a developer, a build and a deploy to add one line to a list, which is
-- how a platform stops being the place the mine keeps its own definitions.
--
-- ONE TABLE FOR BOTH, because they are the same shape. A competency dimension
-- and a handover check are both "an ordered, named thing somebody records an
-- answer against, for a class of machine". Giving them one table means one
-- screen manages both, and the HOTO check-in that comes later inherits
-- everything built here rather than growing its own half of it.
--
-- hoto_template.items already holds a jsonb array for the same purpose and has
-- never had a row in it. It is left alone rather than dropped — a template
-- that pins a specific list to a specific handover is a reasonable thing to
-- want later — but the list people edit lives here.
--
-- WHY NOT A CHECK CONSTRAINT ON operator_competency.dimension. There is none
-- today and none is added. A dimension that is retired must keep meaning what
-- it meant on the assessments already recorded against it; a foreign key would
-- either block retiring it or rewrite history. Retirement hides it from the
-- form and leaves the record alone, which is what an append-only trail needs.

CREATE TABLE IF NOT EXISTS checklist_item (
    checklist_item_id bigserial PRIMARY KEY,

    -- What kind of list this belongs to. COMPETENCY is assessed as a level
    -- nought to four; HOTO is answered at handover.
    kind          text NOT NULL CHECK (kind IN ('COMPETENCY', 'HOTO')),

    -- Stable, and what gets written to operator_competency.dimension. The
    -- label can be reworded freely; this cannot, because assessments point at
    -- it.
    code          text NOT NULL,
    label         text NOT NULL,

    -- What the assessor is actually judging. Shown as help on the form, and
    -- the reason two assessors agree about what "Controls" means.
    help          text,

    -- Null applies to every machine class. A dimension only an excavator has
    -- names its class, and the form shows it only there.
    asset_type_id bigint REFERENCES asset_type(asset_type_id) ON DELETE CASCADE,

    -- Exactly one COMPETENCY item is the clearance decision: the level that
    -- says whether this person may be crewed onto the machine. The rest
    -- describe what they understand. Enforced below.
    is_decisive   boolean NOT NULL DEFAULT FALSE,

    -- An answer is required before the assessment can be submitted.
    is_required   boolean NOT NULL DEFAULT FALSE,

    sort_order    integer NOT NULL DEFAULT 100,
    status        text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'RETIRED')),

    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text,
    updated_by    text,

    -- The same code may exist once for all machines and once for a particular
    -- class, which is how a class overrides the general wording.
    UNIQUE (kind, code, asset_type_id)
);

COMMENT ON TABLE checklist_item IS
    'The ordered things people record answers against: competency dimensions '
    'and handover checks. Rows rather than a list in the source, so the mine '
    'can add one without a deploy.';

CREATE INDEX IF NOT EXISTS ix_checklist_kind
    ON checklist_item (kind, status, sort_order);

-- One decisive item per kind per machine class. Two would mean two answers to
-- "may this person work", which is not a question with two answers.
CREATE UNIQUE INDEX IF NOT EXISTS ux_checklist_one_decisive
    ON checklist_item (kind, COALESCE(asset_type_id, 0))
 WHERE is_decisive AND status = 'ACTIVE';

-- ── the fifteen, as they were written in the form ───────────────────────────
-- Wording carried across exactly, so nobody has to relearn a screen they have
-- only just started using.

INSERT INTO checklist_item (kind, code, label, help, is_decisive, is_required, sort_order)
VALUES
 ('COMPETENCY', 'OVERALL', 'Overall competency',
  'The clearance decision. Level 2 or better is what lets this person be crewed onto the machine.',
  TRUE, TRUE, 10),
 ('COMPETENCY', 'FAMILIARITY', 'Machine familiarity',
  'Knows this make and model, not just the class.', FALSE, FALSE, 20),
 ('COMPETENCY', 'CONTROLS', 'Controls',
  'Every control, without looking for it.', FALSE, FALSE, 30),
 ('COMPETENCY', 'OPERATING_PROCEDURE', 'Operating procedure',
  'The sequence, start to park.', FALSE, FALSE, 40),
 ('COMPETENCY', 'PRE_START', 'Pre-start inspection',
  'The walk-round, and what stops the machine going out.', FALSE, FALSE, 50),
 ('COMPETENCY', 'SAFETY_SYSTEMS', 'Safety systems',
  'Interlocks, alarms, isolators — what they are for.', FALSE, FALSE, 60),
 ('COMPETENCY', 'EMERGENCY_SHUTDOWN', 'Emergency shutdown',
  'Where it is and when to use it.', FALSE, FALSE, 70),
 ('COMPETENCY', 'RATED_CAPACITY', 'Rated capacity',
  'What the machine is rated to move or lift.', FALSE, FALSE, 80),
 ('COMPETENCY', 'OPERATING_LIMITS', 'Operating limits',
  'Gradient, reach, weather, ground conditions.', FALSE, FALSE, 90),
 ('COMPETENCY', 'ATTACHMENTS', 'Attachments',
  'Changing them, and what each is for.', FALSE, FALSE, 100),
 ('COMPETENCY', 'FLUID_CHECKS', 'Fuel and fluid checks',
  'Levels, and what a change in them means.', FALSE, FALSE, 110),
 ('COMPETENCY', 'FAULT_RECOGNITION', 'Fault recognition',
  'Knows a fault from a noise, and what to do.', FALSE, FALSE, 120),
 ('COMPETENCY', 'TELEMATICS', 'Display and telematics',
  'Reads the display and acts on it.', FALSE, FALSE, 130),
 ('COMPETENCY', 'PARKING_SHUTDOWN', 'Safe parking and shutdown',
  'Where, how, and left safe for the next shift.', FALSE, FALSE, 140),
 ('COMPETENCY', 'SITE_SOP', 'Mine-specific SOP',
  'Kaliapani''s own rules for this machine.', FALSE, FALSE, 150)
ON CONFLICT (kind, code, asset_type_id) DO NOTHING;

-- ── a handover list to start from ───────────────────────────────────────────
-- HOTO check-in is not built yet. These are seeded so that when it is, the
-- screen has something to show and the mine has something to correct, rather
-- than an empty list nobody knows the shape of.

INSERT INTO checklist_item (kind, code, label, help, is_decisive, is_required, sort_order)
VALUES
 ('HOTO', 'ACCEPTED', 'Machine accepted',
  'The decisive one: the incoming operator takes the machine as it stands.',
  TRUE, TRUE, 10),
 ('HOTO', 'HOURS_READING', 'Hour meter reading',
  'Read and agreed by both operators, because the shift''s hours are counted from it.',
  FALSE, TRUE, 20),
 ('HOTO', 'FUEL_LEVEL', 'Fuel level', 'As handed over.', FALSE, TRUE, 30),
 ('HOTO', 'VISIBLE_DAMAGE', 'Visible damage',
  'Anything new since the last handover, noted before it becomes nobody''s.',
  FALSE, FALSE, 40),
 ('HOTO', 'FLUID_LEVELS', 'Oil and coolant levels', NULL, FALSE, FALSE, 50),
 ('HOTO', 'TYRES_TRACKS', 'Tyres or tracks', NULL, FALSE, FALSE, 60),
 ('HOTO', 'LIGHTS_HORN', 'Lights, horn and reversing alarm',
  'The things that keep other people safe around the machine.', FALSE, FALSE, 70),
 ('HOTO', 'SAFETY_GEAR', 'Fire extinguisher and first aid', NULL, FALSE, FALSE, 80),
 ('HOTO', 'CAB_CLEAN', 'Cab clean and clear', NULL, FALSE, FALSE, 90),
 ('HOTO', 'PENDING_FAULTS', 'Faults still outstanding',
  'What the outgoing operator knows and the incoming one would otherwise find out.',
  FALSE, FALSE, 100)
ON CONFLICT (kind, code, asset_type_id) DO NOTHING;

COMMENT ON COLUMN checklist_item.code IS
    'Written to operator_competency.dimension. Stable: assessments point at '
    'it, so it is not edited after the first answer is recorded against it.';
