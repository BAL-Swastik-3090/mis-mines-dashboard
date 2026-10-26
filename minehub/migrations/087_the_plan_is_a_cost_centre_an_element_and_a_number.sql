-- 087_the_plan_is_a_cost_centre_an_element_and_a_number
--
-- The monthly cost plan reaches us as SAP CO exports (KP06), one file per
-- slice of the business - "Salary Planning", "CC OH Plan", "depreciation
-- Plan" and so on. Every file carries the same header block (CO Area,
-- Version, Fiscal Year, Period) and then rows of
-- Cost Center / Cost Element / Plan Fix Costs.
--
-- The files are disjoint: for Oct-2026, the Salary and CC OH exports share
-- no (cost centre, cost element) pair at all. So the key is the pair plus
-- the period, and uploading the fourteen files of a month accumulates into
-- one plan rather than fighting over rows.
--
-- The export carries NO descriptions - only numbers. Those live in the two
-- master tables here, loaded from the "CE and CC List" workbook. Without
-- them the plan is unreadable: 1210021001 means nothing, MINES PRODUCTION
-- means something.
--
-- Idempotent: safe to re-run.

CREATE SCHEMA IF NOT EXISTS minehub;

-- ---------------------------------------------------------------------
-- 1. MASTERS - what the numbers mean
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS minehub.cost_element_master (
    cost_element text        PRIMARY KEY,
    description  text        NOT NULL,
    source_file  text,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE minehub.cost_element_master IS
    'Cost element (GL) descriptions. The SAP plan export carries numbers only; this is what makes them readable.';

CREATE TABLE IF NOT EXISTS minehub.cost_centre_master (
    cost_centre text        PRIMARY KEY,
    description text        NOT NULL,
    source_file text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE minehub.cost_centre_master IS
    'Cost centre descriptions. Prefix carries the unit: 1210 = Mines and COB, 1100 = Balasore, 1110 = Sukinda smelter, 1300/1310/1330/1340 = other units.';

-- ---------------------------------------------------------------------
-- 2. THE PLAN
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS minehub.cost_plan (
    co_area       text    NOT NULL DEFAULT '1000',
    plan_version  text    NOT NULL DEFAULT '0',
    fiscal_year   integer NOT NULL,
    period        integer NOT NULL,
    cost_centre   text    NOT NULL,
    cost_element  text    NOT NULL,
    plan_fix_cost numeric NOT NULL,
    currency      text    NOT NULL DEFAULT 'INR',

    -- The calendar month this period means, so no reader has to know that
    -- the financial year starts in April. Periods 13-16 are SAP's year-end
    -- adjustment periods and all land in March.
    plan_month date GENERATED ALWAYS AS (
        make_date(
            fiscal_year + CASE WHEN period >= 10 THEN 1 ELSE 0 END,
            CASE WHEN period BETWEEN 1 AND 12 THEN ((period + 2) % 12) + 1 ELSE 3 END,
            1)
    ) STORED,

    source_file text,
    ingested_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT cost_plan_period_ck CHECK (period BETWEEN 1 AND 16),
    PRIMARY KEY (co_area, plan_version, fiscal_year, period, cost_centre, cost_element)
);

COMMENT ON TABLE minehub.cost_plan IS
    'Monthly planned cost per cost centre per cost element, from the SAP CO plan export. Re-uploading a file overwrites only its own rows.';
COMMENT ON COLUMN minehub.cost_plan.plan_fix_cost IS
    'Plan Fix Costs COArC. Can be negative - deduction elements such as 70501580 Canteen Deductions carry credits.';
COMMENT ON COLUMN minehub.cost_plan.plan_month IS
    'First day of the calendar month this fiscal period covers. FY2026 P7 = 2026-10-01.';

CREATE INDEX IF NOT EXISTS cost_plan_month_idx       ON minehub.cost_plan (plan_month);
CREATE INDEX IF NOT EXISTS cost_plan_centre_idx      ON minehub.cost_plan (cost_centre);
CREATE INDEX IF NOT EXISTS cost_plan_element_idx     ON minehub.cost_plan (cost_element);
-- Mines and COB are read far more often than anything else.
CREATE INDEX IF NOT EXISTS cost_plan_mines_idx       ON minehub.cost_plan (fiscal_year, period)
    WHERE cost_centre LIKE '1210%';

-- ---------------------------------------------------------------------
-- 3. UPLOAD AUDIT - mirrors ev_upload_batch / ev_upload_change (086)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS minehub.cost_plan_upload_batch (
    batch_id       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_file    text        NOT NULL,
    uploaded_by    text,
    uploaded_at    timestamptz NOT NULL DEFAULT now(),
    co_area        text,
    plan_version   text,
    fiscal_year    integer,
    period         integer,
    rows_received  integer     NOT NULL DEFAULT 0,
    rows_new       integer     NOT NULL DEFAULT 0,
    rows_changed   integer     NOT NULL DEFAULT 0,
    rows_identical integer     NOT NULL DEFAULT 0,
    amount_total   numeric     NOT NULL DEFAULT 0
);

COMMENT ON TABLE minehub.cost_plan_upload_batch IS
    'One row per accepted cost plan upload. Append-only; no dashboard figure reads it.';

CREATE TABLE IF NOT EXISTS minehub.cost_plan_upload_change (
    batch_id     bigint NOT NULL REFERENCES minehub.cost_plan_upload_batch (batch_id) ON DELETE CASCADE,
    cost_centre  text   NOT NULL,
    cost_element text   NOT NULL,
    change_type  text   NOT NULL,
    fields       jsonb,
    CONSTRAINT cost_plan_upload_change_type_ck CHECK (change_type IN ('NEW', 'CHANGED', 'IDENTICAL'))
);

COMMENT ON TABLE minehub.cost_plan_upload_change IS
    'What each upload did to each cost centre and element. CHANGED rows carry the amount before and after.';

CREATE INDEX IF NOT EXISTS cost_plan_upload_change_batch_idx
    ON minehub.cost_plan_upload_change (batch_id);

-- ---------------------------------------------------------------------
-- 4. READER VIEW - the plan with its descriptions attached
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW minehub.cost_plan_detail AS
SELECT p.fiscal_year,
       p.period,
       p.plan_month,
       p.co_area,
       p.plan_version,
       p.cost_centre,
       COALESCE(cc.description, '(unmapped cost centre)') AS cost_centre_desc,
       p.cost_element,
       COALESCE(ce.description, '(unmapped cost element)') AS cost_element_desc,
       p.plan_fix_cost,
       p.currency,
       -- Which unit the cost centre belongs to, read off its prefix. Named
       -- here once so no query has to repeat the substring logic.
       CASE substring(p.cost_centre FROM 1 FOR 4)
            WHEN '1210' THEN 'MINES'
            WHEN '1100' THEN 'BALASORE'
            WHEN '1110' THEN 'SUKINDA'
            ELSE 'OTHER'
       END AS unit,
       p.source_file,
       p.ingested_at
FROM minehub.cost_plan p
LEFT JOIN minehub.cost_centre_master  cc ON cc.cost_centre  = p.cost_centre
LEFT JOIN minehub.cost_element_master ce ON ce.cost_element = p.cost_element;

COMMENT ON VIEW minehub.cost_plan_detail IS
    'Cost plan joined to both masters, with the calendar month and owning unit resolved. The thing screens should read.';
