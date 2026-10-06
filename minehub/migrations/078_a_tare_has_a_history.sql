-- 078: a tare has a history, and a trip can be told which one to use.
--
-- WHAT WAS WRONG. `asset.standing_tare_kg` holds one number and every new tare
-- overwrites it. That one figure produces every net weight for that vehicle
-- until it is taken again, so getting it wrong is not one bad trip, it is a
-- fortnight of them -- and there was no way to see what it used to be, when it
-- changed, or by how much.
--
-- A tare drifts for honest reasons: a body repair, a spare wheel, mud packed
-- in the chassis after a wet week, a new tipper body. Those are worth seeing
-- as a series. One overwritten number cannot show a series.
--
-- AND THE TARE THAT ARRIVES LATE. A truck is weighed gross, tips, and only
-- then goes over the bridge empty. Until now that empty weight became the
-- vehicle's standing tare and the trip's net was computed from it -- correct
-- by luck, because the view falls back to the standing figure. The moment
-- another tare is taken, that trip's net silently changes, because net is
-- computed on read.
--
-- So a tare taken after the gross can now be PINNED to the trip it belongs to,
-- as that trip's own TARE weighment. The trip's net stops floating.


-- ---------------------------------------------------------------------------
-- 1. Every tare ever taken
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vehicle_tare_reading (
    tare_reading_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- One or the other. Our own machine, or somebody's truck visiting.
    asset_id            bigint REFERENCES asset(asset_id),
    visiting_vehicle_id bigint REFERENCES visiting_vehicle(visiting_vehicle_id),

    weight_kg   numeric(10,2) NOT NULL CHECK (weight_kg > 0 AND weight_kg < 200000),
    taken_at    timestamptz NOT NULL DEFAULT now(),
    taken_by    text,

    weighbridge_id bigint REFERENCES weighbridge(weighbridge_id),
    -- The bridge reading it came off, so a figure can be traced to the deck.
    reading_id  bigint REFERENCES weighbridge_reading(reading_id),

    capture_mode text NOT NULL DEFAULT 'BRIDGE'
                 CHECK (capture_mode IN ('BRIDGE', 'MANUAL', 'IMPORT')),
    -- Required for a typed figure: a weight nobody watched settle needs a
    -- reason beside it, and "the bridge was down" is a perfectly good one.
    manual_reason text,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT vehicle_tare_one_vehicle CHECK (
        (asset_id IS NOT NULL) <> (visiting_vehicle_id IS NOT NULL)),
    CONSTRAINT vehicle_tare_manual_reason CHECK (
        capture_mode <> 'MANUAL' OR manual_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_tare_reading_asset
    ON vehicle_tare_reading (asset_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS ix_tare_reading_visiting
    ON vehicle_tare_reading (visiting_vehicle_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS ix_tare_reading_when
    ON vehicle_tare_reading (taken_at DESC);

COMMENT ON TABLE vehicle_tare_reading IS
    'Every empty weight ever taken, kept as a series. asset.standing_tare_kg '
    'remains the current figure every net is computed from -- this is where it '
    'came from and what it used to be.';


-- ---------------------------------------------------------------------------
-- 2. The series, with what changed between readings
-- ---------------------------------------------------------------------------
--
-- The change and the gap are what make a list of weights worth reading. A
-- tipper that has gained 400 kg across three months has something in it, and
-- nobody sees that from a column of absolute numbers.

CREATE OR REPLACE VIEW vehicle_tare_history AS
SELECT r.tare_reading_id,
       r.asset_id, r.visiting_vehicle_id,
       COALESCE(a.fleet_code, v.registration_no)        AS fleet_code,
       COALESCE(a.registration_no, v.registration_no)   AS registration_no,
       a.nickname,
       r.weight_kg, r.taken_at, r.taken_by, r.capture_mode, r.manual_reason,
       r.note, w.code AS bridge,

       LAG(r.weight_kg) OVER veh                        AS previous_kg,
       r.weight_kg - LAG(r.weight_kg) OVER veh          AS change_kg,
       LAG(r.taken_at) OVER veh                         AS previous_taken_at,
       EXTRACT(DAY FROM r.taken_at - LAG(r.taken_at) OVER veh)::int
                                                        AS days_since_previous,

       -- How long this figure was the one in force. NULL on the newest row,
       -- which is the one still in force now.
       LEAD(r.taken_at) OVER veh                        AS superseded_at,
       (LEAD(r.tare_reading_id) OVER veh) IS NULL       AS is_current
  FROM vehicle_tare_reading r
  LEFT JOIN asset a ON a.asset_id = r.asset_id
  LEFT JOIN visiting_vehicle v ON v.visiting_vehicle_id = r.visiting_vehicle_id
  LEFT JOIN weighbridge w ON w.weighbridge_id = r.weighbridge_id
-- Partitioned on both keys rather than one coalesced into the other:
-- exactly one is ever set, and an asset_id and a visiting_vehicle_id that
-- happen to share a number are not the same vehicle.
WINDOW veh AS (PARTITION BY r.asset_id, r.visiting_vehicle_id
               ORDER BY r.taken_at, r.tare_reading_id);

COMMENT ON VIEW vehicle_tare_history IS
    'Each tare with what it changed by and how long it stood. A tipper that '
    'has gained 400 kg over three months has something in it, and nobody sees '
    'that from a column of absolute numbers.';


-- ---------------------------------------------------------------------------
-- 3. The tares already standing, brought into the series
-- ---------------------------------------------------------------------------
--
-- Five machines carry one today. Their history starts where the record does
-- rather than pretending it goes back further, and says so.

INSERT INTO vehicle_tare_reading (asset_id, weight_kg, taken_at, taken_by,
                                  capture_mode, note)
SELECT a.asset_id, a.standing_tare_kg,
       COALESCE(a.tare_taken_at, now()), a.tare_taken_by,
       'IMPORT',
       'The standing tare as it was when the history began. Taken before this '
       'table existed, so there is nothing before it to compare against.'
  FROM asset a
 WHERE a.standing_tare_kg IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM vehicle_tare_reading r
                    WHERE r.asset_id = a.asset_id);

INSERT INTO vehicle_tare_reading (visiting_vehicle_id, weight_kg, taken_at,
                                  taken_by, capture_mode, note)
SELECT v.visiting_vehicle_id, v.standing_tare_kg,
       COALESCE(v.tare_taken_at, now()), NULL, 'IMPORT',
       'The standing tare as it was when the history began.'
  FROM visiting_vehicle v
 WHERE v.standing_tare_kg IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM vehicle_tare_reading r
                    WHERE r.visiting_vehicle_id = v.visiting_vehicle_id);


-- ---------------------------------------------------------------------------
-- 4. Where a trip's tare came from, said on the trip
-- ---------------------------------------------------------------------------
--
-- trip_weights already distinguishes WEIGHED from STANDING. What it could not
-- say is that a WEIGHED tare was taken AFTER the gross -- which is the normal
-- order for a loaded truck arriving at the mine, and worth showing plainly so
-- nobody reads it as a mistake.

CREATE OR REPLACE VIEW trip_weights AS
SELECT t.trip_id,
       g.weight_kg AS gross_kg,
       COALESCE(w_tare.weight_kg, a.standing_tare_kg, v.standing_tare_kg) AS tare_kg,
       CASE
           WHEN w_tare.weight_kg IS NOT NULL THEN 'WEIGHED'
           WHEN COALESCE(a.standing_tare_kg, v.standing_tare_kg) IS NOT NULL
                THEN 'STANDING'
       END AS tare_source,
       COALESCE(w_tare.weighed_at, a.tare_taken_at, v.tare_taken_at) AS tare_taken_at,
       g.weight_kg - COALESCE(w_tare.weight_kg, a.standing_tare_kg,
                              v.standing_tare_kg) AS net_kg,
       g.capture_mode = 'MANUAL' OR w_tare.capture_mode = 'MANUAL' AS has_manual,
       g.weighed_at AS gross_at,
       CASE
           WHEN w_tare.weight_kg IS NULL
                AND COALESCE(a.tare_taken_at, v.tare_taken_at) IS NOT NULL
           THEN EXTRACT(DAY FROM now() - COALESCE(a.tare_taken_at,
                                                  v.tare_taken_at))::int
       END AS tare_age_days,

       -- The loaded truck's order of events: gross first, tip, then empty.
       -- A net computed this way is firmer than one resting on a standing
       -- figure, not weaker, and the screen should not imply otherwise.
       w_tare.weighed_at IS NOT NULL AND g.weighed_at IS NOT NULL
         AND w_tare.weighed_at > g.weighed_at AS tare_after_gross
  FROM trip t
  LEFT JOIN asset a ON a.asset_id = t.asset_id
  LEFT JOIN visiting_vehicle v ON v.visiting_vehicle_id = t.visiting_vehicle_id
  LEFT JOIN weighment g ON g.trip_id = t.trip_id AND g.kind = 'GROSS'
  LEFT JOIN weighment w_tare ON w_tare.trip_id = t.trip_id AND w_tare.kind = 'TARE';

COMMENT ON VIEW trip_weights IS
    'Net is gross minus tare, computed on read. tare_source says whether the '
    'tare was weighed for this trip or inherited from the vehicle''s standing '
    'figure; tare_after_gross says the empty weight was taken after the load '
    'was tipped, which is the normal order and makes the net firmer, not '
    'weaker.';
