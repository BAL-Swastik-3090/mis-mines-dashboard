-- 026: the operating chain — shift, availability, plan, deployment, HOTO.
--
-- The specification names eleven domain objects. This is seven, and nothing it
-- asks for is lost:
--
--   operator_schedule + machine_schedule    → shift_plan
--        A planned line is a machine, an operator, or the two of them together.
--        Three tables for what is one sentence — "EX-04 on A shift with Akash,
--        at the south face" — would mean joining a plan to itself to read it.
--
--   machine_availability_event
--   + operator_availability_event           → availability_event
--        Both are "this thing became unavailable at this time, for this reason,
--        until released". The only difference is which column is filled in.
--
--   deployment_block                        → derived, not stored
--        A block is the *absence* of readiness, recomputed from facts every
--        time it is asked. Storing it guarantees a screen that says BLOCKED
--        about a licence that was renewed an hour ago.
--
--   replacement_request                     → ops_exception
--        "The scheduled operator is absent and somebody must act" is an
--        exception with an owner, which is what the exception queue already is.
--
--   shift_readiness_snapshot                → later, if the analytics need it.
--        Derivable from the event log; a snapshot table that nothing reads yet
--        is a table that drifts.
--
-- Nothing here duplicates the machine or person master, as the specification
-- insists: asset and party remain the only ones.

-- ────────────────────────────────────────────────────── shifts as they happen

-- The shift definitions the mine works to. Configurable, because A/B/C at
-- Kaliapani is not the same clock as a general shift.
INSERT INTO shift_calendar (code, name, start_time, end_time, crosses_midnight,
                            planned_hours, created_by)
VALUES ('A',       'A shift',      '06:00', '14:00', false, 8, 'migration'),
       ('B',       'B shift',      '14:00', '22:00', false, 8, 'migration'),
       ('C',       'C shift',      '22:00', '06:00', true,  8, 'migration'),
       ('GENERAL', 'General shift','09:00', '17:30', false, 8, 'migration')
ON CONFLICT DO NOTHING;

-- One occurrence of a shift: A shift on the 18th at Kaliapani. Everything that
-- happens operationally hangs off one of these, which is what makes "what
-- happened on B shift yesterday" a question with an answer.
CREATE TABLE IF NOT EXISTS shift_instance (
    shift_instance_id bigserial PRIMARY KEY,
    shift_id        bigint NOT NULL REFERENCES shift_calendar (shift_id),
    production_day  date NOT NULL,
    plant_id        bigint REFERENCES plant (plant_id),
    location_id     bigint REFERENCES location (location_id),
    supervisor_party_id bigint REFERENCES party (party_id),
    supervisor_emp_id   text,              -- before the supervisor has a party row
    planned_start   timestamptz,
    planned_end     timestamptz,
    actual_start    timestamptz,
    actual_end      timestamptz,
    status          text NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED', 'OPEN', 'CLOSED', 'CANCELLED')),
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text,
    UNIQUE (shift_id, production_day, plant_id)
);

CREATE INDEX IF NOT EXISTS shift_instance_day_idx ON shift_instance (production_day DESC, status);

-- ──────────────────────────────────────────────────────────── what was planned

