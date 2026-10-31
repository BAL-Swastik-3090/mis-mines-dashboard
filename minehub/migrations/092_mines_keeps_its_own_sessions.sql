-- 092: the Mines dashboard stops writing into the shared intranet session table.
--
-- digital_apps_user_sessions is ONE table that about twenty-five intranet
-- applications write to -- Digital Logbook, Leave Management, PMS, INTRANET,
-- IMOS, CRM, SCM and the rest. Mines has been one row-writer among many.
--
-- Moving the Mines login to Postgres means its session writes have to go
-- somewhere, and the shared table is the one place they must NOT go:
--
--   * The Postgres copy of it is a MIRROR, frozen on 26 October for every app
--     but PEMS. The other applications read MySQL. A session written to the
--     mirror would be invisible to all of them.
--   * usage_sync.py already writes that mirror, pulling rows from MySQL. A
--     second writer into the same rows is a race with no referee.
--
-- So Mines gets its own two tables, in its own schema, for its own sessions.
-- Nothing else reads them and nothing else writes them. The shared table keeps
-- working exactly as it does today for every other application -- which is the
-- whole point: this change must be invisible outside this dashboard.
--
-- WHAT IS GIVEN UP, SAID PLAINLY. Mines sessions will no longer appear in the
-- shared intranet session list. If somebody is looking for "who is logged into
-- anything right now" across the estate, Mines will be missing from that
-- answer. The Usage page inside this dashboard is unaffected -- it reads
-- minehub.usage_session, which is separate again.

CREATE TABLE IF NOT EXISTS mines_user_session (
    session_id        VARCHAR(64)  PRIMARY KEY,
    emp_id            VARCHAR(20)  NOT NULL,
    emp_name          VARCHAR(120),
    role              VARCHAR(120),
    department        VARCHAR(120),
    app_source        VARCHAR(40)  NOT NULL DEFAULT 'MINES',
    login_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    logout_at         TIMESTAMP,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    end_reason        VARCHAR(40),
    ip_address        VARCHAR(64),
    user_agent        VARCHAR(500),
    device_type       VARCHAR(20),
    browser           VARCHAR(40),
    os                VARCHAR(40),
    -- Derived, as it was on MySQL, so no code has to remember to set it.
    -- EXTRACT over a timestamp difference is immutable, which is what Postgres
    -- requires of a stored generated column.
    duration_minutes  INTEGER GENERATED ALWAYS AS (
        FLOOR(EXTRACT(EPOCH FROM (logout_at - login_at)) / 60)::INTEGER) STORED
);

-- The session check runs on EVERY api request: cookie, still open, not idle.
-- That is the index that has to exist; the rest of this table is written far
-- more often than it is searched.
CREATE INDEX IF NOT EXISTS ix_mines_user_session_live
    ON mines_user_session (session_id, is_active, last_active_at);

-- For "who is signed in", and for closing a person's other sessions.
CREATE INDEX IF NOT EXISTS ix_mines_user_session_emp
    ON mines_user_session (emp_id, last_active_at DESC);

COMMENT ON TABLE mines_user_session IS
    'Mines dashboard login sessions. This app only -- the shared intranet '
    'table digital_apps_user_sessions is deliberately left alone.';


CREATE TABLE IF NOT EXISTS mines_page_view (
    id                  BIGSERIAL    PRIMARY KEY,
    session_id          VARCHAR(64)  NOT NULL,
    emp_id              VARCHAR(20)  NOT NULL,
    page_path           VARCHAR(255) NOT NULL,
    app_source          VARCHAR(40)  NOT NULL DEFAULT 'MINES',
    referrer_path       VARCHAR(255),
    viewed_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_spent_seconds  INTEGER
);

-- record_time_spent() completes the most recent view of a page in a session
-- that has no duration yet. That lookup is this index.
CREATE INDEX IF NOT EXISTS ix_mines_page_view_open
    ON mines_page_view (session_id, page_path, viewed_at DESC)
    WHERE time_spent_seconds IS NULL;

CREATE INDEX IF NOT EXISTS ix_mines_page_view_session
    ON mines_page_view (session_id, viewed_at DESC);

COMMENT ON TABLE mines_page_view IS
    'Page views and dwell time for the Mines dashboard. This app only.';
