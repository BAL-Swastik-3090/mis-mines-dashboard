-- 022: competency on a particular machine, and how good they actually are.
--
-- TWO CHANGES.
--
-- 1. A LEVEL PER MACHINE, not only per class. Someone certified on excavators
--    may have four thousand hours on the ZX470 and have never sat in the 320D:
--    same class, different machine, and the mine knows the difference even if
--    the qualification does not. The class-wide row stays — it is what
--    eligibility is decided on — and machine rows sit under it.
--
--    The unique key has to grow to match, with NULLS NOT DISTINCT so that the
--    class-wide row (asset_id NULL) is still one row and not many: without it
--    PostgreSQL treats every NULL as different and the upsert silently inserts
--    a duplicate on every assessment.
--
-- 2. A RATING OUT OF FIVE. The level says what someone is cleared to do, which
--    is a threshold question with a right answer. The rating is the supervisor's
--    judgement of how well they do it, which is not the same thing and should
--    not be smuggled into the same number — a level 3 who is careless and a
--    level 3 who is the person you want on the face are both level 3.

ALTER TABLE operator_competency
    ADD COLUMN IF NOT EXISTS rating smallint CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE operator_competency
    ADD COLUMN IF NOT EXISTS rated_by text,
    ADD COLUMN IF NOT EXISTS rated_on date;

ALTER TABLE operator_competency
    DROP CONSTRAINT IF EXISTS operator_competency_operator_id_asset_type_id_dimension_key;

CREATE UNIQUE INDEX IF NOT EXISTS operator_competency_unique
    ON operator_competency (operator_id, asset_type_id, asset_id, dimension)
    NULLS NOT DISTINCT;
