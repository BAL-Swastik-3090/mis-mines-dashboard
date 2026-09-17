-- ============================================================================
-- MineHub · Migration 003 · Access audit trail
-- ============================================================================
-- user_access holds only the current grant, so the questions that actually get
-- asked about a system gating production data have no answer today:
--
--     who gave the external auditor access, and when?
--     who removed this person, and why did they lose it?
--     was this role always able to change access, or did someone add that?
--
-- This records every change as it happens. Append-only: an audit trail that can
-- be edited is not one.
-- ============================================================================

SET search_path TO minehub, public;

CREATE TABLE IF NOT EXISTS access_audit (
    access_audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at    timestamptz NOT NULL DEFAULT now(),
    -- who did it
    actor_emp_id   text NOT NULL,
    -- what happened
    action         text NOT NULL CHECK (action IN (
                     'USER_ROLES_SET','USER_REVOKED',
                     'ROLE_CREATED','ROLE_UPDATED','ROLE_DELETED','ROLE_PERMISSIONS_SET')),
    -- who or what it happened to
    subject_emp_id text,
    role_id        bigint,
    role_name      text,          -- kept as text: a deleted role must still read
    -- before and after, so a change can be understood without replaying history
    before_state   jsonb,
    after_state    jsonb,
    detail         text,
    ip_address     text
);

CREATE INDEX IF NOT EXISTS ix_access_audit_time    ON access_audit (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_access_audit_subject ON access_audit (subject_emp_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_access_audit_actor   ON access_audit (actor_emp_id, occurred_at DESC);

COMMENT ON TABLE access_audit IS
    'Append-only record of every access change. Never updated, never deleted.';

-- Seed one row so the trail explains its own starting point rather than looking
-- as though nobody had access before today.
INSERT INTO access_audit (actor_emp_id, action, detail, after_state)
SELECT 'SYSTEM', 'USER_ROLES_SET',
       'Baseline: ' || count(*)::text || ' existing grants migrated from the legacy role table. '
       || 'Changes from this point forward are recorded individually.',
       jsonb_build_object('migrated_grants', count(*))
FROM user_access
WHERE NOT EXISTS (SELECT 1 FROM access_audit);

INSERT INTO schema_migration (migration_id, description)
VALUES ('003_access_audit', 'Append-only audit trail for access changes')
ON CONFLICT (migration_id) DO NOTHING;
