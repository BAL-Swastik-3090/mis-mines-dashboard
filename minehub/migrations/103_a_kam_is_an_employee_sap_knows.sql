-- 103: a KAM becomes a person SAP knows, not a name somebody typed.
--
-- WHAT WAS WRONG. lcm_kam_master held eight free-text names, typed by hand
-- when the loss heads were moved out of Python in migration 101. emp_id was
-- there and empty -- it is what stalled this table in August 2026 -- so there
-- was nothing tying "Amarendra Sarangi" to an employee. Two consequences:
-- nobody could be added without a deployment, and a name could be entered
-- twice in two spellings and own two different loss heads as two people.
--
-- Checked against sap_odata_api.sap_employee_details on 10 November 2026:
-- of the eight names stored, three match an active employee exactly and five
-- do not, because they were typed as the mine says them rather than as SAP
-- holds them -- "Rana Vikash Singh" against RANA VIKASH KUMAR SINGH,
-- "Bijan Kr Chand" against BIJAN KUMAR CHAND. That is precisely the failure
-- an employee id prevents.
--
-- WHAT THIS DOES NOT DO: fill those ids in. Four of the five have a strong
-- candidate and one has none, and deciding which human being owns a loss
-- head is the mine's call, not a migration's -- a wrong guess here puts real
-- money against the wrong person's name in an accountability report. The
-- screen now lets them be picked, one at a time, against SAP.
--
-- BOTH SCHEMAS ARE IN corpappdb, so the KAM list reads the employee's
-- designation and department live rather than copying them. A copied
-- designation is wrong from the first promotion and nothing says so.

SET LOCAL search_path = minehub, public;


-- ---------------------------------------------------------------------------
-- 1. ONE ROW PER PERSON
-- ---------------------------------------------------------------------------
-- NULLs do not collide in a Postgres unique index, so the eight rows that
-- have no id yet are unaffected and can be filled in one at a time. What it
-- stops is the same employee being added twice under two spellings and then
-- owning loss heads as two different people -- which, with free-text names
-- and a growing list, is a matter of time rather than of carelessness.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'lcm_kam_master_emp_id_key'
                     AND conrelid = 'lcm_kam_master'::regclass) THEN
        ALTER TABLE lcm_kam_master
            ADD CONSTRAINT lcm_kam_master_emp_id_key UNIQUE (emp_id);
    END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 2. WHO ADDED WHOM, AND WHEN
-- ---------------------------------------------------------------------------
-- The master is a LIST, not a dated decision, so it carries no
-- effective_from: a person is on the roll or is not. What IS dated is which
-- loss head they own, and that already lives in lcm_loss_head_setting with
-- its own history. These two columns answer the only question this table is
-- asked -- where did this name come from -- without inventing a second
-- history table for a list of eight people.

ALTER TABLE lcm_kam_master
    ADD COLUMN IF NOT EXISTS entry_id   varchar(32),
    ADD COLUMN IF NOT EXISTS entry_date timestamptz NOT NULL DEFAULT now();

UPDATE lcm_kam_master SET entry_id = 'SEED-101' WHERE entry_id IS NULL;

COMMENT ON COLUMN lcm_kam_master.kam_name IS
    'The display name, and the key the dated loss-head settings point at. It '
    'stays stable once a head has been assigned -- correcting a spelling '
    'cascades through them, replacing it would orphan them.';

COMMENT ON COLUMN lcm_kam_master.emp_id IS
    'sap_employee_details.empid. Nullable: the eight seeded names predate it '
    'and are filled in from the LCM KAM Selector one at a time. Designation '
    'and department are NOT copied here -- they are read live from SAP, '
    'because a copied designation is wrong from the first promotion.';
