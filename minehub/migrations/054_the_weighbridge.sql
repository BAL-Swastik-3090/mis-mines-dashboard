-- 054: the weighbridge, as a trip rather than a screen.
--
-- SAP runs this as five separate transactions — register a vehicle, register a
-- driver, gate entry, weighment, gate exit — each with its own screen and its
-- own copy of the same facts. The gate entry screen alone re-types the vehicle
-- type, the transporter, the transporter name, the RFID and the capacity, all
-- of which the vehicle master already knows. Re-typed data is data that
-- disagrees with itself by the end of the month.
--
-- Two of those five screens are already built here and are not rebuilt:
--
--   Vehicle Registration  is the equipment register. asset already carries
--                         registration_no, ownership, owner_party_id and the
--                         SAP equipment number. It gains one column below,
--                         payload capacity, because the existing `capacity`
--                         column holds engine horsepower on a tipper.
--   Driver Registration   is the operator register, with the licence already
--                         held as an operator_document and renewals tracked.
--
-- So what is new is the part SAP models thinnest: the trip itself.
--
-- ONE TRIP, NOT FIVE TRANSACTIONS
-- A truck arrives, is let in, is weighed, is weighed again, and leaves. That is
-- one thing that happens over an hour, not five. gate_pass is that thing;
-- weighment rows hang off it. Net weight is not stored — it is the difference
-- between two weighments, and a stored total that can disagree with the figures
-- it came from is a number nobody can defend.
--
-- FIRST WEIGHT AND SECOND WEIGHT, NOT GROSS AND TARE
-- A loaded truck coming in weighs gross, tips, then weighs tare. A truck going
-- out does it the other way round. Storing "the gross weighment" as a fixed
-- step only works in one direction, which is why SAP's screen is titled Gross
-- Weighment and needs a separate story for despatch. Each weighment says which
-- kind it is and when it happened; the order follows from the timestamps.
--
-- WHY THE RAW READING IS KEPT
-- This is the part that makes it an advance on what exists rather than a
-- reimplementation. SAP's screen has both a Gross Weight and a Manual Gross
-- Weight field, and nothing in the record afterwards says which one was used or
-- why. The manual field is where weighbridge fraud lives, on every mine.
--
-- Here the desktop agent streams every reading the indicator produces into
-- weighbridge_reading, whether anyone is capturing or not. A captured weighment
-- points at the exact reading it came from. A manual one has to say why in
-- words. So the question "was the bridge actually showing this when it was
-- recorded" has an answer, and the trace either side of the capture is on the
-- screen next to the figure.

-- ---------------------------------------------------------------------------
-- 1. What a machine can carry
-- ---------------------------------------------------------------------------
-- `capacity` on a tipper is 280 — horsepower, not tonnes, because the column is
-- shared with excavators and dozers where output is what matters. Payload is a
-- different fact and gets its own column rather than overloading that one.
ALTER TABLE asset ADD COLUMN IF NOT EXISTS payload_capacity_kg numeric(10,2);
COMMENT ON COLUMN asset.payload_capacity_kg IS
    'Rated payload in kilograms. Distinct from `capacity`, which holds engine '
    'output for machines whose useful rating is power rather than load. Used '
    'to flag an overloaded or suspiciously light trip at the weighbridge.';

-- ---------------------------------------------------------------------------
-- 2. The bridges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weighbridge (
    weighbridge_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,        -- WB1, WB2, WB3
    name           text NOT NULL,
    plant_id       bigint REFERENCES plant (plant_id),
    location_id    bigint REFERENCES location (location_id),
    capacity_kg    numeric(12,2),
    make           text,
    model          text,
    indicator_make text,                        -- the digitizer, not the deck
    -- Legal metrology. A bridge out of stamp is not a bridge whose figures can
    -- be billed on, so the date lives with the bridge and not in a folder.
    last_verified_on date,
    verification_due_on date,
    status         text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'INACTIVE')),
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);

