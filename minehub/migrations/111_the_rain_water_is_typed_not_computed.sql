-- Rain water is a figure the mine types, not one we compute from millimetres.
--
-- THE SHEET WAS READ BACKWARDS. "Add Day Rain Water" was modelled here as a
-- generated column, rainfall_mm * rain_factor_m3_per_mm. On the mine's own
-- master workbook that cell carries a FORMULA on 198 days and a TYPED LITERAL
-- on 209 -- more than half. On those 209 days the water is the real reading
-- and the millimetres are the back-calculation, which is the opposite of what
-- this table assumed.
--
-- MOST DAYS IT DID NOT SHOW, because the millimetres were a clean number and
-- the two agreed. On 1-4 October 2025 the mine typed a repeating decimal --
-- 10/3 mm, whose water is a round 1,000 M3 -- and rainfall_mm numeric(10,3)
-- stored 3.333, which multiplies out to 999.9. Three days lost 0.1 each and
-- the fourth rounded up, leaving the stock chain 0.20 M3 below the sheet.
--
-- Opening stock is the previous day's closing, so that 0.20 was still on the
-- face of the entry screen 406 days later: 11 November 2026 showed 4,911.92
-- against the sheet's 4,912.12, with every other figure on the day identical.
--
-- NO AMOUNT OF PRECISION FIXES IT. 1000/300 does not terminate, so there is
-- no scale at which rainfall_mm * 300 is exactly 1,000. The fix is not to
-- compute the number more precisely; it is to stop computing it.
--
-- WHAT THIS DOES NOT GIVE UP. Closing stock stays GENERATED -- it is merely
-- generated from the stored water instead of from millimetres -- so a stored
-- row still cannot disagree with its own inputs through any route.
--
-- NO DOWNTIME. All three statements are one transaction, and PostgreSQL DDL
-- is transactional: readers see the old table until the commit and the new
-- one after it, never a half-changed table. The lock is held only while 407
-- rows are rewritten.

SET LOCAL search_path = minehub, public;

DO $$
BEGIN
    -- Guarded so a database built from 100 onward, or one where this has
    -- already run, both arrive at the same shape.
    IF EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid = 'minehub.dewatering_daily_data'::regclass
                  AND attname  = 'rain_water_m3'
                  AND attgenerated = 's')
    THEN
        -- Keeps every value it already holds; it simply stops being computed.
        ALTER TABLE minehub.dewatering_daily_data
            ALTER COLUMN rain_water_m3 DROP EXPRESSION;

        -- A generated column's expression cannot be altered in place, so
        -- closing stock is dropped and re-added against the new input. It is
        -- recomputed for every row on the way back in.
        ALTER TABLE minehub.dewatering_daily_data
            DROP COLUMN closing_stock_m3;

        ALTER TABLE minehub.dewatering_daily_data
            ADD COLUMN closing_stock_m3 numeric(14,3)
                GENERATED ALWAYS AS (opening_stock_m3
                                     + seepage_m3
                                     + rain_water_m3
                                     - actual_pump_hr * pump_capacity_m3_hr)
                STORED;
    END IF;
END $$;

-- A day whose water was never stated keeps nothing; a day that had one keeps
-- it. Nothing is invented here -- the figures the mine actually typed are
-- loaded separately, from the workbook.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'minehub.dewatering_daily_data'::regclass
                      AND conname  = 'dewatering_daily_data_rain_water_m3_check')
    THEN
        -- NOT VALID first, then validated: adding it outright would scan the
        -- table under an exclusive lock. Two steps keep the exclusive lock to
        -- the catalogue change and take only a SHARE UPDATE EXCLUSIVE for the
        -- scan, which no reader and no row-level write waits on.
        ALTER TABLE minehub.dewatering_daily_data
            ADD CONSTRAINT dewatering_daily_data_rain_water_m3_check
            CHECK (rain_water_m3 >= 0) NOT VALID;

        ALTER TABLE minehub.dewatering_daily_data
            VALIDATE CONSTRAINT dewatering_daily_data_rain_water_m3_check;
    END IF;
END $$;

COMMENT ON COLUMN dewatering_daily_data.rain_water_m3 IS
    'M3 of rain water. Typed: the mine''s sheet carries this as a literal on '
    'more than half its days. The form pre-fills it as rainfall x factor and '
    'the figure may be typed over, exactly as the spreadsheet does.';
