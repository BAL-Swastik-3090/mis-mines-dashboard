-- 010: let a draft be incomplete, and check completeness where it matters.
--
-- Registration was refusing to save without an equipment type, so someone who
-- walked to the machine to read its chassis plate lost everything they had
-- typed. That is exactly the situation a draft exists for. The completeness
-- rules do not disappear, they move to the point where the record stops being
-- one person's working note and becomes something others rely on: submission
-- for approval.
--
-- Draft rows are therefore allowed to be sparse, and the constraints apply only
-- once approval_status leaves DRAFT.

ALTER TABLE asset ALTER COLUMN asset_type_id DROP NOT NULL;

-- A hired machine still has to name its contractor — but only when it is put
-- forward, not while it is being typed.
ALTER TABLE asset DROP CONSTRAINT IF EXISTS hired_asset_has_owner;
ALTER TABLE asset ADD CONSTRAINT hired_asset_has_owner CHECK (
    approval_status IN ('DRAFT', 'SENT_BACK')
    OR ownership = 'OWN'
    OR owner_party_id IS NOT NULL
);

-- What a machine must have before anyone can be asked to approve it.
ALTER TABLE asset DROP CONSTRAINT IF EXISTS submitted_asset_is_complete;
ALTER TABLE asset ADD CONSTRAINT submitted_asset_is_complete CHECK (
    approval_status IN ('DRAFT', 'SENT_BACK')
    OR (asset_type_id IS NOT NULL AND fleet_code NOT LIKE 'DRAFT-%')
);
