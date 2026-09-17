-- ============================================================================
-- MineHub · Migration 007 · Versions, approval and a trail per machine
-- ============================================================================
-- A machine's record is not a form that is filled once. Its insurance is
-- renewed, its hour meter moves, it is sold or rehired, its rated output is
-- corrected. Each of those is a decision someone made, and the questions that
-- follow are always the same three:
--
--     who changed the rated output, and what was it before?
--     who approved this machine onto the register?
--     when did the insurance expiry change, and to what?
--
-- So every edit produces a revision holding the fields that actually changed,
-- old value and new, and the record carries a version and an approval state -
-- the same shape the cost sheet already uses, because it is the same problem.
-- ============================================================================

SET search_path TO minehub, public;

ALTER TABLE asset
    ADD COLUMN IF NOT EXISTS version         integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'DRAFT'
        CHECK (approval_status IN ('DRAFT','SUBMITTED','APPROVED','SENT_BACK')),
    ADD COLUMN IF NOT EXISTS submitted_by    text,
    ADD COLUMN IF NOT EXISTS submitted_at    timestamptz,
    ADD COLUMN IF NOT EXISTS approved_by     text,
    ADD COLUMN IF NOT EXISTS approved_at     timestamptz;

COMMENT ON COLUMN asset.approval_status IS
    'DRAFT while being completed, SUBMITTED for review, APPROVED once accepted onto the register, SENT_BACK when returned for correction.';

-- ---------------------------------------------------------------------------
-- asset_revision — one row per change, append-only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_revision (
    revision_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id       bigint NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    version        integer NOT NULL,
    action         text NOT NULL CHECK (action IN
                     ('CREATED','UPDATED','SUBMITTED','APPROVED','SENT_BACK',
                      'DOCUMENT_CHANGED','SCHEDULE_CHANGED','IDENTITY_CHANGED')),
    -- Only what moved: {"rated_output_per_hr": {"from": 45, "to": 50}, ...}
    -- A full snapshot per revision would be honest but unreadable; the question
    -- people ask is what changed, not what everything was.
    changes        jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- The complete record as it stood after this revision, so any version can be
    -- reconstructed or reverted to without replaying every change before it.
    snapshot       jsonb,
    remarks        text,
    changed_by     text NOT NULL,
    changed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_asset_revision ON asset_revision (asset_id, changed_at DESC);

COMMENT ON TABLE asset_revision IS
    'Append-only history of every change to a machine. Never updated, never deleted.';

-- ---------------------------------------------------------------------------
-- Seed a CREATED revision for anything already registered, so no machine has a
-- history that begins mid-story.
-- ---------------------------------------------------------------------------
INSERT INTO asset_revision (asset_id, version, action, changes, remarks, changed_by, changed_at)
SELECT a.asset_id, 1, 'CREATED', '{}'::jsonb,
       'Registered before revision tracking existed', COALESCE(a.created_by, 'SYSTEM'), a.created_at
FROM asset a
WHERE NOT EXISTS (SELECT 1 FROM asset_revision r WHERE r.asset_id = a.asset_id);

-- SAP asset numbers become a suggestion list of their own, so the same asset is
-- not entered twice under two spellings.
INSERT INTO lookup (category, value, is_system, created_by)
SELECT DISTINCT 'SAP_ASSET', a.sap_asset_no, false, 'MIGRATION_007'
FROM asset a
WHERE a.sap_asset_no IS NOT NULL AND btrim(a.sap_asset_no) <> ''
  AND NOT EXISTS (SELECT 1 FROM lookup l
                  WHERE l.category = 'SAP_ASSET' AND l.value = a.sap_asset_no);

INSERT INTO schema_migration (migration_id, description)
VALUES ('007_asset_revision', 'Asset versions, approval state and an append-only revision trail')
ON CONFLICT (migration_id) DO NOTHING;
