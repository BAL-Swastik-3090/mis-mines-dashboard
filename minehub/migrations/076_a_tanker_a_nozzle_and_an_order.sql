-- 076: the actual flow — a tanker, a nozzle, an order, and what was really put in.
--
-- WHAT WAS MISSING. Migration 073 modelled an issue as "litres left this
-- point and reached this machine". That is the summary, not the process. The
-- process the mine actually runs is:
--
--   1. A tanker arrives AGAINST A PURCHASE ORDER. It is dipped, decanted into
--      a tank, and dipped again. The invoice says one quantity and the dip
--      says another, and the difference is a fact somebody has to sign for.
--
--   2. Somebody RAISES AN ORDER for fuel -- an indent for a machine, a shift,
--      a quantity.
--
--   3. The machine comes to a NOZZLE, or the internal tanker goes to the
--      machine, and a quantity is ACTUALLY PUT IN, at a time, by a person.
--      Ordered 200 and filled 185 is the normal case, not an error.
--
-- Each of those three is a separate record with a separate owner, and
-- collapsing them into one row is what made the workbook unauditable: it held
-- the answer and none of the working.
--
-- SAP STILL OWNS THE PURCHASE ORDER. po_no here is a REFERENCE, so a litre in
-- a tank can be traced back to the document that bought it. Nothing is posted
-- and no PO is created here.


-- ---------------------------------------------------------------------------
-- 1. A nozzle is where fuel actually comes out
-- ---------------------------------------------------------------------------
--
-- "Which point" was too coarse. A tank has Nozzle 1 and Nozzle 2; the mine's
-- own tanker drives to the equipment and fills it where it stands; the COB
-- plant draws at its own point. Two machines filled at the same tank on the
-- same shift may have been filled from different nozzles, and when a
-- totaliser disagrees with the register that is the first thing worth knowing.
--
-- Each nozzle carries its own totaliser, because that is how they are built.

CREATE TABLE IF NOT EXISTS fuel_nozzle (
    nozzle_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issuing_point_id bigint NOT NULL REFERENCES fuel_issuing_point(issuing_point_id),
    code        text NOT NULL,
    label       text NOT NULL,

    -- FIXED is a nozzle on a tank and the machine comes to it. MOBILE is a
    -- hose on a tanker that goes to the machine. The difference decides
    -- whether a location is worth recording with the fill.
    kind        text NOT NULL DEFAULT 'FIXED'
                CHECK (kind IN ('FIXED', 'MOBILE')),

    has_totaliser boolean NOT NULL DEFAULT true,
    is_active   boolean NOT NULL DEFAULT true,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,

    CONSTRAINT uq_fuel_nozzle UNIQUE (issuing_point_id, code)
);

CREATE INDEX IF NOT EXISTS ix_fuel_nozzle_point
    ON fuel_nozzle (issuing_point_id) WHERE is_active;

-- A nozzle's own totaliser, read like the point's.
ALTER TABLE fuel_meter_reading ADD COLUMN IF NOT EXISTS nozzle_id bigint
    REFERENCES fuel_nozzle(nozzle_id);

-- The unique key has to widen with it: two nozzles at one point are read
-- separately on the same shift, and the old key allowed only one reading.
ALTER TABLE fuel_meter_reading DROP CONSTRAINT IF EXISTS uq_fuel_meter;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_meter_point_day
    ON fuel_meter_reading (issuing_point_id, on_date, shift,
                           COALESCE(nozzle_id, 0));


-- ---------------------------------------------------------------------------
-- 2. A tanker arriving, against a purchase order
-- ---------------------------------------------------------------------------
--
-- The invoice quantity and the dip quantity are different numbers and the
-- difference is the point. A tanker that invoices 12,000 litres and decants
-- 11,940 has lost 60 litres somewhere between the refinery and the tank, and
-- that is either temperature, a short load, or something worth asking about.
-- Recording only one of the two throws the question away.

ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS po_no text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS challan_no text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS tanker_no text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS transporter text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS invoice_litres numeric(10,2);
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS dip_before numeric(10,2);
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS dip_after numeric(10,2);
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS arrived_at timestamptz;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS decanted_at timestamptz;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS received_by text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS is_suspect boolean NOT NULL DEFAULT false;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS suspect_reason text;

COMMENT ON COLUMN fuel_receipt.litres IS
    'What actually went into the tank -- the figure the operational ledger '
    'moves on. Compare against invoice_litres for the short-delivery question.';
COMMENT ON COLUMN fuel_receipt.invoice_litres IS
    'What the vendor billed. Differs from litres more often than not, and the '
    'difference is the reason both are kept.';
