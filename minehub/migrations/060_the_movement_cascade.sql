-- 060: category, material, source and destination — as rows, not as code.
--
-- The weighbridge operator states four things about every load, and each one
-- narrows the next: a category chooses which material types are offered, a
-- source type chooses which locations. Six categories, five source groups,
-- four destination groups, twenty-odd material types between them.
--
-- All of it is data. Written into the frontend as a literal it would be a code
-- change and a deployment every time the mine opens a dump or the COB plant
-- starts taking a new fraction — and this platform has been told once already,
-- about the manpower filters, that a list which cannot be edited without a
-- developer is the wrong shape.
--
-- So: two small tables that say how the cascade is grouped, and the existing
-- material and location tables carry the rest. A new dump yard is one row. A
-- new category is one row and its materials are a few more.
--
-- WHY GROUPS RATHER THAN REUSING location_type
-- location_type is the physical taxonomy — PIT, STOCKPILE, DUMP — and it is
-- read by other parts of the platform. The weighbridge needs a different cut:
-- which radio button a place sits behind, and whether a load can come FROM it,
-- go TO it, or both. The dumps are the clearest case: the same four places are
-- offered as "Dump Yard" when the truck is loading and "Dump" when it is
-- tipping. One set of rows, two uses, and no second copy to drift.

-- ---------------------------------------------------------------------------
-- 1. Material categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_category (
    material_category_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    sort_order  integer NOT NULL DEFAULT 100,
    status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);
DROP TRIGGER IF EXISTS material_category_touch ON material_category;
CREATE TRIGGER material_category_touch BEFORE UPDATE ON material_category
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE material ADD COLUMN IF NOT EXISTS material_category_id bigint
    REFERENCES material_category (material_category_id);
ALTER TABLE material ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;
CREATE INDEX IF NOT EXISTS ix_material_category ON material (material_category_id);

INSERT INTO material_category (code, name, sort_order, created_by) VALUES
    ('ORE',        'Ore',        10, 'MIGRATION 060'),
    ('OVERBURDEN', 'Overburden', 20, 'MIGRATION 060'),
    ('COB',        'COB',        30, 'MIGRATION 060'),
    ('SILT',       'Silt',       40, 'MIGRATION 060'),
    ('REHANDLING', 'Rehandling', 50, 'MIGRATION 060'),
    ('MISC',       'MISC',       60, 'MIGRATION 060')
ON CONFLICT (code) DO NOTHING;

-- The material types under each. Codes are prefixed because the names are not
-- unique across categories — LG is both an ore grade and a COB fraction, OB is
-- both overburden and a silt type, and Tailing appears three times. The code
-- keeps them apart; the name is what anybody sees.
INSERT INTO material (code, name, material_class, uom, is_saleable,
                      material_category_id, sort_order, created_by)
SELECT v.code, v.name, v.cls, 'MT', v.saleable,
       (SELECT material_category_id FROM material_category WHERE code = v.cat),
       v.ord, 'MIGRATION 060'
  FROM (VALUES
    -- Ore
    ('ORE-LG',          'LG',            'LG',          TRUE,  'ORE',        10),
    ('ORE-MG',          'MG',            'MG',          TRUE,  'ORE',        20),
    ('ORE-HG',          'HG',            'HG',          TRUE,  'ORE',        30),
    -- Overburden
    ('OVERBURDEN',      'OB',            'OB',          FALSE, 'OVERBURDEN', 10),
    -- COB
    ('COB-LG',          'LG',            'LG',          TRUE,  'COB',        10),
    ('COB-INTERBURDEN', 'Interburden',   'WASTE',       FALSE, 'COB',        20),
    ('COB-TAILING',     'COB Tailing',   'TAILING',     FALSE, 'COB',        30),
    -- Silt
    ('SILT-OB',         'OB',            'OB',          FALSE, 'SILT',       10),
    ('SILT-ORE',        'ORE',           'ORE',         TRUE,  'SILT',       20),
    ('SILT-TAILING',    'Tailing',       'TAILING',     FALSE, 'SILT',       30),
    -- Rehandling
    ('REHANDLING',      'Rehandling',    'OTHER',       FALSE, 'REHANDLING', 10),
    -- MISC
    ('MISC-EXPLOSIVE',  'Explosive',     'OTHER',       FALSE, 'MISC',       10),
    ('MISC-HSD',        'HSD',           'OTHER',       FALSE, 'MISC',       20),
    ('MISC-WATER',      'Water',         'OTHER',       FALSE, 'MISC',       30),
    ('MISC-SLURRY',     'Slurry',        'OTHER',       FALSE, 'MISC',       40),
    ('MISC-OTHERS',     'Others',        'OTHER',       FALSE, 'MISC',       50)
  ) AS v(code, name, cls, saleable, cat, ord)
ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        material_class = EXCLUDED.material_class,
        material_category_id = EXCLUDED.material_category_id,
        sort_order = EXCLUDED.sort_order,
        status = 'ACTIVE';

