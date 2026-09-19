-- 032: is it electric, or is it not.
--
-- The register already knows fuel_type — diesel, petrol, electric, hybrid, CNG,
-- none — and that is the right level of detail for a maintenance schedule. It
-- is the wrong level for the question people actually ask, which is a two-way
-- split: how much of the fleet is electric yet, and what is still burning
-- diesel. That question gets asked by everybody from the mines manager to the
-- sustainability report, and answering it today means knowing that ELECTRIC
-- counts, HYBRID half counts, and NONE means a towed water bowser.
--
-- So the split becomes a column of its own. Not instead of fuel_type — which
-- stays, because a diesel engine and a CNG engine are serviced differently —
-- but beside it, as the thing the fleet is grouped and counted by.
--
-- DERIVED ONCE, THEN OWNED. It is filled in from fuel_type here, and after that
-- it is a field somebody sets. A machine can be electric and have fuel_type
-- NONE because nobody filled that in, and the category should not silently flip
-- when they do. Anything that stays derived forever is a view, not a column.

ALTER TABLE asset ADD COLUMN IF NOT EXISTS propulsion text;

UPDATE asset SET propulsion =
    CASE
        WHEN fuel_type = 'ELECTRIC' THEN 'EV'
        WHEN fuel_type = 'HYBRID'   THEN 'HYBRID'
        ELSE 'NON_EV'
    END
WHERE propulsion IS NULL;

ALTER TABLE asset ALTER COLUMN propulsion SET DEFAULT 'NON_EV';

ALTER TABLE asset DROP CONSTRAINT IF EXISTS asset_propulsion_check;
ALTER TABLE asset ADD CONSTRAINT asset_propulsion_check
    CHECK (propulsion IS NULL OR propulsion IN ('EV', 'NON_EV', 'HYBRID'));

-- Nullable on purpose. A machine part-way through registration has not said yet,
-- and forcing a guess at that moment is how every EV report starts life wrong.
COMMENT ON COLUMN asset.propulsion IS
    'EV / NON_EV / HYBRID. The two-way split the fleet is counted by. Seeded '
    'from fuel_type in migration 032, then maintained by hand — it does not '
    'follow fuel_type after that.';

CREATE INDEX IF NOT EXISTS asset_propulsion_idx ON asset (propulsion)
    WHERE COALESCE(status, 'ACTIVE') <> 'DISPOSED';
