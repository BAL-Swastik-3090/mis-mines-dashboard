-- 085: a mailbox is a source you configure, not a source you deploy.
--
-- The fleet reports arrive as spreadsheets attached to email -- Tata Prima
-- fuel, idling, trip-wise geofence, driving behaviour -- and the mine wants to
-- point the dashboard at a mailbox without a release each time the sender,
-- the subject line or the mailbox owner changes.
--
-- ── WHAT IS CONFIGURABLE HERE, AND WHAT IS DELIBERATELY NOT ────────────────
--
-- CONFIGURABLE: which mailbox, which folder, which sender, which subject, and
-- whether it is switched on. That is the part that actually changes -- the
-- problem statement names mailbox ownership as a thing that moves, and it is
-- right.
--
-- NOT CONFIGURABLE: how a workbook's columns map to fields. That belongs in
-- code and it is a decision, not an omission. A mapping table is a second
-- programming language with no type checking, no tests and no debugger, and
-- when a report breaks nobody can say whether the config or the file is wrong.
-- The evidence is in this repo: the LiuGong loader matches headers by
-- normalised NAME in about ten lines, and when the vendor added an eleventh
-- column in the Oct-2026 export it parsed without a change.
--
-- ── NO SECRET LIVES IN THIS TABLE ──────────────────────────────────────────
--
-- One Azure app registration serves every mailbox; its tenant, client id and
-- secret are environment, not data. A row here names a mailbox that app has
-- been granted access to. So "configure any email" is an INSERT, a credential
-- is never stored in a database row, and revoking access is an Exchange policy
-- change rather than a hunt through table data.

SET search_path TO minehub, public;

-- ---------------------------------------------------------------------
-- 1. WHERE REPORTS COME FROM
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_source (
    mail_source_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    label           text NOT NULL,
    -- The mailbox to read, e.g. 'mpicc@balasorealloys.com'. The Azure app must
    -- hold application Mail.Read for it; scope that with an Exchange
    -- application access policy so one app cannot read the whole company.
    mailbox         text NOT NULL,
    folder          text NOT NULL DEFAULT 'Inbox',

    -- Both optional and both case-insensitive substring matches. A source with
    -- neither takes every message in the folder, which is occasionally what a
    -- dedicated reports mailbox wants.
    sender_contains  text,
    subject_contains text,

    -- Which parser the attachments go to. A VALUE, not a mapping: it names a
    -- function in services/, so an unknown parser fails loudly on sight
    -- instead of silently writing nothing.
    report_type     text NOT NULL,

    -- Only these extensions are taken off a message. Everything else -- the
    -- signature images, the PDF covering note -- is ignored rather than landed.
    attachment_ext  text[] NOT NULL DEFAULT ARRAY['.xlsx', '.xls', '.csv'],

    is_enabled      boolean NOT NULL DEFAULT true,

    -- Polling state, kept here so the screen can show it without a log dive.
    last_polled_at  timestamptz,
    last_seen_at    timestamptz,   -- newest message datetime this source has read
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text,

    CONSTRAINT mail_source_unique UNIQUE (mailbox, folder, report_type)
);

COMMENT ON TABLE mail_source IS
    'A mailbox the dashboard reads fleet reports from. Credentials are NOT here -- one Azure app in the environment serves every row.';
COMMENT ON COLUMN mail_source.report_type IS
    'Names a parser in services/. Not a field mapping: the columns are matched by name in code.';
COMMENT ON COLUMN mail_source.last_seen_at IS
    'Newest message datetime already read. The poller asks for anything AFTER this, so a restart does not re-read the folder.';

CREATE INDEX IF NOT EXISTS mail_source_enabled_idx ON mail_source (is_enabled);


-- ---------------------------------------------------------------------
-- 2. EVERY FILE THAT LANDED, BEFORE ANYBODY PARSED IT
-- ---------------------------------------------------------------------
--
-- LANDING IS SEPARATE FROM PARSING, on purpose, and this table is the seam.
--
-- Parsing on arrival means a fixed parser can never be re-run over last
-- month's files, a human cannot drop a file in when the mailbox is down, and
-- a duplicate is only as detectable as the file NAME. Keeping the bytes costs
-- a few megabytes a month and buys all three.
--
-- sha256 is the duplicate test. Tata resend the same attachment when somebody
-- asks for it again, and the same workbook twice is one file, whatever the
-- message id says.
CREATE TABLE IF NOT EXISTS mail_report_file (
    file_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mail_source_id  integer REFERENCES mail_source (mail_source_id)
                    ON UPDATE CASCADE ON DELETE SET NULL,

    sha256          char(64) NOT NULL UNIQUE,
    filename        text NOT NULL,
    size_bytes      integer NOT NULL,
    content         bytea NOT NULL,

    -- Provenance, so a figure can be traced to the message it came from.
    message_id      text,
    sender          text,
    subject         text,
    received_at     timestamptz,
    landed_at       timestamptz NOT NULL DEFAULT now(),

    -- Lifecycle. This column IS the audit trail; a separate log table would be
    -- a second place for the same truth to be recorded differently.
    --   LANDED  stored, not yet parsed
    --   PARSED  rows written
    --   FAILED  parser refused it -- last_error says why, and it can be re-run
    --   IGNORED a human decided it is not a report
    status          text NOT NULL DEFAULT 'LANDED'
                    CHECK (status IN ('LANDED', 'PARSED', 'FAILED', 'IGNORED')),
    parsed_at       timestamptz,
    row_count       integer,
    error_text      text,
    attempts        integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE mail_report_file IS
    'Raw attachments as received. Parsing reads from here, so a fixed parser can be re-run and a human can drop a file in by hand.';
COMMENT ON COLUMN mail_report_file.sha256 IS
    'Duplicate test. The same workbook resent is one file however the message id differs.';
COMMENT ON COLUMN mail_report_file.content IS
    'The bytes. Kept so stage 2 never needs the mailbox again.';
COMMENT ON COLUMN mail_report_file.status IS
    'LANDED / PARSED / FAILED / IGNORED. The history of this column is the ingestion audit trail.';

CREATE INDEX IF NOT EXISTS mail_report_file_status_idx ON mail_report_file (status, landed_at DESC);
CREATE INDEX IF NOT EXISTS mail_report_file_source_idx ON mail_report_file (mail_source_id, received_at DESC);


-- ---------------------------------------------------------------------
-- 3. Seed the experiment
-- ---------------------------------------------------------------------
-- Disabled on purpose: it is switched on from the screen once the Azure app
-- can actually read the mailbox, so a half-configured source never starts
-- polling and filling last_error.
INSERT INTO mail_source (label, mailbox, folder, subject_contains,
                         report_type, is_enabled, created_by)
VALUES ('Tata Prima — fuel consumption (trial)',
        'mpicc@balasorealloys.com', 'Inbox', 'fuel',
        'PRIMA_FUEL', false, 'MIGRATION_085')
ON CONFLICT (mailbox, folder, report_type) DO NOTHING;
