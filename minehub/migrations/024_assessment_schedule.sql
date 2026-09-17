-- 024: when the next assessment is due, and who decides that.
--
-- An assessment that happens when someone remembers is not a cycle. What makes
-- it one is a due date the register calculates itself, from an interval the
-- mine sets rather than one I picked.
--
-- THE INTERVAL lives in two places. A mine-wide default, because most classes
-- want the same answer; and an override per equipment class, because a drill is
-- not a water tanker and the people who run them do not need watching at the
-- same rate. Both are settings, changed from the screen, not constants in code
-- that need a deployment to correct.
--
-- WHAT COUNTS AS DUE is also a setting. "Due" is a window before the date so
-- there is time to arrange the assessment; "overdue" is after it. A mine that
-- wants the date to be hard sets the window to zero.

CREATE TABLE IF NOT EXISTS platform_setting (
    key         text PRIMARY KEY,
    value       text NOT NULL,
    description text,
    updated_by  text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_setting (key, value, description, updated_by) VALUES
    ('assessment.interval_months', '6',
     'How often an operator is reassessed, unless the equipment class says otherwise',
     'migration'),
    ('assessment.due_window_days', '30',
     'How long before the due date an assessment starts showing as due',
     'migration'),
    ('assessment.backdate_limit_days', '30',
     'How far back an assessment may be dated. Stops a register being caught up months later',
     'migration')
ON CONFLICT (key) DO NOTHING;

-- Per class, where the mine wants a different rate. NULL means use the default.
ALTER TABLE asset_type ADD COLUMN IF NOT EXISTS assessment_interval_months int;

-- Who did it and when, on the current row, so the register can show it without
-- reading the whole history for every line.
ALTER TABLE operator_competency
    ADD COLUMN IF NOT EXISTS last_assessed_by text;

-- ─────────────────────────────────────────── the alert the cycle depends on

-- operator_alert already carried lapsed certificates and lapsed assessments.
-- An assessment that is merely *due* is the more useful warning — it is the one
-- there is still time to act on — so the view now reads next_assessment_due as
-- well as valid_upto, and uses the mine's own window rather than a fixed month.
CREATE OR REPLACE VIEW operator_alert AS
WITH s AS (
    SELECT COALESCE((SELECT value::int FROM platform_setting
                      WHERE key = 'assessment.due_window_days'), 30) AS window_days
)
SELECT o.operator_id,
       o.operator_ref,
       p.display_name                                  AS operator_name,
       CASE WHEN r.record_type IN ('LICENCE', 'MEDICAL', 'CERTIFICATE', 'AUTHORISATION')
            THEN 'STATUTORY' ELSE 'TRAINING' END       AS alert_kind,
       r.record_type || COALESCE(' · ' || r.title, '') AS alert_type,
       COALESCE(r.valid_upto, r.refresher_due)         AS due_on,
       (COALESCE(r.valid_upto, r.refresher_due) - CURRENT_DATE) AS days_left,
       CASE WHEN COALESCE(r.valid_upto, r.refresher_due) < CURRENT_DATE THEN 'EXPIRED'
            WHEN COALESCE(r.valid_upto, r.refresher_due) <= CURRENT_DATE + 30 THEN 'DUE'
            ELSE 'OK' END                              AS severity
FROM operator o
JOIN party p ON p.party_id = o.party_id
JOIN operator_record r ON r.operator_id = o.operator_id
WHERE r.status = 'ACTIVE'
  AND r.record_type <> 'ASSESSMENT'          -- assessments have their own row below
  AND o.profile_status = 'ACTIVE'
  AND COALESCE(r.valid_upto, r.refresher_due) IS NOT NULL

UNION ALL

SELECT o.operator_id, o.operator_ref, p.display_name,
       'COMPETENCY',
       'Reassessment · ' || COALESCE(t.name, 'equipment')
                         || COALESCE(' · ' || a.fleet_code, ''),
       COALESCE(c.next_assessment_due, c.valid_upto),
       (COALESCE(c.next_assessment_due, c.valid_upto) - CURRENT_DATE),
       CASE WHEN COALESCE(c.next_assessment_due, c.valid_upto) < CURRENT_DATE THEN 'EXPIRED'
            WHEN COALESCE(c.next_assessment_due, c.valid_upto)
                 <= CURRENT_DATE + (SELECT window_days FROM s) THEN 'DUE'
            ELSE 'OK' END
FROM operator o
JOIN party p ON p.party_id = o.party_id
JOIN operator_competency c ON c.operator_id = o.operator_id
LEFT JOIN asset_type t ON t.asset_type_id = c.asset_type_id
LEFT JOIN asset a       ON a.asset_id = c.asset_id
WHERE c.status = 'ACTIVE'
  AND o.profile_status = 'ACTIVE'
  AND c.dimension = 'OVERALL'
  AND COALESCE(c.next_assessment_due, c.valid_upto) IS NOT NULL;

-- ──────────────────────────────────────── backfill what is already recorded

-- Rows assessed before there was a schedule get one, counted from the day they
-- were assessed, so the cycle starts from the truth rather than from today.
UPDATE operator_competency c
   SET next_assessment_due = (c.assessed_on + make_interval(months =>
        COALESCE((SELECT t.assessment_interval_months FROM asset_type t
                   WHERE t.asset_type_id = c.asset_type_id),
                 (SELECT value::int FROM platform_setting
                   WHERE key = 'assessment.interval_months'),
                 6)))::date
 WHERE c.next_assessment_due IS NULL
   AND c.assessed_on IS NOT NULL
   AND c.dimension = 'OVERALL';
