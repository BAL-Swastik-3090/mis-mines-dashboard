-- 013: the two halves of keeping the equipment register.
--
-- Approval is only worth the click if the person approving is not the person
-- who typed it in, so the roles come in a pair:
--
--   Equipment Registrar  — registers machines, links their system names, and
--                          submits them. Cannot approve, including their own.
--   Equipment Approver   — reviews what was submitted and accepts or returns
--                          it. Deliberately cannot edit: a reviewer who can
--                          quietly correct a record and approve it in the same
--                          movement is not a second pair of eyes, and the trail
--                          would show an approval with no sign of what changed
--                          before it.
--
-- Both are ordinary roles, not system ones, so the mine can rename them, change
-- what they carry, or delete them from the Access Control screen.

INSERT INTO role (code, name, description, is_system, created_by)
VALUES
  ('EQUIPMENT_REGISTRAR', 'Equipment Registrar',
   'Registers machines onto the platform and submits them for approval',
   FALSE, 'migration'),
  ('EQUIPMENT_APPROVER', 'Equipment Register Approver',
   'Reviews submitted machines and accepts them onto the register, or sends them back',
   FALSE, 'migration')
ON CONFLICT (code) DO NOTHING;

-- Registrar: see the register, and keep it.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r, permission p
WHERE r.code = 'EQUIPMENT_REGISTRAR'
  AND p.code IN ('platform.registry.view', 'platform.registry.manage', 'dashboard.mis')
ON CONFLICT DO NOTHING;

-- Approver: see the register and decide on it. No manage, on purpose.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r, permission p
WHERE r.code = 'EQUIPMENT_APPROVER'
  AND p.code IN ('platform.registry.view', 'platform.registry.approve', 'dashboard.mis')
ON CONFLICT DO NOTHING;
