-- 057: the gate picks from the registers; it does not ask them to be retyped.
--
-- 056 let the gate take a vehicle number as free text. That is the habit this
-- whole platform exists to break — the equipment register holds 125 machines
-- with their registration numbers, types, owners and capacities, and the
-- operator register holds 211 drivers, and a gate that asks somebody to type
-- "OD35F4475" is a gate that will hold three spellings of one lorry by Friday.
--
-- So a gate pass now names a vehicle rather than describing one.
--
-- TWO KINDS OF VEHICLE, AND THEY ARE GENUINELY DIFFERENT
--
-- A contractor's tipper that comes to work the mine for six months belongs on
-- the equipment register. It is hired plant: it needs a type, a capacity, an
-- owner, a maintenance history, operators assessed on it. Thirty-four such
-- machines are already there under ownership = 'HIRED'. Nothing new is needed
-- for them — the gate picks them from the register that already has them.
--
-- A lorry that arrives once to collect ore is not that, and never will be. It
-- has no maintenance schedule here, no operator competency, no fuel record.
-- Putting it in `asset` would mean either polluting the equipment register and
-- every screen built on it — fifty-seven queries read that table — or adding a
-- filter to all of them and hoping none was missed. Neither is worth it for a
-- lorry we may never see again.
--
-- So visiting vehicles get their own small table. It is not a second equipment
-- register: it holds only what the gate actually needs to identify a truck and
-- what a despatch clerk needs to check it.
--
-- IT DEDUPLICATES ITSELF
-- The registration number is normalised, so "OD 35 F 4475", "od35f4475" and
-- "OD-35-F-4475" are one lorry. A truck that comes fifty times is one row with
-- fifty visits against it, not fifty rows — which is what makes "has this
-- vehicle been here before" a question with an answer.

-- ---------------------------------------------------------------------------
-- 1. Vehicles that visit but are not ours
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visiting_vehicle (
    visiting_vehicle_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    registration_no text NOT NULL,
    -- Stored and generated rather than computed on read, so the unique index
    -- below is one the database maintains and nobody can route around.
    reg_normalised  text GENERATED ALWAYS AS
                      (upper(regexp_replace(registration_no, '[^A-Za-z0-9]', '', 'g'))) STORED,
    vehicle_type    text,           -- Tipper, Trailer, Truck, Tanker…
    make            text,
    model           text,
    axles           smallint,
    payload_capacity_kg numeric(10,2),
    -- Its own standing tare, for the same reason a tipper has one: a despatch
    -- lorry that comes weekly need not be tared twice on every visit.
    standing_tare_kg numeric(10,2),
    tare_taken_at   timestamptz,
    tare_taken_by   text,
    transporter_party_id bigint REFERENCES party (party_id),
    owner_name_text text,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz,
    visits          integer NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'BLACKLISTED', 'INACTIVE')),
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);
CREATE UNIQUE INDEX IF NOT EXISTS visiting_vehicle_one_per_number
    ON visiting_vehicle (reg_normalised);

DROP TRIGGER IF EXISTS visiting_vehicle_touch ON visiting_vehicle;
CREATE TRIGGER visiting_vehicle_touch BEFORE UPDATE ON visiting_vehicle
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE visiting_vehicle IS
    'Outside vehicles — despatch lorries, vendor trucks — identified by a '
    'normalised registration number so the same truck is one row however its '
    'number happens to be typed. Deliberately not the equipment register: '
    'these are not BAL plant and carry no maintenance or competency record.';

COMMENT ON COLUMN visiting_vehicle.visits IS
    'How many times this vehicle has been admitted. Makes "is this a regular '
    'or a stranger" answerable at the gate, which is the question a security '
    'officer actually has.';

-- ---------------------------------------------------------------------------
-- 2. A gate pass names one vehicle, from one register or the other
-- ---------------------------------------------------------------------------
ALTER TABLE gate_pass ADD COLUMN IF NOT EXISTS visiting_vehicle_id bigint
    REFERENCES visiting_vehicle (visiting_vehicle_id);

-- The free-text number goes. Its whole job was to let somebody describe a
-- vehicle instead of naming one, and that is the habit being removed.
ALTER TABLE gate_pass DROP CONSTRAINT IF EXISTS gate_pass_has_a_vehicle;
ALTER TABLE gate_pass DROP COLUMN IF EXISTS vehicle_no_text;

ALTER TABLE gate_pass ADD CONSTRAINT gate_pass_names_one_vehicle CHECK (
    (asset_id IS NOT NULL AND visiting_vehicle_id IS NULL)
 OR (asset_id IS NULL AND visiting_vehicle_id IS NOT NULL)
);
COMMENT ON CONSTRAINT gate_pass_names_one_vehicle ON gate_pass IS
    'A machine on the equipment register, or a visiting vehicle. Exactly one '
    'of them, so there is never a question of which record a load belongs to.';

