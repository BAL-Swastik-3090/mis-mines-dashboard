-- 049: headlines the reader can actually read.
--
-- The Press Information Bureau feed for the Ministry of Mines comes in Hindi.
-- That is not a defect of the source — it is a Hindi feed — but a news panel
-- where most of the room is taken by headlines a reader skips is a panel that
-- gets skipped.
--
-- So each item can carry an English rendering beside the original. The
-- original is never overwritten: it is what the ministry published, it is
-- what the link goes to, and a translation is a convenience laid over it. The
-- screen shows the English and keeps the original underneath.
--
-- WHY A COLUMN RATHER THAN TRANSLATING ON READ. Every open of the page would
-- otherwise re-translate eighty headlines through the model — slow, and the
-- wording would drift between one open and the next for no reason. Translated
-- once, on arrival, and stored.

ALTER TABLE market_news
    ADD COLUMN IF NOT EXISTS title_en      text,
    ADD COLUMN IF NOT EXISTS summary_en    text,
    -- What the original is in. 'en' means nothing to do; anything else is a
    -- candidate for translation. Detected from the characters, not declared
    -- by the feed, because feeds lie about this.
    ADD COLUMN IF NOT EXISTS lang          text,
    ADD COLUMN IF NOT EXISTS translated_at timestamptz,
    -- Which model did it, so a bad rendering can be traced to a version
    -- rather than argued about.
    ADD COLUMN IF NOT EXISTS translated_by text;

COMMENT ON COLUMN market_news.title_en IS
    'English rendering of title, by the on-premise model. Null means either '
    'the original is already English or it has not been translated yet. The '
    'original is never overwritten.';

-- The collector translates in batches; this is what it looks for.
CREATE INDEX IF NOT EXISTS ix_market_news_untranslated
    ON market_news (news_id)
 WHERE title_en IS NULL AND lang IS DISTINCT FROM 'en';
