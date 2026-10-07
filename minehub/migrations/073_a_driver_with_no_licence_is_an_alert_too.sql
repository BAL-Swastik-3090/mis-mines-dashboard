-- 073: the licence that was never recorded raises nothing.
--
-- operator_alert reports a statutory document that has expired or is about to,
-- by reading operator_record and comparing valid_upto to today. It can only
-- report on a record that EXISTS. A driver with no licence row at all is
-- therefore silent -- the quietest possible failure, and the one that matters
-- most: an expired licence is at least visible as a date, while a missing one
-- looks exactly like a driver whose paperwork is in order.
--
-- Patra Carriers' manpower sheet has two tipper drivers with no licence
-- number, no class and no expiry. Both are working. Loading them without this
-- would put them on the register looking no different from anyone else.
--
-- SO THERE IS A THIRD ARM. Anybody whose designation says they drive or
-- operate, who is active, and who has no active LICENCE record.
--
-- Helpers, fitters and the rest are not included: a maintenance helper with no
-- driving licence is not a finding, and an alert that fires on people who
-- were never expected to hold one is an alert everybody learns to ignore.
--
-- due_on and days_left are NULL, because there is no date -- inventing one to
-- make the row sort would be inventing the very fact that is missing. The
-- screen already renders a null date as "no date". The severity is EXPIRED so
-- it is counted and coloured with the others rather than introducing a fourth
-- value the interface has no style for; what it actually is, the row says in
-- words.

CREATE OR REPLACE VIEW operator_alert AS
 WITH s AS (
         SELECT COALESCE(( SELECT platform_setting.value::integer AS value
                   FROM platform_setting
                  WHERE platform_setting.key = 'assessment.due_window_days'::text), 30) AS window_days
        )
 SELECT o.operator_id,
    o.operator_ref,
    p.display_name AS operator_name,
        CASE
            WHEN r.record_type = ANY (ARRAY['LICENCE'::text, 'MEDICAL'::text, 'CERTIFICATE'::text, 'AUTHORISATION'::text]) THEN 'STATUTORY'::text
            ELSE 'TRAINING'::text
        END AS alert_kind,
    r.record_type || COALESCE(' · '::text || r.title, ''::text) AS alert_type,
    COALESCE(r.valid_upto, r.refresher_due) AS due_on,
    COALESCE(r.valid_upto, r.refresher_due) - CURRENT_DATE AS days_left,
        CASE
            WHEN COALESCE(r.valid_upto, r.refresher_due) < CURRENT_DATE THEN 'EXPIRED'::text
            WHEN COALESCE(r.valid_upto, r.refresher_due) <= (CURRENT_DATE + 30) THEN 'DUE'::text
            ELSE 'OK'::text
        END AS severity
   FROM operator o
     JOIN party p ON p.party_id = o.party_id
     JOIN operator_record r ON r.operator_id = o.operator_id
  WHERE r.status = 'ACTIVE'::text AND r.record_type <> 'ASSESSMENT'::text AND o.profile_status = 'ACTIVE'::text AND COALESCE(r.valid_upto, r.refresher_due) IS NOT NULL

UNION ALL

 SELECT o.operator_id,
    o.operator_ref,
    p.display_name AS operator_name,
    'COMPETENCY'::text AS alert_kind,
    ('Reassessment · '::text || COALESCE(t.name, 'equipment'::text)) || COALESCE(' · '::text || a.fleet_code, ''::text) AS alert_type,
    COALESCE(c.next_assessment_due, c.valid_upto) AS due_on,
    COALESCE(c.next_assessment_due, c.valid_upto) - CURRENT_DATE AS days_left,
        CASE
            WHEN COALESCE(c.next_assessment_due, c.valid_upto) < CURRENT_DATE THEN 'EXPIRED'::text
            WHEN COALESCE(c.next_assessment_due, c.valid_upto) <= (CURRENT_DATE + (( SELECT s.window_days
               FROM s))) THEN 'DUE'::text
            ELSE 'OK'::text
        END AS severity
   FROM operator o
     JOIN party p ON p.party_id = o.party_id
     JOIN operator_competency c ON c.operator_id = o.operator_id
     LEFT JOIN asset_type t ON t.asset_type_id = c.asset_type_id
     LEFT JOIN asset a ON a.asset_id = c.asset_id
  WHERE c.status = 'ACTIVE'::text AND o.profile_status = 'ACTIVE'::text AND c.dimension = 'OVERALL'::text AND COALESCE(c.next_assessment_due, c.valid_upto) IS NOT NULL

UNION ALL

-- Drives or operates, and has no licence on file at all.
 SELECT o.operator_id,
    o.operator_ref,
    p.display_name AS operator_name,
    'STATUTORY'::text AS alert_kind,
    'LICENCE · not recorded'::text AS alert_type,
    NULL::date AS due_on,
    NULL::integer AS days_left,
    'EXPIRED'::text AS severity
   FROM operator o
     JOIN party p ON p.party_id = o.party_id
  WHERE o.profile_status = 'ACTIVE'::text
    -- strpos rather than a wildcard LIKE: a per cent sign anywhere in the
    -- of a statement is a parameter placeholder to the driver, and the
    -- migration is refused before Postgres ever sees it.
    AND (strpos(upper(o.designation), 'DRIVER') > 0
      OR strpos(upper(o.designation), 'OPERATOR') > 0)
    AND NOT EXISTS (
        SELECT 1 FROM operator_record r
         WHERE r.operator_id = o.operator_id
           AND r.record_type = 'LICENCE'
           AND r.status = 'ACTIVE');

COMMENT ON VIEW operator_alert IS
    'Statutory documents expiring, competency reassessments falling due, and '
    'anybody who drives or operates with no licence on file. The third case '
    'has no date by definition: a missing record cannot expire, and inventing '
    'a date for it would invent the fact that is missing.';
