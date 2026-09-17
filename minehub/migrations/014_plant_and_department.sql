-- 014: where a machine sits in the company, and the superadmin's standing grant.
--
-- PLANT
-- Codes are SAP's, taken from the employee master rather than invented here:
-- 1100 Balasore, 1110 Sukinda Plant, 1200 Sukinda Mines, 1210 COB, 1300 Kolkata.
-- COB does not appear as a plant in the employee master — its people are
-- recorded under the COB Plant department — so 1210 is on the mine's authority
-- rather than found in the data. Kaliapani
-- machines belong to 1200, which is therefore the default — a field that is
-- right for all but a handful of rows should not be asked fresh every time.
--
-- DEPARTMENT
-- org_unit was empty, so "Department" on the registration form was a dropdown
-- with nothing in it. It is seeded from the departments the employee master
-- actually uses, so what someone picks here matches what SAP says about the
-- people who work on the machine.
--
-- Both become required to submit, not to save: a draft may still be missing
-- them, the same as every other field.

CREATE TABLE IF NOT EXISTS plant (
    plant_id    bigserial PRIMARY KEY,
    code        text NOT NULL UNIQUE,      -- SAP plant code
    name        text NOT NULL,
    is_default  boolean NOT NULL DEFAULT false,
    status      text NOT NULL DEFAULT 'ACTIVE',
    created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plant (code, name, is_default) VALUES
    ('1200', 'Sukinda Mines (Kaliapani)', true),
    ('1100', 'Balasore Plant',            false),
    ('1110', 'Sukinda Plant',             false),
    ('1210', 'COB Plant',                 false),
    ('1300', 'Kolkata Office',            false)
ON CONFLICT (code) DO NOTHING;

-- Only one default, whatever anyone does later.
CREATE UNIQUE INDEX IF NOT EXISTS plant_one_default ON plant (is_default) WHERE is_default;

ALTER TABLE asset ADD COLUMN IF NOT EXISTS plant_id bigint REFERENCES plant (plant_id);

-- Machines already on the register are Kaliapani's; nothing else has been
-- registered yet.
UPDATE asset SET plant_id = (SELECT plant_id FROM plant WHERE code = '1200')
WHERE plant_id IS NULL;

-- Departments, as SAP spells them.
INSERT INTO org_unit (code, name, created_by) VALUES
    ('MINING_OPERATIONS', 'Mining Operations',  'migration'),
    ('FURNACE_OPERATIONS','Furnace Operations', 'migration'),
    ('COB_PLANT',         'COB Plant',          'migration'),
    ('BRIQUETTING',       'Briquetting',        'migration'),
    ('MECHANICAL',        'Mechanical',         'migration'),
    ('ELECTRICAL',        'Electrical',         'migration'),
    ('CIVIL',             'Civil',              'migration'),
    ('GEOLOGY',           'Geology',            'migration'),
    ('QC_DESPATCH',       'QC & Despatch',      'migration'),
    ('WEIGH_BRIDGE',      'Weigh Bridge',       'migration'),
    ('RAW_MATERIAL',      'Raw Material',       'migration'),
    ('SUPPLY_CHAIN',      'Supply Chain Management', 'migration'),
    ('PROJECT',           'Project',            'migration'),
    ('SAFETY',            'Safety',             'migration'),
    ('ADMINISTRATION',    'Administration',     'migration'),
    ('INFORMATION_TECH',  'Information & Technology', 'migration'),
    ('HUMAN_RESOURCES',   'Human Resources',    'migration'),
    ('ACCOUNTS',          'Accounts',           'migration'),
    ('MEDICAL',           'Medical',            'migration')
ON CONFLICT (code) DO NOTHING;

UPDATE asset SET org_unit_id = (SELECT org_unit_id FROM org_unit WHERE code = 'MINING_OPERATIONS')
WHERE org_unit_id IS NULL AND approval_status NOT IN ('DRAFT', 'SENT_BACK');

-- Required to submit, not to save.
ALTER TABLE asset DROP CONSTRAINT IF EXISTS submitted_asset_is_complete;
ALTER TABLE asset ADD CONSTRAINT submitted_asset_is_complete CHECK (
    approval_status IN ('DRAFT', 'SENT_BACK')
    OR (asset_type_id IS NOT NULL
        AND fleet_code NOT LIKE 'DRAFT-%'
        AND plant_id IS NOT NULL
        AND org_unit_id IS NOT NULL)
);

-- THE SUPERADMIN'S STANDING GRANT
-- The owner role was given every permission that existed when it was created,
-- which quietly stops being true the moment a new one is added — as
-- platform.registry.approve was yesterday. Rather than remembering to grant it
-- each time, the rule is written down where permissions are created.
CREATE OR REPLACE FUNCTION grant_new_permission_to_owner() RETURNS trigger AS $$
BEGIN
    INSERT INTO role_permission (role_id, permission_id)
    SELECT role_id, NEW.permission_id FROM role WHERE code = 'PLATFORM_OWNER'
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS permission_grants_owner ON permission;
CREATE TRIGGER permission_grants_owner
    AFTER INSERT ON permission
    FOR EACH ROW EXECUTE FUNCTION grant_new_permission_to_owner();

-- And catch up anything added before the trigger existed.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p WHERE r.code = 'PLATFORM_OWNER'
ON CONFLICT DO NOTHING;
