-- ===========================================================================
-- 135 — THE ROM STACK, AND THE NUMBER DESPATCH KNOWS IT BY
-- ===========================================================================
-- What the mine builds out of its ROM: a stack of ore, assembled from samples
-- already filed on the day-wise ROM analysis, given a number, and despatched
-- under that number. Until now it lived in one workbook, "ROM STACK.xlsx" —
-- 74 stacks between 31 July and 3 November 2026, every cell typed by hand,
-- including the averages.
--
-- ── A STACK IS A PARENT, ITS LINES ARE CHILDREN ─────────────────────────────
-- One stack is several lines. A line is "this much of that ROM sample went
-- into this stack". The sheet proves it is not one line per sample: 3 November
-- carries a 27-trip sample of which nineteen trips went into one stack and the
-- rest into another, so a sample is APPORTIONED and a line is a share of one.
--
-- A stack also spans days — stack 414 carries lines from 31 October, 1 and 2
-- November, out of order — which is exactly why the header exists. The stack
-- has one creation date; its lines have their own production dates.
--
-- ── NOTHING THAT CAN BE COMPUTED IS STORED ──────────────────────────────────
-- The sheet's WET AVG line is a weighted mean of the lines beneath it, and it
-- is NOT stored. It is typed in the workbook, and 13 of the 74 do not
-- reproduce from their own lines — the other 61 are exact, so the method is
-- right and those 13 are drift. Computing it removes the whole class.
-- The Cr/Fe ratio is not stored either, for the reason migration 132 gives.
--
-- ── THE NUMBER, WHICH IS THE WHOLE POINT ────────────────────────────────────
-- A stack is despatched under a batch number, and that number is the only
-- link between what the mine stacked and what SAP shipped. It is already in
-- use: zsd_outbound_despatch.BATCH carries it, and services/quality_e2e.py
-- already reads it as a stack number.
--
-- Every one of the 855 batches ever despatched to BAL is EXACTLY TEN
-- CHARACTERS, shaped
--
--     K        26        1300414
--     │        │         └── seven digits, stack-specific
--     │        └──────────── year, TWO digits  (24, 25, 26 all present)
--     └───────────────────── month letter, A=Jan … L=Dec
--
-- THE MIDDLE OF THOSE SEVEN DIGITS IS NOT CONSTANT and cannot be derived from
-- anything. Both the 1300 form and the 300 form run side by side, every
-- month, and both are the mine's own: November 2026 has K261300414 and
-- K263004121, and the workbook carries 414 and 4121 against them. 229 of
-- 2026's 277 batches are the second form. So no fixed prefix reproduces them.
--
-- WHAT IS RELIABLE is the month letter, the two-digit year and the LAST FOUR
-- DIGITS. Across all 855 batches there is not one case where two different
-- batches share those three things — checked on four digits and on five. So
-- that is what is stored and that is what despatch is matched on:
--
--     stack_key  =  month letter || yy || last four digits
--     match      =  left(batch,3) || right(batch,4) = stack_key
--
-- IT IS SEVEN CHARACTERS AND THE BATCH IS TEN. This is deliberate and it is
-- the one thing a reader has to know: the key is NOT the SAP batch number and
-- a plain equality join against BATCH returns nothing. despatch_batch below
-- is where the real ten-character number goes once despatch has posted it.
--
-- ── WHY THE KEY IS GENERATED AND NOT TYPED ──────────────────────────────────
-- It is derived from created_on and stack_no, so storing it as a third
-- independent column would let the three drift apart — and a key that no
-- longer follows from its own date is a broken despatch link that nothing
-- reports. GENERATED ALWAYS means it cannot be written at all.
--
-- The tail is CHARACTER(4), zero-padded. The workbook writes 414 where the
-- batch ends 0414, and typed raw those are different strings. Padding is not
-- cosmetic; it is the difference between matching and not.
-- ===========================================================================
SET LOCAL search_path = minehub, public;

-- ALTER and CREATE take heavy locks, and a queued exclusive lock blocks every
-- reader behind it. Five seconds of waiting costs nothing and fails cleanly.
-- See CLAUDE.md — this estate has lost tables to a queued lock twice.
SET lock_timeout = '5s';


