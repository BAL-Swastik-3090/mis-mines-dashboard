-- 106 · Head COB moves to the end of the loss tree's line.
--
-- The mine reads the seven cards left to right as the mine itself is run:
-- the five heads that lose ORE first, then Head COB last, because what COB
-- loses is concentrate on a different IBM line -- rupees with no MT beside
-- them. Sitting fourth, between Human Resource and Electrical, it broke that
-- reading and put the one card with a dash in its MT column in the middle of
-- five that carry tonnes.
--
-- sl_order is the single thing that orders these nodes -- the loss structure,
-- the old KAM tree and the node-owner block on the KAM Selector all sort by
-- it -- so moving the card is this one number and nothing else. 9 leaves 6-8
-- to Electrical, Store and Security as migration 105 set them, and stays
-- clear of UNMAPPED at 99.
--
-- NOTHING BUT THE ORDER MOVES. No owner, no reporting line, no loss head and
-- no figure is touched; the root is the sum of the same seven nodes either
-- way. lcm.py's offline fallback registry has placed COB at 9 since it was
-- written, so this makes the database agree with the code rather than the
-- other way about.
--
-- Idempotent: re-running sets the same value.

SET LOCAL search_path = minehub, public;

UPDATE lcm_role_master
   SET sl_order = 9
 WHERE role_code = 'COB'
   AND sl_order IS DISTINCT FROM 9;
