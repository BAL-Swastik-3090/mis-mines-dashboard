-- 138 · A role for each entry form, so a tab names its owner
-- ===========================================================================
--
-- 137 gave every Daily Entry form a view/edit pair of its own. This turns
-- those fourteen codes into nine roles, because of how access actually
-- reaches a person on this platform:
--
--     user_access (emp_id -> role_id) -> role_permission -> permission
--
-- There is no per-person permission grant anywhere in that chain. So "this
-- person may enter the stock position and nothing else" cannot be expressed
-- by ticking a permission against a person -- it has to be a role carrying
-- exactly that form, assigned from People & Access.
--
-- ── WHY ONE PER FORM AND NOT ONE FOR ALL ────────────────────────────────────
-- A single "Daily Data Entry" role was the obvious answer and the wrong one.
-- It would show all ten tabs to everybody who held it, and the mine asked for
-- the opposite: a person should see the sections that are theirs to fill in,
-- so that nobody has to work out which form belongs to whom, and so that a
-- form nobody has given you is a form you cannot reach. One role per form is
-- what makes a tab name its owner.
--
-- This is not the permission grid again. These roles are built once, here.
-- The daily act is ticking a named chip in People & Access that reads like
-- the tab it opens -- and a person carrying several role chips is already
-- ordinary on that screen.
--
-- ── NINE ROLES FOR TEN TABS ─────────────────────────────────────────────────
-- Shifting Actual and Shifting Plan share ENTRY_SHIFTING. The typed actual
-- and the uploaded plan are one job read against each other, the two screens
-- read each other's data, and 137 already gave them a single shifting.*
-- pair. Two roles would mean granting two things to let one person do one
-- thing.
--
-- ── NOBODY IS PUT IN THEM ───────────────────────────────────────────────────
-- Nine empty roles, deliberately. Who files what at Kaliapani is the mine's
-- answer, not a migration's, and a guess here would be invisible until it was
-- wrong. They are assigned from People & Access, by Management or a
-- superadmin.
--
-- ── WHY MANAGEMENT GETS THE NINETEEN CODES ──────────────────────────────────
-- Two reasons, and the second is the one that makes the first possible.
-- Management does the entry; and set_user_roles in routers/access.py refuses
-- to let anybody hand out more than they hold:
--
--     over = [c for c in r["perms"] if c not in mine]
--     if over: raise HTTPException(403, "You cannot grant '...'")
--
-- So without these, Management could open People & Access -- it already holds
-- access.users.manage -- and still be refused every one of these nine roles.
-- Granting them is what makes Management able to grant.
--
-- It is nineteen rather than fourteen because ENTRY_ROM and ENTRY_ROM_STACK
-- carry the five rom.*/romstack.* codes from 133 and 135, which Management
-- did not hold either. A role is grantable only if the grantor holds ALL of
-- what it carries, so leaving those five out would have left two of the nine
-- roles permanently ungrantable by Management -- the exact failure this
-- paragraph exists to prevent.
--
-- Management deliberately does NOT get access.roles.manage. They assign the
-- bundles; only a superadmin changes what a bundle contains. SUPERADMIN needs
-- nothing here: grants_everything already carries every code, including ones
-- added after it.
--
-- ── THIS CHANGES NOTHING UNTIL THE CODE SHIPS ───────────────────────────────
-- Additive throughout: no role loses a permission, no person loses access.
-- The front end that reads these codes is not deployed, so the forms stay
-- exactly as visible as they are today. That is the point -- the grants can
-- all be made BEFORE the deploy, so that when the gate appears the right
-- people are already through it and nobody loses a tab.

SET lock_timeout = '5s';
SET LOCAL search_path = minehub, public;

