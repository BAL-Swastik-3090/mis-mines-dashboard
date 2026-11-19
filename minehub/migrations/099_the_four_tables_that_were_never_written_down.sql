-- 099: the four tables check_migrations.py has been pointing at.
--
-- These predate the two caught this week. They hold 4.6 million rows between
-- them and existed only in corpappdb -- if this database ever had to be
-- rebuilt, their definitions would have had to be read back off the live
-- server, assuming it was still there to read.
--
-- Nothing here is new and nothing is altered. Every statement is
-- IF NOT EXISTS against the live definition, built into a throwaway schema
-- inside one transaction and compared to minehub column by column before
-- being committed. Run against corpappdb it does nothing at all.
--
-- ── THESE ARE REPRODUCED AS THEY ARE, NOT AS THEY SHOULD BE ─────────────────
-- A migration that records what exists is not the place to improve it. Three
-- things below would be written differently today, and are deliberately left
-- alone so that this file and the database agree:
--
--   technoton_*.engine_hours and its two siblings are `text`, not an
--   interval or a numeric. The Technoton feed sends them as strings and
--   whatever loads them stores them unparsed.
--
--   technoton_*.id is a nullable integer with no default and no constraint.
--   It is not this table's key -- the primary key is the triple below -- and
--   appears to be an id carried over from the source system.
--
--   The technoton timestamps are `timestamp without time zone`, where the
--   rest of minehub uses timestamptz. Changing that would reinterpret 4.6
--   million existing rows, which is a data migration and a decision for
--   whoever owns the feed, not a side effect of writing the schema down.
--
-- Each of those is worth revisiting. None of them is worth revisiting in the
-- same change that first records the table exists.

-- ── desilting_plan ──────────────────────────────────────────────────────────
-- The de-silting target, one row per day, keyed on the day itself. The
-- application inserts and deletes here; see services/desilting_plan.py.
CREATE TABLE IF NOT EXISTS desilting_plan (
    plan_date   date PRIMARY KEY,
    plan_qty    numeric(13,3) NOT NULL CHECK (plan_qty >= 0),
    entry_id    varchar(32) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    modified_by varchar(32),
    modified_at timestamptz
);

-- ── technoton_gps ───────────────────────────────────────────────────────────
-- Raw positions from the Technoton units. Nothing in this application reads
-- this table -- it is written by the feed and read elsewhere -- which is
-- precisely why it had no migration and why losing it would be quiet.
CREATE TABLE IF NOT EXISTS technoton_gps (
    vehicle_desc      varchar(60) NOT NULL,
    latitude          numeric(11,7),
    longitude         numeric(11,7),
    coordinates       text,
    gps_time          timestamp,
    speed             numeric(8,2),
    location          text,
    last_message_time varchar(40),
    report_date       timestamp NOT NULL,
    trip_date         timestamp NOT NULL,
    PRIMARY KEY (report_date, vehicle_desc, trip_date)
);

-- ── the two utilisation tables ──────────────────────────────────────────────
-- Identical in shape and split by fleet: MAN tippers in one, everything else
-- in the other. They are written out separately rather than generated,
-- because a migration is read far more often than it is run.
CREATE TABLE IF NOT EXISTS technoton_man_utilization (
    id                       integer,
    vehicle_desc             text NOT NULL,
    trip_date                timestamp NOT NULL,
    report_date              timestamp NOT NULL,
    engine_hours             text,
    in_motion_engine_hours   text,
    idling_engine_hours      text,
    avg_speed                numeric(12,2),
    max_speed                numeric(12,2),
    distance                 numeric(14,2),
    fuel_consumed            numeric(14,2),
    lph                      numeric(12,2),
    initial_fuel_level       numeric(12,2),
    final_fuel_level         numeric(12,2),
    total_fillings           integer,
    total_drains             integer,
    filled                   numeric(14,2),
    drained                  numeric(14,2),
    parkings                 text,
    sig                      text,
    created_at               timestamp,
    PRIMARY KEY (report_date, vehicle_desc, trip_date)
);

CREATE TABLE IF NOT EXISTS technoton_rest_equipment_utilization (
    id                       integer,
    vehicle_desc             text NOT NULL,
    trip_date                timestamp NOT NULL,
    report_date              timestamp NOT NULL,
    engine_hours             text,
    in_motion_engine_hours   text,
    idling_engine_hours      text,
    avg_speed                numeric(12,2),
    max_speed                numeric(12,2),
    distance                 numeric(14,2),
    fuel_consumed            numeric(14,2),
    lph                      numeric(12,2),
    initial_fuel_level       numeric(12,2),
    final_fuel_level         numeric(12,2),
    total_fillings           integer,
    total_drains             integer,
    filled                   numeric(14,2),
    drained                  numeric(14,2),
    parkings                 text,
    sig                      text,
    created_at               timestamp,
    PRIMARY KEY (report_date, vehicle_desc, trip_date)
);

-- The primary key already covers (report_date, vehicle_desc, trip_date)
-- ascending. These add the same triple with trip_date DESC, which is the
-- order the utilisation screens read it in.
CREATE INDEX IF NOT EXISTS ix_technoton_man_utilization_veh_trip
    ON technoton_man_utilization (report_date, vehicle_desc, trip_date DESC);
CREATE INDEX IF NOT EXISTS ix_technoton_rest_equipment_utilization_veh_trip
    ON technoton_rest_equipment_utilization (report_date, vehicle_desc, trip_date DESC);
