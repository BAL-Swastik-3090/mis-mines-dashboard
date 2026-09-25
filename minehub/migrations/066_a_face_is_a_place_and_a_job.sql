-- 066: a face is a real place, doing a named job, moving a known material.
--
-- face_plan held location and material as free text, and free text is how one
-- place becomes two. "Ore" and "ore" are already two answers to the same
-- question, and nothing stopped "North East" and "North-East" joining them.
--
-- THE REGISTER ALREADY KNOWS THESE THINGS. There are 21 locations and 18
-- materials, with codes, types and a status, used by the gate, the weighbridge
-- and the movement ledger. A planning screen inventing its own names beside
-- them means the plan can never be compared with what actually moved.
--
-- WHAT WAS ACTUALLY WRONG WITH "MATERIAL"
--
-- The column was doing two jobs. Its values are:
--
--     Ore                                   a material
--     OB                                    a material
--     Bund preparation / Rehandling / Silt  a job
--     Dump handling                         a job
--     Stack / LG for COB feeding            a job
--     Ore / OB                              two materials
--
-- Three of the six are not materials at all; they are what the machine is
-- doing. And the distinction matters twice over: capacity depends on the
-- material, because ore and overburden do not weigh or swell the same, while
-- the plan and the morning report are written by activity — so much ore, so
-- much OB, so much rehandling. Held as one column, neither question can be
-- answered without somebody reading the words and deciding.
--
-- So the two are separated. An activity is required — a machine is always
-- doing something. A material is not: bund preparation moves material nobody
-- books.


-- ---------------------------------------------------------------------------
-- 1. The jobs a machine can be put on
-- ---------------------------------------------------------------------------
--
-- `reports_as` is the whole reason this table exists rather than a text field
-- with a list in the UI. The morning report wants ore in tonnes and everything
-- else in cubic metres, and which bucket a job falls into is a property of the
-- job, not something to be re-derived by matching on its name each time.

