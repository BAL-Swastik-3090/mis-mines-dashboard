-- 101: the Lost Cost Matrix's loss heads, their owners, and from when.
--
-- WHAT THIS REPLACES. Four hardcoded maps in services/lcm.py, each keyed on
-- the source column name:
--
--   LOSS_TYPE_BY_COLUMN   Controllable / Non Controllable       25 entries
--   KAM_BY_COLUMN         who owns the loss                     25 entries
--   LABEL_OVERRIDES       the words on the screen                9 entries
--   ROLE_BY_COLUMN        which head it rolls up to in the tree 25 entries
--
-- plus the five names at the top of the KAM Wise Loss Tree. Between them they
-- decide the Loss Description, the Loss Type, the KAM, the controllable /
-- non-controllable split of the rupee value, and every node of the tree.
--
-- ── KAM AND ROLE ARE NOT THE SAME MAPPING ─────────────────────────────────
-- It is tempting to derive the tree from the KAM and keep one column. The
-- mine's own structure says otherwise: H.S.D shortage is owned by Praspero
-- Sahoo and rolls up to Head Engineering; Trans. truck jam is owned by
-- Maheswar Mohanty and rolls up to Head Human Resource. Deriving one from the
-- other would move real money between heads in the tree. Both are stored.
--
-- ── DISCOVERY STAYS DYNAMIC, ON PURPOSE ───────────────────────────────────
-- Which loss heads exist comes from the columns of the source table, not from
-- this table. A new loss reason the mine starts recording therefore still
-- appears on the matrix -- as Unclassified, at the bottom, until somebody
-- classifies it in the selector. The alternative is a fixed list from which a
-- new head is silently absent, and a matrix that quietly stops footing.
-- So there is no master list of heads here: only what has been DECIDED about
-- them, which is a different thing and the only thing the mine owns.
--
-- ── A DECISION HAS A DATE ─────────────────────────────────────────────────
-- Same rule as the Equipment Status Selector in migration 100: a row carries
-- the date it takes effect, the settings in force on a date are the latest
-- row on or before it, and before the first row the FIRST row applies -- so
-- the months already reported do not move when October is edited.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. THE PEOPLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcm_kam_master (
    id        serial      PRIMARY KEY,
    kam_name  varchar(60) NOT NULL UNIQUE,
    -- Nullable, and left empty for now. The employee IDs are what stalled
    -- this table in August 2026; the selector works without them and the
    -- column is here so that filling them in later is an UPDATE, not a
    -- migration.
    emp_id    varchar(20),
    status    varchar(10) NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
    sl_order  integer
);

COMMENT ON TABLE lcm_kam_master IS
    'The people a loss head can be assigned to. A name is retired by setting '
    'status INACTIVE, never deleted -- the dated settings behind it still '
    'point here, and a report of last October must still name its owner.';


-- ---------------------------------------------------------------------------
-- 2. WHERE A LOSS ROLLS UP TO
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcm_role_master (
    role_code varchar(20) PRIMARY KEY,
    title     varchar(60) NOT NULL,
    owner_kam varchar(60) REFERENCES lcm_kam_master (kam_name) ON UPDATE CASCADE,
    sl_order  integer     NOT NULL
);

COMMENT ON TABLE lcm_role_master IS
    'The nodes of the KAM Wise Loss Tree, left to right. UNMAPPED is a real '
    'row with no owner: a loss head nobody has classified is collected there '
    'and shown, because the root of the tree must keep matching the matrix '
    'total and a dropped head would break exactly that.';


-- ---------------------------------------------------------------------------
-- 3. WHAT HAS BEEN DECIDED ABOUT EACH LOSS HEAD, AND FROM WHEN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcm_loss_head_setting (
    id             bigserial   PRIMARY KEY,
    -- THE JOIN KEY IS THE COLUMN, NEVER THE LABEL. Renaming 'Idle requ basic'
    -- to something readable must not re-bucket the hours behind it.
    column_name    varchar(60) NOT NULL,
    effective_from date        NOT NULL,

    label          varchar(80) NOT NULL,
    loss_type      varchar(20) NOT NULL DEFAULT 'Unclassified'
                   CHECK (loss_type IN ('Controllable', 'Non Controllable',
                                        'Unclassified')),
    kam_name       varchar(60) REFERENCES lcm_kam_master (kam_name) ON UPDATE CASCADE,
    role_code      varchar(20) REFERENCES lcm_role_master (role_code) ON UPDATE CASCADE,
    sl_order       integer,
    is_active      boolean     NOT NULL DEFAULT true,

    entry_id       varchar(32) NOT NULL,
    entry_date     timestamptz NOT NULL DEFAULT now(),
    revision       integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),

    -- One decision per head per date, for the same reason as the fleet: two
    -- rows sharing an effective_from have no order between them, and the
    -- resolver would pick whichever the planner happened to return.
    UNIQUE (column_name, effective_from)
);