DROP TRIGGER IF EXISTS weighbridge_touch ON weighbridge;
CREATE TRIGGER weighbridge_touch BEFORE UPDATE ON weighbridge
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One bridge today. The mine has three decks and the third is the one wired to
-- SAP, so it is created under its own name rather than as "the weighbridge".
INSERT INTO weighbridge (code, name, plant_id, created_by)
SELECT 'WB3', 'Weigh Bridge 3', p.plant_id, 'MIGRATION 054'
  FROM plant p WHERE p.code = '1200'
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The desktop agent
-- ---------------------------------------------------------------------------
-- The indicator writes the live weight to a file on the weighbridge PC —
-- C:\WB3\wbdata.txt is the one SAP GUI prompts to read on every capture. The
-- agent watches that file and posts what it sees. It never writes to it: the
-- file belongs to the digitizer and SAP still reads it, and an agent that took
-- an exclusive lock would stop the existing system working.
CREATE TABLE IF NOT EXISTS weighbridge_agent (
    agent_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    weighbridge_id bigint NOT NULL REFERENCES weighbridge (weighbridge_id),
    machine_name   text NOT NULL,
    -- Never the token itself. An agent token is a credential; this table is
    -- read by any screen that shows agent health.
    token_hash     text NOT NULL UNIQUE,
    watch_path     text NOT NULL,
    parser         text NOT NULL DEFAULT 'auto',
    poll_ms        integer NOT NULL DEFAULT 400,
    version        text,
    last_seen_at   timestamptz,
    last_error     text,
    last_error_at  timestamptz,
    status         text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text
);
CREATE INDEX IF NOT EXISTS ix_wb_agent_bridge ON weighbridge_agent (weighbridge_id);

