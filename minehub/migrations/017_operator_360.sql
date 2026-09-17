-- 017: Operator 360 — the whole profile in five tables.
--
-- The specification names seventeen. Building seventeen would mean seventeen
-- create screens, seventeen list endpoints and seventeen places to forget a
-- verification column, for one reason: they are described separately in the
-- document. But eight of them — education, language, previous experience,
-- licence, medical, training, specialised training, certificates — are the same
-- record with different words on it. Every one of them is:
--
--     a titled thing, from an issuer, with a number, between two dates,
--     possibly with a result, a document, and someone who verified it
--
-- so they are one table with a record_type, plus a jsonb column for the handful
-- of fields peculiar to each kind. Nothing in the specification is dropped; the
-- distinctions it insists on — training is not competency, certificate is not
-- authorisation, education is not literacy — are kept as record types and as
-- separate tables where they genuinely differ in shape.
--
-- Likewise competency and machine understanding are both "a level, for a person,
-- against an equipment class, with the evidence behind it", differing only in
-- which dimension is being scored. One table, one dimension column.
--
-- Actual operation history gets no table at all: it belongs in the append-only
-- partitioned `event` log that already exists for exactly this kind of
-- high-volume, source-attributed fact.
--
-- Five tables:
--   operator              the profile itself, one row per person
--   operator_record       every dated, issued, verifiable thing about them
--   operator_competency   levels, per equipment class, per dimension
--   operator_assignment   which machine, which shift, since when
--   operator_revision     what changed, who changed it, from what to what

-- ─────────────────────────────────────────────────────────── the operator

CREATE TABLE IF NOT EXISTS operator (
    operator_id     bigserial PRIMARY KEY,
    party_id        bigint NOT NULL UNIQUE REFERENCES party (party_id) ON DELETE CASCADE,
    operator_ref    text UNIQUE,                    -- OPR-2026-0001, ours to quote

    -- Employment is an attribute, not the shape of the model (rule 2 and 3).
    employment_type text,                           -- OWN / CONTRACT / TRAINEE / OTHER
    employer_party_id bigint REFERENCES party (party_id),
    org_unit_id     bigint REFERENCES org_unit (org_unit_id),
    plant_id        bigint REFERENCES plant (plant_id),
    designation     text,
    joined_on       date,
    employment_end  date,
    supervisor_party_id bigint REFERENCES party (party_id),
    shift_pattern   text,
    work_location_id bigint REFERENCES location (location_id),

    -- Personal details the party table does not carry.
    alternate_phone text,
    emergency_contact_name text,
    emergency_contact_phone text,
    emergency_contact_relation text,
    current_address text,
    permanent_address text,

    -- Education summary. The certificates behind it are operator_record rows.
    highest_qualification text,
    qualification_type    text,
    institution           text,
    year_of_passing       int,

    -- Literacy, kept apart from education on purpose (rule 4). Levels are the
    -- specification's own words, stored as text so the mine can change the
    -- vocabulary without a migration.
    reading_level        text,
    writing_level        text,
    numeracy_level       text,
    digital_level        text,
    safety_sign_level    text,
    record_keeping_level text,

    -- Experience summary, in months so arithmetic is possible. Declared is what
    -- the person says; verified is what someone checked. Both are kept, because
    -- the difference between them is itself information (rule 5).
    exp_total_months        int,
    exp_mining_months       int,
    exp_hemm_months         int,
    exp_operator_months     int,
    exp_kaliapani_months    int,
    exp_current_role_months int,
    exp_verified_months     int,
    exp_verified_by         text,
    exp_verified_on         date,

    profile_status  text NOT NULL DEFAULT 'ACTIVE',     -- ACTIVE/INACTIVE/SUSPENDED/RETIRED
    suspension_reason text,

    -- The same draft → submitted → approved life as a machine.
    approval_status text NOT NULL DEFAULT 'DRAFT'
        CHECK (approval_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'SENT_BACK')),
    version         int NOT NULL DEFAULT 1,
    submitted_by    text, submitted_at timestamptz,
    approved_by     text, approved_at  timestamptz,

    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);

CREATE INDEX IF NOT EXISTS operator_party_idx  ON operator (party_id);
CREATE INDEX IF NOT EXISTS operator_status_idx ON operator (approval_status, profile_status);

-- A submitted profile has at least a name behind it and an employment type.
ALTER TABLE operator DROP CONSTRAINT IF EXISTS operator_submitted_is_complete;
ALTER TABLE operator ADD CONSTRAINT operator_submitted_is_complete CHECK (
    approval_status IN ('DRAFT', 'SENT_BACK')
    OR (employment_type IS NOT NULL AND plant_id IS NOT NULL)
);

-- ──────────────────────────────────────── everything dated and verifiable

