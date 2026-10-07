-- 073: fuel as a process, not a spreadsheet.
--
-- WHAT THIS REPLACES. A monthly Excel workbook in which the same grid holds
-- three different kinds of number -- litres issued to a vehicle, tank stock
-- balances, and pump totaliser readings -- distinguished only by what somebody
-- typed in the vendor column. Reading it without knowing that produces
-- 343 million litres for a month in which 79,046 were issued.
--
-- AND WHAT IT DOES NOT REPLACE. SAP keeps procurement, vendors, GRN and
-- finance. Nothing here duplicates a purchase order. There is one nullable
-- text column for an SAP reference, to be filled in when a posting channel
-- exists; no posting is attempted and none is implied.
--
-- THE FIRST ATTEMPT IS STILL IN BALCORPDB, and it is the warning. One test row
-- from December 2025 in mines_hsd_fuel_issued, holding Equipment_Type as free
-- text, Make_Model as 'XYZ/1234', tank capacity copied onto the transaction,
-- and NO equipment identifier at all. That is the spreadsheet with a CREATE
-- TABLE in front of it. Everything below is built the other way round: the
-- equipment register is the identity, and a transaction refers to it.
--
-- ── THE FOUR THINGS THAT MUST RECONCILE ────────────────────────────────────
--
--     receipts + transfers in - issues - transfers out = stock movement
--                            vs
--                       pump totaliser
--                            vs
--                        fuel sensor
--
-- In September three of the four issuing points agreed with their totaliser to
-- within one litre and one was out by 2,154. Nobody knew, because nothing
-- compared them. That comparison is what this schema exists to make routine.


-- ---------------------------------------------------------------------------
-- 1. Where fuel is kept and handed out
-- ---------------------------------------------------------------------------
--
-- Four today: two underground tanks, a bowser on a truck, and a contractor's
-- own tanker. They are not interchangeable -- a bowser is refilled FROM a tank,
-- which is why transfers below are a first-class record rather than a pair of
-- unrelated issues.

