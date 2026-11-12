-- 105: Electrical, Store and Security become nodes of the loss tree.
--
-- The mine's structure, as given on 11 November 2026:
--
--     Head Electrical  reports to  Head Engineering
--     Head Store       reports to  Head Engineering
--     Head Security    reports to  Head Human Resource
--
-- ── THE REPORTING LINE IS RECORDED, BUT IT DOES NOT ADD UP ────────────────
-- "Rolls up to" here means who the head reports to on the org chart. It is
-- NOT an arithmetic roll-up, and the tree deliberately draws all seven nodes
-- on one line rather than nesting three of them -- which is what the mine
-- asked for, and also the only way the figures can be read.
--
-- If Head Engineering's total included Electrical's and Store's while all
-- three sat side by side, adding the line across would count that loss three
-- times, and the root would stop matching the matrix. So each node carries
-- ONLY the loss heads assigned to it, the seven are disjoint, and the root is
-- their sum. parent_role_code is stored because the mine stated it and a
-- later screen may want to group by it -- nothing sums through it today.
--
-- ── WHY THEY ARE EMPTY TO BEGIN WITH ──────────────────────────────────────
-- A node holds whatever loss heads the LCM KAM Selector assigns to it. None
-- are assigned here: moving Illumination problem out of Engineering and into
-- Electrical moves real money between two cards, and that is the mine's
-- decision to record in the selector, not a migration's to make. The three
-- new nodes therefore appear immediately, carrying zero, and fill up as the
-- mine reassigns heads -- at which point each one's owner derives from the
-- KAM holding most of its heads, exactly as the existing nodes do.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. A NODE CAN NAME THE NODE IT REPORTS TO
-- ---------------------------------------------------------------------------
ALTER TABLE lcm_role_master
    ADD COLUMN IF NOT EXISTS parent_role_code varchar(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lcm_role_master_parent_fkey'
          AND conrelid = 'lcm_role_master'::regclass
    ) THEN
        ALTER TABLE lcm_role_master
            ADD CONSTRAINT lcm_role_master_parent_fkey
            FOREIGN KEY (parent_role_code) REFERENCES lcm_role_master (role_code)
            ON UPDATE CASCADE;
    END IF;
END $$;

COMMENT ON COLUMN lcm_role_master.parent_role_code IS
    'Who this head reports to on the org chart. Recorded, never summed: the '
    'tree draws every node on one line and each carries only its own loss '
    'heads, so adding through this column would double-count.';


-- ---------------------------------------------------------------------------
-- 2. ROOM FOR THE THREE NEW NODES IN THE DISPLAY ORDER
-- ---------------------------------------------------------------------------
-- Unmapped must stay last. It is where a head nobody has classified is
-- collected, and the tree shows it only when it has something in it.
UPDATE lcm_role_master SET sl_order = 99 WHERE role_code = 'UNMAPPED';


-- ---------------------------------------------------------------------------
-- 3. THE NEW NODES
-- ---------------------------------------------------------------------------
-- owner_kam is left NULL on purpose. It is only the fallback for a node whose
-- loss heads cannot answer, and these three have no heads yet; naming someone
-- here would put a person on a card the mine has not put them on. Once heads
-- are assigned the owner derives; until then the node reads as vacant, which
-- is the truth.
INSERT INTO lcm_role_master (role_code, title, owner_kam, sl_order, parent_role_code)
VALUES ('ELECTRICAL', 'Head Electrical', NULL, 6, 'ENGINEERING'),
       ('STORE',      'Head Store',      NULL, 7, 'ENGINEERING'),
       ('SECURITY',   'Head Security',   NULL, 8, 'HUMAN_RESOURCE')
ON CONFLICT (role_code) DO UPDATE
    SET title            = EXCLUDED.title,
        sl_order         = EXCLUDED.sl_order,
        parent_role_code = EXCLUDED.parent_role_code;

-- The four that were already here get their reporting line too, so the column
-- means the same thing for every row rather than being populated only for the
-- rows this migration happened to add.
UPDATE lcm_role_master SET parent_role_code = 'CHIEF'
WHERE  role_code IN ('MINES_OPERATION', 'ENGINEERING', 'HUMAN_RESOURCE', 'COB')
  AND  parent_role_code IS DISTINCT FROM 'CHIEF';