COMMENT ON TABLE lcm_loss_head_setting IS
    'The LCM KAM Selector. One row per decision, carrying the date it takes '
    'effect. Nothing is updated in place: a change is a new row, so the '
    'October matrix can still be explained after November has been edited.';

COMMENT ON COLUMN lcm_loss_head_setting.is_active IS
    'false hides the head from the matrix without losing its history. It does '
    'NOT remove its hours from the totals -- a hidden head whose loss simply '
    'vanished would make the matrix stop footing.';

CREATE INDEX IF NOT EXISTS lcm_loss_head_setting_lookup_idx
    ON lcm_loss_head_setting (column_name, effective_from DESC);
CREATE INDEX IF NOT EXISTS lcm_loss_head_setting_date_idx
    ON lcm_loss_head_setting (effective_from DESC);


-- ---------------------------------------------------------------------------
-- 4. WHO CHANGED WHAT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcm_loss_head_hist (
    id             bigserial   PRIMARY KEY,
    column_name    varchar(60) NOT NULL,
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

CREATE INDEX IF NOT EXISTS lcm_loss_head_hist_head_idx
    ON lcm_loss_head_hist (column_name, effective_from DESC);
CREATE INDEX IF NOT EXISTS lcm_loss_head_hist_when_idx
    ON lcm_loss_head_hist (entry_date DESC);


-- ---------------------------------------------------------------------------
-- 5. THE DECISIONS AS THEY STAND
-- ---------------------------------------------------------------------------
-- Generated from the four maps in services/lcm.py on 2026-11-06, so the
-- tables start life identical to the code they replace. Proven by the parity
-- harness, which captures the matrix and the tree before and after the switch
-- and compares them leaf by leaf.
--
-- effective_from is 2026-10-01, the month the mine named. It is not a claim
-- that these owners took over in October -- they are the ones the matrix has
-- used all along. The resolver reads the FIRST version for any date before
-- it, so September reports exactly what it reported yesterday, and the next
-- change the mine makes carries its own date.

-- The people.
INSERT INTO lcm_kam_master (kam_name, emp_id, status, sl_order) VALUES
    ('Amarendra Sarangi', NULL, 'ACTIVE', 1),
    ('Rana Vikash Singh', NULL, 'ACTIVE', 2),
    ('Gurpreet Singh', NULL, 'ACTIVE', 3),
    ('Praspero Sahoo', NULL, 'ACTIVE', 4),
    ('K L Das', NULL, 'ACTIVE', 5),
    ('Maheswar Mohanty', NULL, 'ACTIVE', 6),
    ('Bijan Kr Chand', NULL, 'ACTIVE', 7),
    ('BK Padhi', NULL, 'ACTIVE', 8)
ON CONFLICT (kam_name) DO NOTHING;

-- The tree, left to right. UNMAPPED has no owner by design: it is where a
-- loss head nobody has classified is collected, so the root still foots.
INSERT INTO lcm_role_master (role_code, title, owner_kam, sl_order) VALUES
    ('CHIEF', 'Chief of Mines', 'BK Padhi', 1),
    ('MINES_OPERATION', 'Head Mines Operation', 'Rana Vikash Singh', 2),
    ('ENGINEERING', 'Head Engineering', 'Amarendra Sarangi', 3),
    ('HUMAN_RESOURCE', 'Head Human Resource', 'Gurpreet Singh', 4),
    ('COB', 'Head COB', 'Bijan Kr Chand', 5),
    ('UNMAPPED', 'Unmapped', NULL, 6)
ON CONFLICT (role_code) DO UPDATE SET
        title     = EXCLUDED.title,
        owner_kam = EXCLUDED.owner_kam,
        sl_order  = EXCLUDED.sl_order;

-- The loss heads. A head missing from one of the four maps keeps exactly the
-- fallback the code gives it today -- Unclassified, no owner, UNMAPPED, and a
-- Sl after the highest known -- rather than being quietly dropped here.
INSERT INTO lcm_loss_head_setting (column_name, effective_from, label,
        loss_type, kam_name, role_code, sl_order, is_active, entry_id)
VALUES
    ('breakdown', DATE '2026-10-01', 'Breakdown', 'Controllable', 'Amarendra Sarangi', 'ENGINEERING', 1, true, 'SEED-101'),
    ('maintenance', DATE '2026-10-01', 'Preventive maintenance', 'Non Controllable', 'Amarendra Sarangi', 'ENGINEERING', 2, true, 'SEED-101'),
    ('late_start', DATE '2026-10-01', 'Late start', 'Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 3, true, 'SEED-101'),
    ('tiffin', DATE '2026-10-01', 'Tiffin', 'Non Controllable', 'Gurpreet Singh', 'HUMAN_RESOURCE', 4, true, 'SEED-101'),
    ('hsd_shortage', DATE '2026-10-01', 'H.S.D shortage', 'Controllable', 'Praspero Sahoo', 'ENGINEERING', 5, true, 'SEED-101'),
    ('strike', DATE '2026-10-01', 'Strike', 'Controllable', 'Gurpreet Singh', 'HUMAN_RESOURCE', 6, true, 'SEED-101'),
    ('idle_requ_basic', DATE '2026-10-01', 'Idle requ basic', 'Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 7, true, 'SEED-101'),
    ('safety_talk', DATE '2026-10-01', 'Safety talk', 'Non Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 8, true, 'SEED-101'),
    ('dump_jam', DATE '2026-10-01', 'Dump jam', 'Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 9, true, 'SEED-101'),
    ('lmv_availability', DATE '2026-10-01', 'LMV unavailability', 'Controllable', 'Gurpreet Singh', 'HUMAN_RESOURCE', 10, true, 'SEED-101'),
    ('illumination_problem', DATE '2026-10-01', 'Illumination problem', 'Controllable', 'K L Das', 'ENGINEERING', 11, true, 'SEED-101'),
    ('absence_operator', DATE '2026-10-01', 'Absence of operator', 'Controllable', 'Gurpreet Singh', 'HUMAN_RESOURCE', 12, true, 'SEED-101'),
    ('idle', DATE '2026-10-01', 'Idle (no work)', 'Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 13, true, 'SEED-101'),
    ('tipper_shortage', DATE '2026-10-01', 'Tipper shortage', 'Controllable', 'Amarendra Sarangi', 'ENGINEERING', 14, true, 'SEED-101'),
    ('early_close', DATE '2026-10-01', 'Early close', 'Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 15, true, 'SEED-101'),
    ('hsd_filling', DATE '2026-10-01', 'H.S.D filling', 'Non Controllable', 'Praspero Sahoo', 'ENGINEERING', 16, true, 'SEED-101'),
    ('not_operation', DATE '2026-10-01', 'Not in operation', 'Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 17, true, 'SEED-101'),
    ('rain_slippery', DATE '2026-10-01', 'Rain & slippery problem', 'Non Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 18, true, 'SEED-101'),
    ('trains_truck', DATE '2026-10-01', 'Trans. truck jam', 'Controllable', 'Maheswar Mohanty', 'HUMAN_RESOURCE', 19, true, 'SEED-101'),
    ('imfa_blasting', DATE '2026-10-01', 'IMFA blasting', 'Non Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 20, true, 'SEED-101'),
    ('face_preparation', DATE '2026-10-01', 'Face preparation', 'Non Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 21, true, 'SEED-101'),
    ('job_allocation', DATE '2026-10-01', 'Job allocation', 'Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 22, true, 'SEED-101'),
    ('idle_safety', DATE '2026-10-01', 'Idle due to safety concern', 'Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 24, true, 'SEED-101'),
    ('other', DATE '2026-10-01', 'Other', 'Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 25, true, 'SEED-101'),
    ('mines_restriction', DATE '2026-10-01', 'Mining restriction', 'Non Controllable', 'Rana Vikash Singh', 'MINES_OPERATION', 26, true, 'SEED-101')
ON CONFLICT (column_name, effective_from) DO NOTHING;
