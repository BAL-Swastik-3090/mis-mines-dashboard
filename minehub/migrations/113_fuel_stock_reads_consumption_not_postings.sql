-- 113: fuel stock reads consumption, not postings.
--
-- WHAT WAS WRONG ON THE STOCK & SUPPLY SCREEN, measured 14 November 2026:
--
--   The burn rate was MB5B's "issued" column, which counts every litre that
--   left a plant's books -- including diesel SENT TO ANOTHER PLANT. Sukinda
--   posted 296,200 L to the mine as stock transfers (movement 641) in ninety
--   days, and the screen read that as Sukinda burning 6,656 L a day. Sukinda
--   actually consumed 204 L a day. Its red "1.6 days of diesel" was a false
--   alarm; it held about fifty-four.
--
--   The in-tank figure was MB5B, a day behind. MB52 has today's.
--
--   Plant names, display order and "what counts as fuel" were typed into the
--   code. One plant had two names on one page.
--
-- So three small tables, and every one of them is something the fuel office
-- can change without a developer.


-- WITHOUT THIS LINE THIS FILE CANNOT BE REPLAYED. Every name below is
-- unqualified, so the schema they land in is whatever the applier's
-- search_path happens to say. On corpappdb that was minehub and this is a
-- no-op; from a clean database applied as postgres it would create
-- fuel_movement_class and fuel_plant_setting in PUBLIC, and the ALTER on
-- fuel_material would fail outright -- taking the rest of the set with it.
-- Ten of the other migrations in this range already carry the line.
SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. What an SAP movement MEANS for fuel
-- ---------------------------------------------------------------------------
--
-- A consumption figure is only as honest as the list of movements it sums.
-- Kept as data because SAP grows new movement types -- Z03 is this company's
-- own -- and a new one silently left out of consumption would look exactly
-- like the mine using less diesel.

CREATE TABLE IF NOT EXISTS fuel_movement_class (
    movement_type text PRIMARY KEY,
    class         text NOT NULL CHECK (class IN (
                      'CONSUMPTION',   -- burnt by a machine, a plant, a vehicle
                      'RECEIPT',       -- arrived from outside
                      'TRANSFER',      -- moved between our own plants
                      'ADJUSTMENT',    -- a stock-take write-off or gain
                      'INTERNAL')),    -- moved inside a plant; no litres change hands
    label         text NOT NULL,
    note          text,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    text
);

COMMENT ON TABLE fuel_movement_class IS
    'How each SAP movement type counts for fuel. Consumption is the sum of '
    'CONSUMPTION movements -- never MB5B''s issued column, which also counts '
    'diesel sent to another plant.';

INSERT INTO fuel_movement_class (movement_type, class, label, note, updated_by)
SELECT * FROM (VALUES
    ('201', 'CONSUMPTION', 'Issue to a cost centre',
     'One cost centre per machine at the mine: EX - 2 (ZAXIS 470), MAN-66 OD 04 J 3931.', 'migration 113'),
    ('202', 'CONSUMPTION', 'Return from a cost centre',
     'The reversal of 201. Summed with it, so a return reduces consumption.', 'migration 113'),
    ('261', 'CONSUMPTION', 'Issue to an order', NULL, 'migration 113'),
    ('262', 'CONSUMPTION', 'Return from an order', NULL, 'migration 113'),
    ('281', 'CONSUMPTION', 'Issue to a network', NULL, 'migration 113'),
    ('282', 'CONSUMPTION', 'Return from a network', NULL, 'migration 113'),
    ('Z03', 'CONSUMPTION', 'Issue to a transporter',
     'Contractor vehicles. The vehicle is named in the document header text.', 'migration 113'),
    ('Z04', 'CONSUMPTION', 'Return from a transporter', NULL, 'migration 113'),
    ('101', 'RECEIPT', 'Goods receipt',
     'A tanker against a purchase order, or the receiving end of a transfer from Sukinda.', 'migration 113'),
    ('102', 'RECEIPT', 'Goods receipt reversed', NULL, 'migration 113'),
    ('641', 'TRANSFER', 'Transfer to stock in transit',
     'Diesel sent to another plant. Sukinda to the mine, 296,200 L in ninety days. '
     'Counting this as consumption is what made Sukinda look 33 times thirstier than it is.',
     'migration 113'),
    ('643', 'TRANSFER', 'Transfer in transit, cross-company', NULL, 'migration 113'),
    ('351', 'TRANSFER', 'Transfer posting in transit', NULL, 'migration 113'),
    ('702', 'ADJUSTMENT', 'Stock-take write-off',
     'A physical count lower than the books. A real loss, but not burn -- shown on its own.',
     'migration 113'),
    ('701', 'ADJUSTMENT', 'Stock-take gain', NULL, 'migration 113'),
    ('311', 'INTERNAL', 'Transfer within a plant', NULL, 'migration 113'),
    ('321', 'INTERNAL', 'Quality to unrestricted', NULL, 'migration 113'),
    ('412', 'INTERNAL', 'Storage location to storage location', NULL, 'migration 113')
) AS v(movement_type, class, label, note, updated_by)
WHERE NOT EXISTS (SELECT 1 FROM fuel_movement_class f
                   WHERE f.movement_type = v.movement_type);


