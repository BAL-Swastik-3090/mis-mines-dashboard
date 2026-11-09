-- 105: the HOTO checklist becomes something the admin panel can change.
--
-- WHAT WAS WRONG WITH WHAT WE HAD. `checklist_item` holds 33 flat rows with
-- `is_decisive` and `is_required`, and `hoto_template` holds one row whose
-- `items` is a JSON blob. Between them they can express a tick-box and
-- nothing else. A mine runs on gauges: air pressure between 80 and 120 psi,
-- engine oil pressure 2 to 6 bar, coolant 60 to 95 degrees. An out-of-range
-- reading is a different fact from a failed tick-box, and neither table had
-- anywhere to put it.
--
-- WHERE THIS CONTENT CAME FROM. An earlier attempt at this platform, which
-- stopped before deployment, built three sectioned templates -- Tipper/Dumper,
-- Dozer and Excavator, 54 items across 15 sections -- with response types,
-- units, engineering ranges, per-item severity and photo rules. That work was
-- sitting in `mineone.mo_checklist_items` on a DigitalOcean host whose other
-- job is an unrelated AI platform. It is recovered here verbatim. Somebody who
-- knows these machines wrote it and writing it again from nothing would have
-- been the most wasteful thing available.
--
-- ── EVERYTHING HERE IS DATA, NOT CODE ───────────────────────────────────────
-- Adding a check, changing a range, moving an item between sections, marking
-- one critical or retiring it is an edit in the admin panel. No deployment.
-- That is the whole point of the three tables below, and it is why the item
-- carries its own severity rather than the escalation engine carrying a map
-- of item codes.
--
-- ── HOW A TEMPLATE IS CHOSEN ────────────────────────────────────────────────
-- A template is scoped by asset type, and optionally narrowed to a plant and
-- a department. NULL means "any". The most specific ACTIVE template whose
-- scope matches wins:
--
--     asset type + plant + department   most specific
--     asset type + plant
--     asset type + department
--     asset type                        the base, and the usual case
--
-- So Kaliapani can run a different tipper checklist from Sukinda without a
-- second codebase, and the mine's own departments can add to the base.
-- `UNIQUE NULLS NOT DISTINCT` is what makes two NULL scopes collide rather
-- than quietly coexist.
--
-- ── A PUBLISHED TEMPLATE IS IMMUTABLE ───────────────────────────────────────
-- Templates are versioned and effective-dated, and a captured HOTO records
-- the version it was answered against. Editing an ACTIVE template in place
-- would rewrite history: a handover signed last Tuesday would start claiming
-- it answered a question nobody asked. The admin panel must therefore clone
-- to a new DRAFT, edit that, and publish -- never edit an ACTIVE row.
--
-- Items are RETIRED, never deleted, for the same reason: a response points at
-- its item, and a defect raised eight months ago has to stay readable.

-- ── the template ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hoto_checklist_template (
    template_id    bigserial PRIMARY KEY,
    asset_type_id  bigint NOT NULL REFERENCES asset_type (asset_type_id),

    -- Scope. NULL means "any". See the resolution order above.
    plant_id       bigint REFERENCES plant (plant_id),
    org_unit_id    bigint REFERENCES org_unit (org_unit_id),

    name           varchar(80) NOT NULL,
    version        integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    status         varchar(10) NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),

    -- The date this version starts applying. A capture resolves the template
    -- in force on its own production day, not the one in force today.
    effective_from date,
    notes          text,

    created_by     varchar(32),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     varchar(32),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    -- One version number per scope, counting two NULLs as the same scope.
    UNIQUE NULLS NOT DISTINCT (asset_type_id, plant_id, org_unit_id, version),

    -- Published means dated. A template with no effective_from cannot be
    -- resolved against a production day.
    CHECK (status <> 'ACTIVE' OR effective_from IS NOT NULL)
);

COMMENT ON TABLE hoto_checklist_template IS
    'A HOTO checklist, per asset type and optionally per plant and department. '
    'Versioned and effective-dated; ACTIVE rows are immutable -- clone to a '
    'DRAFT to change one. See migration 105.';

