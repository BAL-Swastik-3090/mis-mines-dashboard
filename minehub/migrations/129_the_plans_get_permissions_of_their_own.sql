-- 129: the three plans get permissions of their own.
--
-- Migrations 127 and 128 moved the despatch plan, the COB plant plan and the
-- excavation plan onto this platform. Their data has been read from here
-- since 16 November; nothing has written them, because the screens did not
-- exist. This is the permission half of building them.
--
-- ── WHY FOUR AND NOT ONE ────────────────────────────────────────────────────
-- The three plans are filed by two different departments. Sudip Hajra (PPIC)
-- files despatch and COB; Asish Kumar Dash (Geology) files the excavation
-- plan. That is not a convention, it is what the stored rows say: every
-- despatch and COB row carries entry_id 2627 and every excavation row 2971.
--
-- One permission over all three would mean Geology could rewrite tomorrow's
-- despatch and PPIC could rewrite the face plan. Neither has ever done so,
-- and neither should be able to by accident.
--
-- Viewing is separate from filing because the plans are read far more widely
-- than they are written -- the Executive Summary, the MIS dashboard, the LCM
-- and Reality Check all read them, and the people who read those screens are
-- not the two people who type them.
--
-- ── NOBODY IS NAMED HERE ────────────────────────────────────────────────────
-- As in migration 116: a trigger grants every new permission to SUPERADMIN on
-- insert, so the superadmins hold these from the moment this lands. Sudip and
-- Asish are given theirs through the Access Control screen, by a person, with
-- a record of who granted it -- not by a migration that nobody will remember
-- reading.

SET LOCAL search_path = minehub, public;

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order)
VALUES
  ('plan.view', 'Plans', 'Read the mine''s plans',
   'See the despatch, COB plant and excavation plans as filed. The figures '
   'every achievement on the dashboard is measured against.',
   FALSE, 10),

  ('plan.despatch.edit', 'Plans', 'File the despatch and COB plans',
   'Enter, correct and remove days in the despatch plan and the COB plant '
   'plan. Held by PPIC, who file both today.',
   FALSE, 20),

  ('plan.excavation.edit', 'Plans', 'File the excavation plan',
   'Enter, correct and remove days in the shift-wise excavation plan. Held by '
   'Geology, who file it today.',
   FALSE, 30),

  ('plan.delete', 'Plans', 'Remove a filed day',
   'Delete a day from a plan outright rather than correcting it. Sensitive: a '
   'deleted day leaves every achievement measured against nothing, and the '
   'screens show that as no plan rather than as a gap. The trail is kept.',
   TRUE, 40)
ON CONFLICT (code) DO NOTHING;
