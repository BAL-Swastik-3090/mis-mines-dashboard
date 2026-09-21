-- 052: when IBM actually published an issue.
--
-- The PDFs carry a "Published Date" on the cover, and it is not the month
-- they are about: the June 2026 issue was published on 13 August 2026. A
-- two-month lag matters — "why is there no July figure yet" has an answer,
-- and it is not that the collector is broken.
--
-- fetched_at says when we read it; first_seen_at says when we first had it;
-- this says when IBM let anybody have it. Three different questions.

ALTER TABLE mineral_price
    ADD COLUMN IF NOT EXISTS published_on date;

COMMENT ON COLUMN mineral_price.published_on IS
    'The Published Date printed on the issue, not the month it reports. IBM '
    'runs roughly two months behind, so this is how to tell a slow publisher '
    'from a stalled collector.';
