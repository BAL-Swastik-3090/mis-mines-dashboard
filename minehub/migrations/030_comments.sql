-- 030: somewhere to say the thing that does not fit in a field.
--
-- Every screen so far records facts: this machine is on hire until March, this
-- operator is assessed at level 3, this shift was short by four. What none of
-- them can hold is the sentence a person would actually say about it — "the
-- hydraulics have been slow since the monsoon, watch it", "Sahoo asked for the
-- 14th off, told him to raise it properly", "this PO is being renegotiated, do
-- not chase the expiry yet".
--
-- That sentence currently lives in WhatsApp, and it is the difference between a
-- register and a record. A note nobody can find is a note nobody wrote.
--
-- WHY IT IS ONE TABLE AND NOT SEVEN. A comment on a machine and a comment on a
-- leave request are the same object: somebody said something about something,
-- at a time, and other people replied. Seven tables would mean seven endpoints,
-- seven components and seven ways for the feature to rot unevenly — and the one
-- thing people will actually ask for, "show me everything said this week",
-- would need a seven-way union nobody maintains.
--
-- The cost is that entity_id cannot be a foreign key: it points at a different
-- table depending on entity_type. That is a real cost and it is paid
-- deliberately. It is bounded by a check constraint on the type, and orphaned
-- threads are cleaned up rather than being allowed to accumulate — see the
-- cleanup at the end.

CREATE TABLE IF NOT EXISTS comment (
    comment_id      bigserial PRIMARY KEY,

    -- What is being talked about. The pair is the address.
    entity_type     text NOT NULL CHECK (entity_type IN (
                        'ASSET', 'OPERATOR', 'SHIFT', 'DEPLOYMENT', 'HOTO',
                        'LEAVE', 'EXCEPTION', 'PATTERN', 'PLANT')),
    entity_id       bigint NOT NULL,

    -- A reply belongs to a thread. One level only: a mine does not need
    -- threaded sub-threads, and every product that allowed them regrets it.
    parent_id       bigint REFERENCES comment (comment_id) ON DELETE CASCADE,

    body            text NOT NULL CHECK (length(btrim(body)) > 0),

    -- Who is being asked. Employee ids rather than names, because a name is not
    -- an identity and "tell Sahoo" has never reached anybody.
    mentions        text[] NOT NULL DEFAULT '{}',

    -- A comment that asks for something can be closed when it is done, which is
    -- what separates a note from a task. Most comments never use this.
    is_resolved     boolean NOT NULL DEFAULT FALSE,
    resolved_by     text,
    resolved_at     timestamptz,

    -- Pinned to the top of its thread. For the one sentence a person arriving
    -- at this machine needs before they read anything else.
    is_pinned       boolean NOT NULL DEFAULT FALSE,

    author_emp_id   text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- Kept rather than hidden. An edited comment says so, because a note that
    -- can change silently is a note nobody can rely on having read.
    edited_at       timestamptz,
    deleted_at      timestamptz,
    deleted_by      text
);

-- The thread for one thing, newest activity first. The partial index skips
-- deleted rows, which is most of what a busy thread accumulates.
CREATE INDEX IF NOT EXISTS comment_entity_idx
    ON comment (entity_type, entity_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- "Everything said this week", which is the feed.
CREATE INDEX IF NOT EXISTS comment_recent_idx
    ON comment (created_at DESC) WHERE deleted_at IS NULL;

-- "What was addressed to me", which is the only notification anybody wants.
CREATE INDEX IF NOT EXISTS comment_mentions_idx
    ON comment USING gin (mentions) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS comment_open_idx
    ON comment (entity_type, entity_id)
    WHERE deleted_at IS NULL AND is_resolved = FALSE AND parent_id IS NULL;

COMMENT ON COLUMN comment.entity_id IS
    'Points at a different table depending on entity_type, so it cannot be a '
    'foreign key. Orphans are cleaned by prune_orphan_comments().';

-- ── who has read what ────────────────────────────────────────────────────────
-- One row per person per thread, holding the moment they last looked. Not a row
-- per person per comment: that is the same information multiplied by the number
-- of comments, and it is the table that makes read-tracking slow everywhere it
-- has ever been built that way.
CREATE TABLE IF NOT EXISTS comment_read (
    entity_type     text NOT NULL,
    entity_id       bigint NOT NULL,
    emp_id          text NOT NULL,
    last_read_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id, emp_id)
);

-- ── keeping it honest ────────────────────────────────────────────────────────
-- Because entity_id is not a foreign key, deleting a machine leaves its thread
-- behind. Run this after anything that removes records in bulk — the purge
-- script calls it — rather than letting orphans quietly become most of the
-- table.
CREATE OR REPLACE FUNCTION prune_orphan_comments() RETURNS integer AS $$
DECLARE
    removed integer := 0;
    n       integer;
BEGIN
    DELETE FROM comment c WHERE c.entity_type = 'ASSET'
      AND NOT EXISTS (SELECT 1 FROM asset a WHERE a.asset_id = c.entity_id);
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

    DELETE FROM comment c WHERE c.entity_type = 'OPERATOR'
      AND NOT EXISTS (SELECT 1 FROM operator o WHERE o.operator_id = c.entity_id);
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

    DELETE FROM comment c WHERE c.entity_type = 'LEAVE'
      AND NOT EXISTS (SELECT 1 FROM leave_request l
                       WHERE l.leave_request_id = c.entity_id);
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

    DELETE FROM comment c WHERE c.entity_type = 'SHIFT'
      AND NOT EXISTS (SELECT 1 FROM shift_instance s
                       WHERE s.shift_instance_id = c.entity_id);
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

    DELETE FROM comment c WHERE c.entity_type = 'DEPLOYMENT'
      AND NOT EXISTS (SELECT 1 FROM deployment d
                       WHERE d.deployment_id = c.entity_id);
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

    DELETE FROM comment_read r
     WHERE NOT EXISTS (SELECT 1 FROM comment c
                        WHERE c.entity_type = r.entity_type
                          AND c.entity_id = r.entity_id);

    RETURN removed;
END;
$$ LANGUAGE plpgsql;

-- ── who may do this ──────────────────────────────────────────────────────────
-- Reading notes is not a privilege worth administering: anybody who can see the
-- machine can see what was said about it. Writing is, because a comment carries
-- a name and a time and will be read as a statement of record.
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
    ('platform.comment.write',   'Platform', 'Write notes',
     'Add notes and replies to machines, people, shifts and requests', FALSE, 510),
    ('platform.comment.moderate', 'Platform', 'Moderate notes',
     'Delete or resolve notes written by somebody else', TRUE, 520)
ON CONFLICT (code) DO NOTHING;

-- Anybody who can already do real work on the platform can write a note. A
-- register people can read but not annotate is one they annotate elsewhere.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE p.code = 'platform.comment.write'
  AND r.code IN ('SHIFT_SUPERVISOR', 'EQUIPMENT_REGISTRAR', 'EQUIPMENT_APPROVER',
                 'OPERATOR_REGISTRAR', 'OPERATOR_APPROVER', 'COMPETENCY_ASSESSOR')
ON CONFLICT DO NOTHING;
