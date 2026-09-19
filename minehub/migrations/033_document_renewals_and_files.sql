-- 033: a renewal is not a correction, and a certificate is a file.
--
-- The statutory panel holds four rows per machine — fitness, road tax,
-- insurance, pollution — each with a valid-upto date. Both things people do to
-- that date were being treated as the same edit:
--
--   a CORRECTION   the date was typed wrong. There is one truth and the old
--                  value was never it.
--   a RENEWAL      the certificate was renewed. Both values were true, each
--                  for its own period, and the old one is what proves the
--                  machine was legal last March.
--
-- Overwriting on renewal loses the only record that the machine was covered
-- during the period that just ended. That record is the entire reason the
-- register exists: when the DGMS inspector asks what the insurance was on the
-- day of an incident, "the current policy" is not an answer.
--
-- So renewals append. The current row is the one with no superseded_at; the
-- ones behind it are the history, each pointing at what replaced it.
-- Corrections still edit in place, but leave a revision row saying what the
-- value used to be, so a typo fixed quietly is still a typo somebody can find.

ALTER TABLE asset_compliance
    ADD COLUMN IF NOT EXISTS superseded_at   timestamptz,
    ADD COLUMN IF NOT EXISTS superseded_by   bigint REFERENCES asset_compliance (asset_compliance_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS renewed_from    bigint REFERENCES asset_compliance (asset_compliance_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS renewal_no      integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN asset_compliance.superseded_at IS
    'Null means this is the document in force. Anything else is history kept '
    'deliberately: it is what proves the machine was covered last March.';

-- Everything that reads "the insurance" wants the one in force, and every one
-- of those queries would otherwise have to remember to say so.
CREATE INDEX IF NOT EXISTS asset_compliance_current_idx
    ON asset_compliance (asset_id, document_type)
    WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS asset_compliance_history_idx
    ON asset_compliance (asset_id, document_type, superseded_at DESC)
    WHERE superseded_at IS NOT NULL;

-- ── corrections leave a trail ────────────────────────────────────────────────
-- Small and append-only. A correction is rare and interesting precisely because
-- it means somebody had the wrong thing on file for a while.
CREATE TABLE IF NOT EXISTS asset_compliance_revision (
    revision_id     bigserial PRIMARY KEY,
    asset_compliance_id bigint NOT NULL
        REFERENCES asset_compliance (asset_compliance_id) ON DELETE CASCADE,
    asset_id        bigint NOT NULL REFERENCES asset (asset_id) ON DELETE CASCADE,
    changes         jsonb NOT NULL,       -- {field: {from, to}}
    reason          text,
    changed_by      text NOT NULL,
    changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_compliance_revision_idx
    ON asset_compliance_revision (asset_id, changed_at DESC);

-- ── the certificate itself ───────────────────────────────────────────────────
-- Files live on disk, not in a column: a scanned fitness certificate is not
-- something to keep in Postgres, and not something to lose on a redeploy. The
-- same arrangement operator_document already uses, deliberately, so there is
-- one way to handle an upload rather than two.
--
-- A document may hang off a compliance row or off the machine alone — a
-- purchase invoice belongs to the machine and to no certificate.
CREATE TABLE IF NOT EXISTS asset_document (
    asset_document_id bigserial PRIMARY KEY,
    asset_id        bigint NOT NULL REFERENCES asset (asset_id) ON DELETE CASCADE,
    asset_compliance_id bigint
        REFERENCES asset_compliance (asset_compliance_id) ON DELETE CASCADE,
    kind            text NOT NULL DEFAULT 'OTHER',
    title           text,
    file_name       text NOT NULL,
    stored_name     text NOT NULL UNIQUE,
    content_type    text,
    size_bytes      bigint,
    uploaded_by     text,
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    status          text NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'REPLACED', 'REMOVED'))
);

CREATE INDEX IF NOT EXISTS asset_document_asset_idx
    ON asset_document (asset_id, uploaded_at DESC) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS asset_document_compliance_idx
    ON asset_document (asset_compliance_id) WHERE status = 'ACTIVE';

-- A renewal keeps its own papers. Attaching the new policy to the new row and
-- leaving last year's on last year's row is the whole point of the lineage
-- above, and it only works if the document points at the version rather than
-- at the machine.
COMMENT ON COLUMN asset_document.asset_compliance_id IS
    'The document version these papers belong to. Null for papers about the '
    'machine itself rather than one certificate.';
