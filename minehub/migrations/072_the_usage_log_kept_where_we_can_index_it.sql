-- 072: our own copy of the usage log, in a database we are allowed to index.
--
-- WHY THIS EXISTS. The usage screen reads two tables in balcorpdb that every
-- application in the company writes to. Neither has an index led by
-- app_source, so finding our rows means reading everyone's:
--
--     digital_apps_user_sessions   128,725 rows   606 of them ours
--     digital_apps_page_views      155,551 rows  2,428 of them ours
--
-- Twenty queries did that twenty times and the page took six seconds. Folding
-- them into two passes got it to 1.2s, and what is left is those two scans.
--
-- The index that would end them belongs on a table twenty-five applications
-- write to, and adding it is not ours to do quietly. So the rows come here
-- instead, where the index costs nobody anything and the reads never touch a
-- shared server at all.
--
-- ONLY OUR OWN APPLICATIONS. MINES and IMOS, which is all the screen has ever
-- shown. Copying the rest of the company's sign-in history into our database
-- to draw a chart about ours would be collecting something we have no use for.
--
-- STILL A COPY, NEVER THE RECORD. balcorpdb stays the place a session is
-- written; this is a mirror kept current by a sync, and it can be dropped and
-- rebuilt from the source at any time without losing anything. Nothing writes
-- here except the sync.


-- ---------------------------------------------------------------------------
-- 1. A sign-in
-- ---------------------------------------------------------------------------
--
-- The same shape the source holds, minus user_agent: it is a 500-character
-- string the screen never shows, and browser, os and device_type -- which it
-- does show -- are already parsed out of it.

CREATE TABLE IF NOT EXISTS usage_session (
    session_id       text PRIMARY KEY,
    app_source       text        NOT NULL,
    emp_id           text        NOT NULL,
    emp_name         text,
    role             text,
    department       text,
    login_at         timestamp   NOT NULL,
    last_active_at   timestamp   NOT NULL,
    logout_at        timestamp,
    duration_minutes integer,
    is_active        boolean     NOT NULL DEFAULT false,
    end_reason       text,
    ip_address       text,
    device_type      text,
    browser          text,
    os               text,
    -- When the sync last carried this row across. A figure whose age cannot
    -- be established is a figure nobody can defend in a meeting.
    synced_at        timestamptz NOT NULL DEFAULT now()
);

-- The index the shared table does not have, and the whole reason for this
-- file: every query on the screen filters app_source and a date range.
CREATE INDEX IF NOT EXISTS ix_usage_session_app_day
    ON usage_session (app_source, login_at DESC);
-- Still signed in, for "who is in there now" -- a question with no date range.
CREATE INDEX IF NOT EXISTS ix_usage_session_live
    ON usage_session (app_source, is_active) WHERE is_active;
-- One person's history, for the drill-down.
CREATE INDEX IF NOT EXISTS ix_usage_session_emp
    ON usage_session (emp_id, login_at DESC);
-- What the sync asks for: everything that has changed since it last looked.
CREATE INDEX IF NOT EXISTS ix_usage_session_touched
    ON usage_session (last_active_at DESC);


-- ---------------------------------------------------------------------------
-- 2. A screen somebody opened
-- ---------------------------------------------------------------------------
--
-- page_view_id is the source's own id, not a new one. A mirror that minted
-- its own keys could not tell an updated row from a new one, and
-- time_spent_seconds IS updated after the fact -- it is written when the
-- reader leaves the page, not when they arrive.

CREATE TABLE IF NOT EXISTS usage_page_view (
    page_view_id       bigint PRIMARY KEY,
    session_id         text        NOT NULL,
    app_source         text        NOT NULL,
    emp_id             text        NOT NULL,
    page_path          text        NOT NULL,
    referrer_path      text,
    viewed_at          timestamp   NOT NULL,
    time_spent_seconds integer,
    synced_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_usage_view_app_day
    ON usage_page_view (app_source, viewed_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_view_emp
    ON usage_page_view (emp_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_view_path
    ON usage_page_view (app_source, page_path);
CREATE INDEX IF NOT EXISTS ix_usage_view_session
    ON usage_page_view (session_id);


-- ---------------------------------------------------------------------------
-- 3. How far the mirror has got
-- ---------------------------------------------------------------------------
--
-- One row per table. Without it every start would either re-read the whole
-- source or quietly skip whatever arrived while the service was down, and the
-- second failure is the one nobody notices.
--
-- The watermark is deliberately rewound a little on each run -- see the sync.
-- A session's row keeps changing after it is written, so "everything newer
-- than last time" is not the same question as "everything that changed since
-- last time".

CREATE TABLE IF NOT EXISTS usage_sync_state (
    source_table  text PRIMARY KEY,
    watermark     timestamp,
    last_run_at   timestamptz,
    last_rows     integer NOT NULL DEFAULT 0,
    last_error    text
);

COMMENT ON TABLE usage_session IS
    'Mirror of balcorpdb.digital_apps_user_sessions for our own applications. '
    'A copy, never the record: droppable and rebuildable from the source.';
COMMENT ON TABLE usage_page_view IS
    'Mirror of balcorpdb.digital_apps_page_views for our own applications.';
