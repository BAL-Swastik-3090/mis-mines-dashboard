-- 094: record sign-in attempts, including the ones that fail.
--
-- Only SUCCESSFUL logins were ever written down -- a session row is created
-- once somebody is already in. A refusal left nothing at all.
--
-- That gap had a cost the day it mattered. An auditor reported being unable
-- to sign in; the stored credential matched MySQL exactly, the access grant
-- was present and active, the role carried eight permissions, and the last
-- successful session was a week old. Every check said the server would let
-- them in, and there was no way to see what actually happened when they
-- tried -- only that it had not worked. The diagnosis ended at "nothing on
-- our side would refuse this", which is an absence of evidence rather than
-- an answer.
--
-- ── WHAT IS DELIBERATELY NOT STORED ─────────────────────────────────────────
-- The password. Not the attempt, not a hash of it, not its length. A table of
-- failed passwords is a table of near-miss passwords, and the reason to want
-- one -- "was it a typo or the wrong password entirely?" -- is not worth
-- keeping that. The outcome says which check refused, which is what a person
-- investigating actually needs.
--
-- empid IS stored as typed, because the useful cases are precisely the ones
-- where it is wrong: somebody entering an email address, a name, or another
-- system's username. It is capped and never interpolated into SQL.

CREATE TABLE IF NOT EXISTS login_attempt (
    login_attempt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at      timestamptz NOT NULL DEFAULT now(),

    -- as typed, trimmed and capped -- see above
    empid            text NOT NULL,

    -- WHICH CHECK REFUSED. The login endpoint deliberately tells the person
    -- the same thing for the first three, so the endpoint cannot be used to
    -- discover which employee IDs exist. That reticence is right facing the
    -- internet and wrong facing whoever has to explain a refusal, so the
    -- distinction is kept here and shown only to Access Managers.
    --   OK            signed in
    --   BAD_PASSWORD  the ID exists and is active; the password did not match
    --   UNKNOWN_ID    no such row in the credentials table
    --   INACTIVE      the row exists but its status is not 'A'
    --   NO_ACCESS     credentials fine, but not invited to this dashboard
    --   INCOMPLETE    the form was submitted without an ID or a password
    outcome          text NOT NULL CHECK (outcome IN (
                       'OK','BAD_PASSWORD','UNKNOWN_ID','INACTIVE',
                       'NO_ACCESS','INCOMPLETE')),

    ip_address       text,
    user_agent       text
);

-- The two questions this gets asked: "what happened in the last hour" and
-- "what has this person been doing". Both newest-first.
CREATE INDEX IF NOT EXISTS ix_login_attempt_at
    ON login_attempt (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_login_attempt_empid
    ON login_attempt (empid, occurred_at DESC);

COMMENT ON TABLE login_attempt IS
    'Every sign-in attempt and how it ended. Never stores the password or '
    'anything derived from it. Read by Access Control; Access Managers only.';

-- ── RETENTION IS NOT HANDLED HERE, AND THAT IS WORTH SAYING ────────────────
-- This table grows with every attempt and nothing prunes it. At the current
-- rate -- a few hundred sign-ins a week -- that is slow enough to leave for a
-- person to decide, and a silent DELETE on security history is worse than a
-- table somebody has to think about. If it does need bounding later, deleting
-- rows older than a year is the obvious rule, and the occurred_at index
-- already supports it.
