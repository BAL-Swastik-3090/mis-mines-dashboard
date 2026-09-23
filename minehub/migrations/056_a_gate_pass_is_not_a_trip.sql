-- 056: a gate pass lasts a contract; a trip lasts twenty minutes.
--
-- 054 built the gate pass as a visit — in at the gate, weighed, out at the
-- gate, done by evening. That is how an outside delivery lorry behaves and it
-- is not how this mine works.
--
-- A contractor wins work and brings in tippers. Each one is registered once,
-- driven through the gate once, and then stays. It runs for weeks or months,
-- pit to ROM and back, twenty-five times a shift, and does not leave the
-- boundary until the contract ends or it goes out for repair. Under 054 that
-- vehicle needed a fresh gate pass for every haul: a thousand gate passes a
-- shift, every one of them saying the truck was still exactly where it was.
--
-- So the two ideas are separated.
--
--   gate_pass   the vehicle is inside the mine. Opened when it first drives
--               in, closed when it finally drives out. Months, not hours.
--   trip        one load moved. Opened when the truck rolls onto the deck,
--               closed when it has been weighed. Minutes.
--
-- A trip belongs to a gate pass, so every load is attributable to a vehicle
-- that somebody let in, under a contract, with a registered operator driving
-- it. That chain is the point: it is what turns a weight into an accountable
-- figure rather than a number on a printout.
--
-- ONE POINT OF CAPTURE
-- Everything about a trip is recorded at the weighbridge, by the person
-- weighing it, at the moment of weighing: the vehicle, the driver on it now,
-- which pit the material was excavated from, where it is going, and what it
-- is. Nothing is inferred and nothing is entered anywhere else. That is what
-- makes the record checkable — one screen, one moment, one person.
--
-- SAFE TO RESTRUCTURE
-- gate_pass and weighment are empty. Nothing is in production use, so the
-- shape is corrected now rather than migrated around for the next five years.

-- ---------------------------------------------------------------------------
-- 1. The gate pass becomes a stay, not a visit
-- ---------------------------------------------------------------------------
ALTER TABLE gate_pass DROP CONSTRAINT IF EXISTS gate_pass_status_check;

-- Any pass already opened under the old four-state vocabulary is carried over
-- rather than discarded. OPEN and WEIGHED both meant "the vehicle is inside",
-- which is now simply IN; CLOSED meant it had left. Passes raised while the
-- gate was being set up are real records of somebody's shift and are not the
-- platform's to throw away because the model underneath them changed.
UPDATE gate_pass SET status = CASE status
        WHEN 'OPEN'      THEN 'IN'
        WHEN 'WEIGHED'   THEN 'IN'
        WHEN 'CLOSED'    THEN 'OUT'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        ELSE status END
 WHERE status IN ('OPEN', 'WEIGHED', 'CLOSED');

ALTER TABLE gate_pass ADD CONSTRAINT gate_pass_status_check
    CHECK (status IN ('IN', 'OUT', 'CANCELLED'));
ALTER TABLE gate_pass ALTER COLUMN status SET DEFAULT 'IN';

-- Why the vehicle is here. A contractor's tipper and a one-off delivery lorry
-- both come through the same gate and are not the same thing afterwards: one
-- is expected to stay and haul, the other to leave within the hour.
ALTER TABLE gate_pass ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'MINING_CONTRACT';
ALTER TABLE gate_pass DROP CONSTRAINT IF EXISTS gate_pass_purpose_known;
ALTER TABLE gate_pass ADD CONSTRAINT gate_pass_purpose_known CHECK (purpose IN (
    'MINING_CONTRACT',   -- a contractor's machine, here to work, here for months
    'DESPATCH',          -- came to collect ore and go
    'DELIVERY',          -- brought something in
    'VISIT'              -- everything else
));

ALTER TABLE gate_pass ADD COLUMN IF NOT EXISTS contract_ref  text;
ALTER TABLE gate_pass ADD COLUMN IF NOT EXISTS expected_until date;
ALTER TABLE gate_pass ADD COLUMN IF NOT EXISTS exit_reason   text;