-- ── its sections ────────────────────────────────────────────────────────────
-- Sections are how the form reads on a 7-inch screen at six in the morning.
-- ENGINE, AIR & BRAKES, TYRES, BODY & TIPPING, SAFETY, FLUIDS -- an operator
-- works down them in the order he walks round the machine.
CREATE TABLE IF NOT EXISTS hoto_checklist_section (
    section_id    bigserial PRIMARY KEY,
    template_id   bigint NOT NULL
                  REFERENCES hoto_checklist_template (template_id) ON DELETE CASCADE,
    name          varchar(60) NOT NULL,
    display_order integer NOT NULL CHECK (display_order >= 1),

    UNIQUE (template_id, display_order),
    UNIQUE (template_id, name)
);

-- ── its items ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hoto_checklist_item (
    item_id       bigserial PRIMARY KEY,
    section_id    bigint NOT NULL
                  REFERENCES hoto_checklist_section (section_id) ON DELETE CASCADE,
    label         varchar(120) NOT NULL,

    -- FOUR KINDS OF ANSWER, because a mine does not only tick boxes.
    --   OK_CAUTION_NOTOK  the tri-state. CAUTION is how a mine actually talks
    --                     about a machine that runs but needs watching.
    --   NUMERIC           a gauge reading, with a unit and a plausible range.
    --   YES_NO            present or absent.
    --   LEVEL             a level, where neither a tick nor a number fits.
    response_type varchar(20) NOT NULL
                  CHECK (response_type IN ('OK_CAUTION_NOTOK', 'NUMERIC',
                                           'YES_NO', 'LEVEL')),

    unit          varchar(12),
    min_value     numeric(12,3),
    max_value     numeric(12,3),

    category      varchar(30),

    -- A failed critical item blocks the handover. Nine of the recovered 54
    -- are critical -- brakes, air pressure, steering, the things that stop a
    -- machine going to work.
    is_critical   boolean NOT NULL DEFAULT false,

    -- "Brakes not OK" is an argument. "Brakes not OK, and here is the photo"
    -- is a defect somebody can act on.
    requires_photo_if_not_ok boolean NOT NULL DEFAULT true,

    -- Feeds the escalation engine: LOW notifies, MEDIUM raises a work order,
    -- HIGH restricts the machine, CRITICAL locks it. Held on the item so the
    -- engine stays a rule reader rather than a table of codes, and so the
    -- device can reach the same verdict offline.
    default_severity varchar(10) NOT NULL
                  CHECK (default_severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),

    display_order integer NOT NULL CHECK (display_order >= 1),

    -- Retired, never deleted: a response points here, and a defect raised
    -- eight months ago has to stay readable.
    status        varchar(10) NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'RETIRED')),

    created_by    varchar(32),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    varchar(32),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (section_id, display_order),

    -- A gauge reading with no unit cannot be validated or printed.
    CHECK (response_type <> 'NUMERIC' OR unit IS NOT NULL),
    -- A range the wrong way round would silently reject every reading.
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value),
    -- Only a numeric answer has a range.
    CHECK (response_type = 'NUMERIC'
           OR (min_value IS NULL AND max_value IS NULL))
);

CREATE INDEX IF NOT EXISTS hoto_checklist_section_tpl_idx
    ON hoto_checklist_section (template_id, display_order);
CREATE INDEX IF NOT EXISTS hoto_checklist_item_sec_idx
    ON hoto_checklist_item (section_id, display_order);
CREATE INDEX IF NOT EXISTS hoto_checklist_template_scope_idx
    ON hoto_checklist_template (asset_type_id, status, effective_from DESC);

-- ── the recovered library ───────────────────────────────────────────────────
-- Three templates, fifteen sections, fifty-four items, as written by whoever
-- built the earlier attempt. Tipper/Dumper is mapped to the Tipper asset type;
-- the mine's register keeps Tipper and Dumper as separate types, and whether
-- Dumper should share this template or get its own is a question for the mine
-- rather than an assumption to bury in a migration.