CREATE TABLE IF NOT EXISTS operator_record (
    operator_record_id bigserial PRIMARY KEY,
    operator_id     bigint NOT NULL REFERENCES operator (operator_id) ON DELETE CASCADE,

    -- What kind of thing this is. Left as text, not an enum: the mine's
    -- statutory list is not settled and adding a kind should not need a
    -- migration.
    --   EDUCATION, LANGUAGE, EXPERIENCE, LICENCE, MEDICAL, TRAINING,
    --   SPECIALIZED_TRAINING, CERTIFICATE, AUTHORISATION,
    --   SAFETY_INCIDENT, SAFETY_OBSERVATION, SAFETY_TRAINING, TRAINING_NEED
    record_type     text NOT NULL,
    title           text,              -- licence class, course name, language…
    category        text,              -- SAFETY / EQUIPMENT / TECHNICAL / …
    asset_type_id   bigint REFERENCES asset_type (asset_type_id),   -- if machine-specific

    document_no     text,              -- licence no, certificate no, roll no
    issuer          text,              -- RTO, institution, training provider
    issued_on       date,
    valid_from      date,
    valid_upto      date,
    refresher_due   date,

    result          text,              -- PASS / FAIL / PENDING / FIT / UNFIT
    score           numeric(6, 2),
    duration_hours  numeric(6, 2),
    restrictions    text,              -- medical fitness with conditions

    -- Verification is per record, because a licence someone has seen and a
    -- licence someone typed are not the same fact.
    verification_status text NOT NULL DEFAULT 'PENDING'
        CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    verified_by     text,
    verified_on     date,

    document_ref    text,              -- where the scan lives
    status          text NOT NULL DEFAULT 'ACTIVE',
    remarks         text,

    -- The fields peculiar to one kind: language levels, previous employer and
    -- site, machine-specific hours, grade and board. Held as jsonb so that a
    -- new kind of record does not widen the table for everyone else.
    details         jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);

CREATE INDEX IF NOT EXISTS operator_record_operator_idx ON operator_record (operator_id, record_type);
CREATE INDEX IF NOT EXISTS operator_record_expiry_idx   ON operator_record (valid_upto)
    WHERE valid_upto IS NOT NULL AND status = 'ACTIVE';

-- ───────────────────────────────────────── competency and understanding

CREATE TABLE IF NOT EXISTS operator_competency (
    operator_competency_id bigserial PRIMARY KEY,
    operator_id     bigint NOT NULL REFERENCES operator (operator_id) ON DELETE CASCADE,
    asset_type_id   bigint REFERENCES asset_type (asset_type_id),
    asset_id        bigint REFERENCES asset (asset_id),   -- when tied to one machine

    -- OVERALL is the competency level for the class. The rest are the fourteen
    -- understanding dimensions — controls, pre-start inspection, emergency
    -- shutdown and so on — scored the same way, because "has operated" and
    -- "understands" are different questions asked in the same form (rule 10).
    dimension       text NOT NULL DEFAULT 'OVERALL',

    level           int CHECK (level BETWEEN 0 AND 4),
    assessment_type text,              -- PRACTICAL / WRITTEN / OBSERVATION
    assessor        text,
    assessed_on     date,
    score           numeric(6, 2),
    result          text,              -- PASS / FAIL / PENDING
    valid_upto      date,

    -- The evidence behind the level, kept rather than reduced to a number
    -- (rule 12): training ids, machine hours, recent operation, observations.
    evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,

    status          text NOT NULL DEFAULT 'ACTIVE',
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text,

    UNIQUE (operator_id, asset_type_id, dimension)
);

CREATE INDEX IF NOT EXISTS operator_competency_idx ON operator_competency (operator_id, asset_type_id);

-- ─────────────────────────────────────────────────────────── assignment

CREATE TABLE IF NOT EXISTS operator_assignment (
    operator_assignment_id bigserial PRIMARY KEY,
    operator_id     bigint NOT NULL REFERENCES operator (operator_id) ON DELETE CASCADE,
    asset_id        bigint NOT NULL REFERENCES asset (asset_id) ON DELETE CASCADE,
    shift           text,                              -- A / B / C / GENERAL
    role            text NOT NULL DEFAULT 'PRIMARY',   -- PRIMARY/SECONDARY/RELIEVER
    valid_from      date NOT NULL DEFAULT CURRENT_DATE,
    valid_to        date,
    assigned_by     text,
    approved_by     text,
    approved_at     timestamptz,
    status          text NOT NULL DEFAULT 'ACTIVE',
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);

CREATE INDEX IF NOT EXISTS operator_assignment_idx ON operator_assignment (operator_id, status);
CREATE INDEX IF NOT EXISTS operator_assignment_asset_idx ON operator_assignment (asset_id, status);

-- ───────────────────────────────────────────────────────────── the trail

