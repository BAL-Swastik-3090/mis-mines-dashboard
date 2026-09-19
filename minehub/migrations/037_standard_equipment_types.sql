-- 037: one standard vocabulary for what a machine is.
--
-- The type list grew from whatever the import happened to find, and it shows.
-- It holds CAT and JCB, which are manufacturers rather than kinds of machine;
-- "Man (Tipper)", which is a manufacturer glued to a kind; Chain, which nobody
-- could define; and no word at all for a pickup, an ambulance or a staff bus,
-- so thirty-three machines sit on the register as nothing.
--
-- A type that names the maker cannot answer the questions a type exists for.
-- "How many excavators do we run" should not depend on whether this one is a
-- Tata Hitachi or a CAT, and "what can this operator run" should not make a
-- CAT backhoe a different competency from a JCB backhoe when they are the same
-- machine to the person in the seat.
--
-- So the vocabulary is set here deliberately, covering everything the mine
-- actually owns rather than everything the spreadsheets happened to name:
--
--   EXCAVATION   Excavator, Backhoe Loader, Wheel Loader
--   HAULAGE      Tipper, Dumper, Trailer
--   DOZING       Dozer
--   DRILLING     Drill
--   GRADING      Grader, Compactor
--   LIFTING      Crane, Telehandler
--   WATER        Water Tanker, Mist Cannon
--   SUPPORT      Diesel Bowser, Maintenance Van, Pickup, Forklift
--   LMV          SUV, MUV, Car, Bus, Ambulance, Motorcycle
--
-- It is a starting vocabulary, not a closed one — the field that uses it is
-- still search-or-add, because a mine that buys something nobody listed should
-- not have to wait for a migration.

-- ── the makers that were pretending to be kinds ──────────────────────────────
-- Renamed rather than replaced, so every machine already pointing at them
-- follows along and no competency assessment is orphaned. A rename keeps the
-- asset_type_id, which is what every operator_competency row refers to.
UPDATE asset_type SET name = 'Backhoe Loader', code = 'BACKHOE_LOADER',
       category = 'EXCAVATION' WHERE name = 'JCB';
UPDATE asset_type SET name = 'Tipper', code = 'TIPPER', category = 'HAULAGE'
 WHERE name = 'Man (Tipper)';
UPDATE asset_type SET name = 'Wheel Loader', code = 'WHEEL_LOADER',
       category = 'EXCAVATION' WHERE name = 'Loader';
UPDATE asset_type SET name = 'Compactor', code = 'COMPACTOR', category = 'GRADING'
 WHERE name = 'Soil Compactor (Roller)';
UPDATE asset_type SET name = 'Mist Cannon', code = 'MIST_CANNON', category = 'WATER'
 WHERE name = 'Mist Cannon (Sprinkler)';
-- These two were about to collapse into one another, and they are not the same
-- machine: a sprinkler carries water onto the haul road, a tanker carries
-- diesel to the face. Merging them would have made "how much water did we put
-- down" unanswerable.
UPDATE asset_type SET name = 'Water Tanker', code = 'WATER_TANKER', category = 'WATER'
 WHERE name = 'Water Sprinkler';
UPDATE asset_type SET name = 'Diesel Bowser', code = 'DIESEL_BOWSER', category = 'SUPPORT'
 WHERE name = 'Tanker';
UPDATE asset_type SET name = 'Crane', code = 'CRANE', category = 'LIFTING'
 WHERE name = 'Hydra';

-- The two that named nothing and are used by nothing.
DELETE FROM asset_type
 WHERE name IN ('CAT', 'Chain')
   AND NOT EXISTS (SELECT 1 FROM asset a WHERE a.asset_type_id = asset_type.asset_type_id);

-- ── the standard list ────────────────────────────────────────────────────────
-- code is what other systems and every import will match on, so it is derived
-- from the name rather than typed twice and allowed to drift out of step.
INSERT INTO asset_type (code, name, category, created_by)
SELECT upper(replace(v.name, ' ', '_')), v.name, v.category, 'migration'
FROM (VALUES
    ('Excavator',        'EXCAVATION'),
    ('Backhoe Loader',   'EXCAVATION'),
    ('Wheel Loader',     'EXCAVATION'),
    ('Tipper',           'HAULAGE'),
    ('Dumper',           'HAULAGE'),
    ('Trailer',          'HAULAGE'),
    ('Dozer',            'DOZING'),
    ('Drill',            'DRILLING'),
    ('Grader',           'GRADING'),
    ('Compactor',        'GRADING'),
    ('Crane',            'LIFTING'),
    ('Telehandler',      'LIFTING'),
    ('Water Tanker',     'WATER'),
    ('Mist Cannon',      'WATER'),
    ('Diesel Bowser',    'SUPPORT'),
    ('Maintenance Van',  'SUPPORT'),
    ('Pickup',           'SUPPORT'),
    ('Forklift',         'SUPPORT'),
    ('SUV',              'LMV'),
    ('MUV',              'LMV'),
    ('Car',              'LMV'),
    ('Bus',              'LMV'),
    ('Ambulance',        'LMV'),
    ('Motorcycle',       'LMV')
) AS v(name, category)
WHERE NOT EXISTS (SELECT 1 FROM asset_type t
                   WHERE lower(t.name) = lower(v.name)
                      OR t.code = upper(replace(v.name, ' ', '_')));

-- Anything left over from before keeps working but is put in a sensible
-- category rather than OTHER, so the register colours by something meaningful.
UPDATE asset_type SET category = 'SUPPORT'
 WHERE category = 'OTHER' OR category IS NULL;