-- ---------------------------------------------------------------------------
-- 1. THE STACK
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mines_rom_stack (
    stack_id        bigserial    PRIMARY KEY,

    -- STACK CREATION DATE. Not the production date of anything in it: a stack
    -- built on 31 October out of ore mined on the 29th, 30th and 31st is an
    -- October stack and despatches under J. The month letter follows THIS,
    -- which is the whole reason it is a column of its own.
    created_on      date         NOT NULL,

    -- The last four digits of the despatch batch, zero-padded. Typed by the
    -- mine; everything to its left is derived.
    stack_no        character(4) NOT NULL,

    -- A=Jan … L=Dec, two-digit year, then the tail. See the header.
    -- EXTRACT on a date is immutable, which is what lets this be stored.
    -- to_char is NOT -- it reads lc_time -- so the year is built by hand.
    stack_key       varchar(7)
                    GENERATED ALWAYS AS (
                        chr(64 + EXTRACT(MONTH FROM created_on)::int)
                     || lpad((EXTRACT(YEAR FROM created_on)::int % 100)::text, 2, '0')
                     || stack_no
                    ) STORED,

    -- The real ten-character SAP batch, written in once despatch has posted
    -- it. Null until then, which is the normal state of a stack that has been
    -- built and not yet shipped -- not a fault and not something to chase.
    despatch_batch  varchar(10),

    note            text,

    entry_id        varchar(50)  NOT NULL,
    entry_date      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    updated_by      varchar(50),

    -- Four digits. A CHARACTER(4) is already four wide, so this is about what
    -- is IN them: 'A414' would pad and store happily and match nothing.
    CONSTRAINT chk_mines_rom_stack_no
        CHECK (stack_no ~ '^[0-9]{4}$'),
    -- The shape SAP uses. Checked rather than trusted, because this column is
    -- the one that makes the link exact rather than inferred.
    CONSTRAINT chk_mines_rom_stack_batch
        CHECK (despatch_batch IS NULL OR despatch_batch ~ '^[A-L][0-9]{9}$'),
    -- AND IT HAS TO BE THE SAME STACK. A batch whose own letter, year and
    -- last four digits disagree with the key is a mis-keyed link, and a
    -- mis-keyed link is worse than an absent one because it reports.
    CONSTRAINT chk_mines_rom_stack_batch_agrees
        CHECK (despatch_batch IS NULL
            OR left(despatch_batch, 3) || right(despatch_batch, 4) = stack_key)
);

-- ONE STACK PER KEY. Historically there has never been a collision, but at
-- about thirty stacks a month a repeated tail inside one month is possible,
-- and the time to find out is at entry rather than at reconciliation.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mines_rom_stack_key
    ON mines_rom_stack (stack_key);

CREATE INDEX IF NOT EXISTS idx_mines_rom_stack_created
    ON mines_rom_stack (created_on DESC);

-- Partial: the stacks still waiting on a despatch are the short list somebody
-- reconciles, and it is a shrinking slice of the table.
CREATE INDEX IF NOT EXISTS idx_mines_rom_stack_unmatched
    ON mines_rom_stack (created_on DESC)
    WHERE despatch_batch IS NULL;

COMMENT ON TABLE mines_rom_stack IS
    'A stack of ROM ore, built from samples on the day-wise ROM analysis and '
    'despatched under one batch number. The weighted average of its lines is '
    'computed on read, never stored.';
COMMENT ON COLUMN mines_rom_stack.created_on IS
    'When the stack was made. The month letter and year of stack_key come '
    'from this, NOT from the production dates of its lines -- a stack spans '
    'days and sometimes months.';
COMMENT ON COLUMN mines_rom_stack.stack_no IS
    'The last four digits of the despatch batch, zero-padded. The workbook '
    'writes 414 where the batch ends 0414; padded here so it matches.';
COMMENT ON COLUMN mines_rom_stack.stack_key IS
    'Month letter + two-digit year + the four-digit tail, e.g. K260414. '
    'SEVEN characters -- NOT the ten-character SAP batch. Despatch is matched '
    'on left(BATCH,3) || right(BATCH,4) = stack_key, which is unique across '
    'all 855 batches ever despatched. A plain equality join on BATCH returns '
    'nothing.';
COMMENT ON COLUMN mines_rom_stack.despatch_batch IS
    'The real ten-character SAP batch, filled in once despatch posts it. Null '
    'is the normal state of a stack that has not shipped yet.';


