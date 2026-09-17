-- 020: national skills, assessment history, and somewhere to put the paper.
--
-- THREE THINGS.
--
-- 1. SKILLS. The Skill Council for Mining Sector publishes a list of
--    qualification packs — Dumper/Tipper Operator is MIN/Q1402 at NSQF level 3,
--    Excavator Operator is MIN/IES/Q0103 at level 4. These are the country's
--    names for what a person can do, and using them means the register can be
--    compared with training records, NCVET certificates and anyone else's
--    numbers. Typing our own names for the same jobs would throw that away, so
--    the list is seeded and the mine picks from it.
--
-- 2. ASSESSMENT HISTORY. operator_competency held one row per person per class
--    per dimension and overwrote it on each assessment — so the moment someone
--    was reassessed, the previous result vanished. Assessments are periodic and
--    the whole point is to watch the trend: whether a level went up after
--    training, or quietly down. Each assessment is now appended as an
--    operator_record of type ASSESSMENT, and operator_competency keeps only the
--    current standing. The history is queryable, the current level is cheap to
--    read, and neither is derived from the other by guesswork.
--
-- 3. DOCUMENTS. operator_record.document_ref held a string nobody could open.
--    Files now land in a store on the server with their metadata recorded, so a
--    licence can be looked at rather than taken on trust.

-- ───────────────────────────────────────── the national qualification packs

