-- 015: departments are the mine's to create, not mine to infer.
--
-- 014 seeded nineteen departments read out of the SAP employee master. That was
-- the wrong instinct: the employee master says which department a *person* is
-- paid under, which is not the same question as which department is accountable
-- for a machine, and a list arriving pre-filled with names nobody chose invites
-- people to pick the nearest one rather than the right one. It is also the
-- pattern already used everywhere else on this form — type what is missing and
-- it joins the list.
--
-- So the seeded rows go, along with the department I inferred onto machines
-- that had none. The database stops requiring a department; submission still
-- asks for one, which is where the requirement belongs.

-- The old rule comes off first. Clearing org_unit_id while it still demands one
-- would fail against the constraint this migration exists to replace.
ALTER TABLE asset DROP CONSTRAINT IF EXISTS submitted_asset_is_complete;

UPDATE asset SET org_unit_id = NULL
WHERE org_unit_id IN (SELECT org_unit_id FROM org_unit WHERE created_by = 'migration');

DELETE FROM org_unit WHERE created_by = 'migration';

ALTER TABLE asset ADD CONSTRAINT submitted_asset_is_complete CHECK (
    approval_status IN ('DRAFT', 'SENT_BACK')
    OR (asset_type_id IS NOT NULL
        AND fleet_code NOT LIKE 'DRAFT-%'
        AND plant_id IS NOT NULL)
);
