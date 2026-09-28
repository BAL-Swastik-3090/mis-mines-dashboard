-- An alert is an episode, not a flash.
--
-- The live endpoint could say what is wrong NOW. It could not say that WB3 had
-- been down since Saturday 09:50, because nothing wrote that down — each poll
-- recomputed the present and forgot it. So "how long has this been happening",
-- "has it happened before", and "did anybody see it" had no answers.
--
-- An episode has a beginning, possibly an end, and a severity that can worsen
-- while it runs. One row per episode, opened when the fault appears and closed
-- when it clears, rather than one row per poll — sixty rows an hour saying the
-- same thing is a log, not a history, and nobody reads it.
--
-- RECOVERY IS AN EVENT TOO. Closing the row is what lets the bell say "WB3 is
-- back" — which people want to hear at least as much as the failure, and which
-- no amount of looking at the present can tell you.

CREATE TABLE IF NOT EXISTS platform_alert (
    alert_id     BIGSERIAL PRIMARY KEY,
    -- Stable across polls: "wb-agent-WB3". This is what ties the fault seen at
    -- 12:40 to the same fault seen at 12:41 instead of opening a new episode
    -- every minute.
    alert_key    TEXT        NOT NULL,
    kind         TEXT        NOT NULL,
    title        TEXT        NOT NULL,
    detail       TEXT,
    -- The worst it reached, not the severity when it opened. An agent that
    -- goes late and then down had one bad episode, and the history should say
    -- so rather than recording a ten-minute wobble.
    severity     TEXT        NOT NULL,
    opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- When the underlying condition actually began, where that is knowable —
    -- the last heartbeat, not the poll that noticed. Otherwise an outage that
    -- started on Saturday reads as having started when somebody first looked.
    since_at     TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ
);

-- One OPEN episode per key. A partial index rather than a plain unique: the
-- same bridge may go down many times, and each closed episode has to stay.
CREATE UNIQUE INDEX IF NOT EXISTS platform_alert_one_open
    ON platform_alert (alert_key) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS platform_alert_recent
    ON platform_alert (opened_at DESC);


-- Who has seen what.
--
-- "Clear all" marks alerts as seen BY THE PERSON WHO CLICKED. It does not
-- delete them, and it does not clear them for anybody else: the fault is still
-- happening, the weighbridge is still not weighing, and one person deciding
-- they have read it must not take it off a colleague's screen. Dismissing a
-- notification is a fact about a reader, not about the world.
--
-- An alert that is acknowledged and then WORSENS surfaces again, because the
-- acknowledgement was of the thing as it stood.
CREATE TABLE IF NOT EXISTS platform_alert_ack (
    alert_id  BIGINT      NOT NULL REFERENCES platform_alert(alert_id) ON DELETE CASCADE,
    emp_id    TEXT        NOT NULL,
    acked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- What they acknowledged. If it gets worse than this, it is news again.
    severity  TEXT        NOT NULL,
    PRIMARY KEY (alert_id, emp_id)
);
