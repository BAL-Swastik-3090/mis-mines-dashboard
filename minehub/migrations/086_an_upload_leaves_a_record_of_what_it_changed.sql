-- 086: what an upload changed, kept where the change cannot erase it.
--
-- THE PROBLEM WITH THE HISTORY WE HAD. get_upload_history reconstructs the
-- "audit trail" by grouping ev_vehicle_tracking on source_file. That is not a
-- history, it is a description of the current state wearing one:
--
--   * a row carries only the file that touched it LAST, so re-uploading a
--     month from a different export silently re-attributes those days and the
--     earlier file shrinks, or disappears, from the list;
--   * it cannot say what changed, because the old values were overwritten by
--     the very write it is trying to describe;
--   * a day that was loaded and then corrected looks exactly like a day that
--     was loaded once and left alone.
--
-- That is precisely the question asked of this table when a figure is
-- disputed: who loaded this day, when, and what did it say before.
--
-- So the write records itself. Two tables, both append-only, neither read by
-- the dashboard's own figures -- deleting the lot would cost the audit trail
-- and nothing else.
--
-- THE LOG STARTS NOW. The 1,168 rows already loaded were written before this
-- existed and have no batch; their origin is still visible through
-- source_file on the tracking row, which is what the old view will go on
-- showing. Nothing is backfilled, because the before-values those uploads
-- overwrote are genuinely gone and inventing them would be worse than a gap.

SET search_path TO minehub, public;

-- ---------------------------------------------------------------------
-- One row per file accepted. Written on the real upload only: a dry run
-- changes nothing and so has nothing to record.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ev_upload_batch (
    batch_id        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ev_vehicle_id   integer     NOT NULL REFERENCES ev_vehicle_master (ev_vehicle_id),
    source_file     text        NOT NULL,
    uploaded_by     text,
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    -- As reported to the person who pressed the button, kept so the log and
    -- the screen they saw cannot drift apart.
    rows_received   integer     NOT NULL DEFAULT 0,
    rows_new        integer     NOT NULL DEFAULT 0,
    rows_changed    integer     NOT NULL DEFAULT 0,
    rows_identical  integer     NOT NULL DEFAULT 0,
    date_from       date,
    date_to         date
);

CREATE INDEX IF NOT EXISTS ev_upload_batch_when_idx
    ON ev_upload_batch (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS ev_upload_batch_vehicle_idx
    ON ev_upload_batch (ev_vehicle_id, uploaded_at DESC);

COMMENT ON TABLE ev_upload_batch IS
    'One row per accepted EV telemetry upload. Append-only; no dashboard figure reads it.';

-- ---------------------------------------------------------------------
-- One row per day the upload touched, and for a correction, the figures
-- that moved.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ev_upload_change (
    batch_id     bigint  NOT NULL REFERENCES ev_upload_batch (batch_id) ON DELETE CASCADE,
    report_date  date    NOT NULL,
    change_type  text    NOT NULL CHECK (change_type IN ('NEW', 'CHANGED')),
    -- {"total_energy_kwh": {"from": 412.0, "to": 0.0}, ...}
    --
    -- Only the fields that actually moved, and only for CHANGED. A day being
    -- added has nothing to compare against, and storing its whole row here
    -- would duplicate the tracking table to no purpose -- the row itself is
    -- the record of what was added.
    fields       jsonb,
    PRIMARY KEY (batch_id, report_date),
    CONSTRAINT ev_upload_change_fields_ck
        CHECK ((change_type = 'CHANGED') = (fields IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ev_upload_change_date_idx
    ON ev_upload_change (report_date);

COMMENT ON TABLE ev_upload_change IS
    'What each upload did to each day. CHANGED rows carry the figures that moved, before and after.';
COMMENT ON COLUMN ev_upload_change.fields IS
    'Field-level diff for a correction: {"column": {"from": x, "to": y}}. NULL when the day was new.';
