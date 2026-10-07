-- 075: litres per cubic metre, and the plan it is measured against.
--
-- WHY. The audit's observation on August 2026 is not about fuel at all:
--
--     planned  2.60 litres/Cum      actual  5.49 litres/Cum     +111 per cent
--     planned  Rs 274.51 /Cum       actual  Rs 770.84 /Cum
--     planned  67,735 Cum excavated actual  8,949 Cum
--     planned  Rs 185.94 lakh       actual  Rs 68.98 lakh
--
-- Diesel SPEND came in at 37 per cent of plan. Diesel per cubic metre came in
-- at 211 per cent of plan. Both are true at once, and reading only the second
-- says the machines got thirsty when what actually happened is that excavation
-- collapsed to 13 per cent of plan while the fuel that keeps a mine running --
-- dewatering, lighting, generators, the road -- carried on regardless.
--
-- A screen that shows 5.49 against 2.60 and stops there invites the wrong
-- conclusion and the wrong action. So this table holds the plan, and the
-- screen decomposes the variance into the part caused by output and the part
-- caused by consumption, which are different problems with different owners.
--
-- NOT HARD-CODED, for a reason that has already bitten. The tonnage factor
-- that converts ore from Mt to Cum lives in productivity_assumption
-- (ore_t_per_cum, 3.000) and the plan lives here, per month. The audit's own
-- ore figure is 5,709 Cum where 3.0 t/Cum gives 5,739 -- a 0.5 per cent
-- difference that comes entirely from that factor. Anyone reconciling this
-- screen against the slide needs to be able to see and change it.


CREATE TABLE IF NOT EXISTS fuel_plan (
    fuel_plan_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Always the first of the month. A plan is a monthly document.
    plan_month   date NOT NULL UNIQUE,

    -- What the business plan expected to move. Split the way the plan splits
    -- it, because "excavation was short" is not an answer -- short of ore,
    -- short of overburden and short of silt are three different failures.
    planned_silt_cum numeric(12,2),
    planned_ob_cum   numeric(12,2),
    planned_ore_cum  numeric(12,2),

    -- And what it expected that to cost in diesel.
    planned_l_per_cum  numeric(8,3),
    planned_rate_per_l numeric(8,2),
    planned_total_cost numeric(14,2),      -- rupees, not lakhs

    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,

    CONSTRAINT fuel_plan_month_start CHECK (EXTRACT(DAY FROM plan_month) = 1)
);

COMMENT ON TABLE fuel_plan IS
    'The business plan''s monthly diesel and excavation expectations, so the '
    'screen can show actual against plan and split the variance into the part '
    'caused by output and the part caused by consumption.';

COMMENT ON COLUMN fuel_plan.planned_total_cost IS
    'Rupees, not lakhs. The audit slide quotes lakhs and a figure stored in '
    'the unit it is displayed in is a figure that gets multiplied twice.';


-- ---------------------------------------------------------------------------
-- August 2026, exactly as the audit slide has it
-- ---------------------------------------------------------------------------
--
-- Seeded so the first thing the screen shows can be checked line by line
-- against the document it is replacing. Anything that disagrees is then a real
-- difference rather than a transcription error.

INSERT INTO fuel_plan (plan_month, planned_silt_cum, planned_ob_cum,
                       planned_ore_cum, planned_l_per_cum, planned_rate_per_l,
                       planned_total_cost, note, created_by)
SELECT DATE '2026-08-01', 12617.00, 45707.33, 9410.79, 2.600, 105.50,
       18594000.00,
       'The Aug-26 business plan as the audit slide quotes it: 67,735.12 Cum '
       'total excavation, Rs 185.94 lakh diesel, Rs 274.51 per Cum, 2.60 '
       'litres per Cum. Kept so this screen can be reconciled against that '
       'slide line by line.',
       'migration 075'
 WHERE NOT EXISTS (SELECT 1 FROM fuel_plan WHERE plan_month = DATE '2026-08-01');


-- ---------------------------------------------------------------------------
-- How ore is counted, and where the excavation figures come from
-- ---------------------------------------------------------------------------
--
-- Recorded here rather than left in a comment in the source, because the next
-- person to reconcile a per-Cum figure against a slide will need it.
--
--   mines_day_wise_excavation, in balcorpdb, with a Units column:
--     Variant 1  ore          mostly Mt, occasionally CuM
--     Variant 3  overburden   CuM
--     Variant 4  silt         CuM
--
-- Ore in Mt is divided by productivity_assumption.ore_t_per_cum to reach Cum.
-- August 2026 checks out: silt 84, OB 3,156, ore 16,947 Mt -> 5,649 Cum plus
-- 90 Cum booked directly = 8,979 against the slide's 8,949.

CREATE TABLE IF NOT EXISTS fuel_cost_note (
    note_key    text PRIMARY KEY,
    body        text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO fuel_cost_note (note_key, body)
SELECT 'excavation_source',
       'Excavation comes from mines_day_wise_excavation: Variant 1 is ore, 3 '
       'is overburden, 4 is silt, and the Units column says whether a row is '
       'Mt or CuM. Ore in Mt is converted at productivity_assumption.'
       'ore_t_per_cum. For August 2026 this gives 8,979 Cum against the audit '
       'slide''s 8,949 -- a 0.3 per cent difference arising entirely from that '
       'conversion factor.'
 WHERE NOT EXISTS (SELECT 1 FROM fuel_cost_note WHERE note_key = 'excavation_source');