-- ── the nine roles ─────────────────────────────────────────────────────────
INSERT INTO role (code, name, description, is_system, status, created_by)
VALUES
  ('ENTRY_PREV_DAY', 'Entry · Est Actual',
   'File the mine''s own estimate for a day against what production and '
   'despatch recorded. Opens that one tab of the Daily Entry Hub.',
   FALSE, 'ACTIVE', 'migration-138'),
  ('ENTRY_STOCK', 'Entry · Mines Stock',
   'File the morning stock position, bucket by bucket. Saving a day replaces '
   'it outright. Opens that one tab of the Daily Entry Hub.',
   FALSE, 'ACTIVE', 'migration-138'),
  ('ENTRY_RESERVE', 'Entry · Resource Reserve',
   'Declare the reserve still in the ground. Every remaining-reserve and '
   'valuation figure is derived from it, so this is the narrowest of these '
   'roles by intent.', FALSE, 'ACTIVE', 'migration-138'),
  ('ENTRY_ROM', 'Entry · Daywise ROM',
   'File what came out of the ground each day, shift by shift, with the assay '
   'of each parcel and Geology''s block model.',
   FALSE, 'ACTIVE', 'migration-138'),
  ('ENTRY_ROM_STACK', 'Entry · ROM Stack',
   'Build the stacks the mine despatches from, and assign the number despatch '
   'invoices them under.', FALSE, 'ACTIVE', 'migration-138'),
  ('ENTRY_DESILTING', 'Entry · Desilting Plan',
   'Upload the month''s day-wise de-silting plan -- the target every '
   'de-silting achievement is measured against.',
   FALSE, 'ACTIVE', 'migration-138'),
  ('ENTRY_OEE_MASTER', 'Entry · OEE Master',
   'Set which machine digs what, which machines are on the OEE tables, and '
   'who owns each loss head.', FALSE, 'ACTIVE', 'migration-138'),
  ('ENTRY_SHIFTING', 'Entry · Shifting',
   'Type the day''s LG, tailings and rehandling movements, and upload the '
   'month''s plan they are read against. Both screens, because they are one '
   'job.', FALSE, 'ACTIVE', 'migration-138'),
  ('ENTRY_DEWATERING', 'Entry · Dewatering',
   'File a day of the dewatering sheet. Each day''s closing stock is the next '
   'day''s opening, so a correction carries forward.',
   FALSE, 'ACTIVE', 'migration-138')
ON CONFLICT (code) DO NOTHING;

-- ── what each one carries ──────────────────────────────────────────────────
-- Named in pairs rather than matched on a prefix: a LIKE 'stock.%' would
-- quietly pick up any future stock.* code and widen a role nobody reviewed.
INSERT INTO role_permission (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, 'migration-138'
  FROM role r
  JOIN (VALUES
      ('ENTRY_PREV_DAY',   'prevday.view'),    ('ENTRY_PREV_DAY',   'prevday.edit'),
      ('ENTRY_STOCK',      'stock.view'),      ('ENTRY_STOCK',      'stock.edit'),
      ('ENTRY_RESERVE',    'reserve.view'),    ('ENTRY_RESERVE',    'reserve.edit'),
      ('ENTRY_ROM',        'rom.view'),        ('ENTRY_ROM',        'rom.edit'),
      ('ENTRY_ROM',        'rom.block.edit'),
      ('ENTRY_ROM_STACK',  'romstack.view'),   ('ENTRY_ROM_STACK',  'romstack.edit'),
      ('ENTRY_DESILTING',  'desilting.view'),  ('ENTRY_DESILTING',  'desilting.edit'),
      ('ENTRY_OEE_MASTER', 'oeemaster.view'),  ('ENTRY_OEE_MASTER', 'oeemaster.edit'),
      ('ENTRY_SHIFTING',   'shifting.view'),   ('ENTRY_SHIFTING',   'shifting.edit'),
      ('ENTRY_DEWATERING', 'dewatering.view'), ('ENTRY_DEWATERING', 'dewatering.edit')
  ) AS want(role_code, perm_code) ON want.role_code = r.code
  JOIN permission p ON p.code = want.perm_code
ON CONFLICT DO NOTHING;

-- ── Management: so it can enter, and so it can grant ───────────────────────
INSERT INTO role_permission (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, 'migration-138'
  FROM role r, permission p
 WHERE r.code = 'MANAGEMENT'
   AND p.code IN ('prevday.view', 'prevday.edit',
                  'stock.view', 'stock.edit',
                  'reserve.view', 'reserve.edit',
                  'rom.view', 'rom.edit', 'rom.block.edit',
                  'romstack.view', 'romstack.edit',
                  'desilting.view', 'desilting.edit',
                  'oeemaster.view', 'oeemaster.edit',
                  'shifting.view', 'shifting.edit',
                  'dewatering.view', 'dewatering.edit')
ON CONFLICT DO NOTHING;