-- Dozer
INSERT INTO hoto_checklist_template (asset_type_id, name, version, status, effective_from, created_by)
SELECT asset_type_id, 'Dozer handover', 1, 'ACTIVE', DATE '2026-11-09', 'migration-105'
  FROM asset_type WHERE name = 'Dozer'
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'ENGINE', 1 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Engine oil level', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Engine', FALSE, TRUE,
       'MEDIUM', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Engine oil pressure', 'NUMERIC', 'bar', 2, 6,
       'Engine', FALSE, TRUE,
       'HIGH', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Coolant / water temperature', 'NUMERIC', '°C', 60, 95,
       'Engine', FALSE, TRUE,
       'HIGH', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Abnormal sound / vibration', 'YES_NO', NULL, NULL, NULL,
       'Engine', FALSE, TRUE,
       'MEDIUM', 4
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'HYDRAULICS', 2 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Blade lift / tilt cylinder', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Hydraulic', FALSE, TRUE,
       'HIGH', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 2
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Ripper hydraulics', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Hydraulic', FALSE, TRUE,
       'MEDIUM', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 2
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Hose condition / leakage', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Hydraulic', TRUE, TRUE,
       'HIGH', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 2
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'UNDERCARRIAGE', 3 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Track tension (L/R)', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Undercarriage', FALSE, TRUE,
       'MEDIUM', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Sprocket / idler wear', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Undercarriage', FALSE, TRUE,
       'MEDIUM', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Grease points done', 'YES_NO', NULL, NULL, NULL,
       'Undercarriage', FALSE, FALSE,
       'LOW', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'SAFETY', 4 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Horn', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'LOW', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Reverse alarm', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'MEDIUM', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Fire extinguisher (charge + date)', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', TRUE, TRUE,
       'CRITICAL', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Seat belt', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'MEDIUM', 4
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'ROPS / FOPS visible damage', 'YES_NO', NULL, NULL, NULL,
       'Safety', TRUE, TRUE,
       'CRITICAL', 5
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'FLUIDS', 5 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Fuel level (start)', 'NUMERIC', '%', 0, 100,
       'Fluids', FALSE, FALSE,
       'LOW', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 5
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Hydraulic oil level', 'LEVEL', NULL, NULL, NULL,
       'Fluids', FALSE, TRUE,
       'MEDIUM', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Dozer' AND t.version = 1 AND s.display_order = 5
ON CONFLICT DO NOTHING;

-- Excavator
INSERT INTO hoto_checklist_template (asset_type_id, name, version, status, effective_from, created_by)
SELECT asset_type_id, 'Excavator handover', 1, 'ACTIVE', DATE '2026-11-09', 'migration-105'
  FROM asset_type WHERE name = 'Excavator'
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'ENGINE', 1 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Engine oil level', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Engine', FALSE, TRUE,
       'MEDIUM', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Engine oil pressure', 'NUMERIC', 'bar', 2, 6,
       'Engine', FALSE, TRUE,
       'HIGH', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Coolant / water temperature', 'NUMERIC', '°C', 60, 95,
       'Engine', FALSE, TRUE,
       'HIGH', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Abnormal sound', 'YES_NO', NULL, NULL, NULL,
       'Engine', FALSE, TRUE,
       'MEDIUM', 4
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'HYDRAULICS', 2 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Boom pressure', 'NUMERIC', 'bar', NULL, NULL,
       'Hydraulic', FALSE, TRUE,
       'HIGH', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 2
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Hydraulic leakage', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Hydraulic', TRUE, TRUE,
       'HIGH', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 2
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Hose condition', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Hydraulic', FALSE, TRUE,
       'MEDIUM', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 2
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'SAFETY', 3 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Horn', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'LOW', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Reverse alarm', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'MEDIUM', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Fire extinguisher (charge + date)', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', TRUE, TRUE,
       'CRITICAL', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Seat belt', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'MEDIUM', 4
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'FLUIDS', 4 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Fuel level (start)', 'NUMERIC', '%', 0, 100,
       'Fluids', FALSE, FALSE,
       'LOW', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Hydraulic oil level', 'LEVEL', NULL, NULL, NULL,
       'Fluids', FALSE, TRUE,
       'MEDIUM', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Excavator' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;