CREATE TABLE IF NOT EXISTS operator_revision (
    revision_id     bigserial PRIMARY KEY,
    operator_id     bigint NOT NULL REFERENCES operator (operator_id) ON DELETE CASCADE,
    version         int NOT NULL,
    action          text NOT NULL,        -- CREATED/UPDATED/SUBMITTED/APPROVED/SENT_BACK
    changes         jsonb,
    snapshot        jsonb,
    remarks         text,
    changed_by      text NOT NULL,
    changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_revision_idx ON operator_revision (operator_id, changed_at DESC);

-- ───────────────────────────────────────────────── the reference we issue

CREATE OR REPLACE FUNCTION next_operator_ref() RETURNS text AS $$
DECLARE
    yr text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
    n  integer;
BEGIN
    SELECT count(*) + 1 INTO n FROM operator WHERE operator_ref LIKE 'OPR-' || yr || '-%';
    RETURN 'OPR-' || yr || '-' || lpad(n::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────── the alerts

-- The same shape as asset_alert, so one screen can show machines and people
-- together ordered by what lapses first. A lapsed medical and a lapsed fitness
-- certificate are the same problem to whoever is running the shift.
CREATE OR REPLACE VIEW operator_alert AS
SELECT o.operator_id,
       o.operator_ref,
       p.display_name                                  AS operator_name,
       CASE WHEN r.record_type IN ('LICENCE', 'MEDICAL', 'CERTIFICATE', 'AUTHORISATION')
            THEN 'STATUTORY' ELSE 'TRAINING' END       AS alert_kind,
       r.record_type || COALESCE(' · ' || r.title, '') AS alert_type,
       COALESCE(r.valid_upto, r.refresher_due)         AS due_on,
       (COALESCE(r.valid_upto, r.refresher_due) - CURRENT_DATE) AS days_left,
       CASE WHEN COALESCE(r.valid_upto, r.refresher_due) < CURRENT_DATE THEN 'EXPIRED'
            WHEN COALESCE(r.valid_upto, r.refresher_due) <= CURRENT_DATE + 30 THEN 'DUE'
            ELSE 'OK' END                              AS severity
FROM operator o
JOIN party p ON p.party_id = o.party_id
JOIN operator_record r ON r.operator_id = o.operator_id
WHERE r.status = 'ACTIVE'
  AND o.profile_status = 'ACTIVE'
  AND COALESCE(r.valid_upto, r.refresher_due) IS NOT NULL

UNION ALL

-- A competency whose assessment has lapsed is a gap in the same sense.
SELECT o.operator_id, o.operator_ref, p.display_name,
       'COMPETENCY',
       'Assessment · ' || COALESCE(t.name, 'equipment'),
       c.valid_upto,
       (c.valid_upto - CURRENT_DATE),
       CASE WHEN c.valid_upto < CURRENT_DATE THEN 'EXPIRED'
            WHEN c.valid_upto <= CURRENT_DATE + 30 THEN 'DUE'
            ELSE 'OK' END
FROM operator o
JOIN party p ON p.party_id = o.party_id
JOIN operator_competency c ON c.operator_id = o.operator_id
LEFT JOIN asset_type t ON t.asset_type_id = c.asset_type_id
WHERE c.status = 'ACTIVE' AND c.valid_upto IS NOT NULL AND c.dimension = 'OVERALL';

-- ─────────────────────────────────────────── permissions and the roles

-- The trigger from 014 hands each of these to PLATFORM_OWNER as it lands.
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
  ('platform.operators.view',    'Operators', 'View operators',
   'See the operator register and profiles', FALSE, 310),
  ('platform.operators.manage',  'Operators', 'Register operators',
   'Create and edit operator profiles, records and documents', TRUE, 320),
  ('platform.operators.assess',  'Operators', 'Assess competency',
   'Record competency levels and machine understanding assessments', TRUE, 330),
  ('platform.operators.approve', 'Operators', 'Approve operators',
   'Accept an operator onto the register, or send the profile back', TRUE, 340)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role (code, name, description, is_system, created_by) VALUES
  ('OPERATOR_REGISTRAR', 'Operator Registrar',
   'Registers operators and keeps their profiles, documents and experience', FALSE, 'migration'),
  ('COMPETENCY_ASSESSOR', 'Competency Assessor',
   'Assesses what an operator can run and how well they understand it', FALSE, 'migration'),
  ('OPERATOR_APPROVER', 'Operator Register Approver',
   'Reviews submitted operator profiles and accepts them onto the register', FALSE, 'migration')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE (r.code = 'OPERATOR_REGISTRAR'
        AND p.code IN ('platform.operators.view', 'platform.operators.manage',
                       'platform.registry.view', 'dashboard.mis'))
   OR (r.code = 'COMPETENCY_ASSESSOR'
        AND p.code IN ('platform.operators.view', 'platform.operators.assess',
                       'platform.registry.view', 'dashboard.mis'))
   OR (r.code = 'OPERATOR_APPROVER'
        AND p.code IN ('platform.operators.view', 'platform.operators.approve',
                       'platform.registry.view', 'dashboard.mis'))
ON CONFLICT DO NOTHING;
