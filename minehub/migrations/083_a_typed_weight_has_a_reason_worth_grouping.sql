-- 083: the reason a weight was typed becomes a value, not a sentence.
--
-- "Why not from the bridge?" is a required free-text box on the manual-weight
-- dialog, and a required free-text box is how a register quietly becomes
-- unusable -- the same lesson migration 006 was written for. The reasons are
-- a short, repeating list: the indicator failed, the power went, the lorry was
-- weighed somewhere else. Typed by hand they arrive as "Interet is not
-- working", "internet down", "No internet" and "NET ISSUE", which is four
-- reasons to a database and one to anybody standing at the bridge.
--
-- That matters here more than in most places, because this field exists to be
-- READ BACK. It is kept with the figure and shown to management precisely so
-- somebody can ask "how often is the indicator failing?" -- a question no
-- report can answer across four spellings of the same fault.
--
-- WHICH IS WHY THIS IS A SEED, NOT A CONSTRAINT. The list below is what the
-- screen's own hint already suggested plus the one an operator actually typed
-- this morning. Nothing is closed: the field is a Combobox over this category
-- and POST /minehub/lookups refuses nothing, so a reason nobody anticipated is
-- one click to add and is there for the next person. The aim is that picking
-- beats retyping, not that typing is blocked.

SET search_path TO minehub, public;

INSERT INTO lookup (category, value, is_system, created_by)
SELECT v.category, v.value, true, 'MIGRATION_083'
FROM (VALUES
    -- The three the dialog's own hint named.
    ('WB_MANUAL_REASON', 'Indicator not working'),
    ('WB_MANUAL_REASON', 'Power cut'),
    ('WB_MANUAL_REASON', 'Weighed elsewhere'),

    -- Typed by hand at the bridge on 9 October, which is the whole argument
    -- for this migration existing.
    ('WB_MANUAL_REASON', 'Internet not working'),

    -- The rest of what stops a bridge: each of these is a different fix, so
    -- they are separate values rather than one "bridge down".
    ('WB_MANUAL_REASON', 'Weighbridge under maintenance'),
    ('WB_MANUAL_REASON', 'Display or printer fault'),
    ('WB_MANUAL_REASON', 'Reading would not settle'),
    ('WB_MANUAL_REASON', 'Weighbridge agent not running')
) AS v(category, value)
WHERE NOT EXISTS (
    SELECT 1 FROM lookup l
     WHERE l.category = v.category AND lower(l.value) = lower(v.value)
);

COMMENT ON TABLE lookup IS
    'Every repeated free-text value. Users add to it inline; nothing is rejected, but picking beats retyping.';