CREATE TABLE IF NOT EXISTS skill (
    skill_id    bigserial PRIMARY KEY,
    code        text NOT NULL UNIQUE,     -- MIN/Q1402
    name        text NOT NULL,            -- Dumper/Tipper Operator
    nsqf_level  numeric(3, 1),            -- 3, 4, 5.5
    source      text NOT NULL DEFAULT 'SCMS',
    category    text,                     -- OPERATOR / MAINTENANCE / SUPERVISORY / SUPPORT
    -- The equipment class this qualification is about, where there is one. Left
    -- null for supervisory and support roles, which are not about a machine.
    asset_type_id bigint REFERENCES asset_type (asset_type_id),
    status      text NOT NULL DEFAULT 'ACTIVE',
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

INSERT INTO skill (code, name, nsqf_level, category) VALUES
    ('MIN/Q1805', 'Mining Supervisor (Mineral Sands)', 5.5, 'SUPERVISORY'),
    ('MIN/Q1207', 'Mine Foreman / Overman', 5.5, 'SUPERVISORY'),
    ('MIN/Q1204', 'Mining Mate / Sirdar', 5, 'SUPERVISORY'),
    ('MIN/Q3104', 'Electrician (Mineral Sands)', 4.5, 'MAINTENANCE'),
    ('MIN/Q3302', 'Instrumentation Technician (Mineral Sands)', 4.5, 'MAINTENANCE'),
    ('MIN/Q3202', 'Heavy Earth Moving Machinery (HEMM) Mechanic', 4, 'MAINTENANCE'),
    ('MIN/Q1103', 'Assistant Mine Surveyor', 4, 'SUPPORT'),
    ('MIN/Q3101', 'Mine Electrician', 4, 'MAINTENANCE'),
    ('MIN/Q3201', 'Mine Welder', 4, 'MAINTENANCE'),
    ('MIN/Q4101', 'Mineral Processing Operator', 4, 'OPERATOR'),
    ('MIN/Q3102', 'HEMM Electrician', 4, 'MAINTENANCE'),
    ('MIN/Q1803', 'Dredge and Ore Processing Operator', 4, 'OPERATOR'),
    ('MIN/Q1804', 'Mineral Processing Technician', 4, 'MAINTENANCE'),
    ('MIN/Q1806', 'Rare Earths Extraction Plant Operator', 4, 'OPERATOR'),
    ('MIN/Q1401', 'Bulldozer Operator', 3, 'OPERATOR'),
    ('MIN/Q1402', 'Dumper / Tipper Operator', 3, 'OPERATOR'),
    ('MIN/Q1202', 'Jack Hammer Operator', 3, 'OPERATOR'),
    ('MIN/Q1403', 'Loader Operator (Mining)', 3, 'OPERATOR'),
    ('MIN/Q3203', 'Mine Mechanic / Fitter', 3, 'MAINTENANCE'),
    ('MIN/N1701', 'Mining Rescuer', 3, 'SUPPORT'),
    ('MIN/Q1605', 'Coal Bed Methane (CBM) Extraction Operator', 3, 'OPERATOR'),
    ('MIN/Q1405', 'Grader Machine Operator', 3, 'OPERATOR'),
    ('MIN/Q3211', 'Mechanic-Fitter (Mineral Sands)', 3, 'MAINTENANCE'),
    ('MIN/Q1506', 'Low Profile Dump Truck (LPDT) Operator', 3, 'OPERATOR'),
    ('MIN/Q3207', 'Slurry Pump Operator (Mines)', 3, 'OPERATOR'),
    ('MIN/Q1206', 'Drill Operator (DTH / Long Hole)', 3, 'OPERATOR'),
    ('MIN/Q1101', 'Helper — Open Cast Mines', 2, 'SUPPORT'),
    ('MIN/Q1102', 'Helper — Underground Mines', 2, 'SUPPORT'),
    ('MIN/Q1408', 'Shovel Operator', 4, 'OPERATOR'),
    ('MIN/Q1603', 'Longwall Operator', 5, 'OPERATOR'),
    ('MIN/Q1703', 'Reclamation Supervisor', 5, 'SUPERVISORY'),
    ('MIN/Q1501', 'Bellman cum Banksman', 4, 'SUPPORT'),
    ('MIN/Q3204', 'Compressor Operator', 4, 'OPERATOR'),
    ('MIN/Q1301', 'Driver — Special Utility Vehicle', 4, 'OPERATOR'),
    ('MIN/Q1702', 'Gas Detector', 4, 'SUPPORT'),
    ('MIN/Q1505', 'Haulage Operator', 4, 'OPERATOR'),
    ('MIN/Q1203', 'Jumbo Drill Operator', 4, 'OPERATOR'),
    ('MIN/Q1504', 'Loader Operator — Underground', 4, 'OPERATOR'),
    ('MIN/Q3301', 'Mechatronics Incharge', 4, 'MAINTENANCE'),
    ('MIN/Q0601', 'Mine Driller (Exploration)', 4, 'OPERATOR'),
    ('MIN/Q3206', 'Mine Machinist', 4, 'MAINTENANCE'),
    ('MIN/Q1601', 'Mine Roof Bolter', 4, 'OPERATOR'),
    ('MIN/Q1302', 'Mine Shotfirer / Blaster', 4, 'OPERATOR'),
    ('MIN/Q3205', 'Pump Operator — Mining', 4, 'OPERATOR'),
    ('MIN/Q1205', 'Rig-Mounted Drill Operator', 4, 'OPERATOR'),
    ('MIN/Q1604', 'Roof Support Personnel', 4, 'SUPPORT'),
    ('MIN/Q1704', 'Strata Monitoring Personnel', 4, 'SUPPORT'),
    ('MIN/Q1404', 'Surface Miner Operator', 4, 'OPERATOR'),
    ('MIN/Q1502', 'Track Layer Personnel', 4, 'SUPPORT'),
    ('MIN/Q1602', 'Ventilation Checker cum Fan Operator', 4, 'SUPPORT'),
    ('MIN/Q1503', 'Winding Operator', 4, 'OPERATOR'),
    ('MIN/Q1303', 'Explosives Handler', 3, 'SUPPORT'),
    ('MIN/Q0501', 'Mine Sampler', 3, 'SUPPORT'),
    ('MIN/Q1201', 'Wire Saw Operator', 3, 'OPERATOR'),
    ('MIN/Q0502', 'Kamgar (Mining)', 1, 'SUPPORT'),
    ('MIN/IES/Q0101', 'Backhoe Loader Operator', 4, 'OPERATOR'),
    ('MIN/IES/Q0103', 'Excavator Operator', 4, 'OPERATOR'),
    ('MIN/IES/Q0108', 'Hydra Crane Operator', 4, 'OPERATOR'),
    ('MIN/IES/Q0110', 'Crawler Crane Operator', 4, 'OPERATOR'),
    ('MIN/ISC/Q0904', 'Belt Conveyor Mechanic', 3, 'MAINTENANCE')
ON CONFLICT (code) DO NOTHING;

-- Where a qualification obviously names an equipment class the mine already
-- keeps, they are tied together, so "who can run an excavator" and "who holds
-- MIN/IES/Q0103" are the same question asked twice.
UPDATE skill s SET asset_type_id = t.asset_type_id
FROM asset_type t
WHERE s.asset_type_id IS NULL
  AND (
       (s.code = 'MIN/IES/Q0103' AND t.name ILIKE '%excavat%')
    OR (s.code = 'MIN/Q1402'     AND (t.name ILIKE '%tipper%' OR t.name ILIKE '%dumper%'))
    OR (s.code = 'MIN/Q1401'     AND (t.name ILIKE '%dozer%'))
    OR (s.code = 'MIN/Q1403'     AND t.name ILIKE '%loader%')
    OR (s.code = 'MIN/Q1405'     AND t.name ILIKE '%grader%')
    OR (s.code = 'MIN/Q1206'     AND t.name ILIKE '%drill%')
  );

-- ───────────────────────────────────────────────── documents that can be read

CREATE TABLE IF NOT EXISTS operator_document (
    operator_document_id bigserial PRIMARY KEY,
    operator_id     bigint NOT NULL REFERENCES operator (operator_id) ON DELETE CASCADE,
    -- Optional: a file can belong to a licence row, or stand on its own as a
    -- photograph or a scanned form with no record behind it yet.
    operator_record_id bigint REFERENCES operator_record (operator_record_id) ON DELETE SET NULL,
    kind            text,                  -- PHOTO / LICENCE / MEDICAL / CERTIFICATE / OTHER
    file_name       text NOT NULL,         -- what the person called it
    stored_name     text NOT NULL,         -- what it is called on disk, which is not the same
    content_type    text,
    size_bytes      bigint,
    uploaded_by     text,
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    status          text NOT NULL DEFAULT 'ACTIVE'
);

CREATE INDEX IF NOT EXISTS operator_document_idx ON operator_document (operator_id, kind);

-- ───────────────────────────────────────── the current level, and its history

-- The unique constraint stays: operator_competency is the current standing, one
-- row per person per class per dimension. What changes is that the assessment
-- that produced it is also written to operator_record, where nothing is
-- overwritten — so a level that went up after training, or quietly down, can be
-- seen rather than inferred.
ALTER TABLE operator_competency ADD COLUMN IF NOT EXISTS assessment_count int NOT NULL DEFAULT 1;
ALTER TABLE operator_competency ADD COLUMN IF NOT EXISTS previous_level int;
ALTER TABLE operator_competency ADD COLUMN IF NOT EXISTS next_assessment_due date;

-- ─────────────────────────────────────────────────── languages worth asking

-- Three languages cover the mine: instructions, toolbox talks and the SOP are
-- given in them. A fourth is anything the person actually speaks, typed in.
INSERT INTO lookup (category, value, created_by) VALUES
    ('LANGUAGE', 'Hindi',   'migration'),
    ('LANGUAGE', 'Odia',    'migration'),
    ('LANGUAGE', 'English', 'migration')
ON CONFLICT DO NOTHING;
