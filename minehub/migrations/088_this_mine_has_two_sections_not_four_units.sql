-- 088_this_mine_has_two_sections_not_four_units
--
-- The cost plan view split rows four ways off the cost-centre prefix -
-- MINES, BALASORE, SUKINDA, OTHER - and offered all four on the screen.
-- That was wrong for this application twice over.
--
-- This is the Kaliapani mines dashboard. Balasore and Sukinda are different
-- plants; their planned cost is not something anybody opens this screen to
-- read, and offering it implies the mine is being compared against them.
--
-- And the split that does matter here is the one the costing workbook uses:
-- Mines Costing and COB Costing, side by side. That is not a prefix - every
-- cost centre on this site is 1210 - it is a property of the cost centre,
-- and SAP already knows which four belong to the beneficiation plant.
--
-- So section becomes a column on the master rather than a substring in a
-- view, seeded from the same four cost centres the costing engine uses
-- (owner = 'HEAD (COB)'). A centre the mine adds later is a row to update,
-- not a CASE to edit.
--
-- Rows for other plants stay in the table. The export contains them, the
-- upload reports them, and dropping them on ingest would mean a re-upload
-- silently lost data. They are simply not offered as a view.
--
-- Idempotent: safe to re-run.

ALTER TABLE minehub.cost_centre_master
    ADD COLUMN IF NOT EXISTS section text;

COMMENT ON COLUMN minehub.cost_centre_master.section IS
    'MINES or COB for cost centres on this site; NULL for other plants. Drives the two sections of the cost sheet.';

-- The beneficiation plant's own cost centres. Everything else on 1210 is the
-- mine. Matches app/data/costing/cost_centre_master.csv, which takes it from
-- SAP's owner field.
UPDATE minehub.cost_centre_master
   SET section = 'COB'
 WHERE cost_centre IN ('1210021002', '1210023009', '1210023010', '1210023011');

UPDATE minehub.cost_centre_master
   SET section = 'MINES'
 WHERE cost_centre LIKE '1210%'
   AND section IS DISTINCT FROM 'COB';

CREATE INDEX IF NOT EXISTS cost_centre_master_section_idx
    ON minehub.cost_centre_master (section)
    WHERE section IS NOT NULL;

-- ---------------------------------------------------------------------
-- The view, rebuilt on the master rather than on a substring
--
-- Dropped rather than replaced: the column is renamed from "unit" to
-- "section", and CREATE OR REPLACE VIEW cannot rename a column. Nothing but
-- this module's own endpoints reads it.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS minehub.cost_plan_detail;

CREATE VIEW minehub.cost_plan_detail AS
SELECT p.fiscal_year,
       p.period,
       p.plan_month,
       p.co_area,
       p.plan_version,
       p.cost_centre,
       COALESCE(cc.description, '(unmapped cost centre)') AS cost_centre_desc,
       p.cost_element,
       COALESCE(ce.description, '(unmapped cost element)') AS cost_element_desc,
       p.plan_fix_cost,
       p.currency,
       -- MINES or COB for this site; OTHER is another plant and is never
       -- offered on screen. A cost centre missing from the master still
       -- resolves, so an unseeded centre shows up as the mine's rather than
       -- disappearing from the total.
       COALESCE(
           cc.section,
           CASE WHEN p.cost_centre LIKE '1210%' THEN 'MINES' ELSE 'OTHER' END
       ) AS section,
       p.source_file,
       p.ingested_at
FROM minehub.cost_plan p
LEFT JOIN minehub.cost_centre_master  cc ON cc.cost_centre  = p.cost_centre
LEFT JOIN minehub.cost_element_master ce ON ce.cost_element = p.cost_element;

COMMENT ON VIEW minehub.cost_plan_detail IS
    'Cost plan joined to both masters, with the calendar month and the Mines/COB section resolved. The thing screens should read.';
