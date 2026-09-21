-- 050: a price that changes keeps what it was.
--
-- Both price tables are written with ON CONFLICT DO UPDATE, so re-reading a
-- source overwrites the figure in place. That is right for the common case —
-- the same PDF read twice should not become two rows — and wrong for the case
-- that matters: IBM republishes corrected issues, and OMC restates a window.
-- When that happened the old figure simply disappeared.
--
-- It disappears from a table the royalty is computed on. "What was the
-- average sale price when we paid for June" is a question that must have an
-- answer months later, and until now the honest answer was "whatever it says
-- today".
--
-- WHY A TRIGGER RATHER THAN WRITING HISTORY IN THE COLLECTOR. Because a
-- collector can forget, and a second collector written next year will forget.
-- The rule belongs where the write happens. Anything that updates a price —
-- a collector, a correction, somebody at a psql prompt — leaves a trail
-- without having to know this table exists.
--
-- ONLY REAL CHANGES. Every run rewrites fetched_at; none of those are
-- revisions. A row is recorded only when the figure itself moved.

CREATE TABLE IF NOT EXISTS price_revision (
    revision_id  bigserial PRIMARY KEY,

    -- Which series this belonged to. Two tables, one history, because the
    -- question "has this ever been restated" is the same question for both.
    kind         text NOT NULL CHECK (kind IN ('ASP', 'AUCTION')),
    ref_id       bigint NOT NULL,

    -- Enough to show the revision without joining back to a row that may
    -- itself have moved on.
    label        text NOT NULL,
    period_label text NOT NULL,

    old_price    numeric(14, 2),
    new_price    numeric(14, 2),
    old_document_url text,
    new_document_url text,

    changed_at   timestamptz NOT NULL DEFAULT now(),
    -- The whole previous row, for the columns this table does not name.
    -- Nothing reads it today; it exists so a question nobody has asked yet
    -- is answerable without a restore from backup.
    before       jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_price_revision_point
    ON price_revision (kind, ref_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS ix_price_revision_recent
    ON price_revision (changed_at DESC);

COMMENT ON TABLE price_revision IS
    'What a published price used to be, whenever it was restated. Written by '
    'trigger, so no collector can forget to.';

-- ── the triggers ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_asp_revision() RETURNS trigger AS $$
BEGIN
    IF NEW.price IS DISTINCT FROM OLD.price
       OR NEW.document_url IS DISTINCT FROM OLD.document_url THEN
        INSERT INTO price_revision (kind, ref_id, label, period_label,
                                    old_price, new_price,
                                    old_document_url, new_document_url, before)
        VALUES ('ASP', OLD.price_id, OLD.grade, to_char(OLD.period, 'Mon YYYY'),
                OLD.price, NEW.price, OLD.document_url, NEW.document_url,
                to_jsonb(OLD));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mineral_price_keeps_history ON mineral_price;
CREATE TRIGGER mineral_price_keeps_history
    BEFORE UPDATE ON mineral_price
    FOR EACH ROW EXECUTE FUNCTION record_asp_revision();


CREATE OR REPLACE FUNCTION record_auction_revision() RETURNS trigger AS $$
BEGIN
    IF NEW.price IS DISTINCT FROM OLD.price THEN
        INSERT INTO price_revision (kind, ref_id, label, period_label,
                                    old_price, new_price,
                                    old_document_url, new_document_url, before)
        VALUES ('AUCTION', OLD.auction_price_id,
                OLD.mine || ' — ' || OLD.grade,
                to_char(OLD.valid_from, 'DD Mon YYYY') || ' to '
                  || to_char(OLD.valid_to, 'DD Mon YYYY'),
                OLD.price, NEW.price, OLD.document_url, NEW.document_url,
                to_jsonb(OLD));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auction_price_keeps_history ON auction_price;
CREATE TRIGGER auction_price_keeps_history
    BEFORE UPDATE ON auction_price
    FOR EACH ROW EXECUTE FUNCTION record_auction_revision();

-- Rows already here predate the trigger and have no recorded history. That is
-- a fact about them, not a gap to invent entries for: first_seen says when
-- each was first read, and anything after today is tracked.
ALTER TABLE mineral_price
    ADD COLUMN IF NOT EXISTS first_seen_at timestamptz;
ALTER TABLE auction_price
    ADD COLUMN IF NOT EXISTS first_seen_at timestamptz;

UPDATE mineral_price SET first_seen_at = fetched_at WHERE first_seen_at IS NULL;
UPDATE auction_price SET first_seen_at = fetched_at WHERE first_seen_at IS NULL;

ALTER TABLE mineral_price
    ALTER COLUMN first_seen_at SET DEFAULT now();
ALTER TABLE auction_price
    ALTER COLUMN first_seen_at SET DEFAULT now();

COMMENT ON COLUMN mineral_price.first_seen_at IS
    'When this figure was first read. fetched_at moves on every run; this '
    'does not, so "how long have we had this" has an answer.';