-- ---------------------------------------------------------------------------
-- 2. WHAT WENT INTO IT
-- ---------------------------------------------------------------------------
-- A line is a SHARE of a ROM sample, not the sample. qty_mt is what the mine
-- says went in and is typed, never apportioned automatically: the sheet's own
-- quantities do not divide evenly and inventing a split would be a guess
-- wearing the clothes of a measurement.
--
-- ── WHY THE FIGURES ARE STORED AND rom_id IS KEPT ANYWAY ────────────────────
-- Both, on purpose. rom_id says which sample this came off, so moisture,
-- provenance and a correction on the ROM screen can all be found. The figures
-- are stored because the mine may amend them here -- shifting material has no
-- sample at all and is typed end to end -- and a line that only pointed at a
-- sample could not hold an amended figure or survive that sample's deletion.
--
-- `amended` says the two have diverged, so a reader who finds this screen and
-- the ROM screen quoting different grades for one parcel is told why rather
-- than left to wonder which is broken.
CREATE TABLE IF NOT EXISTS mines_rom_stack_line (
    line_id         bigserial     PRIMARY KEY,
    stack_id        bigint        NOT NULL
                    REFERENCES mines_rom_stack (stack_id) ON DELETE CASCADE,

    -- The sample this came off. NULL for shifting material, which is not ROM
    -- and was never filed as a sample. ON DELETE SET NULL rather than CASCADE:
    -- removing a ROM sample must not silently empty a stack that was already
    -- built, despatched and invoiced out of it.
    rom_id          bigint        REFERENCES mines_rom_entry (rom_id)
                    ON DELETE SET NULL,

    -- The production date and shift of the ore, NOT of the stack.
    on_date         date          NOT NULL,
    shift           varchar(24)   NOT NULL,
    location_id     integer       REFERENCES mines_rom_location (location_id),

    -- Geology's half, carried across from the sample. Usually null: nothing
    -- before November 2026 carries a block model at all.
    block_mrl       varchar(20),
    block_cr2o3_pct numeric(6,3),

    cr2o3_pct       numeric(6,3)  NOT NULL,
    feo_pct         numeric(6,3)  NOT NULL,
    -- Not on the workbook anywhere. Carried from the sample because the AMIRA
    -- chain's ROM Stack column needs it: without a moisture that column can
    -- show a weight and never a Net Chromium, which is the figure it exists
    -- for. Null when the lab was silent that day.
    moisture_pct    numeric(5,2),

    -- How much of that sample went into this stack. Typed.
    qty_mt          numeric(12,3) NOT NULL,

    amended         boolean       NOT NULL DEFAULT false,

    entry_id        varchar(50)   NOT NULL,
    entry_date      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    updated_by      varchar(50),

    -- THE SIX THE MINE NAMED. Shifting material is a shift value here rather
    -- than a flag beside A/B/C, at the mine's instruction (24 Nov 2026): it
    -- is how their sheet reads and how they asked for the dropdown. The
    -- workbook spells these fourteen ways -- 'A(Shifting material)',
    -- '(A) shifting material', 'B shifting', 'A+B', 'CON' and two blanks --
    -- and this is the list that stops that.
    CONSTRAINT chk_mines_rom_stack_line_shift
        CHECK (shift IN ('A', 'B', 'C',
                         'A(Shifting material)',
                         'B(Shifting material)',
                         'C(Shifting material)')),
    CONSTRAINT chk_mines_rom_stack_line_qty
        CHECK (qty_mt > 0),
    CONSTRAINT chk_mines_rom_stack_line_cr2o3
        CHECK (cr2o3_pct >= 0 AND cr2o3_pct <= 100),
    CONSTRAINT chk_mines_rom_stack_line_feo
        CHECK (feo_pct >= 0 AND feo_pct <= 100),
    CONSTRAINT chk_mines_rom_stack_line_moisture
        CHECK (moisture_pct IS NULL
            OR (moisture_pct >= 0 AND moisture_pct <= 100)),
    CONSTRAINT chk_mines_rom_stack_line_block_cr2o3
        CHECK (block_cr2o3_pct IS NULL
            OR (block_cr2o3_pct >= 0 AND block_cr2o3_pct <= 100)),
    -- Same shape and same ordering rule as migration 132's. A bench level or
    -- a span of two, and a span runs upwards.
    CONSTRAINT chk_mines_rom_stack_line_block_mrl
        CHECK (block_mrl IS NULL OR block_mrl ~
               '^[0-9]{1,4}(\.[0-9]{1,2})?(-[0-9]{1,4}(\.[0-9]{1,2})?)?$'),
    CONSTRAINT chk_mines_rom_stack_line_block_mrl_order
        CHECK (block_mrl IS NULL OR position('-' in block_mrl) = 0
            OR CAST(split_part(block_mrl, '-', 1) AS numeric)
             <= CAST(split_part(block_mrl, '-', 2) AS numeric)),
    -- SHIFTING MATERIAL HAS NO SAMPLE, and that is what makes the two paths
    -- distinguishable. Without this a fetched line whose rom_id went missing
    -- would be indistinguishable from one the mine typed, and `amended` would
    -- have nothing to be measured against.
    CONSTRAINT chk_mines_rom_stack_line_shifting_has_no_sample
        CHECK (position('Shifting' in shift) = 0 OR rom_id IS NULL)
);