COMMENT ON COLUMN fuel_receipt.po_no IS
    'A reference to the SAP purchase order, so a litre in a tank can be traced '
    'to the document that bought it. Nothing is posted to SAP from here.';


-- ---------------------------------------------------------------------------
-- 3. An order for fuel, and then what was really put in
-- ---------------------------------------------------------------------------
--
-- Ordered and filled are not the same number and pretending they are is how a
-- tank quietly goes out of balance. A tipper indented for 200 litres takes 185
-- because that is what its tank had room for; an excavator indented for 300
-- takes 300 on the first fill and 120 on a second the same shift.
--
-- So an order can be filled by more than one issue, and its status follows
-- from the issues rather than being set by hand -- a status somebody has to
-- remember to update is a status that is wrong by Friday.

CREATE TABLE IF NOT EXISTS fuel_order (
    order_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Human-facing, because people talk about these on the telephone.
    order_no    text NOT NULL UNIQUE,

    on_date     date NOT NULL,
    shift       text CHECK (shift IN ('A', 'B', 'C', 'GEN')),

    consumer_id bigint NOT NULL REFERENCES fuel_consumer(consumer_id),
    -- Where it is expected to be filled. Not binding: a machine sent to
    -- Nozzle 1 and filled at Nozzle 2 is a normal morning, and the issue
    -- records where it actually happened.
    issuing_point_id bigint REFERENCES fuel_issuing_point(issuing_point_id),
    nozzle_id   bigint REFERENCES fuel_nozzle(nozzle_id),

    requested_l numeric(10,2) NOT NULL CHECK (requested_l > 0),
    purpose     text,

    status      text NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN', 'PART_FILLED', 'FILLED',
                                  'CANCELLED', 'EXPIRED')),

    requested_by text,
    approved_by  text,
    approved_at  timestamptz,

    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

CREATE INDEX IF NOT EXISTS ix_fuel_order_open
    ON fuel_order (on_date DESC, status) WHERE status IN ('OPEN', 'PART_FILLED');
CREATE INDEX IF NOT EXISTS ix_fuel_order_consumer
    ON fuel_order (consumer_id, on_date DESC);


-- ---------------------------------------------------------------------------
-- 4. An issue gains a nozzle, a time, and the order it answers
-- ---------------------------------------------------------------------------
--
-- filled_at is the ACTUAL time fuel went in, which is not the same as the day
-- the row belongs to and not the same as when somebody typed it. A fill at
-- 23:40 on a night shift, keyed in at 06:10 the next morning, has three
-- different times attached to it and only one of them is the truth about the
-- diesel.

ALTER TABLE fuel_issue ADD COLUMN IF NOT EXISTS nozzle_id bigint
    REFERENCES fuel_nozzle(nozzle_id);
ALTER TABLE fuel_issue ADD COLUMN IF NOT EXISTS order_id bigint
    REFERENCES fuel_order(order_id);
ALTER TABLE fuel_issue ADD COLUMN IF NOT EXISTS filled_at timestamptz;
-- Where a mobile nozzle was when it filled. Free text on purpose: the mine's
-- own words for a place ("Pit Bottom", "LG Dump") beat a dropdown that would
-- force the operator to choose between the truth and the list.
ALTER TABLE fuel_issue ADD COLUMN IF NOT EXISTS filled_location text;

CREATE INDEX IF NOT EXISTS ix_fuel_issue_order ON fuel_issue (order_id);
CREATE INDEX IF NOT EXISTS ix_fuel_issue_nozzle ON fuel_issue (nozzle_id);

COMMENT ON COLUMN fuel_issue.filled_at IS
    'When the diesel actually went in. Distinct from on_date, which is the '
    'production day it is booked to, and from created_at, which is when '
    'somebody typed it.';


-- ---------------------------------------------------------------------------
-- 5. An order's status follows from its fills
-- ---------------------------------------------------------------------------
--
-- Derived, never typed. A status field somebody has to remember to update is a
-- status field that is wrong by Friday, and this one decides what the fuel
-- point sees as still outstanding.
--
-- 98 per cent counts as filled: a machine that took 197 of an indented 200 is
-- not still waiting for three litres, and leaving it open means the pending
-- list fills with orders nobody will ever close.

CREATE OR REPLACE FUNCTION fuel_order_restate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    oid bigint := COALESCE(NEW.order_id, OLD.order_id);
    got numeric;
    want numeric;
BEGIN
    IF oid IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    SELECT COALESCE(SUM(litres), 0) INTO got
      FROM fuel_issue WHERE order_id = oid;
    SELECT requested_l INTO want FROM fuel_order WHERE order_id = oid;

    UPDATE fuel_order SET status = CASE
        WHEN status IN ('CANCELLED', 'EXPIRED') THEN status
        WHEN got <= 0            THEN 'OPEN'
        WHEN got >= want * 0.98  THEN 'FILLED'
        ELSE 'PART_FILLED' END
     WHERE order_id = oid;
    RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_fuel_order_restate ON fuel_issue;
