-- 034: the list of statutory documents is the mine's, not this file's.
--
-- document_type was a CHECK constraint holding ten values, the last of which
-- was OTHER. "Other" is what a list says when it has stopped trying: a mining
-- lease certificate, a hydra crane licence, a state border permit all become
-- "Other", and then nothing can count them, alert on them or tell them apart.
--
-- The same argument as departments, leave types and equipment classes, each of
-- which stopped being a fixed list for the same reason. A register whose
-- vocabulary is fixed in a migration is a register that quietly stops
-- describing the mine about six months in.
--
-- So the constraint comes off and the values move to the lookup table, where
-- every other open vocabulary already lives — searchable, addable from the
-- field that uses it, and counted by usage so the common ones rise.
--
-- WHAT IS STILL ENFORCED. Not nothing: the value must be a non-empty upper-case
-- token. What is refused is a free-text sentence in a column that reports group
-- by, which is the actual failure mode — "Insurance (renewed Feb)" and
-- "insurance" becoming two kinds of document.

ALTER TABLE asset_compliance DROP CONSTRAINT IF EXISTS asset_compliance_document_type_check;

ALTER TABLE asset_compliance ADD CONSTRAINT asset_compliance_document_type_check
    CHECK (document_type = upper(btrim(document_type))
           AND length(btrim(document_type)) BETWEEN 2 AND 40
           AND document_type !~ '\s\s');

-- The ten that were in the constraint become the starting vocabulary. Marked
-- is_system so they sort first and cannot be deleted out from under existing
-- rows, but they are no longer the only possibilities.
INSERT INTO lookup (category, value, is_system, created_by)
SELECT 'DOCUMENT_TYPE', v, TRUE, 'migration'
FROM (VALUES
    ('INSURANCE'), ('FITNESS'), ('PUC'), ('ROAD_TAX'), ('PERMIT'),
    ('NATIONAL_PERMIT'), ('STATUTORY_INSPECTION'), ('EXPLOSIVE_LICENCE'),
    ('POLLUTION_NOC')
) AS seed(v)
WHERE NOT EXISTS (
    SELECT 1 FROM lookup l WHERE l.category = 'DOCUMENT_TYPE' AND l.value = seed.v
);

-- OTHER is deliberately not seeded. It was the escape hatch that made the list
-- look sufficient while the real answers went unrecorded; with the list open
-- there is nothing left for it to mean. Rows already carrying it keep it —
-- rewriting somebody's data to prove a point would be worse than the word.

-- Anything already on file that the seed missed becomes part of the vocabulary
-- too, so the list reflects what the mine actually has rather than what this
-- migration guessed.
INSERT INTO lookup (category, value, is_system, created_by)
SELECT DISTINCT 'DOCUMENT_TYPE', c.document_type, FALSE, 'migration'
FROM asset_compliance c
WHERE c.document_type IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM lookup l
     WHERE l.category = 'DOCUMENT_TYPE' AND l.value = c.document_type);

-- How often each is used, so the field offers the ones this mine really keeps
-- rather than alphabetical order.
UPDATE lookup l
   SET usage_count = COALESCE((SELECT count(*) FROM asset_compliance c
                                WHERE c.document_type = l.value), 0)
 WHERE l.category = 'DOCUMENT_TYPE';
