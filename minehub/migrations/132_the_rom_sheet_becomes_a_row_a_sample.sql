-- ===========================================================================
-- 132 — THE DAY-WISE ROM ANALYSIS BECOMES A ROW PER SAMPLE
-- ===========================================================================
-- What the mine digs, shift by shift, with the assay of each parcel and the
-- block model's own figure for the ground it came out of. Until now it lived
-- in one workbook, "DAY WISE ROM ANALYSIS REPORT", a sheet per month since
-- April 2024 — 32 sheets, 2,514 sample rows, and ten different column
-- layouts as it was reshaped along the way.
--
-- ── WHAT A ROW IS ───────────────────────────────────────────────────────────
-- ONE SAMPLE, not one day. A day is several rows: a shift, a location, the
-- tonnage that came off it and the assay of that tonnage. The day's total and
-- the day's weighted average are what the sheet calls TOTAL QTY and
-- "WET & AVG.", and NEITHER IS STORED — both are arithmetic over the rows,
-- computed on read. The sheet's own reserve total is the warning here: it
-- printed August's figure under a November heading for three months because
-- somebody had to remember to refresh it.
--
-- The ratio is not stored either. Cr/Fe is
--     (Cr2O3 × 0.6843) ÷ (FeO × 0.7773)
-- and that reproduces 2,093 of the workbook's 2,138 rows to within 0.02. The
-- 45 it does not reproduce are typing slips — one reads 2.79 where the
-- chemistry gives 1.86 — so computing it removes a whole class of error
-- rather than carrying it forward.
--
-- ── TWO PEOPLE FILL ONE ROW ─────────────────────────────────────────────────
-- Production files the left half: date, shift, trips, tonnage, location and
-- the assay of what was dug. Geology fills the block half: the bench level it
-- came from and what the block model says that ground holds. The mine works
-- in that order — you know which block you are in and what it should assay,
-- and the ROM entry is made against it.
--
-- So the block columns are NULLABLE and the row is complete without them. A
-- day must be fileable the day it happens; requiring a figure the second
-- person has not supplied yet is how invented numbers get typed.
--
-- They carry block_entry_id and block_entry_date, and the production half
-- carries rom_entry_id and rom_entry_date. NAMED IN PARALLEL ON PURPOSE:
-- a bare entry_id beside a block_entry_id reads as "the" owner of the row,
-- and there is no such person. "Who said this ground was 44%" has an answer
-- that is not the same answer as "who filed Tuesday's production".
--
-- ── WHY THERE IS NO NATURAL KEY ─────────────────────────────────────────────
-- (date, shift, location) is NOT unique and must not be made so. 1 November
-- 2026 carries two A-shift PIT BOTTOM rows — 100 MT at 43.25% and 170 MT at
-- 45.29% — and that split is the entire reason this sheet exists. A natural
-- key would merge them and lose the thing being recorded.
-- ===========================================================================
SET LOCAL search_path = minehub, public;

-- Five seconds of waiting costs nothing and fails cleanly; without it a
-- statement queues on the server default and every reader queues behind it.
-- See CLAUDE.md — this estate has lost tables to a queued lock twice.
SET lock_timeout = '5s';


