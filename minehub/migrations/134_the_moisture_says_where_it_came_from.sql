-- ===========================================================================
-- 134 — A ROM MOISTURE SAYS WHERE IT CAME FROM
-- ===========================================================================
-- mines_rom_entry.moisture_pct is null on every row ever filed. The entry
-- form has the box; nobody fills it. So AMIRA's ROM column shows no moisture,
-- and Net Chromium with it, because the formula needs all three terms.
--
-- The lab does measure it — PLANT 1200 / STORAGE_LOCATION 'ROM1' in
-- pp_quality_inspection, one composite per day. November 2026 carries 17 of
-- the mine's 18 filed days.
--
-- ── THE PROBLEM THIS COLUMN EXISTS TO SOLVE ────────────────────────────────
-- A ROM row is one SAMPLE — a shift, a location, a parcel. The lab's figure
-- is one DAY. There is no honest way to say "this parcel was 12.50% wet";
-- the lab never weighed that parcel.
--
-- Copying the day's figure onto each of the day's rows is arithmetically
-- exact — a tonnage-weighted mean of a constant within a day IS that
-- constant, so the period figure is identical to what a day-level join would
-- produce. What it is NOT is honest about provenance: moisture_pct would
-- silently come to mean "measured for this parcel" on some rows and "the
-- day's composite, inherited" on others, with nothing anywhere to say which.
--
-- That distinction cannot be recovered later. Once the figures are in the
-- column they look alike, and the only way back is to re-derive which rows
-- happened to match a SAP composite — which is a guess, not a record. So the
-- marker goes in BEFORE the first figure does.
--
-- ── NULL IS NOT 'UNKNOWN SOURCE' ───────────────────────────────────────────
-- A null here means there is no moisture on the row at all. The CHECK ties
-- the two together so the pair cannot drift: a figure must name its source,
-- and a source cannot sit on a row with no figure.
-- ===========================================================================
SET LOCAL search_path = minehub, public;

-- ALTER TABLE takes ACCESS EXCLUSIVE, and a queued exclusive lock blocks every
-- reader behind it. Five seconds of waiting costs nothing and fails cleanly.
-- See CLAUDE.md — this estate has lost tables to a queued lock twice.
SET lock_timeout = '5s';


ALTER TABLE mines_rom_entry
    ADD COLUMN IF NOT EXISTS moisture_source varchar(20);

COMMENT ON COLUMN mines_rom_entry.moisture_source IS
    'Where moisture_pct came from. MEASURED = typed on the entry form against '
    'this parcel. SAP ROM1 DAY = the lab''s daily composite for on_date, '
    'inherited by every row of that day. Null when there is no moisture.';

-- Written as a separate statement with its own existence test so a re-run is
-- a no-op: ADD CONSTRAINT has no IF NOT EXISTS.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_mines_rom_entry_moisture_source'
           AND conrelid = 'minehub.mines_rom_entry'::regclass
    ) THEN
        ALTER TABLE mines_rom_entry
            ADD CONSTRAINT chk_mines_rom_entry_moisture_source
            -- THE `IS NOT NULL` IS LOAD-BEARING, not belt and braces. Without
            -- it this constraint lets a figure with no source straight
            -- through: `moisture_source IN (...)` is NULL rather than false
            -- when the column is null, `true AND NULL` is NULL, and a CHECK
            -- PASSES on NULL. The rehearsal caught it accepting exactly the
            -- row this column exists to forbid.
            CHECK (
                (moisture_pct IS NULL AND moisture_source IS NULL)
             OR (moisture_pct IS NOT NULL
                 AND moisture_source IS NOT NULL
                 AND moisture_source IN ('MEASURED', 'SAP ROM1 DAY'))
            );
    END IF;
END
$$;

-- The 153 historic rows that carry a moisture came off the workbook, where the
-- column was the mine's own measurement. Nothing in this table was ever filled
-- from SAP before this migration, so anything already present is MEASURED.
UPDATE mines_rom_entry
   SET moisture_source = 'MEASURED'
 WHERE moisture_pct IS NOT NULL
   AND moisture_source IS NULL;