DROP INDEX IF EXISTS gate_pass_one_stay_per_vehicle_text;
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_one_stay_per_visitor
    ON gate_pass (visiting_vehicle_id)
    WHERE visiting_vehicle_id IS NOT NULL AND status = 'IN';

CREATE INDEX IF NOT EXISTS ix_gate_pass_visitor ON gate_pass (visiting_vehicle_id);

-- A trip inherits the same rule through its gate pass, and carries the visitor
-- alongside asset_id for the same reason asset_id is carried: every report
-- starts "how much did that vehicle move".
ALTER TABLE trip ADD COLUMN IF NOT EXISTS visiting_vehicle_id bigint
    REFERENCES visiting_vehicle (visiting_vehicle_id);
CREATE INDEX IF NOT EXISTS ix_trip_visitor ON trip (visiting_vehicle_id, production_date DESC);

-- One vehicle on the deck at a time, whichever register it came from.
CREATE UNIQUE INDEX IF NOT EXISTS trip_one_open_per_visitor
    ON trip (visiting_vehicle_id)
    WHERE visiting_vehicle_id IS NOT NULL AND status = 'OPEN';

-- ---------------------------------------------------------------------------
-- 3. Net weight, now that a tare can come from either register
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW trip_weights AS
SELECT t.trip_id,
       g.weight_kg AS gross_kg,
       COALESCE(w_tare.weight_kg, a.standing_tare_kg, v.standing_tare_kg) AS tare_kg,
       CASE WHEN w_tare.weight_kg IS NOT NULL THEN 'WEIGHED'
            WHEN COALESCE(a.standing_tare_kg, v.standing_tare_kg) IS NOT NULL THEN 'STANDING'
            ELSE NULL END AS tare_source,
       COALESCE(a.tare_taken_at, v.tare_taken_at) AS tare_taken_at,
       g.weight_kg - COALESCE(w_tare.weight_kg, a.standing_tare_kg, v.standing_tare_kg) AS net_kg,
       (g.capture_mode = 'MANUAL' OR w_tare.capture_mode = 'MANUAL') AS has_manual,
       g.weighed_at AS gross_at,
       CASE WHEN w_tare.weight_kg IS NULL
             AND COALESCE(a.tare_taken_at, v.tare_taken_at) IS NOT NULL
            THEN EXTRACT(DAY FROM (now() - COALESCE(a.tare_taken_at, v.tare_taken_at)))::int
       END AS tare_age_days
  FROM trip t
  LEFT JOIN asset a            ON a.asset_id = t.asset_id
  LEFT JOIN visiting_vehicle v ON v.visiting_vehicle_id = t.visiting_vehicle_id
  LEFT JOIN weighment g        ON g.trip_id = t.trip_id AND g.kind = 'GROSS'
  LEFT JOIN weighment w_tare   ON w_tare.trip_id = t.trip_id AND w_tare.kind = 'TARE';

-- ---------------------------------------------------------------------------
-- 4. One vehicle, whichever register it is in
-- ---------------------------------------------------------------------------
-- The gate, the weighbridge and every report want "the vehicle" without caring
-- which table it came from. Written once here rather than as the same UNION
-- copied into six queries, where the sixth one quietly forgets the visitors.
CREATE OR REPLACE VIEW weighable_vehicle AS
SELECT 'ASSET'::text        AS kind,
       a.asset_id           AS asset_id,
       NULL::bigint         AS visiting_vehicle_id,
       a.registration_no    AS registration_no,
       a.fleet_code         AS fleet_code,
       at.name              AS vehicle_type,
       a.make, a.model,
       a.payload_capacity_kg,
       a.standing_tare_kg, a.tare_taken_at,
       o.display_name       AS owner,
       a.ownership          AS ownership,
       a.status             AS status
  FROM asset a
  LEFT JOIN asset_type at ON at.asset_type_id = a.asset_type_id
  LEFT JOIN party o       ON o.party_id = a.owner_party_id
UNION ALL
SELECT 'VISITOR',
       NULL,
       v.visiting_vehicle_id,
       v.registration_no,
       NULL,
       v.vehicle_type,
       v.make, v.model,
       v.payload_capacity_kg,
       v.standing_tare_kg, v.tare_taken_at,
       COALESCE(p.display_name, v.owner_name_text),
       'VISITOR',
       v.status
  FROM visiting_vehicle v
  LEFT JOIN party p ON p.party_id = v.transporter_party_id;

COMMENT ON VIEW weighable_vehicle IS
    'Everything the weighbridge can weigh: the equipment register and the '
    'visiting vehicles, in one shape. The equipment register''s own screens do '
    'not read this — they read asset, and are untouched by visitors existing.';
