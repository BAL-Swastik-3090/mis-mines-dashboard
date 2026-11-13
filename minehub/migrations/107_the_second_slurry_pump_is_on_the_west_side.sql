-- The second slurry pump is on the WEST side, and always was.
--
-- The form called it "Slurry Pump (East)-2" and the column was named to
-- match. Both were wrong. The mine's own master workbook -- Daily Dashboard
-- Dewatering, version V2_16122025 -- carries this reading on the row headed
-- "Slurry Pump (Weast)-1", directly under "Slurry Pump-1 (East Side - 40HP
-- GOODWIN)", and the operator's notes say the slurry pump was shifted to the
-- west side.
--
-- THE DATA IS NOT BEING RE-ATTRIBUTED. It was checked day by day against the
-- mine's workbook before this ran: 407 days overlap, and 394 of them match
-- this column exactly. The 13 that differ are the most recent days, where
-- the sheet has a reading and the application has not been filled in yet --
-- a gap in entry, not a disagreement about which pump. So every figure
-- already under this column is a West-1 reading, and the rename only makes
-- the name say what the numbers have always meant.
--
-- The history log is rewritten in the same step. It stores the column name
-- as text, so leaving it would split one field's trail across two names and
-- the Change History panel would show seven edits to a field that no longer
-- exists.

SET LOCAL search_path = minehub, public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'minehub'
                  AND table_name   = 'dewatering_daily_data'
                  AND column_name  = 'slurry_pump_east_2_hr')
    THEN
        ALTER TABLE minehub.dewatering_daily_data
            RENAME COLUMN slurry_pump_east_2_hr TO slurry_pump_west_1_hr;

        -- A column rename leaves the constraint's own name behind, and a
        -- CHECK called ..._east_2_hr_check on a column called ..._west_1_hr
        -- is the next person's wasted hour.
        ALTER TABLE minehub.dewatering_daily_data
            RENAME CONSTRAINT dewatering_daily_data_slurry_pump_east_2_hr_check
                           TO dewatering_daily_data_slurry_pump_west_1_hr_check;
    END IF;
END $$;

UPDATE minehub.dewatering_history_log
   SET field = 'slurry_pump_west_1_hr'
 WHERE field = 'slurry_pump_east_2_hr';
