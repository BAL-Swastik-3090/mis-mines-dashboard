-- 040: what a person is employed to do, as a thing rather than as a string.
--
-- The register is about to take 211 contractor workmen, of whom only about
-- two-thirds operate a machine. The rest are fitters, welders, tyre men,
-- electricians, a time keeper, a sweeper, a gardener. All of them are on site,
-- all of them are on the gate, all of them are on somebody's bill.
--
-- WHY NOT JUST THE TEXT. operator.designation is free text, and the roll as
-- supplied already contains 'MECH. HELPER  MAN' with two spaces, 'GRARDENER',
-- 'WATCHMEN', 'HOUSE KEEP', 'A/ C MECHANIC' and 'ASST. AUTO ELE.'. Thirty-eight
-- spellings for about thirty jobs. Free text is fine while nothing depends on
-- it; the moment a rate, a competency requirement or a headcount does, every
-- variant spelling is a row that silently falls out of the total.
--
-- So the trade becomes a row. The text people typed is kept beside it — what
-- the contractor called the job is a fact about the contractor's paperwork and
-- is worth being able to show — but the thing anything hangs off is the trade.
--
-- WHAT A TRADE CARRIES, AND WHY THIS SHAPE. The mine has said billing comes
-- later and to leave room for any of the usual bases. So this deliberately
-- does not model a rate. It models the classification a rate would attach to,
-- the way an ERP occupation master does:
--
--   group              the family it belongs to, for headcount and reporting
--   operates_equipment whether the job is to run a machine, which is what
--                      decides whether a competency is owed
--   asset_type_id      which machine, where the trade names one — so a tipper
--                      driver's competency, deployment and licence checks can
--                      be derived rather than typed
--   skilled            skilled / semi-skilled / unskilled, which is how
--                      minimum wage is notified in Odisha and how nearly every
--                      labour contract states its rates
--
-- Whatever the basis turns out to be — per head per day, per machine hour,
-- lump sum — it attaches here, and none of it needs the 211 rows re-typed.

CREATE TABLE IF NOT EXISTS trade (
    trade_id        bigserial PRIMARY KEY,
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    trade_group     text NOT NULL,
    -- The job is to run a machine. Not the same as "is allowed to": that is a
    -- competency, assessed per person, and this is what makes one necessary.
    operates_equipment boolean NOT NULL DEFAULT FALSE,
    asset_type_id   bigint REFERENCES asset_type(asset_type_id),
    -- How labour contracts and the state's minimum wage notification classify
    -- the work. Left null where it genuinely does not apply.
    skill_class     text CHECK (skill_class IN ('SKILLED', 'SEMI_SKILLED', 'UNSKILLED')),
    sort_order      integer NOT NULL DEFAULT 100,
    status          text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'RETIRED')),
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE trade IS
    'What a person is employed to do. Rates, competency requirements and '
    'headcount all hang off this rather than off free text, because thirty-'
    'eight spellings of thirty jobs is thirty-eight ways for a total to be '
    'quietly wrong.';

CREATE INDEX IF NOT EXISTS ix_trade_group ON trade (trade_group, sort_order);

ALTER TABLE operator ADD COLUMN IF NOT EXISTS trade_id bigint REFERENCES trade(trade_id);
CREATE INDEX IF NOT EXISTS ix_operator_trade ON operator (trade_id);

COMMENT ON COLUMN operator.trade_id IS
    'The classified job. operator.designation keeps what the employer actually '
    'wrote, which is evidence about their paperwork and not something to '
    'compute from.';

-- ── the trades, as the mine actually employs them ────────────────────────────
-- Grouped so a headcount reads the way somebody would ask for it, and ordered
-- within the group by how many people do the job.

INSERT INTO trade (code, name, trade_group, operates_equipment, asset_type_id,
                   skill_class, sort_order)
SELECT v.code, v.name, v.trade_group, v.operates, t.asset_type_id,
       v.skill_class, v.sort_order