CREATE TABLE IF NOT EXISTS face_activity (
    face_activity_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    label       text NOT NULL,

    reports_as  text NOT NULL DEFAULT 'OTHER'
        CHECK (reports_as IN ('ORE', 'OB', 'REHANDLING', 'OTHER')),

    -- Whether a material has to be named alongside. Digging ore obviously has
    -- one; preparing a bund moves whatever is in the way.
    needs_material boolean NOT NULL DEFAULT false,

    is_active   boolean NOT NULL DEFAULT true,
    sort_order  int NOT NULL DEFAULT 100,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

-- Case-insensitive, so "Ore" cannot be added a second time as "ore". The
-- masters this joins are keyed on code and their names are deliberately not
-- unique — material holds two rows called "LG", one from the pit and one from
-- the COB plant — but an activity is a short closed list and a second "Ore"
-- in it is always a mistake.
CREATE UNIQUE INDEX IF NOT EXISTS uq_face_activity_label
    ON face_activity (lower(btrim(label)));

INSERT INTO face_activity (code, label, reports_as, needs_material, sort_order, created_by)
SELECT * FROM (VALUES
    ('ORE',          'Ore',                     'ORE',        true,  10, 'migration 066'),
    ('OB',           'OB',                      'OB',         true,  20, 'migration 066'),
    ('ORE_OB',       'Ore and OB',              'ORE',        true,  30, 'migration 066'),
    ('REHANDLING',   'Rehandling / Silt',       'REHANDLING', false, 40, 'migration 066'),
    ('BUND_PREP',    'Bund preparation',        'OTHER',      false, 50, 'migration 066'),
    ('DUMP_HANDLING','Dump handling',           'REHANDLING', false, 60, 'migration 066'),
    ('STACK_FEED',   'Stack / LG for COB feeding','REHANDLING',true, 70, 'migration 066'),
    ('VENDOR',       'Vendor work',             'OTHER',      false, 80, 'migration 066')
) AS v(code, label, reports_as, needs_material, sort_order, created_by)
 WHERE NOT EXISTS (SELECT 1 FROM face_activity);


-- ---------------------------------------------------------------------------
-- 2. The faces the plan works that the location master did not hold
-- ---------------------------------------------------------------------------
--
-- The master has the compass pits — North, South, East, West, Bottom — and
-- the plan works compound faces the mine names differently. They are real
-- places and they belong in the master, not in a second list beside it.
--
-- Parented to the site and typed as the master types them, so they behave like
-- every other location for the gate and the movement ledger.

INSERT INTO location (code, name, location_type, parent_id, status, created_by, sort_order)
SELECT v.code, v.name, v.location_type,
       (SELECT location_id FROM location WHERE code = 'KALIAPANI'),
       'ACTIVE', 'migration 066', v.sort_order
  FROM (VALUES
    ('PIT-NORTH-WEST', 'North West',                 'PIT',        35),
    ('PIT-SOUTH-WEST', 'South West',                 'PIT',        15),
    ('PIT-NORTH-EAST', 'North East',                 'PIT',        45),
    ('PIT-SOUTH-EAST', 'South East',                 'PIT',         5),
    ('DUMP-WORKING',   'Dump',                       'DUMP',       90),
    ('STACK-LG-ETP',   'Stack Yard / LG Dump / ETP', 'STOCKYARD',  95)
  ) AS v(code, name, location_type, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM location l WHERE l.code = v.code);

-- One name per place, WITHIN A PARENT AND A TYPE.
--
-- Not one name in the whole master: it holds "North" twice on purpose —
-- PIT-NORTH is the north pit and MRL-NORTH is the north stockpile — and five
-- more pairs like it. The name is short because the type carries the rest of
-- the meaning, and a rule that called those duplicates would be wrong about
-- the mine.
--
-- Two north PITS, though, are a mistake, and that is the way a planning screen
-- quietly splits a face in two.
CREATE UNIQUE INDEX IF NOT EXISTS uq_location_name_in_parent
    ON location (parent_id, location_type, lower(btrim(name)))
 WHERE status = 'ACTIVE';


-- ---------------------------------------------------------------------------
-- 3. face_plan points at all three
-- ---------------------------------------------------------------------------

ALTER TABLE face_plan ADD COLUMN IF NOT EXISTS location_id bigint
    REFERENCES location(location_id);
ALTER TABLE face_plan ADD COLUMN IF NOT EXISTS face_activity_id bigint
    REFERENCES face_activity(face_activity_id);
ALTER TABLE face_plan ADD COLUMN IF NOT EXISTS material_id bigint
    REFERENCES material(material_id);

-- Backfill from what was typed, matched case-insensitively on the name —
-- which is the whole point: "Pit Bottom" and "Bottom" were the same face
-- written twice, and this is where they stop being two.
--
-- Restricted to pits, dumps and stockyards, and to one match. Without that,
-- "North" joins to both the north pit and the north MRL stockpile and takes
-- whichever the planner returns first. This is an excavation plan, so the
-- working places are what it means; the type is how that gets said rather
-- than left to chance.
UPDATE face_plan fp
   SET location_id = (
        SELECT l.location_id FROM location l
         WHERE lower(btrim(l.name)) = lower(btrim(fp.location))
           AND l.status = 'ACTIVE'
         ORDER BY CASE l.location_type
                    WHEN 'PIT' THEN 1 WHEN 'DUMP' THEN 2
                    WHEN 'STOCKYARD' THEN 3 WHEN 'STOCKPILE' THEN 4 ELSE 5 END,
                  l.location_id
         LIMIT 1)
 WHERE fp.location_id IS NULL
   AND EXISTS (SELECT 1 FROM location l
                WHERE lower(btrim(l.name)) = lower(btrim(fp.location))
                  AND l.status = 'ACTIVE');

-- The two the plan wrote its own way.
UPDATE face_plan SET location_id = (SELECT location_id FROM location WHERE code = 'PIT-BOTTOM')
 WHERE location_id IS NULL AND lower(btrim(location)) = 'pit bottom';

UPDATE face_plan fp
   SET face_activity_id = a.face_activity_id
  FROM face_activity a
 WHERE fp.face_activity_id IS NULL
   AND lower(btrim(a.label)) = lower(btrim(fp.material));

-- The seeded rows carry the workbook's own wording, which predates the list
-- above; mapped by hand once rather than by a LIKE that would go on guessing.
UPDATE face_plan SET face_activity_id =
        (SELECT face_activity_id FROM face_activity WHERE code = 'REHANDLING')
 WHERE face_activity_id IS NULL
   AND lower(btrim(material)) LIKE '%rehandling%';
UPDATE face_plan SET face_activity_id =
        (SELECT face_activity_id FROM face_activity WHERE code = 'ORE_OB')
 WHERE face_activity_id IS NULL AND lower(btrim(material)) = 'ore / ob';
UPDATE face_plan SET face_activity_id =
        (SELECT face_activity_id FROM face_activity WHERE code = 'STACK_FEED')
 WHERE face_activity_id IS NULL AND lower(btrim(material)) LIKE 'stack%';

-- Anything still unmatched becomes vendor work rather than being dropped: a
-- row that disappears in a migration is worse than one that lands in a bucket
-- somebody can see and correct.
UPDATE face_plan SET face_activity_id =
        (SELECT face_activity_id FROM face_activity WHERE code = 'VENDOR')
 WHERE face_activity_id IS NULL;

UPDATE face_plan SET location_id =
        (SELECT location_id FROM location WHERE code = 'KALIAPANI')
 WHERE location_id IS NULL;

ALTER TABLE face_plan ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE face_plan ALTER COLUMN face_activity_id SET NOT NULL;

-- The old text columns go. They were the problem, and keeping them beside the
-- ids would leave two answers to "what is this face called" — which is how the
-- ids quietly stop being maintained.
ALTER TABLE face_plan DROP CONSTRAINT IF EXISTS uq_face_plan;
ALTER TABLE face_plan DROP COLUMN IF EXISTS location;
ALTER TABLE face_plan DROP COLUMN IF EXISTS material;

-- One machine, one place, one job, one day. A second row for the same three is
-- a correction, not a second deployment.
ALTER TABLE face_plan ADD CONSTRAINT uq_face_plan
    UNIQUE (on_date, asset_id, location_id, face_activity_id);

CREATE INDEX IF NOT EXISTS ix_face_plan_location ON face_plan (location_id);

COMMENT ON COLUMN face_plan.face_activity_id IS
    'What the machine is doing. Separate from material_id because three of the '
    'values this replaced were jobs and not materials, and because capacity '
    'depends on the material while the morning report is written by activity.';
COMMENT ON COLUMN face_plan.material_id IS
    'What is being moved, where the activity names one. Null for bund '
    'preparation and the like, which move material nobody books.';
