-- 025: every assessment has a number you can quote.
--
-- An assessment is one sitting that produces fifteen scores — overall, then the
-- fourteen understanding questions — and until now each score was a row with
-- nothing tying it to the others. So "the assessment on the 12th" could not be
-- named, cited in a training record, or pointed at in an appraisal: you could
-- only describe it.
--
-- ASM-2026-0001 belongs to the sitting, not to the score. Every row written by
-- the same person, on the same machine or class, on the same day, by the same
-- assessor and the same method, carries it. That is what makes a sitting one
-- thing: the same five facts anyone would use to say which assessment they
-- meant.

ALTER TABLE operator_record ADD COLUMN IF NOT EXISTS record_ref text;

-- The machine an assessment was about was living in the details blob, which is
-- the wrong place for something that has to be grouped and joined on. It gets a
-- column, and the blob keeps whatever is genuinely peculiar to one kind.
ALTER TABLE operator_record
    ADD COLUMN IF NOT EXISTS asset_id bigint REFERENCES asset (asset_id) ON DELETE SET NULL;

UPDATE operator_record
   SET asset_id = NULLIF(details ->> 'asset_id', '')::bigint
 WHERE asset_id IS NULL
   AND details ? 'asset_id'
   AND NULLIF(details ->> 'asset_id', '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS operator_record_ref_idx ON operator_record (record_ref);

CREATE OR REPLACE FUNCTION next_assessment_ref() RETURNS text AS $$
DECLARE
    yr   text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
    last integer;
BEGIN
    -- One past the highest ever issued, never a count of what survives: a
    -- reference that gets reused after a deletion is not a reference.
    SELECT COALESCE(MAX(NULLIF(regexp_replace(record_ref, '^ASM-\d{4}-', ''), '')::integer), 0)
      INTO last
      FROM operator_record
     WHERE record_ref LIKE 'ASM-' || yr || '-%';
    RETURN 'ASM-' || yr || '-' || lpad((last + 1)::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Assessments recorded before there were references are grouped the same way —
-- by operator, class, machine, date, assessor and method — so the history reads
-- consistently rather than having a gap where the older sittings are.
DO $$
DECLARE
    grp record;
    ref text;
BEGIN
    FOR grp IN
        SELECT operator_id, asset_type_id, asset_id, issued_on, issuer,
               COALESCE(details ->> 'assessment_type', '') AS method
          FROM operator_record
         WHERE record_type = 'ASSESSMENT' AND record_ref IS NULL
         GROUP BY operator_id, asset_type_id, asset_id, issued_on, issuer,
                  COALESCE(details ->> 'assessment_type', '')
         ORDER BY min(operator_record_id)
    LOOP
        ref := next_assessment_ref();
        UPDATE operator_record
           SET record_ref = ref
         WHERE record_type = 'ASSESSMENT'
           AND record_ref IS NULL
           AND operator_id = grp.operator_id
           AND asset_type_id IS NOT DISTINCT FROM grp.asset_type_id
           AND asset_id IS NOT DISTINCT FROM grp.asset_id
           AND issued_on IS NOT DISTINCT FROM grp.issued_on
           AND issuer IS NOT DISTINCT FROM grp.issuer
           AND COALESCE(details ->> 'assessment_type', '') = grp.method;
    END LOOP;
END $$;
