-- 012: approving the register is its own permission.
--
-- Registering a machine and accepting one onto the register are different
-- responsibilities. Until now both sat behind platform.registry.manage, so
-- anyone who could type a machine in could also wave it through — the only
-- thing standing between a typo and the register was the rule that you cannot
-- approve your own submission, which two colleagues can defeat without meaning
-- to. Separating them lets the mine decide who reviews, from the Access Control
-- screen, without anyone editing code.

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order)
VALUES ('platform.registry.approve', 'Platform', 'Approve register entries',
        'Accept a machine onto the register, or send it back for correction',
        TRUE, 225)
ON CONFLICT (code) DO NOTHING;

-- The owner role keeps everything, so the platform is never left with nobody
-- able to approve. Every other role is the mine's decision to make.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r, permission p
WHERE r.code = 'PLATFORM_OWNER' AND p.code = 'platform.registry.approve'
ON CONFLICT DO NOTHING;