-- ---------------------------------------------------------------------------
-- 2. Which SAP materials are fuel
-- ---------------------------------------------------------------------------
--
-- The screen kept "12007590 is base oil, not fuel" in a Python set. It
-- belongs on the material master the platform already has.

ALTER TABLE fuel_material ADD COLUMN IF NOT EXISTS counts_as_fuel boolean
    NOT NULL DEFAULT true;

COMMENT ON COLUMN fuel_material.counts_as_fuel IS
    'Whether litres of this material count toward a plant''s fuel and its '
    'days of cover. Base oil sits in SAP''s fuel group and is stored in litres, '
    'but no engine burns it.';

UPDATE fuel_material SET sap_material = '12000004'
 WHERE code = 'HSD' AND sap_material IS NULL;

INSERT INTO fuel_material (code, label, sap_material, uom, counts_as_fuel, note)
SELECT * FROM (VALUES
    ('HSD-MINES', 'High Speed Diesel for Mines', '12002780', 'L', true,
     'A second SAP material number for the same diesel, used at the mine.'),
    ('BASE-OIL',  'Base Oil HSB 70N',            '12007590', 'L', false,
     'In SAP''s fuel group and stored in litres, but a lubricating base oil.')
) AS v(code, label, sap_material, uom, counts_as_fuel, note)
WHERE NOT EXISTS (SELECT 1 FROM fuel_material m WHERE m.sap_material = v.sap_material);


-- ---------------------------------------------------------------------------
-- 3. What each plant's tank can and cannot give
-- ---------------------------------------------------------------------------
--
-- DEAD STOCK. The mine's own diesel workbook subtracts a 2,000 L underground
-- minimum before it calls anything available: the pump cannot lift the last
-- of it. SAP holds no minimum for the mine at all, so a tank showing 1,636 L
-- reads as a day's diesel when in fact none of it can be drawn.
--
-- CAPACITY. The projection used to land a whole supply-agreement line on its
-- due date -- 3,28,452 L on 20 November -- into a tank that holds a fraction
-- of that. Where SAP carries a maximum stock (Sukinda 54,219, Balasore
-- 22,000) that is used; where it does not, this is.
--
-- ORDER. The mine first, then the plant that feeds it. It was a Python dict.

CREATE TABLE IF NOT EXISTS fuel_plant_setting (
    plant_id        bigint PRIMARY KEY REFERENCES plant(plant_id),
    display_order   smallint NOT NULL DEFAULT 100,
    is_shown        boolean  NOT NULL DEFAULT true,
    dead_stock_l    numeric(10,2) NOT NULL DEFAULT 0
                    CHECK (dead_stock_l >= 0),
    tank_capacity_l numeric(12,2)
                    CHECK (tank_capacity_l IS NULL OR tank_capacity_l > 0),
    note            text,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      text
);

COMMENT ON TABLE fuel_plant_setting IS
    'Per plant: whether it appears on the fuel screens and in what order, how '
    'much of its tank cannot be drawn, and how much the tank holds when SAP '
    'does not say.';
COMMENT ON COLUMN fuel_plant_setting.dead_stock_l IS
    'Litres the pump cannot lift. Days of cover are worked out from stock '
    'above this, not from the whole tank.';

INSERT INTO fuel_plant_setting (plant_id, display_order, dead_stock_l, note, updated_by)
SELECT p.plant_id, v.ord, v.dead, v.note, 'migration 113'
  FROM plant p
  JOIN (VALUES
    ('1200', 1, 2000.00,
     'The 2,000 L underground minimum from the mine''s Diesel_Stock_Monitoring '
     'workbook. SAP holds no minimum for this plant.'),
    ('1110', 2, 0.00, 'Feeds the mine by stock transfer in 18,000 L tankers.'),
    ('1100', 3, 0.00, NULL),
    ('1210', 4, 0.00, NULL)
  ) AS v(code, ord, dead, note) ON v.code = p.code
 WHERE NOT EXISTS (SELECT 1 FROM fuel_plant_setting s WHERE s.plant_id = p.plant_id);