COMMENT ON TABLE gate_pass IS
    'A vehicle''s stay inside the mine. Opened once when it first drives in and '
    'closed once when it finally leaves — for a contractor''s tipper that is '
    'the length of the contract. The loads it carries in between are trips.';

-- The per-trip fields move to trip, where they belong. A stay does not have a
-- material or a source: the vehicle that hauled ore from the north pit this
-- morning hauls overburden to the dump this afternoon.
ALTER TABLE gate_pass DROP COLUMN IF EXISTS material_id;
ALTER TABLE gate_pass DROP COLUMN IF EXISTS grade;
ALTER TABLE gate_pass DROP COLUMN IF EXISTS sub_grade;
ALTER TABLE gate_pass DROP COLUMN IF EXISTS source_location_id;
ALTER TABLE gate_pass DROP COLUMN IF EXISTS dest_location_id;
ALTER TABLE gate_pass DROP COLUMN IF EXISTS shift_code;
ALTER TABLE gate_pass DROP COLUMN IF EXISTS production_date;

-- The open-stay indexes now mean "is this vehicle currently inside".
DROP INDEX IF EXISTS gate_pass_one_open_per_asset;
DROP INDEX IF EXISTS gate_pass_one_open_per_vehicle_text;
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_one_stay_per_asset
    ON gate_pass (asset_id) WHERE asset_id IS NOT NULL AND status = 'IN';
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_one_stay_per_vehicle_text
    ON gate_pass (upper(regexp_replace(vehicle_no_text, '[^A-Za-z0-9]', '', 'g')))
    WHERE asset_id IS NULL
      AND nullif(trim(vehicle_no_text), '') IS NOT NULL
      AND status = 'IN';

-- ---------------------------------------------------------------------------
-- 2. The trip
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip (
    trip_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trip_no        text NOT NULL UNIQUE,
    gate_pass_id   bigint NOT NULL REFERENCES gate_pass (gate_pass_id),
    -- Carried here as well as on the gate pass. Every question this table is
    -- asked starts "how much did that vehicle move", and making it a join
    -- through the stay would put gate_pass in the middle of every report.
    asset_id       bigint REFERENCES asset (asset_id),

    -- The driver on THIS trip. Not the one on the gate pass: a tipper that
    -- stays six months is driven by a different person every shift, and a
    -- load has to be attributable to whoever was actually in the seat.
    operator_id    bigint REFERENCES operator (operator_id),
    driver_name_text text,

    -- Where it came from and where it went. Source is the excavation point —
    -- which pit, which face — because that is the question production asks
    -- and the one nothing else on the platform can answer after the fact.
    source_location_id bigint REFERENCES location (location_id),
    dest_location_id   bigint REFERENCES location (location_id),
    material_id    bigint REFERENCES material (material_id),
    grade          text,
    sub_grade      text,

    shift_code     text,
    production_date date NOT NULL DEFAULT CURRENT_DATE,
    weighbridge_id bigint REFERENCES weighbridge (weighbridge_id),

    status         text NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN', 'WEIGHED', 'CANCELLED')),
    cancel_reason  text,
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);
CREATE INDEX IF NOT EXISTS ix_trip_gate_pass ON trip (gate_pass_id);
CREATE INDEX IF NOT EXISTS ix_trip_asset_day ON trip (asset_id, production_date DESC);
CREATE INDEX IF NOT EXISTS ix_trip_day ON trip (production_date DESC, shift_code);
CREATE INDEX IF NOT EXISTS ix_trip_source ON trip (source_location_id, production_date DESC);
CREATE INDEX IF NOT EXISTS ix_trip_open ON trip (status) WHERE status = 'OPEN';

