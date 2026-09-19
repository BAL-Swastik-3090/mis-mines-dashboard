-- 036: a machine has a life, not just a status.
--
-- asset.status held five values — ACTIVE, MAINTENANCE, STANDBY, IDLE,
-- DISPOSED — which describe what a machine is doing this week. The mine's own
-- spreadsheet uses a different and longer vocabulary, because it is tracking
-- something else:
--
--     Working at Mine          running, on site
--     Off Road / Major B/D     not running, and not expected to this month
--     Cannibalize              being taken apart to keep others alive
--     Scrap to be done         written off, awaiting disposal
--
-- Those are stages of a life, not conditions of a day. A machine goes off road
-- in March, gets cannibalised in July and is scrapped the following year, and
-- each of those is a decision somebody made with a date and a reason. Today the
-- register can only hold the latest one, and only if it happens to be one of
-- the five.
--
-- WHY NOT availability_event. That table already records BREAKDOWN,
-- MAINTENANCE and the rest, and it is right for what it does: short-lived
-- operational holds that open and close, sometimes twice a day. A lifecycle
-- stage lasts months and is a commercial decision — cannibalising a tipper is
-- not a long breakdown, it is the end of that tipper. Mixing them would make
-- "how long was this machine down" unanswerable, because the answer would
-- include the eighteen months it spent being dismantled.

ALTER TABLE asset DROP CONSTRAINT IF EXISTS asset_status_check;
ALTER TABLE asset ADD CONSTRAINT asset_status_check CHECK (status IN (
    'ACTIVE',        -- working
    'MAINTENANCE',   -- in the workshop, expected back
    'STANDBY',       -- serviceable, not deployed
    'IDLE',          -- available, nothing to do
    'OFF_ROAD',      -- not running, not expected back this month
    'CANNIBALISED',  -- being stripped for parts to keep others running
    'SCRAPPED',      -- written off, awaiting disposal
    'DISPOSED'       -- gone: sold, scrapped and removed, or returned to owner
));

COMMENT ON COLUMN asset.status IS
    'Where the machine is in its life. The stage it reached and when is in '
    'asset_lifecycle; this is the current one, kept here so every list can '
    'read it without a join.';

-- ── how it got there ─────────────────────────────────────────────────────────
-- Append-only. Each row is a decision: this machine entered this stage on this
-- date, because of this, decided by this person. The current stage is the row
-- with no ended_on, and it matches asset.status.
CREATE TABLE IF NOT EXISTS asset_lifecycle (
    asset_lifecycle_id bigserial PRIMARY KEY,
    asset_id        bigint NOT NULL REFERENCES asset (asset_id) ON DELETE CASCADE,
    stage           text NOT NULL,
    started_on      date NOT NULL,
    ended_on        date,
    -- Why, in the words of whoever decided. "Engine seized, quote exceeds
    -- residual value" is the sentence an auditor asks for two years later.
    reason          text,
    -- What it cost or fetched, where that is the point of the stage. A scrap
    -- sale and a disposal both have a figure and nowhere to put it today.
    amount          numeric(14, 2),
    reference       text,                  -- disposal note, sale invoice, work order
    decided_by      text,
    recorded_by     text,
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (ended_on IS NULL OR ended_on >= started_on)
);

CREATE INDEX IF NOT EXISTS asset_lifecycle_asset_idx
    ON asset_lifecycle (asset_id, started_on DESC);

-- One current stage per machine, for the same reason one live deployment per
-- machine is enforced: two answers to "what is this doing" is worse than none.
CREATE UNIQUE INDEX IF NOT EXISTS asset_lifecycle_one_current_idx
    ON asset_lifecycle (asset_id) WHERE ended_on IS NULL;

-- ── what the fleet looks like by stage ───────────────────────────────────────
-- A view rather than a report, so the answer is the same wherever it is asked.
CREATE OR REPLACE VIEW asset_lifecycle_summary AS
SELECT a.status AS stage,
       count(*)                                                  AS machines,
       count(*) FILTER (WHERE a.ownership = 'HIRED')             AS hired,
       min(l.started_on)                                         AS earliest_entry,
       avg(CURRENT_DATE - l.started_on)::numeric(10, 0)          AS avg_days_in_stage
FROM asset a
LEFT JOIN asset_lifecycle l
       ON l.asset_id = a.asset_id AND l.ended_on IS NULL
GROUP BY a.status;

-- ── who may decide ───────────────────────────────────────────────────────────
-- Taking a machine off road is an operational call. Scrapping one is a
-- commercial write-off, and it is the only stage that cannot be undone by
-- putting the machine back to work — so it carries its own permission.
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
    ('platform.asset.lifecycle', 'Platform', 'Change a machine''s stage',
     'Move a machine between working, off road, cannibalised and standby', TRUE, 530),
    ('platform.asset.dispose',   'Platform', 'Write a machine off',
     'Mark a machine scrapped or disposed — the one stage that cannot be undone', TRUE, 540)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE p.code = 'platform.asset.lifecycle'
  AND r.code IN ('EQUIPMENT_REGISTRAR', 'EQUIPMENT_APPROVER')
ON CONFLICT DO NOTHING;
