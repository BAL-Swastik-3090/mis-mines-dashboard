-- 053: the organisation, written down.
--
-- The platform knew seven departments, all of them created because a CLL
-- workman had to be posted somewhere. Nothing said who runs a department, what
-- it answers for, or which SAP label means which unit. Every screen that has
-- needed an accountable person so far has settled for a free-text name.
--
-- That runs out the moment inventory arrives. The material scope asks the
-- platform to show a user "what is held against your department" and to
-- escalate an unanswered case to the Department Head. Both questions need the
-- same thing first: a department that exists as a row, a post that exists as a
-- row, and a named person holding that post on a date.
--
-- FOUR TABLES, ONE IDEA EACH
--
--   org_unit_source     what an outside system calls this unit
--   org_post            a chair
--   org_post_holding    who is sitting in it, and since when
--   org_accountability  what this unit answers for
--
-- WHY A POST AND NOT A COLUMN ON THE DEPARTMENT
-- head_party_id on org_unit would be one column and would answer today's
-- question. It cannot answer "who was the head when this material was bought",
-- which is the question an ageing case actually asks -- the material is two
-- years old and the person who signed for it has moved on. A post outlives its
-- holder; a holding has dates. The same shape already works for
-- party_employment and asset_revision, and for the same reason.
--
-- NOTHING HERE CLAIMS A HEAD.
-- The import can see who the senior-most person in a department is, and that
-- is a good guess and not a fact: SAP records a President under MINING
-- OPERATIONS, and he runs the mine, not the department. So a derived holding
-- arrives with source = 'SAP_DERIVED' and confirmed_at NULL, and the screen
-- says "proposed" until somebody with org.manage says otherwise. A wrong name
-- against an escalation is worse than a blank one, because a blank asks to be
-- filled and a wrong one does not.

-- ---------------------------------------------------------------------------
-- 1. The unit itself gains a shape
-- ---------------------------------------------------------------------------
ALTER TABLE org_unit ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'DEPARTMENT';
ALTER TABLE org_unit DROP CONSTRAINT IF EXISTS org_unit_type_known;
ALTER TABLE org_unit ADD CONSTRAINT org_unit_type_known
    CHECK (unit_type IN ('SITE', 'DIVISION', 'DEPARTMENT', 'SECTION'));

ALTER TABLE org_unit ADD COLUMN IF NOT EXISTS plant_id    bigint REFERENCES plant (plant_id);
ALTER TABLE org_unit ADD COLUMN IF NOT EXISTS purpose     text;
ALTER TABLE org_unit ADD COLUMN IF NOT EXISTS sort_order  integer NOT NULL DEFAULT 100;

COMMENT ON COLUMN org_unit.purpose IS
    'What this unit is for, in the mine''s own words. Shown to a user who is '
    'about to be asked why their department is holding something.';

CREATE INDEX IF NOT EXISTS ix_org_unit_parent ON org_unit (parent_id);

-- ---------------------------------------------------------------------------
-- 2. What the other systems call it
-- ---------------------------------------------------------------------------
-- SAP's EMPDEPT is a 24-character column and the names run past it:
-- 'SUPPLY CHAIN MANAGEMENT (' and 'TOTAL PRODUCTIVE MAINTENA' are what is
-- actually stored. Matching on the name would therefore fail exactly where the
-- department is large enough to matter. So the label is recorded rather than
-- matched, and a new spelling is one row, not a code change.
CREATE TABLE IF NOT EXISTS org_unit_source (
    org_unit_source_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_unit_id    bigint NOT NULL REFERENCES org_unit (org_unit_id) ON DELETE CASCADE,
    system         text NOT NULL CHECK (system IN
                     ('SAP_DEPT', 'SAP_COST_CENTRE', 'SAP_STORAGE_LOC',
                      'SAP_PLANT_SECTION', 'CONTRACTOR_DEPT')),
    external_label text NOT NULL,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT uq_org_unit_source UNIQUE (system, external_label)
);
CREATE INDEX IF NOT EXISTS ix_org_unit_source_unit ON org_unit_source (org_unit_id);
COMMENT ON CONSTRAINT uq_org_unit_source ON org_unit_source IS
    'One SAP department name points at one unit. Two units claiming the same '
    'label is how headcount and inventory stop reconciling.';

-- ---------------------------------------------------------------------------
-- 3. Posts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_post (
    post_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_unit_id    bigint NOT NULL REFERENCES org_unit (org_unit_id),
    title          text NOT NULL,
    post_type      text NOT NULL CHECK (post_type IN
                     ('SITE_HEAD', 'FUNCTIONAL_HEAD', 'DEPARTMENT_HEAD',
                      'SECTION_INCHARGE', 'MATERIAL_CUSTODIAN', 'MEMBER')),
    reports_to_post_id bigint REFERENCES org_post (post_id),
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);
CREATE INDEX IF NOT EXISTS ix_org_post_unit ON org_post (org_unit_id);