-- ---------------------------------------------------------------------------
-- 4. What the indicator said
-- ---------------------------------------------------------------------------
-- Every reading, not only the ones somebody captured. That is the whole point:
-- a figure is only checkable against what the bridge was showing if what the
-- bridge was showing was written down at the time, including the seconds
-- nobody was looking at.
--
-- Two clocks, deliberately. read_at is the agent's, received_at is the
-- server's. A weighbridge PC with a wrong clock is a common and quiet problem,
-- and keeping both is what makes it visible instead of silently shifting every
-- timestamp on the mine's despatch record.
CREATE TABLE IF NOT EXISTS weighbridge_reading (
    reading_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    weighbridge_id bigint NOT NULL REFERENCES weighbridge (weighbridge_id),
    agent_id       bigint REFERENCES weighbridge_agent (agent_id),
    weight_kg      numeric(12,2) NOT NULL,
    is_stable      boolean NOT NULL DEFAULT false,
    raw_line       text,
    read_at        timestamptz NOT NULL,
    received_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_wb_reading_bridge_time
    ON weighbridge_reading (weighbridge_id, read_at DESC);
-- The trace around a capture is the query this table exists to answer, and it
-- wants the stable points first.
CREATE INDEX IF NOT EXISTS ix_wb_reading_stable
    ON weighbridge_reading (weighbridge_id, read_at DESC) WHERE is_stable;

COMMENT ON COLUMN weighbridge_reading.is_stable IS
    'The indicator said the load had settled. An unstable reading is a truck '
    'still rolling onto the deck and must never be captured as a weight.';

-- ---------------------------------------------------------------------------
-- 5. The trip
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gate_pass (
    gate_pass_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gate_pass_no   text NOT NULL UNIQUE,
    plant_id       bigint REFERENCES plant (plant_id),

    -- Who and what. All three point at masters that already exist; nothing
    -- about the vehicle or the driver is copied in here.
    asset_id       bigint REFERENCES asset (asset_id),
    operator_id    bigint REFERENCES operator (operator_id),
    transporter_party_id bigint REFERENCES party (party_id),
    -- An outside truck that is not on the register yet still has to be let in.
    -- Recording the number it showed is honest; inventing an asset row for a
    -- one-off delivery is not.
    vehicle_no_text text,
    driver_name_text text,
    driver_phone_text text,
    driver_licence_text text,

    direction      text NOT NULL DEFAULT 'INBOUND'
                     CHECK (direction IN ('INBOUND', 'OUTBOUND', 'INTERNAL')),
    material_id    bigint REFERENCES material (material_id),
    grade          text,
    sub_grade      text,
    source_location_id bigint REFERENCES location (location_id),
    dest_location_id   bigint REFERENCES location (location_id),
    shift_code     text,
    production_date date,

    entry_at       timestamptz,
    entry_by       text,
    exit_at        timestamptz,
    exit_by        text,

    status         text NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN', 'WEIGHED', 'CLOSED', 'CANCELLED')),
    cancel_reason  text,
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,

    -- A pass names a machine on the register or a vehicle number, and one of
    -- them it must name — a trip whose vehicle is unknown is not a record of
    -- anything.
    CONSTRAINT gate_pass_has_a_vehicle
        CHECK (asset_id IS NOT NULL OR nullif(trim(vehicle_no_text), '') IS NOT NULL),
    CONSTRAINT gate_pass_exit_after_entry
        CHECK (exit_at IS NULL OR entry_at IS NULL OR exit_at >= entry_at)
);
CREATE INDEX IF NOT EXISTS ix_gate_pass_open
    ON gate_pass (status, entry_at DESC) WHERE status IN ('OPEN', 'WEIGHED');
CREATE INDEX IF NOT EXISTS ix_gate_pass_asset ON gate_pass (asset_id, entry_at DESC);
CREATE INDEX IF NOT EXISTS ix_gate_pass_date ON gate_pass (production_date DESC);

DROP TRIGGER IF EXISTS gate_pass_touch ON gate_pass;
CREATE TRIGGER gate_pass_touch BEFORE UPDATE ON gate_pass
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A machine cannot be inside the gate twice at once. Without this, a missed
-- exit quietly leaves a second pass open and the yard count drifts all shift.
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_one_open_per_asset
    ON gate_pass (asset_id)
    WHERE asset_id IS NOT NULL AND status IN ('OPEN', 'WEIGHED');

-- ---------------------------------------------------------------------------
-- 6. The weighments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weighment (
    weighment_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gate_pass_id   bigint NOT NULL REFERENCES gate_pass (gate_pass_id) ON DELETE CASCADE,
    weighbridge_id bigint NOT NULL REFERENCES weighbridge (weighbridge_id),
    kind           text NOT NULL CHECK (kind IN ('GROSS', 'TARE')),
    weight_kg      numeric(12,2) NOT NULL CHECK (weight_kg >= 0),

    -- The distinction this whole module exists to preserve.
    capture_mode   text NOT NULL CHECK (capture_mode IN ('CAPTURED', 'MANUAL')),
    reading_id     bigint REFERENCES weighbridge_reading (reading_id),
    manual_reason  text,

    weighed_at     timestamptz NOT NULL DEFAULT now(),
    weighed_by     text,
    remarks        text,
    created_at     timestamptz NOT NULL DEFAULT now(),

    -- A captured weight names the reading it came from; a manual one says why
    -- it had to be typed. Neither is optional, because "captured" with nothing
    -- behind it is exactly the claim that needs evidence.
    CONSTRAINT weighment_shows_its_working CHECK (
        (capture_mode = 'CAPTURED' AND reading_id IS NOT NULL)
     OR (capture_mode = 'MANUAL'   AND nullif(trim(manual_reason), '') IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS ix_weighment_pass ON weighment (gate_pass_id);
CREATE INDEX IF NOT EXISTS ix_weighment_bridge ON weighment (weighbridge_id, weighed_at DESC);

-- One gross and one tare per trip. A re-weigh corrects the figure by replacing
-- the row, which the revision history records; two live gross weights on one
-- pass is an unanswered question about which of them the despatch note used.
CREATE UNIQUE INDEX IF NOT EXISTS weighment_one_of_each_kind
    ON weighment (gate_pass_id, kind);

-- ---------------------------------------------------------------------------
-- 7. Net weight, worked out rather than stored
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW gate_pass_weights AS
SELECT g.gate_pass_id,
       max(w.weight_kg) FILTER (WHERE w.kind = 'GROSS') AS gross_kg,
       max(w.weight_kg) FILTER (WHERE w.kind = 'TARE')  AS tare_kg,
       max(w.weight_kg) FILTER (WHERE w.kind = 'GROSS')
         - max(w.weight_kg) FILTER (WHERE w.kind = 'TARE') AS net_kg,
       bool_or(w.capture_mode = 'MANUAL') AS has_manual,
       count(*) AS weighments,
       max(w.weighed_at) AS last_weighed_at
  FROM gate_pass g
  LEFT JOIN weighment w ON w.gate_pass_id = g.gate_pass_id
 GROUP BY g.gate_pass_id;

COMMENT ON VIEW gate_pass_weights IS
    'Net is gross minus tare, computed on read. Storing it would let a total '
    'survive a correction to one of the figures it came from.';

-- ---------------------------------------------------------------------------
-- 8. Rights
-- ---------------------------------------------------------------------------
-- Split by the job being done, not by seniority. The gate keeper lets trucks
-- in and out; the weighbridge operator weighs them. Typing a weight by hand is
-- its own right again, because it is the one action here that cannot be
-- checked against the indicator.
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
  ('wb.view', 'Weighbridge', 'See the weighbridge',
   'Live weight, today''s trips, and the weighment record.', FALSE, 370),
  ('wb.gate', 'Weighbridge', 'Gate entry and exit',
   'Let a vehicle in against a gate pass and sign it out again.', FALSE, 371),
  ('wb.weigh', 'Weighbridge', 'Record a weight',
   'Capture the weight the bridge is showing against an open gate pass.',
   FALSE, 372),
  ('wb.manual', 'Weighbridge', 'Enter a weight by hand',
   'Type a weight the bridge did not supply — for a failed indicator or a '
   'vehicle weighed elsewhere. Every manual weight is marked as such, keeps '
   'the reason given, and is counted separately on the management view.',
   TRUE, 373),
  ('wb.manage', 'Weighbridge', 'Manage bridges and agents',
   'Add a weighbridge, record its verification, and issue or revoke the token '
   'a desktop agent uses to send readings.', TRUE, 374)
ON CONFLICT (code) DO NOTHING;