-- ---------------------------------------------------------------------------
-- 1. WHERE IT CAME OUT OF
-- ---------------------------------------------------------------------------
-- The workbook's POINT OF EXCA. column is free text, and across 2,514 rows it
-- has collected EIGHTY-FIVE spellings of what the mine agrees are about
-- twenty places: PIT BOTTOM appears as PIT BOTTOM:EAST, PIT BOTTOM:(BAL)EAST,
-- PIT BOTTOM(bpm), PIT BOTTOM E and six more; DVS WEST, DVS W and WEST DVS
-- are 379 rows under three names. Five rows have a number in the column.
-- Any report that groups by that text counts one place several times.
--
-- So the entry form offers this list and nothing else — with an "add a new
-- location" that writes here, because a dropdown somebody cannot extend is a
-- dropdown they will work around.
--
-- THE UNIQUENESS IS ON THE FOLDED NAME, not the name as typed. A plain UNIQUE
-- would happily hold "Pit Bottom" beside "PIT BOTTOM" and the list would be
-- back where the workbook started within a month.
CREATE TABLE IF NOT EXISTS mines_rom_location (
    location_id serial       PRIMARY KEY,
    name        varchar(60)  NOT NULL
                CHECK (btrim(name) <> ''),

    -- A worked-out face stays here for reading history and stops being
    -- offered for new entry. Deleting it would orphan every row that cites
    -- it; hiding it is what is actually wanted.
    is_active   boolean      NOT NULL DEFAULT true,
    note        text,

    entry_id    varchar(50)  NOT NULL,
    entry_date  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    updated_by  varchar(50)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mines_rom_location_name
    ON mines_rom_location (upper(btrim(name)));

COMMENT ON TABLE mines_rom_location IS
    'The places ROM is dug from, as a list rather than free text. Extended '
    'from the entry form; a worked-out location is deactivated, never '
    'deleted, because rows cite it.';
COMMENT ON COLUMN mines_rom_location.is_active IS
    'False hides it from the entry dropdown. History still reads it.';
COMMENT ON COLUMN mines_rom_location.entry_date IS
    'When it was first added. See updated_at for the last change.';


-- THE MINE'S OWN LIST, confirmed November 2026. An earlier draft of this
-- migration seeded eight names read off the workbook's spellings — Pit
-- Bottom East/West, three DVS faces, BAL West. The mine struck all six out:
-- they are spellings of places that are not worked under those names. What
-- is left is what November is actually dug from.
--
-- The 85 spellings are still NOT folded in here. Deciding whether "B-W" is
-- a face of its own is the mine's call and not a migration's, and guessing
-- it would bake a wrong answer into history. They add the rest from the
-- screen as the ground opens.
INSERT INTO mines_rom_location (name, entry_id) VALUES
    ('West Pit Bottom',  'MIGRATION 132'),
    ('West',             'MIGRATION 132'),
    ('South West',       'MIGRATION 132')
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. THE SAMPLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mines_rom_entry (
    rom_id          bigserial     PRIMARY KEY,

    on_date         date          NOT NULL,
    -- The workbook has carried a D shift and a MID DAY column in the past and
    -- carries neither now. The CHECK is the current three; widening it later
    -- is one line, while storing anything at all would let a typo through.
    shift           varchar(1)    NOT NULL,
    location_id     integer       NOT NULL
                    REFERENCES mines_rom_location (location_id),

    -- TRIPS IS NOT AN INTEGER. The sheet carries 26.43867 and 40.4 — a tipper
    -- counted part-loaded, or a shift split across a date boundary.
    trips           numeric(8,2),
    qty_mt          numeric(12,3) NOT NULL,

    -- Carried on 153 of the workbook's 2,514 rows and on none of the current
    -- format. Null means nobody measured it, which is not the same as dry.
    moisture_pct    numeric(5,2),
    cr2o3_pct       numeric(6,3)  NOT NULL,
    feo_pct         numeric(6,3)  NOT NULL,

    -- ── the block half, filled by geology ──────────────────────────────────
    -- mRL is the bench level. It is new as a field and not as data: today it
    -- is buried inside the location text — 80MRL, 102.MRL, DVS(WEST) 35MRL —
    -- on 274 rows, and pulling it out is what collapses 85 spellings to 61.
    -- TEXT, NOT A NUMBER. A parcel is often won off a span of bench rather
    -- than one level — "80-82" — and there is no numeric column that holds
    -- that. Storing the midpoint would invent a precision nobody measured,
    -- and storing the lower edge would quietly lose the upper one. The
    -- shape is pinned by a CHECK instead, so it stays a bench level and
    -- does not drift into free text the way the location column did.
    block_mrl        varchar(20),
    block_cr2o3_pct  numeric(6,3),
    block_entry_id   varchar(50),
    block_entry_date timestamptz,

    rom_entry_id    varchar(50)   NOT NULL,
    rom_entry_date  timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    updated_by      varchar(50),

    CONSTRAINT chk_mines_rom_entry_shift
        CHECK (shift IN ('A', 'B', 'C')),
    CONSTRAINT chk_mines_rom_entry_trips
        CHECK (trips IS NULL OR trips >= 0),
    CONSTRAINT chk_mines_rom_entry_qty
        CHECK (qty_mt >= 0),
    -- An assay is a percentage. The upper bound catches the commonest typo of
    -- all, a tonnage pasted into an assay column.
    CONSTRAINT chk_mines_rom_entry_moisture
        CHECK (moisture_pct IS NULL OR (moisture_pct >= 0 AND moisture_pct <= 100)),
    CONSTRAINT chk_mines_rom_entry_cr2o3
        CHECK (cr2o3_pct >= 0 AND cr2o3_pct <= 100),
    CONSTRAINT chk_mines_rom_entry_feo
        CHECK (feo_pct >= 0 AND feo_pct <= 100),
    CONSTRAINT chk_mines_rom_entry_block_cr2o3
        CHECK (block_cr2o3_pct IS NULL
            OR (block_cr2o3_pct >= 0 AND block_cr2o3_pct <= 100)),
    -- A level ("80", "27.5") or a span of two ("80-82"). Nothing else.
    CONSTRAINT chk_mines_rom_entry_block_mrl
        CHECK (block_mrl IS NULL OR block_mrl ~
               '^[0-9]{1,4}(\.[0-9]{1,2})?(-[0-9]{1,4}(\.[0-9]{1,2})?)?$'),
    -- AND A SPAN RUNS UPWARDS. "82-80" passes the shape test and is a
    -- transposition; caught here it is a typo, caught later it is a report.
    CONSTRAINT chk_mines_rom_entry_block_mrl_order
        CHECK (block_mrl IS NULL OR position('-' in block_mrl) = 0
            OR CAST(split_part(block_mrl, '-', 1) AS numeric)
             <= CAST(split_part(block_mrl, '-', 2) AS numeric)),
    -- THE BLOCK HALF IS PRESENT OR IT IS ABSENT, never half of it and never
    -- without a name against it. A bench level with no grade beside it, or a
    -- grade nobody owns, is a row that cannot be read or questioned later.
    CONSTRAINT chk_mines_rom_entry_block_complete
        CHECK ((block_mrl IS NULL AND block_cr2o3_pct IS NULL
                AND block_entry_id IS NULL AND block_entry_date IS NULL)
            OR (block_mrl IS NOT NULL AND block_cr2o3_pct IS NOT NULL
                AND block_entry_id IS NOT NULL AND block_entry_date IS NOT NULL))
);

COMMENT ON TABLE mines_rom_entry IS
    'Day-wise ROM analysis, one row per sample. The day total and the '
    'weighted average ("WET & AVG.") are computed on read, never stored. So '
    'is the Cr/Fe ratio.';
COMMENT ON COLUMN mines_rom_entry.on_date IS
    'The date of production the sample belongs to.';
COMMENT ON COLUMN mines_rom_entry.trips IS
    'Tipper trips. Fractional on purpose — the sheet carries 26.43867.';
COMMENT ON COLUMN mines_rom_entry.qty_mt IS
    'The tonnage this sample covers. The sheet calls it TOTAL QTY; the day '
    'total is the sum of these and is not stored.';
COMMENT ON COLUMN mines_rom_entry.block_mrl IS
    'Bench level (mRL) the parcel came from, per the block model. Text, not '
    'a number: a parcel won off a span of bench is written "80-82". Filled '
    'by geology, not by whoever files the day.';
COMMENT ON COLUMN mines_rom_entry.block_cr2o3_pct IS
    'What the block model says that ground holds — the figure the ROM assay '
    'is read against. Null until geology fills it.';
COMMENT ON COLUMN mines_rom_entry.rom_entry_id IS
    'Who filed the production half: shift, trips, tonnage, location, assay. '
    'Named rom_ rather than bare entry_ so that neither half of the row '
    'reads as the owner of the whole of it.';
COMMENT ON COLUMN mines_rom_entry.block_entry_id IS
    'Who filled the block half. Deliberately not rom_entry_id: two people '
    'fill one row and the two answers are different.';

-- Reading is almost always a date range, newest first.
CREATE INDEX IF NOT EXISTS idx_mines_rom_entry_on_date
    ON mines_rom_entry (on_date DESC);

-- THE GEOLOGY QUEUE. Partial, because the rows still waiting on a block model
-- are a small and shrinking slice of the table and that is the one list the
-- second person opens every day.
CREATE INDEX IF NOT EXISTS idx_mines_rom_entry_awaiting_block
    ON mines_rom_entry (on_date)
    WHERE block_cr2o3_pct IS NULL;

CREATE INDEX IF NOT EXISTS idx_mines_rom_entry_location
    ON mines_rom_entry (location_id, on_date DESC);


-- ---------------------------------------------------------------------------
-- 3. WHAT THE FIGURES USED TO BE
-- ---------------------------------------------------------------------------
-- Written by the application on every insert, edit and deletion. Not a
-- trigger: the actor is an application identity the database never sees, and
-- a trigger logging 'mines_app' for every change would be an audit trail in
-- form only.
--
-- `part` says which half moved. With two people writing to one row, "who
-- changed this" is only answerable if the log says whether it was the
-- production figures or the block model that moved.
--
-- OLD AND NEW ARE jsonb, not a column per field. The reserve log carries a
-- column pair per value because it has two values; this row has nine, and
-- eighteen columns that must be kept in step with the table above is a
-- maintenance burden that buys nothing a document does not.
--
-- NO FOREIGN KEY TO mines_rom_entry. A deletion is the single most important
-- thing in here, and a cascade would erase the record of it.
CREATE TABLE IF NOT EXISTS mines_rom_entry_log (
    log_id      bigserial     PRIMARY KEY,
    rom_id      bigint        NOT NULL,
    on_date     date          NOT NULL,
    action      varchar(10)   NOT NULL,
    part        varchar(10)   NOT NULL,

    old_values  jsonb,
    new_values  jsonb,

    changed_by  varchar(50)   NOT NULL,
    changed_at  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT chk_mines_rom_entry_log_action
        CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    CONSTRAINT chk_mines_rom_entry_log_part
        CHECK (part IN ('ROM', 'BLOCK'))
);

COMMENT ON TABLE mines_rom_entry_log IS
    'Every change to mines_rom_entry, with the values before and after and '
    'which half of the row moved. Written by the application, which is the '
    'only layer that knows who the actor is.';

CREATE INDEX IF NOT EXISTS idx_mines_rom_entry_log_row
    ON mines_rom_entry_log (rom_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_mines_rom_entry_log_date
    ON mines_rom_entry_log (on_date, changed_at DESC);