-- Two materials seeded in 056 from the IBM price work are not on the mine's
-- weighbridge list. They are deactivated rather than deleted — nothing points
-- at them yet, but a figure that vanishes is worse than one marked closed, and
-- either can be brought back from the customisation screen.
UPDATE material SET status = 'INACTIVE'
 WHERE code IN ('CONCENTRATE', 'MINERAL-REJ')
   AND material_category_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Movement groups — the radio buttons
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movement_group (
    movement_group_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    -- Whether a load can come from here, go to here, or both. The dumps are
    -- both, which is the whole reason this is a flag and not two tables.
    is_source      boolean NOT NULL DEFAULT false,
    is_destination boolean NOT NULL DEFAULT false,
    -- A group with one place behind it is offered as the radio button itself,
    -- with no second dropdown — "COB" and "Outside" need no sub-choice, and
    -- making the operator pick "COB" twice is how a form gets hated.
    sort_order  integer NOT NULL DEFAULT 100,
    status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,
    CONSTRAINT movement_group_is_used_somewhere CHECK (is_source OR is_destination)
);
DROP TRIGGER IF EXISTS movement_group_touch ON movement_group;
CREATE TRIGGER movement_group_touch BEFORE UPDATE ON movement_group
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE location ADD COLUMN IF NOT EXISTS movement_group_id bigint
    REFERENCES movement_group (movement_group_id);
ALTER TABLE location ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;
CREATE INDEX IF NOT EXISTS ix_location_movement_group ON location (movement_group_id);

INSERT INTO movement_group (code, name, is_source, is_destination, sort_order, created_by) VALUES
    ('PIT',       'PIT',                  TRUE,  FALSE, 10, 'MIGRATION 060'),
    ('MRL',       'MRL',                  TRUE,  FALSE, 20, 'MIGRATION 060'),
    ('DUMP',      'Dump Yard',            TRUE,  TRUE,  30, 'MIGRATION 060'),
    ('ORE_PLOT',  'Ore Plot / Stack Yard', FALSE, TRUE,  40, 'MIGRATION 060'),
    ('COB',       'COB',                  FALSE, TRUE,  50, 'MIGRATION 060'),
    ('OUTSIDE',   'Outside',              FALSE, TRUE,  60, 'MIGRATION 060')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The places behind each group
-- ---------------------------------------------------------------------------
-- The five pit sides already exist from 056 and keep their ids; the rest are
-- added. Names are the mine's own, from the dropdowns on the existing screen.
INSERT INTO location (code, name, location_type, parent_id, sort_order, created_by)
SELECT v.code, v.name, v.ltype,
       (SELECT location_id FROM location WHERE code = 'KALIAPANI'), v.ord, 'MIGRATION 060'
  FROM (VALUES
    ('MRL-SOUTH',   'South',        'STOCKPILE', 10),
    ('MRL-EAST',    'East',         'STOCKPILE', 20),
    ('MRL-WEST',    'West',         'STOCKPILE', 30),
    ('MRL-NORTH',   'North',        'STOCKPILE', 40),
    ('MRL-BOTTOM',  'Bottom',       'STOCKPILE', 50),
    ('DUMP-1',      'Dump Yard 1',  'DUMP',      10),
    ('DUMP-2',      'Dump Yard 2',  'DUMP',      20),
    ('DUMP-3',      'Dump Yard 3',  'DUMP',      30),
    ('DUMP-TAILING','Tailing',      'DUMP',      40)
  ) AS v(code, name, ltype, ord)