DROP TRIGGER IF EXISTS trip_touch ON trip;
CREATE TRIGGER trip_touch BEFORE UPDATE ON trip
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A vehicle is on the deck once at a time. Two open trips for one tipper means
-- the next weight could land on either, and nobody would know which.
CREATE UNIQUE INDEX IF NOT EXISTS trip_one_open_per_asset
    ON trip (asset_id) WHERE asset_id IS NOT NULL AND status = 'OPEN';

COMMENT ON TABLE trip IS
    'One load moved, captured at the weighbridge by the person weighing it. '
    'Belongs to the vehicle''s stay, so every load traces back to a machine '
    'somebody admitted, under a contract, with a named driver on it.';

-- ---------------------------------------------------------------------------
-- 3. Weighments now hang off the trip
-- ---------------------------------------------------------------------------
-- The old view reads weighment.gate_pass_id, so it has to go before the column
-- it depends on can be dropped. Postgres would otherwise refuse, and CASCADE
-- would drop whatever else happened to depend on it without saying what.
DROP VIEW IF EXISTS gate_pass_weights;

ALTER TABLE weighment DROP CONSTRAINT IF EXISTS weighment_gate_pass_id_fkey;
DROP INDEX IF EXISTS weighment_one_of_each_kind;
ALTER TABLE weighment DROP COLUMN IF EXISTS gate_pass_id;
ALTER TABLE weighment ADD COLUMN IF NOT EXISTS trip_id bigint NOT NULL
    REFERENCES trip (trip_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_weighment_trip ON weighment (trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS weighment_one_of_each_kind
    ON weighment (trip_id, kind);

-- ---------------------------------------------------------------------------
-- 4. Standing tare, so a tipper is not tared twenty-five times a shift
-- ---------------------------------------------------------------------------
-- A haul cycle weighs the loaded truck and nothing else. The empty weight is
-- taken properly now and then and reused, which is the only way the throughput
-- works at all.
--
-- The date matters as much as the figure. A tare goes stale — mud builds up on
-- the body, a tray is replaced, the fuel tank empties — and a stale tare
-- silently inflates every net weight taken against it. Keeping when it was
-- last taken is what lets the screen say "this figure rests on a tare nobody
-- has checked for three weeks" instead of quietly reporting production that
-- is not there.
ALTER TABLE asset ADD COLUMN IF NOT EXISTS standing_tare_kg  numeric(10,2);
ALTER TABLE asset ADD COLUMN IF NOT EXISTS tare_taken_at     timestamptz;
ALTER TABLE asset ADD COLUMN IF NOT EXISTS tare_taken_by     text;
ALTER TABLE asset ADD COLUMN IF NOT EXISTS tare_weighment_id bigint;

COMMENT ON COLUMN asset.standing_tare_kg IS
    'The vehicle''s empty weight, reused across hauls so a tipper need not be '
    'tared on every trip. Refreshed by weighing it empty; tare_taken_at says '
    'when, and a net computed against an old tare is flagged as an estimate.';

-- ---------------------------------------------------------------------------
-- 5. Net weight, from whichever tare was actually used
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW trip_weights AS
SELECT t.trip_id,
       g.weight_kg AS gross_kg,
       -- A tare weighed on this trip wins over the vehicle's standing one.
       COALESCE(w_tare.weight_kg, a.standing_tare_kg) AS tare_kg,
       CASE WHEN w_tare.weight_kg IS NOT NULL THEN 'WEIGHED'
            WHEN a.standing_tare_kg IS NOT NULL THEN 'STANDING'
            ELSE NULL END AS tare_source,
       a.tare_taken_at,
       g.weight_kg - COALESCE(w_tare.weight_kg, a.standing_tare_kg) AS net_kg,
       (g.capture_mode = 'MANUAL' OR w_tare.capture_mode = 'MANUAL') AS has_manual,
       g.weighed_at AS gross_at,
       -- Days since the standing tare was taken, when that is what was used.
       CASE WHEN w_tare.weight_kg IS NULL AND a.tare_taken_at IS NOT NULL
            THEN EXTRACT(DAY FROM (now() - a.tare_taken_at))::int END AS tare_age_days
  FROM trip t
  LEFT JOIN asset a ON a.asset_id = t.asset_id
  LEFT JOIN weighment g      ON g.trip_id = t.trip_id AND g.kind = 'GROSS'
  LEFT JOIN weighment w_tare ON w_tare.trip_id = t.trip_id AND w_tare.kind = 'TARE';

COMMENT ON VIEW trip_weights IS
    'Net per trip, and which tare produced it. A net from a standing tare is '
    'not the same claim as one from a tare weighed minutes earlier, so the '
    'view says which it is rather than presenting both as the same number.';

-- ---------------------------------------------------------------------------
-- 6. The places, as this mine names them
-- ---------------------------------------------------------------------------
-- Taken from the source and destination dropdowns on the existing weighbridge
-- screen rather than invented: PIT / MRL / Dump Yard / Outside, with the pit
-- sides Bottom, East, North, South and West; and Stack Yard / COB / Dump /
-- Outside on the other end. Anything missing is added in the portal — these
-- are rows, not a list in the code.
INSERT INTO location (code, name, location_type, created_by) VALUES
  ('PIT-BOTTOM',  'Pit — Bottom',      'PIT',       'MIGRATION 056'),
  ('PIT-EAST',    'Pit — East',        'PIT',       'MIGRATION 056'),
  ('PIT-NORTH',   'Pit — North',       'PIT',       'MIGRATION 056'),
  ('PIT-SOUTH',   'Pit — South',       'PIT',       'MIGRATION 056'),
  ('PIT-WEST',    'Pit — West',        'PIT',       'MIGRATION 056'),
  ('MRL',         'MRL',               'STOCKPILE', 'MIGRATION 056'),
  ('DUMP-YARD',   'Dump Yard',         'DUMP',      'MIGRATION 056'),
  ('STACK-YARD',  'Stack Yard',        'STOCKYARD', 'MIGRATION 056'),
  ('COB',         'COB Plant',         'PLANT',     'MIGRATION 056'),
  ('ROM',         'ROM Pad',           'ROM',       'MIGRATION 056'),
  ('OUTSIDE',     'Outside the mine',  'GATE',      'MIGRATION 056')
ON CONFLICT (code) DO NOTHING;

-- Everything sits under the site the platform already knows about.
UPDATE location SET parent_id = (SELECT location_id FROM location WHERE code = 'KALIAPANI')
 WHERE created_by = 'MIGRATION 056' AND parent_id IS NULL;

-- The materials the bridge actually sees, from the same screen.
INSERT INTO material (code, name, material_class, uom, is_saleable, created_by) VALUES
  ('OVERBURDEN', 'Overburden',                  'WASTE', 'MT', FALSE, 'MIGRATION 056'),
  ('ORE-LG',     'Low Grade Ore (<40% Cr2O3)',  'ORE',   'MT', TRUE,  'MIGRATION 056'),
  ('ORE-MG',     'Medium Grade Ore',            'ORE',   'MT', TRUE,  'MIGRATION 056'),
  ('ORE-HG',     'High Grade Ore',              'ORE',   'MT', TRUE,  'MIGRATION 056'),
  ('CONCENTRATE','Chrome Concentrate',          'ORE',   'MT', TRUE,  'MIGRATION 056'),
  ('MINERAL-REJ','Mineral Reject',              'WASTE', 'MT', FALSE, 'MIGRATION 056')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. One more right: taking a vehicle's standing tare
-- ---------------------------------------------------------------------------
-- Separate from weighing a trip. A standing tare is reused across every haul
-- that vehicle makes until it is next taken, so getting it wrong is not one
-- bad figure, it is a fortnight of them.
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
  ('wb.tare', 'Weighbridge', 'Set a vehicle''s standing tare',
   'Record a vehicle''s empty weight for use across its hauls. Every net '
   'weight for that vehicle is worked out from it until it is taken again, '
   'so it is held separately from weighing a single trip.', TRUE, 375)
ON CONFLICT (code) DO NOTHING;