CREATE TABLE IF NOT EXISTS fuel_issuing_point (
    issuing_point_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    label       text NOT NULL,

    -- TANK is fixed, BOWSER moves and is refilled from a tank, CONTRACTOR is
    -- somebody else's tanker issuing to their own machines on our lease.
    kind        text NOT NULL DEFAULT 'TANK'
                CHECK (kind IN ('TANK', 'BOWSER', 'CONTRACTOR')),

    -- Whose it is. NULL means ours.
    owner_party_id bigint REFERENCES party(party_id),

    -- A bowser is itself a vehicle on the register, and its diesel and its own
    -- running fuel are different things.
    asset_id    bigint REFERENCES asset(asset_id),

    capacity_l  numeric(10,2),

    -- Whether a totaliser can be read here at all. Without one there is no
    -- independent witness and the reconciliation is one-sided -- worth knowing
    -- rather than discovering.
    has_totaliser boolean NOT NULL DEFAULT true,

    is_active   boolean NOT NULL DEFAULT true,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

COMMENT ON TABLE fuel_issuing_point IS
    'A tank, bowser or contractor tanker that diesel is handed out from. '
    'Configurable: bowsers and contractors change, and a code in the source '
    'would mean a deployment every time they do.';


-- ---------------------------------------------------------------------------
-- 2. What receives the fuel -- and it is not always a vehicle
-- ---------------------------------------------------------------------------
--
-- The September register issued diesel to a 1010 KVA generator, a compressor, a
-- dewatering pump, the Sukinda guest house, a lighting set, the ETP, and a row
-- called MISCELLANEOUS. A model that assumes fuel goes to equipment does not
-- survive this register.
--
-- So: a consumer. Sometimes a machine on the register, which then has an hour
-- meter, a benchmark and a variance. Sometimes a standing fixture, which has
-- litres and a location. Sometimes a cost head, which has only litres.

CREATE TABLE IF NOT EXISTS fuel_consumer (
    consumer_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    label       text NOT NULL,

    kind        text NOT NULL DEFAULT 'ASSET'
                CHECK (kind IN ('ASSET', 'FIXTURE', 'COST_HEAD')),

    -- Set for kind = ASSET, and that is the whole point: the equipment register
    -- is the identity. A consumer with an asset_id inherits its make, model,
    -- fleet code and every name it is known by elsewhere.
    asset_id    bigint REFERENCES asset(asset_id),

    -- Whose machine it is. Sixteen vendors drew fuel in September.
    vendor_party_id bigint REFERENCES party(party_id),

    -- HMR for an excavator, KM for a road vehicle, NONE for a generator that
    -- has neither. Litres per hour and litres per kilometre are different
    -- quantities and must never share a column.
    meter_kind  text NOT NULL DEFAULT 'NONE'
                CHECK (meter_kind IN ('HMR', 'KM', 'NONE')),

    -- How fuel reaches this consumer today. A: sensor and metered dispenser.
    -- B: dispenser plus a typed meter reading. C: everything by hand.
    -- Every consumer is C until hardware arrives, and this column is how the
    -- move to A is made one machine at a time rather than all at once.
    capture_mode text NOT NULL DEFAULT 'C'
                CHECK (capture_mode IN ('A', 'B', 'C')),

    tank_capacity_l numeric(10,2),
    is_active   boolean NOT NULL DEFAULT true,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,

    -- A machine cannot be two consumers. A fixture or cost head has no asset.
    CONSTRAINT fuel_consumer_asset_once UNIQUE (asset_id),
    CONSTRAINT fuel_consumer_kind_sane CHECK (
        (kind = 'ASSET' AND asset_id IS NOT NULL)
     OR (kind <> 'ASSET' AND asset_id IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_fuel_consumer_asset ON fuel_consumer (asset_id);

COMMENT ON COLUMN fuel_consumer.capture_mode IS
    'A = sensor + metered dispenser, B = dispenser + typed meter, C = by hand. '
    'Everything is C until a metered dispenser exists; this column is how '
    'consumers graduate one at a time instead of in a big bang.';


-- ---------------------------------------------------------------------------
-- 3. Diesel arriving
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fuel_receipt (
    receipt_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issuing_point_id bigint NOT NULL REFERENCES fuel_issuing_point(issuing_point_id),
    on_date     date NOT NULL,
    litres      numeric(10,2) NOT NULL CHECK (litres > 0),

    supplier_party_id bigint REFERENCES party(party_id),
    -- What the delivery paper says. Not an SAP posting -- a reference somebody
    -- can look up when a figure is questioned.
    invoice_no  text,
    rate_per_l  numeric(10,3),

    -- To be filled when a posting channel exists. Nothing writes it today.
    sap_reference text,

    note        text,
    entered_by  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fuel_receipt_day
    ON fuel_receipt (issuing_point_id, on_date DESC);


-- ---------------------------------------------------------------------------
-- 4. Diesel moving between our own points
-- ---------------------------------------------------------------------------
--
-- THE FIX FOR THE WORST NUMBER IN THE WORKBOOK. The four September sheets add
-- to 165,129 litres; the Total sheet says 79,046. A bowser refilled from a tank
-- is recorded as an issue on the tank's sheet and again as stock on the
-- bowser's, so a litre is counted twice and nothing in the grid says so.
--
-- A transfer is its own record. It leaves one point and arrives at another, it
-- is never an issue to a consumer, and consumption totals exclude it by
-- construction rather than by somebody remembering to.

CREATE TABLE IF NOT EXISTS fuel_transfer (
    transfer_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    on_date     date NOT NULL,
    from_point_id bigint NOT NULL REFERENCES fuel_issuing_point(issuing_point_id),
    to_point_id   bigint NOT NULL REFERENCES fuel_issuing_point(issuing_point_id),
    litres      numeric(10,2) NOT NULL CHECK (litres > 0),
    note        text,
    entered_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fuel_transfer_two_points CHECK (from_point_id <> to_point_id)
);

CREATE INDEX IF NOT EXISTS ix_fuel_transfer_day ON fuel_transfer (on_date DESC);

COMMENT ON TABLE fuel_transfer IS
    'Diesel moved from one of our points to another -- a bowser refilled from a '
    'tank. Separate from an issue because recording it as one is what made the '
    'four register sheets add to twice the real consumption.';


-- ---------------------------------------------------------------------------
-- 5. One issue of fuel
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fuel_issue (
    issue_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    on_date     date NOT NULL,
    shift       text CHECK (shift IN ('A', 'B', 'C', 'GEN')),

    issuing_point_id bigint NOT NULL REFERENCES fuel_issuing_point(issuing_point_id),
    consumer_id bigint NOT NULL REFERENCES fuel_consumer(consumer_id),
    litres      numeric(10,2) NOT NULL CHECK (litres > 0 AND litres < 20000),

    -- The meter on the machine at the moment of issue, in whatever unit that
    -- machine is measured in. This is what makes consumption computable at all,
    -- and the reason the logbooks fail is that it was kept somewhere else.
    meter_reading numeric(12,2),
    meter_kind  text CHECK (meter_kind IN ('HMR', 'KM')),

    -- WHERE THE FIGURE CAME FROM, and never nullable. A litre from a sensor and
    -- a litre from a notebook are not equally certain, and a screen that shows
    -- them identically is lying quietly.
    capture_mode text NOT NULL DEFAULT 'C'
                CHECK (capture_mode IN ('A', 'B', 'C')),
    source      text NOT NULL DEFAULT 'MANUAL'
                CHECK (source IN ('SENSOR', 'DISPENSER', 'MANUAL', 'IMPORT')),

    -- Who handed it over and who took it. The register has both columns and
    -- they are the only accountability in the current process.
    issued_by   text,
    received_by text,
    operator_party_id bigint REFERENCES party(party_id),

    -- Where an imported row came from, so a questioned figure can be traced to
    -- the sheet and row it was read out of.
    import_ref  text,

    sap_reference text,
    note        text,
    entered_by  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fuel_issue_day ON fuel_issue (on_date DESC);
CREATE INDEX IF NOT EXISTS ix_fuel_issue_point ON fuel_issue (issuing_point_id, on_date DESC);
CREATE INDEX IF NOT EXISTS ix_fuel_issue_consumer ON fuel_issue (consumer_id, on_date DESC);


-- ---------------------------------------------------------------------------
-- 6. The pump totaliser -- the independent witness
-- ---------------------------------------------------------------------------
--
-- Security already writes these in a paper notebook, and that notebook is not a
-- failing to be engineered away: it is the only check that exists, and in
-- September it worked. Two of four points reconciled to the litre; one was out
-- by 2,154, and the evidence was sitting in the workbook uncompared.
--
-- IT MUST ACCEPT A READING IT BELIEVES IS WRONG. A closing figure below the
-- opening is recorded and flagged, never refused. A validation that blocks the
-- entry means the notebook wins and we get nothing.

CREATE TABLE IF NOT EXISTS fuel_meter_reading (
    meter_reading_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issuing_point_id bigint NOT NULL REFERENCES fuel_issuing_point(issuing_point_id),
    on_date     date NOT NULL,
    shift       text NOT NULL DEFAULT 'GEN'
                CHECK (shift IN ('A', 'B', 'C', 'GEN')),

    opening_reading numeric(14,2),
    closing_reading numeric(14,2),

    -- Set by the application, not by a CHECK, precisely so that an impossible
    -- reading can still be stored. The reason is kept with it.
    is_suspect  boolean NOT NULL DEFAULT false,
    suspect_reason text,

    entered_by  text,
    entered_at  timestamptz NOT NULL DEFAULT now(),
    -- The page in the notebook, so the paper and the record can be tied
    -- together when somebody asks.
    paper_ref   text,
    note        text,

    CONSTRAINT uq_fuel_meter UNIQUE (issuing_point_id, on_date, shift)
);

CREATE INDEX IF NOT EXISTS ix_fuel_meter_day
    ON fuel_meter_reading (issuing_point_id, on_date DESC);


-- ---------------------------------------------------------------------------
-- 7. The meter on the machine
-- ---------------------------------------------------------------------------
--
-- What the 98 HSD logbook sheets are for. 120 rows across 86 of them carry a
-- negative working-hours figure, because the sheet subtracts a blank cell and
-- then carries the error forward all month. Here the two readings are stored
-- and the difference is derived, so a missing closing reading leaves a gap
-- rather than a negative number that looks like data.

CREATE TABLE IF NOT EXISTS consumer_meter_reading (
    consumer_meter_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    consumer_id bigint NOT NULL REFERENCES fuel_consumer(consumer_id),
    on_date     date NOT NULL,
    shift       text NOT NULL DEFAULT 'GEN'
                CHECK (shift IN ('A', 'B', 'C', 'GEN')),

    meter_kind  text NOT NULL CHECK (meter_kind IN ('HMR', 'KM')),
    opening_reading numeric(12,2),
    closing_reading numeric(12,2),

    idle_hours  numeric(6,2),
    breakdown_hours numeric(6,2),

    is_suspect  boolean NOT NULL DEFAULT false,
    suspect_reason text,
    source      text NOT NULL DEFAULT 'MANUAL'
                CHECK (source IN ('SENSOR', 'MANUAL', 'IMPORT')),
    import_ref  text,
    entered_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    note        text,

    CONSTRAINT uq_consumer_meter UNIQUE (consumer_id, on_date, shift)
);

CREATE INDEX IF NOT EXISTS ix_consumer_meter_day
    ON consumer_meter_reading (consumer_id, on_date DESC);


-- ---------------------------------------------------------------------------
-- 8. What a machine ought to burn
-- ---------------------------------------------------------------------------
--
-- Not one benchmark for the fleet. An excavator is not a tipper is not a
-- generator, and two tippers on different hauls are not each other either.
--
-- Effective-dated, with a reason that is NOT NULL: an unexplained norm cannot
-- be told from a typo six months later, and every variance the screen raises
-- will be measured against it.
--
-- AND NOT SEEDED FROM THE LOGBOOKS. Their average column divides by the hour
-- meter instead of hours worked -- one observed row reports 0.0385 L/h where
-- the answer is 1.29, wrong by a factor of 33. Norms come from sensor data and
-- validated issues or they do not come at all.

CREATE TABLE IF NOT EXISTS fuel_benchmark (
    benchmark_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- One or the other: a specific machine, or a class of them.
    consumer_id bigint REFERENCES fuel_consumer(consumer_id),
    asset_type_id bigint REFERENCES asset_type(asset_type_id),
    make        text,
    model       text,

    meter_kind  text NOT NULL CHECK (meter_kind IN ('HMR', 'KM')),
    -- A range, not a number. A single expected figure makes every machine
    -- either over or under and tells nobody anything.
    expected_low  numeric(8,3) NOT NULL,
    expected_high numeric(8,3) NOT NULL,

    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_to   date,

    reason      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,

    CONSTRAINT fuel_benchmark_target CHECK (
        (consumer_id IS NOT NULL) OR (asset_type_id IS NOT NULL)),
    CONSTRAINT fuel_benchmark_range CHECK (expected_high >= expected_low
                                           AND expected_low > 0),
    CONSTRAINT fuel_benchmark_dates CHECK (
        effective_to IS NULL OR effective_to >= effective_from)
);


-- ---------------------------------------------------------------------------
-- 9. How big a gap is worth raising
-- ---------------------------------------------------------------------------
--
-- The fuel office's call, not a developer's, and different per thing measured.
-- Both a percentage and an absolute floor, because 40 per cent of a lighting set is
-- nothing and 3 per cent of a 20,000 litre month is not.

CREATE TABLE IF NOT EXISTS fuel_tolerance (
    tolerance_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scope       text NOT NULL UNIQUE
                CHECK (scope IN ('TANK_TOTALISER', 'ISSUE_VS_SENSOR',
                                 'CONSUMPTION_VS_BENCHMARK', 'METER_ROLLBACK')),
    pct         numeric(6,3),
    absolute_l  numeric(10,2),
    is_active   boolean NOT NULL DEFAULT true,
    note        text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);


-- ---------------------------------------------------------------------------
-- 10. A gap, and its explanation
-- ---------------------------------------------------------------------------
--
-- A row rather than a calculation, because a discrepancy needs a person's
-- explanation attached and a derived figure has nowhere to put one.
--
-- Nothing here concludes anything. A gap between a meter and a register has a
-- dozen honest causes -- a misread digit, an entry made the next morning, a
-- transfer booked one-sided -- and this table records the question and the
-- answer somebody gives, never a verdict.

CREATE TABLE IF NOT EXISTS fuel_exception (
    exception_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    raised_on   date NOT NULL,
    kind        text NOT NULL
                CHECK (kind IN ('TANK_TOTALISER', 'ISSUE_VS_SENSOR',
                                'CONSUMPTION_VS_BENCHMARK', 'METER_ROLLBACK',
                                'SENSOR_SILENT', 'UNMAPPED_NAME')),

    issuing_point_id bigint REFERENCES fuel_issuing_point(issuing_point_id),
    consumer_id bigint REFERENCES fuel_consumer(consumer_id),

    expected_value numeric(14,3),
    actual_value   numeric(14,3),
    gap_value      numeric(14,3),
    -- The question, in words, as the screen will show it.
    detail      text NOT NULL,

    status      text NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN', 'EXPLAINED', 'ACCEPTED', 'STALE')),
    explanation text,
    explained_by text,
    explained_at timestamptz,

    created_at  timestamptz NOT NULL DEFAULT now(),

    -- One open exception per thing per day. A second detection is the same
    -- question asked twice, not a new one.
    CONSTRAINT uq_fuel_exception UNIQUE (raised_on, kind, issuing_point_id, consumer_id)
);

CREATE INDEX IF NOT EXISTS ix_fuel_exception_open
    ON fuel_exception (status, raised_on DESC) WHERE status = 'OPEN';


-- ---------------------------------------------------------------------------
-- 11. The four issuing points, as September had them
-- ---------------------------------------------------------------------------
--
-- Seeded so the first thing the screen shows can be checked against the
-- workbook it replaces. PATRA CARRIER is a contractor's own tanker and
-- OD04G5855 is a bowser -- which is why the transfers table exists.

INSERT INTO fuel_issuing_point (code, label, kind, has_totaliser, note, created_by)
SELECT * FROM (VALUES
    ('OLD_UG', 'Old UG tank', 'TANK', true,
     'Totaliser reconciled exactly in September: 3,130 L issued, 3,130 L dispensed.',
     'migration 073'),
    ('RIL_UG', 'RIL UG tank', 'TANK', true,
     'September: 12,041 L issued against a totaliser delta of 12,042.',
     'migration 073'),
    ('OD04G5855', 'HSD bowser OD04 G 5855', 'BOWSER', true,
     'September: 80,251 L booked against a totaliser delta of 78,097 -- a gap of '
     '2,154 L that nothing in the workbook compared. Refilled from the tanks, so '
     'its intake belongs in fuel_transfer, not fuel_issue.',
     'migration 073'),
    ('PATRA_CARRIER', 'Patra Carrier tanker', 'CONTRACTOR', true,
     'A contractor tanker issuing to its own machines. September reconciled '
     'exactly: 69,707 L.',
     'migration 073')
) AS v(code, label, kind, has_totaliser, note, created_by)
WHERE NOT EXISTS (SELECT 1 FROM fuel_issuing_point);


-- ---------------------------------------------------------------------------
-- 12. Starting tolerances
-- ---------------------------------------------------------------------------
--
-- Deliberately loose. A screen that cries on the first day gets ignored by the
-- second, and the fuel office should tighten these once they have seen a
-- fortnight of real gaps. The September figures are the evidence for where
-- they start: three points inside one litre, one out by 2,154.

INSERT INTO fuel_tolerance (scope, pct, absolute_l, note, updated_by)
SELECT * FROM (VALUES
    ('TANK_TOTALISER', 1.0::numeric, 50.0::numeric,
     'Issued vs totaliser delta. Three of four points were inside 1 L in '
     'September, so 1 per cent or 50 L raises the one that was not.', 'migration 073'),
    ('ISSUE_VS_SENSOR', 10.0::numeric, 25.0::numeric,
     'A tank sensor is not a flow meter; 10 per cent is noise, beyond it is a question.',
     'migration 073'),
    ('CONSUMPTION_VS_BENCHMARK', 15.0::numeric, NULL::numeric,
     'Against the benchmark range, not a single figure.', 'migration 073'),
    ('METER_ROLLBACK', NULL::numeric, 0.0::numeric,
     'A closing reading below the opening. Recorded, never refused.',
     'migration 073')
) AS v(scope, pct, absolute_l, note, updated_by)
WHERE NOT EXISTS (SELECT 1 FROM fuel_tolerance);


-- ---------------------------------------------------------------------------
-- 13. Every machine on the register becomes a consumer
-- ---------------------------------------------------------------------------
--
-- The equipment register is the identity. A consumer row per active asset,
-- carrying the asset's own fleet code, so nothing has to be typed twice and
-- nothing invents a second name for a machine that already has five.
--
-- meter_kind from the asset's own reading_uom where it says so: HOURS for a
-- machine with an hour meter, KM for a road vehicle. NONE where the register
-- does not say, because guessing it wrong puts litres per hour and litres per
-- kilometre in one column.
--
-- Fixtures and cost heads -- the generators, the guest house, MISCELLANEOUS --
-- are NOT seeded. They are real and they draw fuel, but naming them is the
-- fuel office's job, not a migration's.

INSERT INTO fuel_consumer (code, label, kind, asset_id, meter_kind,
                           tank_capacity_l, is_active, created_by)
SELECT a.fleet_code,
       COALESCE(NULLIF(TRIM(a.nickname), ''), a.fleet_code),
       'ASSET',
       a.asset_id,
       CASE UPPER(COALESCE(a.reading_uom, ''))
            WHEN 'HOURS' THEN 'HMR'
            WHEN 'HR'    THEN 'HMR'
            WHEN 'HMR'   THEN 'HMR'
            WHEN 'KM'    THEN 'KM'
            ELSE 'NONE' END,
       a.tank_capacity_l,
       a.status NOT IN ('DISPOSED', 'SCRAPPED', 'CANNIBALISED'),
       'migration 073'
  FROM asset a
 WHERE NOT EXISTS (SELECT 1 FROM fuel_consumer c WHERE c.asset_id = a.asset_id)
   AND NOT EXISTS (SELECT 1 FROM fuel_consumer c WHERE c.code = a.fleet_code);


-- ---------------------------------------------------------------------------
-- 14. Two more ways a machine is named
-- ---------------------------------------------------------------------------
--
-- asset_identity already carries TELEMATICS, SAP, WEIGHBRIDGE and the rest, and
-- holds eight rows. The same excavator is EX-2 to the shift board,
-- 'BAL_Z AXIS 470-2(Excavator)' to the fuel sensor, 'ZAXIS-470-2' to the
-- logbook, 'PC - 200' or a registration plate to the diesel register, and
-- 1210021012 to SAP. Five names, and the mapping is data entry, not code.

ALTER TABLE asset_identity DROP CONSTRAINT IF EXISTS asset_identity_system_check;
ALTER TABLE asset_identity ADD CONSTRAINT asset_identity_system_check CHECK (
    system IN ('TELEMATICS', 'HOTO', 'WEIGHBRIDGE', 'RFID', 'SAP', 'SECURITY',
               'LEGACY', 'BUSINESS_PLAN', 'FUEL_REGISTER', 'FUEL_SENSOR'));

COMMENT ON CONSTRAINT asset_identity_system_check ON asset_identity IS
    'FUEL_REGISTER is what the diesel register calls this machine -- a '
    'registration plate on one row and "PC - 200" on the next. FUEL_SENSOR is '
    'the Technoton vehicle_desc. Both are needed because neither matches the '
    'fleet code and matching on a cleaned-up string guesses wrong silently.';


-- ---------------------------------------------------------------------------
-- 15. A road vehicle is measured in kilometres
-- ---------------------------------------------------------------------------
--
-- Section 13 read meter_kind from asset.reading_uom, which says HOURS for all
-- 97 machines -- including the ambulance. That cannot be right, and litres per
-- hour on a vehicle that is measured in kilometres is not a smaller error than
-- a missing figure; it is a number that looks usable and is not.
--
-- Corrected only where the answer is not in doubt: an ambulance, a car, a bus,
-- a van and a motorcycle run on an odometer. The HSD logbooks agree -- their
-- fifteen KM-based sheets are the buses, the Scorpio and the hired road
-- vehicles.
--
-- TIPPERS ARE DELIBERATELY LEFT ON HMR. A mine haul truck running a fixed
-- circuit is legitimately measured by hour meter, the MAN logbook sheets are
-- HMR, and 60 of the 97 are tippers -- too many to change on a guess. The fuel
-- office can set them from the screen, machine by machine, and the screen says
-- which ones nobody has confirmed.
--
-- Guarded on created_by, so a value somebody has since corrected by hand is
-- never overwritten by a re-run.

UPDATE fuel_consumer c
   SET meter_kind = 'KM'
  FROM asset a, asset_type t
 WHERE c.asset_id = a.asset_id
   AND a.asset_type_id = t.asset_type_id
   AND c.created_by = 'migration 073'
   AND c.meter_kind = 'HMR'
   AND UPPER(t.name) IN ('CAR', 'SUV', 'MUV', 'BUS', 'PICKUP', 'MOTORCYCLE',
                         'AMBULANCE', 'MAINTENANCE VAN', 'TRAILER');