ON CONFLICT (code) DO NOTHING;

-- Pit sides get their short names back: the group already says "PIT", so
-- "Pit — North" inside a PIT dropdown reads as a stutter.
UPDATE location SET name = CASE code
        WHEN 'PIT-SOUTH'  THEN 'South'  WHEN 'PIT-EAST' THEN 'East'
        WHEN 'PIT-WEST'   THEN 'West'   WHEN 'PIT-NORTH' THEN 'North'
        WHEN 'PIT-BOTTOM' THEN 'Bottom' ELSE name END,
       sort_order = CASE code
        WHEN 'PIT-SOUTH' THEN 10 WHEN 'PIT-EAST' THEN 20 WHEN 'PIT-WEST' THEN 30
        WHEN 'PIT-NORTH' THEN 40 WHEN 'PIT-BOTTOM' THEN 50 ELSE sort_order END
 WHERE code LIKE 'PIT-%';

UPDATE location SET name = 'Ore Plot / Stack Yard' WHERE code = 'STACK-YARD';
UPDATE location SET name = 'Outside' WHERE code = 'OUTSIDE';

-- Put each place behind its radio button.
UPDATE location SET movement_group_id = (SELECT movement_group_id FROM movement_group WHERE code = 'PIT')
 WHERE code IN ('PIT-SOUTH','PIT-EAST','PIT-WEST','PIT-NORTH','PIT-BOTTOM');
UPDATE location SET movement_group_id = (SELECT movement_group_id FROM movement_group WHERE code = 'MRL')
 WHERE code IN ('MRL-SOUTH','MRL-EAST','MRL-WEST','MRL-NORTH','MRL-BOTTOM');
UPDATE location SET movement_group_id = (SELECT movement_group_id FROM movement_group WHERE code = 'DUMP')
 WHERE code IN ('DUMP-1','DUMP-2','DUMP-3','DUMP-TAILING');
UPDATE location SET movement_group_id = (SELECT movement_group_id FROM movement_group WHERE code = 'ORE_PLOT')
 WHERE code = 'STACK-YARD';
UPDATE location SET movement_group_id = (SELECT movement_group_id FROM movement_group WHERE code = 'COB')
 WHERE code = 'COB';
UPDATE location SET movement_group_id = (SELECT movement_group_id FROM movement_group WHERE code = 'OUTSIDE')
 WHERE code = 'OUTSIDE';

-- The bare MRL and Dump Yard rows become the parents of their sides rather
-- than choices in their own right: "MRL" is not a place a load comes from,
-- one of its five faces is.
UPDATE location SET parent_id = (SELECT location_id FROM location WHERE code = 'MRL')
 WHERE code LIKE 'MRL-%';
UPDATE location SET parent_id = (SELECT location_id FROM location WHERE code = 'DUMP-YARD')
 WHERE code LIKE 'DUMP-%' AND code <> 'DUMP-YARD';

-- ROM Pad keeps its row and stays out of the cascade: it is not on the list
-- the mine gave, and inventing a destination nobody asked for is how a
-- dropdown stops being trusted. Add it from Customise if it is needed.

-- ---------------------------------------------------------------------------
-- 4. Who may change the lists
-- ---------------------------------------------------------------------------
-- Separate from running the bridge. Adding a dump yard or a material type
-- changes what every operator records from then on and what every report adds
-- up, so it is a decision rather than a day's work.
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
  ('wb.masters', 'Weighbridge', 'Change the weighbridge lists',
   'Add or retire material categories, material types, and the sources and '
   'destinations offered at the bridge. Changes what every operator can record '
   'from then on, so it is held separately from weighing.', TRUE, 376)
ON CONFLICT (code) DO NOTHING;