-- One head per department, one custodian per department. Two of either is not
-- a richer model, it is an unanswered question about who escalation reaches.
CREATE UNIQUE INDEX IF NOT EXISTS org_post_one_head
    ON org_post (org_unit_id) WHERE post_type = 'DEPARTMENT_HEAD' AND status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS org_post_one_custodian
    ON org_post (org_unit_id) WHERE post_type = 'MATERIAL_CUSTODIAN' AND status = 'ACTIVE';

DROP TRIGGER IF EXISTS org_post_touch ON org_post;
CREATE TRIGGER org_post_touch BEFORE UPDATE ON org_post
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE org_post IS
    'A chair, not a person. Posts outlive their holders, which is what lets a '
    'two-year-old material case name the head who was accountable at the time.';

-- ---------------------------------------------------------------------------
-- 4. Holdings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_post_holding (
    holding_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id        bigint NOT NULL REFERENCES org_post (post_id) ON DELETE CASCADE,
    party_id       bigint NOT NULL REFERENCES party (party_id),
    -- The SAP number is carried here as well as through party_identity, because
    -- user_access.emp_id is what a login is matched on and a join through two
    -- tables to answer "is this my department" runs on every page load.
    emp_id         text,
    basis          text NOT NULL DEFAULT 'SUBSTANTIVE'
                     CHECK (basis IN ('SUBSTANTIVE', 'ACTING', 'ADDITIONAL')),
    valid_from     date NOT NULL DEFAULT CURRENT_DATE,
    valid_to       date,
    source         text NOT NULL DEFAULT 'DECLARED'
                     CHECK (source IN ('SAP_DERIVED', 'DECLARED')),
    derived_note   text,
    confirmed_by   text,
    confirmed_at   timestamptz,
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,
    CONSTRAINT holding_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS ix_holding_post  ON org_post_holding (post_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS ix_holding_party ON org_post_holding (party_id);
CREATE INDEX IF NOT EXISTS ix_holding_emp   ON org_post_holding (emp_id) WHERE valid_to IS NULL;

-- A post has one substantive occupant at a time. Acting and additional charge
-- sit alongside it, which is the whole reason those words exist.
CREATE UNIQUE INDEX IF NOT EXISTS holding_one_substantive
    ON org_post_holding (post_id)
    WHERE valid_to IS NULL AND basis = 'SUBSTANTIVE';

COMMENT ON COLUMN org_post_holding.source IS
    'SAP_DERIVED is a proposal the import made from grade seniority and nobody '
    'has agreed to. DECLARED is somebody''s decision. Only a confirmed holding '
    'is shown as the accountable person.';

-- ---------------------------------------------------------------------------
-- 5. What a unit answers for
-- ---------------------------------------------------------------------------
-- This is the row the inventory work will hang off: a department does not own
-- "material" in the abstract, it owns the stock at a storage location, the
-- spend on a cost centre, the machines on a register. Recording the scope as a
-- reference into the source system means the inventory portal can ask "whose
-- is this?" and get an answer rather than a guess from a name.
CREATE TABLE IF NOT EXISTS org_accountability (
    accountability_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_unit_id    bigint NOT NULL REFERENCES org_unit (org_unit_id) ON DELETE CASCADE,
    domain         text NOT NULL CHECK (domain IN
                     ('MATERIAL', 'EQUIPMENT', 'MANPOWER', 'STATUTORY',
                      'BUDGET', 'PRODUCTION', 'SAFETY', 'DATA')),
    -- Narrower than the unit head when it needs to be: stores material may
    -- answer to a custodian while the department answers to its head.
    post_id        bigint REFERENCES org_post (post_id),
    scope_system   text CHECK (scope_system IN
                     ('SAP_COST_CENTRE', 'SAP_STORAGE_LOC', 'SAP_PLANT_SECTION',
                      'SAP_WBS', 'MINEHUB_ASSET', 'MINEHUB_LOCATION')),
    scope_ref      text,
    description    text,
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);
CREATE INDEX IF NOT EXISTS ix_accountability_unit ON org_accountability (org_unit_id);
CREATE INDEX IF NOT EXISTS ix_accountability_scope ON org_accountability (scope_system, scope_ref);

-- ---------------------------------------------------------------------------
-- 6. Who may look and who may change it
-- ---------------------------------------------------------------------------
-- Looking is deliberately cheap. An organisation chart that only its custodian
-- can read is a chart nobody uses, and the material portal is going to put a
-- department head's name in front of every user it asks a question of.
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
  ('org.view', 'Organisation', 'See the organisation',
   'Open the organisation structure: departments, posts, who holds them and '
   'what each department answers for.', FALSE, 360),
  ('org.manage', 'Organisation', 'Change the organisation',
   'Create departments and posts, confirm or change who holds a post, and '
   'record what a department is accountable for. Every change is dated and '
   'the previous holder is kept.', TRUE, 361)
ON CONFLICT (code) DO NOTHING;
