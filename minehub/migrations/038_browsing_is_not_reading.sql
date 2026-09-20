-- 038: reading the machine vocabulary is not browsing the machine register.
--
-- platform.registry.view was doing two jobs at once, and the difference only
-- became visible when an operator registrar opened the platform and found the
-- whole equipment register in front of her.
--
--   READING THE VOCABULARY  An operator registrar assesses somebody as
--                           competent on an Excavator, or on EX-04
--                           specifically. To do that the form has to read
--                           asset types, machines, plants, departments and
--                           agencies. This is reference data, and every
--                           register needs somebody else's.
--
--   BROWSING THE REGISTER   Opening the equipment register itself: 130
--                           machines, their documents, their costs, their
--                           contracts, and the alerts that hang off them.
--                           That is the automobile section's work.
--
-- Collapsing the two meant every people-role had to be given the machine
-- register to do its own job. A permission that must be granted to everybody
-- has stopped meaning anything, and the screen it was protecting stopped being
-- protected.
--
-- So browsing gets its own permission. The vocabulary stays where it was,
-- because the operator form genuinely needs it and taking it away would break
-- competency assessment — which is the actual work of the people this is
-- separating.

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
    ('platform.registry.browse', 'Platform', 'Open the equipment register',
     'See the machine register, its documents, costs and alerts. Reading the '
     'machine vocabulary to assess an operator does not need this.', FALSE, 205)
ON CONFLICT (code) DO NOTHING;

-- The people whose work is machines.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE p.code = 'platform.registry.browse'
  AND r.code IN ('EQUIPMENT_REGISTRAR', 'EQUIPMENT_APPROVER', 'SHIFT_SUPERVISOR')
ON CONFLICT DO NOTHING;

-- The Superadmin holds it already through the standing grant from 014, which
-- fires on any permission inserted. Nothing to do here, and nothing to
-- remember next time.

-- The people-roles keep platform.registry.view. They need it — an assessment
-- against "Excavator" is an assessment against a row in asset_type, and a
-- machine-level competency against EX-04 reads the asset. What they lose is
-- the register screen, which was never their work.
--
-- Deliberately no revocation here: nothing is taken away from anybody. The
-- Equipment tab simply stops being offered to a role that does not hold
-- browse, and the API keeps refusing what it always refused.

COMMENT ON COLUMN asset.asset_id IS
    'Referenced by operator_competency for machine-level assessments, which is '
    'why reading this table is not the same right as browsing the register.';