CREATE TABLE IF NOT EXISTS shift_plan (
    shift_plan_id   bigserial PRIMARY KEY,
    shift_instance_id bigint NOT NULL REFERENCES shift_instance (shift_instance_id) ON DELETE CASCADE,
    -- One or both. A machine with no operator is a machine plan; an operator
    -- with no machine is a roster line; both together is an intended pairing.
    asset_id        bigint REFERENCES asset (asset_id) ON DELETE SET NULL,
    operator_id     bigint REFERENCES operator (operator_id) ON DELETE SET NULL,
    -- What was wanted, when the particular machine is not yet decided.
    asset_type_id   bigint REFERENCES asset_type (asset_type_id),
    required_count  int NOT NULL DEFAULT 1,
    activity        text,                  -- ore excavation, OB removal, haulage
    location_id     bigint REFERENCES location (location_id),
    role            text NOT NULL DEFAULT 'PRIMARY',
    planned_hours   numeric(5, 2),
    status          text NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PUBLISHED', 'ACKNOWLEDGED', 'REASSIGNED',
                          'COMPLETED', 'CANCELLED')),
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text,
    published_by    text,
    published_at    timestamptz,
    CHECK (asset_id IS NOT NULL OR operator_id IS NOT NULL OR asset_type_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS shift_plan_instance_idx ON shift_plan (shift_instance_id, status);

-- ──────────────────────────────────── when something stops being available

-- One table for machines and people. A breakdown, a medical hold, an absence
-- and a leave day are the same shape: it started, there is a reason, it has not
-- been released yet.
CREATE TABLE IF NOT EXISTS availability_event (
    availability_event_id bigserial PRIMARY KEY,
    asset_id        bigint REFERENCES asset (asset_id) ON DELETE CASCADE,
    operator_id     bigint REFERENCES operator (operator_id) ON DELETE CASCADE,
    -- Machines: BREAKDOWN, MAINTENANCE, INSPECTION_HOLD, COMPLIANCE_HOLD,
    --           FUEL_REQUIRED, LOCATION_RESTRICTED, PLANNED_DOWN, AVAILABLE
    -- People:   ABSENT, LEAVE, TRAINING, MEDICAL_HOLD, SUSPENDED, PRESENT
    state           text NOT NULL,
    reason          text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    ended_at        timestamptz,
    shift_instance_id bigint REFERENCES shift_instance (shift_instance_id) ON DELETE SET NULL,
    source          text NOT NULL DEFAULT 'MANUAL',   -- MANUAL / HRMS / TELEMATICS
    recorded_by     text,
    released_by     text,
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (asset_id IS NOT NULL OR operator_id IS NOT NULL)
);

-- The open ones are what every readiness check reads, so they are indexed on
-- their own rather than filtered out of the whole history each time.
CREATE INDEX IF NOT EXISTS availability_open_asset_idx
    ON availability_event (asset_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS availability_open_operator_idx
    ON availability_event (operator_id) WHERE ended_at IS NULL;

-- ─────────────────────────────────────────────────────── what actually ran

CREATE TABLE IF NOT EXISTS deployment (
    deployment_id   bigserial PRIMARY KEY,
    deployment_ref  text UNIQUE,
    shift_instance_id bigint NOT NULL REFERENCES shift_instance (shift_instance_id) ON DELETE CASCADE,
    asset_id        bigint NOT NULL REFERENCES asset (asset_id),
    operator_id     bigint REFERENCES operator (operator_id),
    shift_plan_id   bigint REFERENCES shift_plan (shift_plan_id) ON DELETE SET NULL,
    location_id     bigint REFERENCES location (location_id),
    activity        text,
    role            text NOT NULL DEFAULT 'PRIMARY',
    started_at      timestamptz,
    ended_at        timestamptz,
    start_reading   numeric(12, 2),
    end_reading     numeric(12, 2),
    status          text NOT NULL DEFAULT 'READY'
        CHECK (status IN ('READY', 'RUNNING', 'PAUSED', 'RELEASED', 'CANCELLED')),
    -- What was overridden, and by whom. A supervisor at two in the morning is
    -- not helped by a refusal, but nothing should be waived silently.
    readiness_at_start jsonb,
    override_by     text,
    override_reason text,
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One machine cannot be run by two people at once, and one person cannot be on
-- two machines. Enforced rather than checked in code, because the code that
-- checks is the code that gets bypassed at handover time.
CREATE UNIQUE INDEX IF NOT EXISTS deployment_one_live_machine
    ON deployment (asset_id) WHERE status IN ('READY', 'RUNNING', 'PAUSED');
CREATE UNIQUE INDEX IF NOT EXISTS deployment_one_live_operator
    ON deployment (operator_id) WHERE status IN ('READY', 'RUNNING', 'PAUSED')
                                   AND operator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deployment_shift_idx ON deployment (shift_instance_id, status);

CREATE OR REPLACE FUNCTION next_deployment_ref() RETURNS text AS $$
DECLARE
    yr   text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
    last integer;
BEGIN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(deployment_ref, '^DEP-\d{4}-', ''), '')::integer), 0)
      INTO last FROM deployment WHERE deployment_ref LIKE 'DEP-' || yr || '-%';
    RETURN 'DEP-' || yr || '-' || lpad((last + 1)::text, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────── handing a machine to somebody else

-- The checklist, per equipment class. Nine production tables currently record
-- the same handover nine ways; the difference between them is which items are
-- on the list, so that is the only thing that varies here.
CREATE TABLE IF NOT EXISTS hoto_template (
    hoto_template_id bigserial PRIMARY KEY,
    asset_type_id   bigint REFERENCES asset_type (asset_type_id),
    name            text NOT NULL,
    -- [{key, label, critical, kind}] — critical items block the handover.
    items           jsonb NOT NULL DEFAULT '[]'::jsonb,
    status          text NOT NULL DEFAULT 'ACTIVE',
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text,
    UNIQUE (asset_type_id, name)
);

CREATE TABLE IF NOT EXISTS hoto (
    hoto_id         bigserial PRIMARY KEY,
    hoto_ref        text UNIQUE,
    asset_id        bigint NOT NULL REFERENCES asset (asset_id),
    shift_instance_id bigint REFERENCES shift_instance (shift_instance_id) ON DELETE SET NULL,
    outgoing_operator_id bigint REFERENCES operator (operator_id),
    incoming_operator_id bigint REFERENCES operator (operator_id),
    outgoing_deployment_id bigint REFERENCES deployment (deployment_id) ON DELETE SET NULL,
    incoming_deployment_id bigint REFERENCES deployment (deployment_id) ON DELETE SET NULL,
    template_id     bigint REFERENCES hoto_template (hoto_template_id),
    meter_reading   numeric(12, 2),
    fuel_level      numeric(6, 2),
    location_id     bigint REFERENCES location (location_id),
    -- The answers: [{key, label, status, remarks, critical}]
    checks          jsonb NOT NULL DEFAULT '[]'::jsonb,
    defects         jsonb NOT NULL DEFAULT '[]'::jsonb,
    status          text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'BLOCKED', 'COMPLETED', 'CANCELLED')),
    blocked_reason  text,
    outgoing_confirmed_by text, outgoing_confirmed_at timestamptz,
    incoming_confirmed_by text, incoming_confirmed_at timestamptz,
    remarks         text,
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hoto_asset_idx ON hoto (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hoto_open_idx ON hoto (status) WHERE status IN ('PENDING', 'BLOCKED');

CREATE OR REPLACE FUNCTION next_hoto_ref() RETURNS text AS $$
DECLARE
    yr   text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
    last integer;
BEGIN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(hoto_ref, '^HOT-\d{4}-', ''), '')::integer), 0)
      INTO last FROM hoto WHERE hoto_ref LIKE 'HOT-' || yr || '-%';
    RETURN 'HOT-' || yr || '-' || lpad((last + 1)::text, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- The default checklist, from what the mine's own handover form already asks.
INSERT INTO hoto_template (asset_type_id, name, items, created_by)
VALUES (NULL, 'Standard HEMM handover', '[
    {"key": "visual",        "label": "Visual inspection",        "critical": false},
    {"key": "engine",        "label": "Engine condition",         "critical": true},
    {"key": "engine_oil",    "label": "Engine oil level",         "critical": false},
    {"key": "coolant",       "label": "Coolant level",            "critical": false},
    {"key": "hydraulic",     "label": "Hydraulic oil",            "critical": false},
    {"key": "transmission",  "label": "Transmission oil",         "critical": false},
    {"key": "fuel",          "label": "Fuel level",               "critical": false},
    {"key": "battery",       "label": "Battery condition",        "critical": false},
    {"key": "tyres",         "label": "Tyres / tracks",           "critical": true},
    {"key": "tyre_pressure", "label": "Tyre pressure",            "critical": false},
    {"key": "brakes",        "label": "Brakes",                   "critical": true},
    {"key": "steering",      "label": "Steering",                 "critical": true},
    {"key": "seat_belt",     "label": "Seat belt",                "critical": true},
    {"key": "lights",        "label": "Lights",                   "critical": false},
    {"key": "horn",          "label": "Horn",                     "critical": false},
    {"key": "ac",            "label": "Air conditioning",         "critical": false},
    {"key": "door",          "label": "Cabin and door",           "critical": false},
    {"key": "indicators",    "label": "Indicators",               "critical": false},
    {"key": "reverse_alarm", "label": "Reverse alarm",            "critical": true},
    {"key": "wipers",        "label": "Wipers",                   "critical": false},
    {"key": "mirrors",       "label": "Mirrors",                  "critical": false},
    {"key": "windshield",    "label": "Windshield",               "critical": false},
    {"key": "guards",        "label": "Safety guards",            "critical": true},
    {"key": "extinguisher",  "label": "Fire extinguisher",        "critical": true},
    {"key": "first_aid",     "label": "First aid kit",            "critical": false},
    {"key": "trial_run",     "label": "Trial test run",           "critical": false},
    {"key": "leakage",       "label": "Leakage",                  "critical": true},
    {"key": "noise",         "label": "Unusual noise",            "critical": false}
]'::jsonb, 'migration')
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────── everything stopping planned work

CREATE TABLE IF NOT EXISTS ops_exception (
    ops_exception_id bigserial PRIMARY KEY,
    kind            text NOT NULL,     -- OPERATOR_ABSENT, HOTO_BLOCKED, RUNNING_WITHOUT_DEPLOYMENT…
    severity        text NOT NULL DEFAULT 'MEDIUM'
        CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    shift_instance_id bigint REFERENCES shift_instance (shift_instance_id) ON DELETE CASCADE,
    asset_id        bigint REFERENCES asset (asset_id) ON DELETE SET NULL,
    operator_id     bigint REFERENCES operator (operator_id) ON DELETE SET NULL,
    hoto_id         bigint REFERENCES hoto (hoto_id) ON DELETE SET NULL,
    detail          text NOT NULL,
    owner_role      text,
    status          text NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')),
    resolution      text,
    resolved_by     text,
    resolved_at     timestamptz,
    raised_by       text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- The same problem raised every minute is noise. One open row per thing.
    dedupe_key      text UNIQUE
);

CREATE INDEX IF NOT EXISTS ops_exception_open_idx ON ops_exception (status, severity, created_at DESC);

-- ───────────────────────────────────────────── permissions for the new work

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
    ('ops.shift.view',    'Operations', 'View shift board',
     'See shift readiness, the live fleet and deployments', FALSE, 410),
    ('ops.shift.manage',  'Operations', 'Run the shift',
     'Open and close shifts, publish plans, deploy and release machines', TRUE, 420),
    ('ops.hoto.record',   'Operations', 'Record handover',
     'Carry out handover and takeover between operators', TRUE, 430),
    ('ops.override',      'Operations', 'Override a block',
     'Deploy against a blocking condition, with a recorded reason', TRUE, 440)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role (code, name, description, is_system, created_by) VALUES
    ('SHIFT_SUPERVISOR', 'Shift Supervisor',
     'Runs the shift: plans it, deploys machines, resolves what is blocking work', FALSE, 'migration'),
    ('SHIFT_VIEWER', 'Shift Viewer',
     'Sees the live fleet and shift readiness without changing anything', FALSE, 'migration')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE (r.code = 'SHIFT_SUPERVISOR'
        AND p.code IN ('ops.shift.view', 'ops.shift.manage', 'ops.hoto.record',
                       'platform.registry.view', 'platform.operators.view', 'dashboard.mis'))
   OR (r.code = 'SHIFT_VIEWER'
        AND p.code IN ('ops.shift.view', 'platform.registry.view', 'dashboard.mis'))
ON CONFLICT DO NOTHING;