FROM (VALUES
    -- Machine operators. asset_type is named so competency and deployment can
    -- be derived from the trade instead of being typed per person.
    ('TIPPER_DRIVER',    'Tipper Driver',          'Machine operation', TRUE,  'Tipper',         'SKILLED',      10),
    ('EXCAVATOR_OP',     'Excavator Operator',     'Machine operation', TRUE,  'Excavator',      'SKILLED',      11),
    ('DOZER_OP',         'Dozer Operator',         'Machine operation', TRUE,  'Dozer',          'SKILLED',      12),
    ('WATER_TANKER_DRV', 'Water Tanker Driver',    'Machine operation', TRUE,  'Water Tanker',   'SKILLED',      13),
    ('BACKHOE_OP',       'Backhoe Loader Operator','Machine operation', TRUE,  'Backhoe Loader', 'SKILLED',      14),
    ('DRILL_OP',         'Drill Operator',         'Machine operation', TRUE,  'Drill',          'SKILLED',      15),
    ('GRADER_OP',        'Grader Operator',        'Machine operation', TRUE,  'Grader',         'SKILLED',      16),
    ('HYDRA_OP',         'Hydra Operator',         'Machine operation', TRUE,  'Crane',          'SKILLED',      17),
    ('LOADER_OP',        'Wheel Loader Operator',  'Machine operation', TRUE,  'Wheel Loader',   'SKILLED',      18),
    ('LMV_DRIVER',       'Light Vehicle Driver',   'Machine operation', TRUE,  'Pickup',         'SKILLED',      19),

    -- Mining operations: on the bench, not on a machine.
    ('MINES_HELPER',     'Mines Helper',           'Mining operations', FALSE, NULL, 'UNSKILLED',     30),
    ('SPOTTER',          'Spotter',                'Mining operations', FALSE, NULL, 'SEMI_SKILLED',  31),
    ('DRILL_HELPER',     'Drill Operation Helper', 'Mining operations', FALSE, NULL, 'SEMI_SKILLED',  32),
    ('MINING_MATE',      'Mining Mate',            'Mining operations', FALSE, NULL, 'SKILLED',       33),
    ('BLASTER',          'Blaster',                'Mining operations', FALSE, NULL, 'SKILLED',       34),

    -- The workshop. HEMM and MAN are kept apart because the roll keeps them
    -- apart: a fitter on heavy earth-moving plant and one on the MAN tipper
    -- fleet are different postings here, whatever the trade certificate says.
    ('MECH_FITTER_HEMM', 'Mechanical Fitter (HEMM)','Workshop',         FALSE, NULL, 'SKILLED',       40),
    ('MECHANIC_HEMM',    'Mechanic (HEMM)',        'Workshop',          FALSE, NULL, 'SKILLED',       41),
    ('MECHANIC_MAN',     'Mechanic (MAN)',         'Workshop',          FALSE, NULL, 'SKILLED',       42),
    ('MECH_HELPER_HEMM', 'Mechanical Helper (HEMM)','Workshop',         FALSE, NULL, 'SEMI_SKILLED',  43),
    ('MECH_HELPER_MAN',  'Mechanical Helper (MAN)','Workshop',          FALSE, NULL, 'SEMI_SKILLED',  44),
    ('TYRE_FITTER',      'Tyre Fitter',            'Workshop',          FALSE, NULL, 'SKILLED',       45),
    ('TYRE_HELPER',      'Tyre Helper',            'Workshop',          FALSE, NULL, 'UNSKILLED',     46),
    ('WELDER',           'Welder',                 'Workshop',          FALSE, NULL, 'SKILLED',       47),
    ('WELDER_DENTER',    'Welder / Denter',        'Workshop',          FALSE, NULL, 'SKILLED',       48),
    ('WELDER_HELPER',    'Welder Helper',          'Workshop',          FALSE, NULL, 'UNSKILLED',     49),
    ('AC_MECHANIC',      'Air-conditioning Mechanic','Workshop',        FALSE, NULL, 'SKILLED',       50),

    ('AUTO_ELECTRICIAN', 'Auto Electrician',       'Electrical',        FALSE, NULL, 'SKILLED',       60),
    ('ASST_AUTO_ELEC',   'Assistant Auto Electrician','Electrical',     FALSE, NULL, 'SEMI_SKILLED',  61),
    ('ELECTRICIAN',      'Electrician',            'Electrical',        FALSE, NULL, 'SKILLED',       62),

    ('SUPERVISOR',       'Supervisor',             'Supervision',       FALSE, NULL, 'SKILLED',       70),
    ('AUTO_COORDINATOR', 'Automobile Coordinator', 'Supervision',       FALSE, NULL, 'SKILLED',       71),
    ('TIME_KEEPER',      'Time Keeper',            'Supervision',       FALSE, NULL, 'SEMI_SKILLED',  72),

    ('HR_EXECUTIVE',     'HR / IR Executive',      'Administration',    FALSE, NULL, 'SKILLED',       80),
    ('HR_ASST_EXEC',     'Assistant Executive (HR)','Administration',   FALSE, NULL, 'SKILLED',       81),
    ('MIS_ASSISTANT',    'MIS Assistant',          'Administration',    FALSE, NULL, 'SKILLED',       82),
    ('IT_HELPER',        'IT Helper',              'Administration',    FALSE, NULL, 'SEMI_SKILLED',  83),

    ('SECURITY_GUARD',   'Security Guard',         'Site services',     FALSE, NULL, 'UNSKILLED',     90),
    ('HOUSEKEEPING',     'Housekeeping',           'Site services',     FALSE, NULL, 'UNSKILLED',     91),
    ('SWEEPER',          'Sweeper',                'Site services',     FALSE, NULL, 'UNSKILLED',     92),
    ('GARDENER',         'Gardener',               'Site services',     FALSE, NULL, 'UNSKILLED',     93)
) AS v(code, name, trade_group, operates, asset_type_name, skill_class, sort_order)
LEFT JOIN asset_type t ON t.name = v.asset_type_name
ON CONFLICT (code) DO NOTHING;

-- A trade that says it runs a machine and does not say which one is a trade
-- nothing can be derived from, so the two must agree.
ALTER TABLE trade DROP CONSTRAINT IF EXISTS trade_names_its_machine;
ALTER TABLE trade ADD CONSTRAINT trade_names_its_machine
    CHECK (NOT operates_equipment OR asset_type_id IS NOT NULL);