-- The stack's own lines, which is almost every read.
CREATE INDEX IF NOT EXISTS idx_mines_rom_stack_line_stack
    ON mines_rom_stack_line (stack_id, on_date, line_id);

-- "What has this sample already been stacked into", which is what the entry
-- form asks before it offers a sample again.
CREATE INDEX IF NOT EXISTS idx_mines_rom_stack_line_rom
    ON mines_rom_stack_line (rom_id)
    WHERE rom_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mines_rom_stack_line_date
    ON mines_rom_stack_line (on_date);

COMMENT ON TABLE mines_rom_stack_line IS
    'One share of one ROM sample inside one stack. A sample can be split '
    'across stacks, so this is a share and not the sample.';
COMMENT ON COLUMN mines_rom_stack_line.rom_id IS
    'The ROM sample this came off. Null for shifting material, which was '
    'never filed as a sample. The assay is stored here as well because the '
    'mine may amend it -- see amended.';
COMMENT ON COLUMN mines_rom_stack_line.qty_mt IS
    'How much of that sample went into this stack. Typed by the mine, never '
    'apportioned automatically.';
COMMENT ON COLUMN mines_rom_stack_line.amended IS
    'True when a stored figure no longer matches the ROM sample it was '
    'fetched from. Says WHY the two screens differ, so neither has to be '
    'assumed broken.';


-- ---------------------------------------------------------------------------
-- 3. WHAT THE FIGURES USED TO BE
-- ---------------------------------------------------------------------------
-- As migration 132's log, and for the same reasons: written by the
-- application because the actor is an identity the database never sees, jsonb
-- rather than a column per field, and NO FOREIGN KEY -- a deletion is the
-- most important thing in here and a cascade would erase the record of it.
CREATE TABLE IF NOT EXISTS mines_rom_stack_log (
    log_id      bigserial     PRIMARY KEY,
    stack_id    bigint        NOT NULL,
    stack_key   varchar(7)    NOT NULL,
    action      varchar(10)   NOT NULL,
    part        varchar(10)   NOT NULL,

    old_values  jsonb,
    new_values  jsonb,

    changed_by  varchar(50)   NOT NULL,
    changed_at  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT chk_mines_rom_stack_log_action
        CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    CONSTRAINT chk_mines_rom_stack_log_part
        CHECK (part IN ('STACK', 'LINE'))
);

COMMENT ON TABLE mines_rom_stack_log IS
    'Every change to a stack or its lines, with the values before and after. '
    'stack_key is copied in rather than joined so a deleted stack is still '
    'readable by the number it was known by.';

CREATE INDEX IF NOT EXISTS idx_mines_rom_stack_log_stack
    ON mines_rom_stack_log (stack_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_mines_rom_stack_log_key
    ON mines_rom_stack_log (stack_key, changed_at DESC);


-- ---------------------------------------------------------------------------
-- 4. WHO MAY DO WHAT
-- ---------------------------------------------------------------------------
-- Not folded into rom.edit. Filing what was dug and deciding what was built
-- out of it are different jobs, and the second one assigns the number the
-- despatch is invoiced under -- so it is the number, not the tonnage, that
-- makes this its own permission.
--
-- As in 116, 129 and 133, nobody is named: the trigger on permission grants
-- each new code to SUPERADMIN on insert, and the people who will type are
-- given theirs through the Access Control screen, by a person, with a record.
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order)
VALUES
  ('romstack.view', 'Operations', 'Read the ROM stacks',
   'See the stacks the mine has built, what went into each and the number it '
   'despatches under.',
   FALSE, 494),

  ('romstack.edit', 'Operations', 'Build and correct a ROM stack',
   'Create a stack, give it its creation date and number, and choose which '
   'ROM samples went into it and how much of each.',
   FALSE, 495),

  ('romstack.delete', 'Operations', 'Remove a ROM stack',
   'Delete a stack and its lines outright. Correcting what went in is '
   'romstack.edit; this is for a stack that should never have been built.',
   TRUE, 496)
ON CONFLICT (code) DO NOTHING;
