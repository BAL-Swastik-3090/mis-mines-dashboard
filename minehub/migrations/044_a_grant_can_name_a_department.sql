-- 044: a grant can say which department it covers.
--
-- "Department-wise only they can apply" is the right rule — a supervisor in
-- Automobile has no business correcting a tipper driver's attendance in Mining
-- Operation, and attendance feeds a contractor's bill.
--
-- The obvious way to implement it is to read the raiser's own department from
-- the employee master and compare. That was tried and abandoned: the master
-- says MINING OPERATIONS and INFORMATION & TECHNOLOGY where this platform says
-- Mining Operation and Information Technology, so it would work by matching
-- names loosely. Deciding who may write somebody's attendance on a fuzzy
-- string match is how the wrong person quietly gets the right, or the right
-- person quietly loses it.
--
-- So the scope is data on the grant, set by an Access Manager on the same
-- screen that grants the role. Null means every department, which is what all
-- existing grants become — this takes nothing away from anybody. Narrowing a
-- grant is then a deliberate act with a name against it.
--
-- WHY ON THE GRANT RATHER THAN THE ROLE. Two supervisors hold the same role
-- and cover different pits. The role says what you may do; the grant says
-- where. Putting the scope on the role would mean a role per department, which
-- is how a permission model turns into a spreadsheet.

ALTER TABLE user_access
    ADD COLUMN IF NOT EXISTS scope_org_unit_id bigint REFERENCES org_unit(org_unit_id);

COMMENT ON COLUMN user_access.scope_org_unit_id IS
    'The department this grant covers. Null is every department, which is what '
    'every grant made before this column existed means. Read by attendance '
    'corrections; other modules may honour it as they gain the need.';

CREATE INDEX IF NOT EXISTS ix_user_access_scope
    ON user_access (emp_id, scope_org_unit_id);