CREATE TRIGGER trg_fuel_order_restate
    AFTER INSERT OR UPDATE OF litres, order_id OR DELETE ON fuel_issue
    FOR EACH ROW EXECUTE FUNCTION fuel_order_restate();


-- ---------------------------------------------------------------------------
-- 6. A new machine on the register becomes a fuel consumer by itself
-- ---------------------------------------------------------------------------
--
-- The admin Bolero, the employee cars, the buses. You asked whether they need
-- their own section or belong in the equipment master under a category like
-- SUV -- and the register already HAS those categories: Car, SUV, MUV, Bus,
-- Pickup and Motorcycle all exist as asset types and all hold zero rows.
--
-- So they go in the equipment master like anything else, and this trigger
-- means they appear in fuel management without a second piece of data entry.
-- Migration 073 seeded consumers for the 97 machines that existed that day;
-- without this, the 98th would have been invisible to fuel forever.
--
-- Road vehicles come in measured in kilometres. Everything else in hours,
-- which is the register's own reading_uom and is right for a machine.

CREATE OR REPLACE FUNCTION fuel_consumer_for_asset() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    tname text;
BEGIN
    SELECT UPPER(name) INTO tname FROM asset_type
     WHERE asset_type_id = NEW.asset_type_id;

    INSERT INTO fuel_consumer (code, label, kind, asset_id, meter_kind,
                               tank_capacity_l, is_active, created_by)
    SELECT NEW.fleet_code,
           COALESCE(NULLIF(TRIM(NEW.nickname), ''), NEW.fleet_code),
           'ASSET', NEW.asset_id,
           CASE WHEN tname IN ('CAR', 'SUV', 'MUV', 'BUS', 'PICKUP',
                               'MOTORCYCLE', 'AMBULANCE', 'MAINTENANCE VAN',
                               'TRAILER') THEN 'KM'
                WHEN UPPER(COALESCE(NEW.reading_uom, '')) IN ('KM') THEN 'KM'
                WHEN UPPER(COALESCE(NEW.reading_uom, '')) IN ('HOURS','HR','HMR')
                     THEN 'HMR'
                ELSE 'NONE' END,
           NEW.tank_capacity_l,
           NEW.status NOT IN ('DISPOSED', 'SCRAPPED', 'CANNIBALISED'),
           'trigger: new asset'
     WHERE NOT EXISTS (SELECT 1 FROM fuel_consumer WHERE asset_id = NEW.asset_id)
       AND NOT EXISTS (SELECT 1 FROM fuel_consumer WHERE code = NEW.fleet_code);
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fuel_consumer_for_asset ON asset;
CREATE TRIGGER trg_fuel_consumer_for_asset
    AFTER INSERT ON asset
    FOR EACH ROW EXECUTE FUNCTION fuel_consumer_for_asset();


-- ---------------------------------------------------------------------------
-- 7. The nozzles as they stand
-- ---------------------------------------------------------------------------
--
-- Two nozzles on each underground tank, and a single hose on each tanker
-- because a tanker has one. Editable from the screen: a nozzle taken out of
-- service, or a third one added, is data entry and not a deployment.

INSERT INTO fuel_nozzle (issuing_point_id, code, label, kind, note, created_by)
SELECT p.issuing_point_id, v.code, v.label, v.kind, v.note, 'migration 076'
  FROM fuel_issuing_point p
  JOIN (VALUES
    ('OLD_UG',        'N1', 'Nozzle 1', 'FIXED',  'The machine comes to the tank.'),
    ('OLD_UG',        'N2', 'Nozzle 2', 'FIXED',  'The machine comes to the tank.'),
    ('RIL_UG',        'N1', 'Nozzle 1', 'FIXED',  'The machine comes to the tank.'),
    ('RIL_UG',        'N2', 'Nozzle 2', 'FIXED',  'The machine comes to the tank.'),
    ('OD04G5855',     'HOSE', 'Tanker hose', 'MOBILE',
     'The mine''s own tanker goes to the equipment and fills it where it '
     'stands, so the fill carries a location rather than a nozzle position.'),
    ('PATRA_CARRIER', 'HOSE', 'Tanker hose', 'MOBILE',
     'A contractor tanker, filling its own machines on our lease.')
  ) AS v(point_code, code, label, kind, note) ON v.point_code = p.code
 WHERE NOT EXISTS (SELECT 1 FROM fuel_nozzle WHERE issuing_point_id = p.issuing_point_id);
