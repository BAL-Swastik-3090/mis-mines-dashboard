-- 136 · The mRL is what Geology wrote, not what a regex allows
-- ===========================================================================
--
-- The block model's mRL has been a number or a span of two since 132:
--
--     block_mrl ~ '^[0-9]{1,4}(\.[0-9]{1,2})?(-[0-9]{1,4}(\.[0-9]{1,2})?)?$'
--
-- which accepts 80, 27.5 and 80-82 and refuses everything else. The mine asked
-- (26 November 2026) for the box to take whatever Geology actually writes --
-- '>80', '80 & above', 'below 27' -- because a bench is not always a number
-- and the people filing it were having to flatten what the survey said in
-- order to get past the form.
--
-- ── WHY BOTH TABLES, IN ONE FILE ───────────────────────────────────────────
-- mines_rom_stack_line COPIES block_mrl from the sample it is built from
-- (135). Freeing only mines_rom_entry would let somebody file '>80' against a
-- day and then have the stack refuse to save when they came to build one out
-- of it -- a failure one screen away from the entry that caused it, with
-- nothing on either screen to connect them. The two constraints are one rule
-- and they move together.
--
-- ── WHAT IS BEING GIVEN UP, AND IT IS NOT NOTHING ──────────────────────────
-- chk_*_block_mrl_order caught a transposed span: '82-80' is a bench written
-- backwards, not a range, and the database has been refusing it. Free text
-- cannot keep that check -- '>80' has no two sides to compare -- so from here
-- a transposition is a thing a reader has to notice. That is the mine's call,
-- made knowing the cost; the alternative was a form that refuses what the
-- survey says.
--
-- Nothing reads this column numerically. Checked across the whole backend
-- before writing this: no cast, no split_part, no float() -- it is carried to
-- the screen as text and printed. So widening it breaks no arithmetic.
--
-- varchar(20) -> varchar(40), because free text invites more than a number and
-- 20 was sized for '1234.56-1234.56'. Raising a varchar length is a catalogue
-- change in PostgreSQL, not a table rewrite, so it is cheap -- but it still
-- takes ACCESS EXCLUSIVE, which is why the lock_timeout below is not optional.

SET lock_timeout = '5s';
SET LOCAL search_path = minehub, public;

-- ── mines_rom_entry ────────────────────────────────────────────────────────
ALTER TABLE mines_rom_entry
    DROP CONSTRAINT IF EXISTS chk_mines_rom_entry_block_mrl,
    DROP CONSTRAINT IF EXISTS chk_mines_rom_entry_block_mrl_order;

ALTER TABLE mines_rom_entry
    ALTER COLUMN block_mrl TYPE varchar(40);

-- The one rule that survives: a bench nobody typed is NULL, not a row of
-- spaces. Without this, '   ' passes as a filled block model and the
-- both-or-neither constraint above it is satisfied by nothing at all.
ALTER TABLE mines_rom_entry
    ADD CONSTRAINT chk_mines_rom_entry_block_mrl_not_blank
    CHECK (block_mrl IS NULL OR btrim(block_mrl) <> '');

-- ── mines_rom_stack_line ───────────────────────────────────────────────────
ALTER TABLE mines_rom_stack_line
    DROP CONSTRAINT IF EXISTS chk_mines_rom_stack_line_block_mrl,
    DROP CONSTRAINT IF EXISTS chk_mines_rom_stack_line_block_mrl_order;

ALTER TABLE mines_rom_stack_line
    ALTER COLUMN block_mrl TYPE varchar(40);

ALTER TABLE mines_rom_stack_line
    ADD CONSTRAINT chk_mines_rom_stack_line_block_mrl_not_blank
    CHECK (block_mrl IS NULL OR btrim(block_mrl) <> '');
