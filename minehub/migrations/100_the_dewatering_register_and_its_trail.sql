-- 100: the de-silting pump register and its trail.
--
-- Third time this week, and the first one nobody had flagged: both tables
-- were live in corpappdb -- 399 rows and 13 -- declared in no migration, and
-- created after the checker last ran clean. The checker found them from a
-- clean checkout; my own earlier run reported "all declared" only because I
-- had tarred my working tree into the container, untracked files and all.
--
-- Nothing here is new. Generated from the catalog rather than transcribed by
-- hand -- dewatering_daily_data carries twenty-eight columns, six of them
-- computed -- then built into a throwaway schema inside one transaction and
-- compared to minehub column by column before being committed.
--
-- ── SIX COLUMNS ARE GENERATED, NOT STORED BY THE APPLICATION ────────────────
-- rain_water_m3, plan_disposal_m3, actual_disposal_m3, variance_m3,
-- closing_stock_m3 and plan_compliance_pct are GENERATED ALWAYS AS ... STORED.
-- The arithmetic of the water balance lives in the table, so no caller can
-- file a closing stock that does not follow from its own opening stock,
-- seepage, rainfall and pumping. A first pass at this file emitted them as
-- DEFAULT expressions, which PostgreSQL does not allow to reference other
-- columns -- it would have failed on the first run against an empty database.
-- The catalog knew; transcribing by eye did not.
--
-- rain_factor_m3_per_mm defaults to 280: cubic metres of run-off per
-- millimetre of rain over the catchment. It is a column rather than a
-- constant because the catchment changes as the pit does.
--
-- plan_compliance_pct divides by NULLIF(plan_pump_hr, 0), so a day with no
-- plan reads NULL rather than raising -- the same rule the rest of this
-- platform follows: no plan is not nought per cent.

CREATE TABLE IF NOT EXISTS dewatering_daily_data (
    data_date                  date NOT NULL,
    rainfall_mm                numeric(10,3),
    pump_capacity_m3_hr        numeric(10,3),
    rain_factor_m3_per_mm      numeric(10,3) DEFAULT 280 NOT NULL,
    opening_stock_m3           numeric(14,3),
    seepage_m3                 numeric(14,3),
    plan_pump_hr               numeric(8,2),
    actual_pump_hr             numeric(8,2),
    rain_water_m3              numeric(14,3) GENERATED ALWAYS AS (rainfall_mm * rain_factor_m3_per_mm) STORED,
    plan_disposal_m3           numeric(14,3) GENERATED ALWAYS AS (plan_pump_hr * pump_capacity_m3_hr) STORED,
    actual_disposal_m3         numeric(14,3) GENERATED ALWAYS AS (actual_pump_hr * pump_capacity_m3_hr) STORED,
    variance_m3                numeric(14,3) GENERATED ALWAYS AS ((actual_pump_hr * pump_capacity_m3_hr) - (plan_pump_hr * pump_capacity_m3_hr)) STORED,
    closing_stock_m3           numeric(14,3) GENERATED ALWAYS AS (((opening_stock_m3 + seepage_m3) + (rainfall_mm * rain_factor_m3_per_mm)) - (actual_pump_hr * pump_capacity_m3_hr)) STORED,
    plan_compliance_pct        numeric(9,3) GENERATED ALWAYS AS ((actual_pump_hr / NULLIF(plan_pump_hr, (0)::numeric)) * (100)::numeric) STORED,
    west_water_level_mrl       numeric(8,2),
    west_silt_level_mrl        numeric(8,2),
    east_water_level_mrl       numeric(8,2),
    east_silt_level_mrl        numeric(8,2),
    dewatering_reason          text,
    slurry_pump_east_1_hr      numeric(8,2),
    slurry_pump_east_2_hr      numeric(8,2),
    east_pit_water_level_mrl   numeric(8,2),
    slurry_challenges          text,
    eddy_a_shift_min           numeric(8,2),
    eddy_b_shift_min           numeric(8,2),
    eddy_day_min               numeric(8,2),
    eddy_discharge_m3          numeric(14,3),
    total_slurry_discharge_m3  numeric(14,3),
    eddy_challenges            text,
    revision                   integer DEFAULT 1 NOT NULL,
    entry_id                   varchar(32) NOT NULL,
    entry_date                 timestamptz DEFAULT now() NOT NULL,
    updated_id                 varchar(32),
    updated_date               timestamptz,
    PRIMARY KEY (data_date),
    CHECK (((updated_id IS NULL) = (updated_date IS NULL))),
    CHECK ((actual_pump_hr >= (0)::numeric)),
    CHECK ((eddy_a_shift_min >= (0)::numeric)),
    CHECK ((eddy_b_shift_min >= (0)::numeric)),
    CHECK ((eddy_day_min >= (0)::numeric)),
    CHECK ((eddy_discharge_m3 >= (0)::numeric)),
    CHECK ((plan_pump_hr >= (0)::numeric)),
    CHECK ((pump_capacity_m3_hr >= (0)::numeric)),
    CHECK ((rain_factor_m3_per_mm >= (0)::numeric)),
    CHECK ((rainfall_mm >= (0)::numeric)),
    CHECK ((revision >= 1)),
    CHECK ((seepage_m3 >= (0)::numeric)),
    CHECK ((slurry_pump_east_1_hr >= (0)::numeric)),
    CHECK ((slurry_pump_east_2_hr >= (0)::numeric)),
    CHECK ((total_slurry_discharge_m3 >= (0)::numeric))
);


CREATE TABLE IF NOT EXISTS dewatering_history_log (
    id          bigserial,
    data_date   date NOT NULL,
    field       varchar(40) NOT NULL,
    action      varchar(8) NOT NULL,
    old_value   text,
    new_value   text,
    revision    integer NOT NULL,
    entry_id    varchar(32) NOT NULL,
    entry_date  timestamptz DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    -- Written as IN rather than as the catalog renders it: PostgreSQL
    -- re-parses its own output into a different canonical form, and this
    -- is the form the live constraint actually carries.
    CHECK (action IN ('ADDED', 'CHANGED', 'REMOVED', 'CHAINED')),
    CHECK ((old_value IS DISTINCT FROM new_value)),
    CHECK ((revision >= 1))
);

CREATE INDEX IF NOT EXISTS dewatering_history_log_date_idx ON dewatering_history_log USING btree (data_date, entry_date DESC);
CREATE INDEX IF NOT EXISTS dewatering_history_log_field_idx ON dewatering_history_log USING btree (field, data_date);