-- Tipper / Dumper
INSERT INTO hoto_checklist_template (asset_type_id, name, version, status, effective_from, created_by)
SELECT asset_type_id, 'Tipper / Dumper handover', 1, 'ACTIVE', DATE '2026-11-09', 'migration-105'
  FROM asset_type WHERE name = 'Tipper'
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'ENGINE', 1 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Engine oil pressure', 'NUMERIC', 'bar', 2, 6,
       'Engine', FALSE, TRUE,
       'HIGH', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Water temperature', 'NUMERIC', '°C', 60, 95,
       'Engine', FALSE, TRUE,
       'HIGH', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Exhaust smoke (excessive)', 'YES_NO', NULL, NULL, NULL,
       'Engine', FALSE, TRUE,
       'MEDIUM', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'AIR & BRAKES', 2 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Air pressure', 'NUMERIC', 'psi', 80, 120,
       'Brakes', TRUE, TRUE,
       'CRITICAL', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 2
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Service brake response', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Brakes', TRUE, TRUE,
       'CRITICAL', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 2
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Parking brake', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Brakes', FALSE, TRUE,
       'HIGH', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 2
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'TYRES', 3 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'All tyre pressures', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Tyres', FALSE, TRUE,
       'MEDIUM', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Tread depth (any below limit)', 'YES_NO', NULL, NULL, NULL,
       'Tyres', FALSE, TRUE,
       'HIGH', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Cuts / bulges visible', 'YES_NO', NULL, NULL, NULL,
       'Tyres', FALSE, TRUE,
       'HIGH', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Wheel nut torque indicators OK', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Tyres', TRUE, TRUE,
       'CRITICAL', 4
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 3
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'BODY & TIPPING', 4 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Body / dumper condition', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Body', FALSE, TRUE,
       'MEDIUM', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Tail-gate / pin & latch', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Body', FALSE, TRUE,
       'HIGH', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Body-up alarm', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Body', FALSE, TRUE,
       'MEDIUM', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Tipping hydraulic seal', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Body', FALSE, TRUE,
       'HIGH', 4
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 4
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'SAFETY', 5 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Horn', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'LOW', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 5
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Reverse alarm', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'MEDIUM', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 5
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Headlights / indicators', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'MEDIUM', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 5
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Reflective tape / chevrons', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'LOW', 4
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 5
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Fire extinguisher (charge + date)', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', TRUE, TRUE,
       'CRITICAL', 5
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 5
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Seat belt', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
       'Safety', FALSE, TRUE,
       'MEDIUM', 6
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 5
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_section (template_id, name, display_order)
SELECT t.template_id, 'FLUIDS', 6 FROM hoto_checklist_template t
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Fuel level (start)', 'NUMERIC', '%', 0, 100,
       'Fluids', FALSE, FALSE,
       'LOW', 1
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 6
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Engine oil level', 'LEVEL', NULL, NULL, NULL,
       'Fluids', FALSE, TRUE,
       'MEDIUM', 2
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 6
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Coolant level', 'LEVEL', NULL, NULL, NULL,
       'Fluids', FALSE, TRUE,
       'MEDIUM', 3
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 6
ON CONFLICT DO NOTHING;
INSERT INTO hoto_checklist_item (section_id, label, response_type, unit, min_value, max_value,
       category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
SELECT s.section_id, 'Brake fluid level', 'LEVEL', NULL, NULL, NULL,
       'Fluids', FALSE, TRUE,
       'HIGH', 4
  FROM hoto_checklist_section s JOIN hoto_checklist_template t ON t.template_id = s.template_id
  JOIN asset_type at ON at.asset_type_id = t.asset_type_id
 WHERE at.name = 'Tipper' AND t.version = 1 AND s.display_order = 6
ON CONFLICT DO NOTHING;