-- 071: a machine has two buckets, and until now they shared one column.
--
-- WHAT WENT WRONG. Migration 065 gave the register `fitted_bucket_cum` — what
-- is on the machine today — and for the other number, the bucket the machine
-- is built for, it borrowed `asset.capacity`. That column is not a bucket
-- column. Across the whole fleet:
--
--     HP       70 machines        <- engine power
--     (none)   22
--     CUM       6                 <- the only ones a bucket can be read from
--     kW        3
--
-- It is the engine-power column with six exceptions, and reading it as "the
-- standard bucket" is why EX-1 and EX-5 — two excavators that dig every day —
-- cannot be planned at all. The screen has nothing to show for them and the
-- capacity model skips them.
--
-- WORSE, THE TWO MEANINGS HAVE ALREADY FOUGHT. LONG-BOOM-ZAXIS-470 holds
-- capacity 2.500 CUM and fitted 0.650. Both are right: 2.5 is the bucket a
-- Zaxis 470 carries, and 0.65 is the small bucket a long boom reaching deep in
-- a chromite pit actually runs — migration 065 says so in as many words. When
-- those two machines were merged onto EX-2 and EX-7 there was only one bucket
-- field to land in, so the rated figure went into the fitted one and the
-- long-boom bucket the plan is built on was displaced. This migration is what
-- makes that unable to happen again, and it puts those two back.
--
-- SO THERE ARE TWO COLUMNS, AND THEY MEAN DIFFERENT THINGS.
--
--     rated_bucket_cum   what the manufacturer built it to carry. Changes
--                        when the machine is replaced, which is to say almost
--                        never. The benchmark.
--
--     fitted_bucket_cum  what is bolted on this morning. Changes when the pit
--                        changes. The number productivity is worked out from.
--
-- A machine running below its rating is then visible as a fact rather than
-- lost in one averaged column — a long boom on 0.65 of a rated 2.5 is doing
-- that deliberately, and anything else on a quarter of its rating is a
-- question somebody should be asked.
--
-- NEITHER IS REQUIRED. A blank rating is a machine nobody has looked up yet,
-- and a blank fitted bucket means the rated one is on it. A default typed for
-- every machine would be typed wrong for some of them.

ALTER TABLE asset ADD COLUMN IF NOT EXISTS rated_bucket_cum numeric(6,3);

COMMENT ON COLUMN asset.rated_bucket_cum IS
    'The bucket the machine is built for, in Cum — the manufacturer''s figure, '
    'not what is on it today. The benchmark the fitted bucket is read against. '
    'Null means nobody has recorded it yet; it is never inferred.';

COMMENT ON COLUMN asset.fitted_bucket_cum IS
    'The bucket on the machine now, in Cum. This is what productivity is '
    'worked out from. Null means the rated bucket is fitted. Kept separate '
    'from rated_bucket_cum because a long boom deliberately runs a small '
    'bucket and both numbers are true at once.';

ALTER TABLE asset DROP CONSTRAINT IF EXISTS asset_rated_bucket_sane;
ALTER TABLE asset ADD CONSTRAINT asset_rated_bucket_sane CHECK (
    rated_bucket_cum IS NULL OR (rated_bucket_cum > 0 AND rated_bucket_cum < 50));


-- ---------------------------------------------------------------------------
-- The ratings the register already holds, moved to the column that means it
-- ---------------------------------------------------------------------------
--
-- Only where the unit says cubic metres. Six machines. Nothing is inferred
-- from a model name or a horsepower figure: a rating somebody has to guess at
-- is a rating the screen should ask for, not invent.

UPDATE asset
   SET rated_bucket_cum = capacity
 WHERE rated_bucket_cum IS NULL
   AND capacity IS NOT NULL
   AND capacity > 0 AND capacity < 50
   AND UPPER(TRIM(COALESCE(capacity_uom, ''))) IN
       ('CUM', 'M3', 'M^3', 'CU.M', 'CUM.', 'CBM');


-- ---------------------------------------------------------------------------
-- The four that were merged, put back the right way round
-- ---------------------------------------------------------------------------
--
-- Each of these carries a rating that arrived in the fitted column because
-- that was the only column there was. The rating moves to where it belongs.
-- The long booms then get back the 0.65 bucket the plan is actually built on,
-- and EX-8 gets the 1.100 its own twin recorded — a Zaxis 220 rated at 0.91
-- running a larger bucket, which is a real entry and not a default.
--
-- Guarded on the exact value each one holds, so re-running this after somebody
-- has corrected a figure by hand cannot overwrite them.

UPDATE asset SET rated_bucket_cum = 2.800, fitted_bucket_cum = 0.650
 WHERE fleet_code = 'EX-2' AND rated_bucket_cum IS NULL AND fitted_bucket_cum = 2.800;

UPDATE asset SET rated_bucket_cum = 2.500, fitted_bucket_cum = 0.650
 WHERE fleet_code = 'EX-7' AND rated_bucket_cum IS NULL AND fitted_bucket_cum = 2.500;

UPDATE asset SET rated_bucket_cum = 1.500, fitted_bucket_cum = NULL
 WHERE fleet_code = 'EX-4' AND rated_bucket_cum IS NULL AND fitted_bucket_cum = 1.500;

UPDATE asset SET rated_bucket_cum = 0.910, fitted_bucket_cum = 1.100
 WHERE fleet_code = 'EX-8' AND rated_bucket_cum IS NULL AND fitted_bucket_cum = 0.910;

-- A fitted bucket with no date behind it cannot be questioned later.
UPDATE asset SET fitted_bucket_since = CURRENT_DATE
 WHERE fitted_bucket_cum IS NOT NULL AND fitted_bucket_since IS NULL;
