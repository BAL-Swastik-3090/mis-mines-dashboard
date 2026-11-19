-- 107: the KAM Wise Loss Tree's node owners become a dated, editable setting.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────
-- Migration 101 moved every loss head's KAM into lcm_loss_head_setting, dated,
-- and wired the LCM KAM Selector to it. It left the FIVE NAMES AT THE TOP OF
-- THE TREE behind, in lcm_role_master.owner_kam -- a flat column with no
-- effective_from that nothing in the application has ever written.
--
-- The mine found it the only way anyone could: on 1 November they moved
-- Tiffin, Strike, LMV unavailability and Absence of operator from Gurpreet
-- Singh to Dr. Pabitra Parida. The matrix picked it up on the next load. The
-- tree above it went on reporting Rs 50.21 Lac against "Head Human Resource --
-- Gurpreet Singh", because that name was never part of the selector at all.
--
-- ── THE NODE OWNER IS DERIVED FIRST, AND STORED ONLY AS AN OVERRIDE ───────
-- The first attempt at this made the owner a stored decision the mine had to
-- make by hand, on the reasoning that a node's heads do not share one KAM --
-- Head Human Resource holds four heads under one person and Trans. truck jam
-- under another; Head Engineering holds three, two and one across three
-- people. That reasoning was wrong about what follows from it. Measured
-- against the mine's own data, the KAM holding the MOST heads under a node
-- reproduces every name the tree currently shows, in both months:
--
--   MINES_OPERATION  Rana Vikash Singh 14                        -> Rana Vikash Singh
--   ENGINEERING      Amarendra Sarangi 3, Praspero Sahoo 2,
--                    K L Das 1                                   -> Amarendra Sarangi
--   HUMAN_RESOURCE   Gurpreet Singh 4, Maheswar Mohanty 1  (Oct) -> Gurpreet Singh
--                    Dr. Pabitra Parida 4, Maheswar Mohanty 1    -> Dr. Pabitra Parida
--
-- with no tie anywhere. So the card follows the KAM Selector on its own, which
-- is what the mine expected it to do all along, and nobody has to remember to
-- change the same name in two places.
--
-- THIS TABLE IS THEREFORE AN OVERRIDE, NOT THE SOURCE. It is here for the
-- cases the derivation cannot reach: a department head who owns no loss head
-- personally, a node whose heads tie, Chief of Mines and Head COB, which have
-- no loss heads under them at all, and a post the mine wants recorded as
-- vacant. An explicit row always wins; where there is none, the heads decide.
--
-- WHICH IS WHY NOTHING IS SEEDED HERE. Seeding a row per node would make
-- every node explicit from day one and the derivation would never run --
-- November's tree would go on naming October's owner, which is the exact bug
-- this migration exists to fix.
--
-- ── WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT ──────────────────────────
-- lcm_role_master keeps being the REGISTRY of nodes: which exist, their
-- left-to-right order, and the owner to fall back on. It is not dropped and
-- its owner_kam is not removed -- code that has not been deployed yet still
-- reads it, and a migration that breaks the running application to tidy a
-- column is not worth the outage. See migration 100, where exactly that was
-- rolled back.
--
-- lcm_role_setting is the new dated decision, resolved the same way as the
-- fleet and the loss heads: the latest row on or before the date, and before
-- the first row, the first row. So correcting November leaves October's
-- reported tree exactly as it was reported.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. WHO OWNS EACH NODE OF THE TREE, AND FROM WHEN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcm_role_setting (
    id             bigserial   PRIMARY KEY,
    role_code      varchar(20) NOT NULL
                   REFERENCES lcm_role_master (role_code) ON UPDATE CASCADE,
    effective_from date        NOT NULL,

    -- The person. NULL is meaningful and allowed: UNMAPPED is a real node
    -- with no owner, and a node whose head has left and not been replaced
    -- should read as vacant rather than as whoever held it last.
    owner_kam      varchar(60) REFERENCES lcm_kam_master (kam_name) ON UPDATE CASCADE,

    -- The words on the card. Dated with the owner because a restructure
    -- usually renames the post and moves the person in one go.
    title          varchar(60),

    entry_id       varchar(32) NOT NULL,
    entry_date     timestamptz NOT NULL DEFAULT now(),
    revision       integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),

    -- One decision per node per date. Two rows sharing an effective_from have
    -- no order between them and the resolver would pick whichever the planner
    -- happened to return first.
    UNIQUE (role_code, effective_from)
);

COMMENT ON TABLE lcm_role_setting IS
    'Who owns each node of the KAM Wise Loss Tree, from a date. Nothing is '
    'updated in place: a change is a new row, so a tree already reported for '
    'October still names October''s owner after November has been edited.';

COMMENT ON COLUMN lcm_role_setting.owner_kam IS
    'NULL is a vacant post, not an error. UNMAPPED has no owner by design, '
    'and a node whose head has left reads as vacant rather than as the last '
    'person to hold it.';

CREATE INDEX IF NOT EXISTS lcm_role_setting_lookup_idx
    ON lcm_role_setting (role_code, effective_from DESC);
CREATE INDEX IF NOT EXISTS lcm_role_setting_date_idx
    ON lcm_role_setting (effective_from DESC);


-- ---------------------------------------------------------------------------
-- 2. WHO CHANGED WHAT
-- ---------------------------------------------------------------------------
-- Same shape as lcm_loss_head_hist, deliberately: the selector shows one
-- history list and must not have to reconcile two row shapes to build it.
CREATE TABLE IF NOT EXISTS lcm_role_hist (
    id             bigserial   PRIMARY KEY,
    role_code      varchar(20) NOT NULL,
    effective_from date        NOT NULL,
    action         varchar(8)  NOT NULL CHECK (action IN ('ADDED', 'CHANGED', 'REMOVED')),
    field          varchar(40),
    old_value      text,
    new_value      text,
    revision       integer     NOT NULL CHECK (revision >= 1),
    entry_id       varchar(32) NOT NULL,
    entry_date     timestamptz NOT NULL DEFAULT now(),

    CHECK (old_value IS DISTINCT FROM new_value)
);

CREATE INDEX IF NOT EXISTS lcm_role_hist_role_idx
    ON lcm_role_hist (role_code, entry_date DESC);


-- ---------------------------------------------------------------------------
-- 3. NOTHING IS SEEDED, AND THAT IS THE POINT
-- ---------------------------------------------------------------------------
-- Both tables start empty. Every node therefore resolves from the loss heads
-- underneath it until somebody deliberately overrides one, so applying this
-- migration changes three of the tree's cards from a fixed name to a name that
-- follows the KAM Selector -- and changes nothing about what any of them say
-- for October, because the derivation agrees with the registry there.
--
-- Chief of Mines and Head COB have no loss heads under them, so they keep
-- reading from lcm_role_master until the mine sets them here.
