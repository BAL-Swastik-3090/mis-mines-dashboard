-- ===========================================================================
-- 133 — THE ROM ENTRY GETS PERMISSIONS OF ITS OWN
-- ===========================================================================
-- Migration 132 gave the day-wise ROM analysis its tables. This is the
-- permission half.
--
-- ── WHY FILING IS SPLIT IN TWO ──────────────────────────────────────────────
-- One row of that sheet is filled by two people in sequence. Production files
-- the day — shift, trips, tonnage, location and the assay of what was dug —
-- and submits. Geology then states which bench the parcel came from and what
-- the block model says that ground holds, and submits. The mine works in that
-- order: you know the block and its expected quality, and the ROM figures are
-- read against it.
--
-- One permission over both would mean production could restate the block
-- model and geology could restate the day's tonnage. Neither is their figure
-- to change, and a row where both halves can be rewritten by either person is
-- a row whose provenance means nothing — which is the whole reason the table
-- carries block_entry_id separately from entry_id.
--
-- ONE PERSON MAY STILL HOLD BOTH, and that is expected rather than tolerated:
-- a small shift, somebody covering, or simply the way the mine chooses to run
-- it. Holding both lets them fill a row end to end in one pass. The split is
-- about what each permission AUTHORISES, not about how many people there are.
--
-- Viewing is separate again, because ROM figures are read far more widely
-- than they are written.
--
-- Removing a sample is its own permission for the reason migration 129 gives
-- for the plans: "I have not filed it yet" and "I want it gone" are different
-- intentions, and only one of them is undone by typing the figure again.
--
-- ── NOBODY IS NAMED HERE ────────────────────────────────────────────────────
-- As in 116 and 129: the trigger on permission grants each new code to
-- SUPERADMIN on insert, so the superadmins hold these the moment this lands.
-- The two people who will actually type are given theirs through the Access
-- Control screen, by a person, with a record of who granted it.
-- ===========================================================================
SET LOCAL search_path = minehub, public;

SET lock_timeout = '5s';

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order)
VALUES
  ('rom.view', 'Operations', 'Read the day-wise ROM analysis',
   'See what was dug each shift, from where, and how it assayed — together '
   'with the block model figure it is read against.',
   FALSE, 490),

  ('rom.edit', 'Operations', 'File the day-wise ROM analysis',
   'Enter and correct the production half of a ROM sample: shift, trips, '
   'tonnage, location and the assay. Also adds a new location to the list the '
   'entry form offers.',
   FALSE, 491),

  ('rom.block.edit', 'Operations', 'File the ROM block model figures',
   'Enter and correct the block half of a ROM sample: the bench level the '
   'parcel came from and what the block model says that ground holds. Held by '
   'Geology. Nothing before November 2026 carries these figures.',
   FALSE, 492),

  ('rom.delete', 'Operations', 'Remove a filed ROM sample',
   'Delete a sample row outright. Correcting a figure is rom.edit; this is '
   'for a row that should never have been filed.',
   TRUE, 493)
ON CONFLICT (code) DO NOTHING;
