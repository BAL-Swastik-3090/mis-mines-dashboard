-- 137 · Every entry form gets a permission of its own
-- ===========================================================================
--
-- The Daily Entry Hub put ten forms on the rail, each a page, so canOpen()
-- could decide per form which ones a person sees. That machinery works. What
-- it had nothing to decide WITH is the gap this closes.
--
-- Eight of the ten were gated on dashboard.mis, and that was the honest first
-- step: it is what services/auth.py's PREFIX_PAGE already enforces, so the
-- rail agreed with the API rather than inventing a right nobody checked. But
-- dashboard.mis is held by eight roles -- ACCESS_MANAGER, COMPETENCY_ASSESSOR,
-- DASHBOARD_VIEWER, MANAGEMENT, OPERATOR_APPROVER, SHIFT_SUPERVISOR,
-- SHIFT_VIEWER, SUPERADMIN -- which means a DASHBOARD_VIEWER, a read-only
-- audience, currently sees eight forms for typing the mine's figures.
--
-- Only rom.* and romstack.* were ever per-form, which is why those two tabs
-- are the only ones that already disappear for somebody who should not have
-- them.
--
-- ── WHY A PAIR PER FORM AND NOT ONE CODE ───────────────────────────────────
-- Every one of these screens shows what is already stored the moment it
-- opens: the day's figures, the month's plan, the stored declaration. Reading
-- that is a different right from rewriting it, and rom.view/rom.edit already
-- draw exactly that line. A grid where some forms have two rows and others
-- one would be a grid nobody can read.
--
-- ── WHAT HAPPENS THE DAY THIS IS APPLIED ───────────────────────────────────
-- The trigger on permission grants each new code to SUPERADMIN on insert and
-- to nobody else. So the moment the front end is gated on these, the eight
-- forms vanish for everyone but a superadmin until an Access Manager grants
-- them by name, to a person, with a record. That is the point of the change
-- and it is not a side effect -- but it does mean the grants want making in
-- the same window as the deploy, not the week after.
--
-- Nobody is named here, as in 116, 129, 133 and 135.

SET lock_timeout = '5s';
SET LOCAL search_path = minehub, public;

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order)
VALUES
  ('prevday.view', 'Operations', 'Read the estimated actuals',
   'See the mine''s own estimate for a day beside what production and '
   'despatch recorded for it.', FALSE, 500),
  ('prevday.edit', 'Operations', 'Enter the estimated actuals',
   'Type the mine''s estimate for a day. The plan it was agreed against is '
   'stored with each figure, so a later revision cannot rewrite history.',
   FALSE, 501),

  ('stock.view', 'Operations', 'Read the mines stock position',
   'See what is standing at the mine on a given morning, bucket by bucket.',
   FALSE, 502),
  ('stock.edit', 'Operations', 'Enter the mines stock position',
   'File the morning''s stock position. Saving a day REPLACES it outright, so '
   'this is the right to restate a day as much as to add one.', FALSE, 503),

  ('reserve.view', 'Operations', 'Read the declared resource reserve',
   'See the reserve still in the ground as the latest survey states it.',
   FALSE, 504),
  -- Sensitive: every remaining-reserve and valuation figure on the dashboard
  -- is derived from this, and it is filed a handful of times a year by one
  -- person. A wrong tonnage here is wrong everywhere, quietly.
  ('reserve.edit', 'Operations', 'Declare the resource reserve',
   'File the survey''s statement of what is left in the ground. Every '
   'remaining-reserve and valuation figure is derived from it.', TRUE, 505),

  ('desilting.view', 'Operations', 'Read the de-silting plan',
   'See the month''s day-wise de-silting plan.', FALSE, 506),
  ('desilting.edit', 'Operations', 'Upload the de-silting plan',
   'Replace a month''s de-silting plan from a spreadsheet. It is the target '
   'every de-silting achievement on the dashboard is measured against.',
   FALSE, 507),

  ('oeemaster.view', 'Operations', 'Read the OEE master selections',
   'See which machine digs what, which machines are on the OEE tables, and '
   'who owns each loss head.', FALSE, 508),
  ('oeemaster.edit', 'Operations', 'Set the OEE master selections',
   'Change the three standing decisions the OEE and the Lost Cost Matrix are '
   'calculated from. A machine left out keeps its lost hours out of the LCM.',
   FALSE, 509),

  ('shifting.view', 'Operations', 'Read the shifting figures',
   'See the day''s LG, tailings and rehandling movements against the plan.',
   FALSE, 510),
  ('shifting.edit', 'Operations', 'Enter the shifting figures',
   'Type the day''s movements, and upload the month''s shifting plan they are '
   'read against.', FALSE, 511),

  ('dewatering.view', 'Operations', 'Read the daily dewatering sheet',
   'See a day of the dewatering sheet and the sump position it leaves.',
   FALSE, 512),
  ('dewatering.edit', 'Operations', 'Enter the daily dewatering sheet',
   'Type a day of the dewatering sheet. Each day''s closing stock is the '
   'next day''s opening, so a correction carries forward.', FALSE, 513)
ON CONFLICT (code) DO NOTHING;
