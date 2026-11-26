-- 139 · Nine entry roles behave as one chip with a picker
-- ===========================================================================
--
-- 138 created one role per entry form, because the access chain has no
-- per-person permission grant: user_access (emp_id -> role_id) ->
-- role_permission -> permission. "This person may enter the stock position
-- and nothing else" can only be said by assigning a role that carries exactly
-- that form.
--
-- That is still true, and nothing about it changes here. What changes is how
-- the nine are PRESENTED, because nine roles sitting beside Management, Shift
-- Supervisor and Access Manager made both access screens hard to read:
--
--   * People & Access drew nine more chips in the role picker and nine more
--     distribution tiles, so the chips that decide what SECTION of the
--     dashboard a person sees were lost among chips that decide which FORM
--     they file.
--   * The Roles screen drew nine more full-height cards, each with its three
--     permission chips, pushing the roles that actually get edited off the
--     first screen.
--
-- The mine asked for one chip reading "Daily Data Entry" that opens a picker
-- listing the forms, with a select-all, and for the Roles screen to show the
-- nine as one thing rather than nine.
--
-- ── WHY A GROUP AND NOT A SINGLE ROLE ───────────────────────────────────────
-- A single DAILY_DATA_ENTRY role carrying all nineteen codes would be one
-- chip too, and it was the first thing tried. It cannot express the
-- requirement: every holder would see all ten tabs, and the whole point of
-- 137/138 was that a person sees the forms that are theirs to fill in, so
-- nobody has to work out whose section is whose. One role means one
-- permission set for everybody who holds it. The nine roles are what make the
-- per-person answer possible.
--
-- So the grouping is presentational, declared in the database rather than
-- hardcoded in the front end -- a tenth entry form added later joins the
-- picker by setting one column, not by editing a list in a .tsx file that
-- nobody remembers exists. Everything underneath is unchanged: assigning the
-- picker's ticks still writes ordinary user_access rows, set_user_roles still
-- refuses to hand out more than the grantor holds, and the audit trail still
-- names each role separately, which is what makes "who gave them Dewatering"
-- answerable afterwards.
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
-- No permission is created, granted or revoked. No person's access changes in
-- any direction. A branch running the old front end against this schema sees
-- exactly what it sees today -- group_code is a column nothing reads yet.

SET lock_timeout = '5s';
SET LOCAL search_path = minehub, public;

-- ---------------------------------------------------------------------------
-- role_group — roles that are one choice to the person granting them.
-- ---------------------------------------------------------------------------
-- Deliberately thin. It carries what a picker needs to label itself and
-- nothing that could drift away from the roles it names: no permission list
-- of its own, no holder count, no status. The group is a heading, and the
-- roles remain the only thing that carries access.
CREATE TABLE IF NOT EXISTS role_group (
    group_code   text PRIMARY KEY,
    name         text NOT NULL,              -- what the chip says
    description  text,                       -- what the picker says under it
    sort_order   smallint NOT NULL DEFAULT 100,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text
);

COMMENT ON TABLE role_group IS
  'A set of roles presented as one choice. Presentation only: access still '
  'comes from role_permission, one role at a time.';

-- A nullable column with no default and no rewrite -- catalogue-only, so the
-- ACCESS EXCLUSIVE lock is taken and released immediately. The lock_timeout
-- above is what makes that safe anyway: role is read by every signed-in
-- request through services/access._load().
ALTER TABLE role ADD COLUMN IF NOT EXISTS group_code text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'role_group_code_fkey'
                      AND conrelid = 'minehub.role'::regclass) THEN
        ALTER TABLE role
          ADD CONSTRAINT role_group_code_fkey
          FOREIGN KEY (group_code) REFERENCES role_group(group_code)
          ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

-- Partial: all but nine rows are NULL today and most roles will never be
-- grouped, so an index over the whole table would be mostly empty entries.
CREATE INDEX IF NOT EXISTS idx_role_group_code
    ON role (group_code) WHERE group_code IS NOT NULL;

-- ---------------------------------------------------------------------------
INSERT INTO role_group (group_code, name, description, sort_order, created_by)
VALUES ('DAILY_DATA_ENTRY', 'Daily Data Entry',
        'The forms of the Daily Entry Hub. Tick the ones this person files — '
        'they will see those tabs and no others.',
        10, 'migration-139')
ON CONFLICT (group_code) DO NOTHING;

-- Named one by one rather than matched on a prefix. Two reasons: LIKE 'ENTRY_%'
-- does not mean what it looks like -- the underscore is a wildcard, so it would
-- also match ENTRYX -- and a prefix match would silently pull in any future
-- role somebody happens to name ENTRY_SOMETHING, which is how a picker starts
-- offering a form nobody reviewed.
UPDATE role SET group_code = 'DAILY_DATA_ENTRY'
 WHERE code IN ('ENTRY_PREV_DAY', 'ENTRY_STOCK', 'ENTRY_RESERVE',
                'ENTRY_ROM', 'ENTRY_ROM_STACK', 'ENTRY_DESILTING',
                'ENTRY_OEE_MASTER', 'ENTRY_SHIFTING', 'ENTRY_DEWATERING')
   AND group_code IS DISTINCT FROM 'DAILY_DATA_ENTRY';
