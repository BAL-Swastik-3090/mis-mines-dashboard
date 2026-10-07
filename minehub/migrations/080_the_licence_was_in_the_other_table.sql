-- 080: 130 drivers had a licence the weighbridge could not see.
--
-- weighable_driver reads the licence from operator_record, where 30 operators
-- have one. party_identity holds a DRIVING_LICENCE for 130 more, and the view
-- never looked there. So the weighbridge told the operator "no licence on
-- file" about men whose licence number the register was holding all along,
-- and migration 073's alert counted them as missing for the same reason --
-- 141 of them, which is most of the noise on that panel.
--
-- Both are legitimate places for it. operator_record is the document, with an
-- issue and an expiry and a verification state behind it. party_identity is
-- the number, as the HR import supplied it. The document wins where it exists
-- because only it can expire; the number stands in where it does not, because
-- a number with no expiry is still an identification.
--
-- AND THE EMPLOYEE NUMBER. The driver list showed OPR-2026-0152, which is a
-- key this platform minted for its own use -- it appears on no card, no
-- muster and no gate register, and nobody at the bridge has ever seen it.
-- party_identity carries the number the mine actually uses, for 211 of 244
-- operators. That is what goes on the row.

CREATE OR REPLACE VIEW weighable_driver AS
 SELECT 'OPERATOR'::text AS kind,
    o.operator_id,
    NULL::bigint AS visiting_driver_id,
    p.legal_name AS full_name,
    o.operator_ref AS reference,
    COALESCE(lic.document_no, ident.external_code) AS licence_no,
    upper(regexp_replace(COALESCE(lic.document_no, ident.external_code, ''::text),
                         '[^A-Za-z0-9]'::text, ''::text, 'g'::text)) AS licence_normalised,
    lic.valid_upto AS licence_valid_upto,
    p.phone,
    emp.legal_name AS employer,
    o.designation,
    p.status,
    NULL::integer AS visits,
    p.father_name,
    p.date_of_birth,
    -- Appended, not inserted: CREATE OR REPLACE VIEW may only add columns at
    -- the end, and moving an existing one renames every column after it.
    CASE WHEN lic.document_no IS NOT NULL THEN 'RECORD'
         WHEN ident.external_code IS NOT NULL THEN 'IDENTITY'
    END AS licence_source,
    empid.external_code AS emp_id
   FROM operator o
     JOIN party p ON p.party_id = o.party_id
     LEFT JOIN party emp ON emp.party_id = o.employer_party_id
     LEFT JOIN LATERAL ( SELECT r.document_no, r.valid_upto
           FROM operator_record r
          WHERE r.operator_id = o.operator_id AND r.record_type = 'LICENCE'::text
            AND r.status <> 'INACTIVE'::text
          ORDER BY r.valid_upto DESC NULLS LAST
         LIMIT 1) lic ON true
     LEFT JOIN LATERAL ( SELECT i.external_code
           FROM party_identity i
          WHERE i.party_id = p.party_id AND i.system = 'DRIVING_LICENCE'
          ORDER BY i.party_identity_id
         LIMIT 1) ident ON true
     LEFT JOIN LATERAL ( SELECT i.external_code
           FROM party_identity i
          WHERE i.party_id = p.party_id AND i.system = 'CONTRACTOR'
          ORDER BY i.party_identity_id
         LIMIT 1) empid ON true
UNION ALL
 SELECT 'VISITOR'::text AS kind,
    NULL::bigint AS operator_id,
    d.visiting_driver_id,
    d.full_name,
    NULL::text AS reference,
    d.licence_no,
    d.licence_normalised,
    d.licence_valid_upto,
    d.phone,
    COALESCE(p.display_name, d.employer_name_text) AS employer,
    NULL::text AS designation,
    d.status,
    d.visits,
    NULL::text AS father_name,
    NULL::date AS date_of_birth,
    CASE WHEN d.licence_no IS NOT NULL THEN 'RECORD' END AS licence_source,
    NULL::text AS emp_id
   FROM visiting_driver d
     LEFT JOIN party p ON p.party_id = d.transporter_party_id;


-- ---------------------------------------------------------------------------
-- The alert follows the same rule
-- ---------------------------------------------------------------------------
--
-- 073 asked operator_record whether a driver had a licence and raised an
-- alert for everybody it could not find one for. It found 141 -- and 130 of
-- those were men whose licence number sits in party_identity. An alert panel
-- that is mostly wrong is a panel people stop reading, which costs more than
-- the four genuinely expired licences it was built to surface.

CREATE OR REPLACE VIEW operator_alert AS
 WITH s AS (
         SELECT COALESCE(( SELECT platform_setting.value::integer AS value
                   FROM platform_setting
                  WHERE platform_setting.key = 'assessment.due_window_days'::text), 30) AS window_days
        )
 SELECT o.operator_id, o.operator_ref, p.display_name AS operator_name,
        CASE WHEN r.record_type = ANY (ARRAY['LICENCE'::text, 'MEDICAL'::text, 'CERTIFICATE'::text, 'AUTHORISATION'::text])
             THEN 'STATUTORY'::text ELSE 'TRAINING'::text END AS alert_kind,
    r.record_type || COALESCE(' · '::text || r.title, ''::text) AS alert_type,
    COALESCE(r.valid_upto, r.refresher_due) AS due_on,
    COALESCE(r.valid_upto, r.refresher_due) - CURRENT_DATE AS days_left,
        CASE WHEN COALESCE(r.valid_upto, r.refresher_due) < CURRENT_DATE THEN 'EXPIRED'::text
             WHEN COALESCE(r.valid_upto, r.refresher_due) <= (CURRENT_DATE + 30) THEN 'DUE'::text
             ELSE 'OK'::text END AS severity
   FROM operator o
     JOIN party p ON p.party_id = o.party_id
     JOIN operator_record r ON r.operator_id = o.operator_id
  WHERE r.status = 'ACTIVE'::text AND r.record_type <> 'ASSESSMENT'::text
    AND o.profile_status = 'ACTIVE'::text
    AND COALESCE(r.valid_upto, r.refresher_due) IS NOT NULL
UNION ALL
 SELECT o.operator_id, o.operator_ref, p.display_name AS operator_name,
    'COMPETENCY'::text AS alert_kind,
    ('Reassessment · '::text || COALESCE(t.name, 'equipment'::text)) || COALESCE(' · '::text || a.fleet_code, ''::text) AS alert_type,
    COALESCE(c.next_assessment_due, c.valid_upto) AS due_on,
    COALESCE(c.next_assessment_due, c.valid_upto) - CURRENT_DATE AS days_left,
        CASE WHEN COALESCE(c.next_assessment_due, c.valid_upto) < CURRENT_DATE THEN 'EXPIRED'::text
             WHEN COALESCE(c.next_assessment_due, c.valid_upto) <= (CURRENT_DATE + ((SELECT s.window_days FROM s))) THEN 'DUE'::text
             ELSE 'OK'::text END AS severity
   FROM operator o
     JOIN party p ON p.party_id = o.party_id
     JOIN operator_competency c ON c.operator_id = o.operator_id
     LEFT JOIN asset_type t ON t.asset_type_id = c.asset_type_id
     LEFT JOIN asset a ON a.asset_id = c.asset_id
  WHERE c.status = 'ACTIVE'::text AND o.profile_status = 'ACTIVE'::text
    AND c.dimension = 'OVERALL'::text
    AND COALESCE(c.next_assessment_due, c.valid_upto) IS NOT NULL
UNION ALL
 SELECT o.operator_id, o.operator_ref, p.display_name AS operator_name,
    'STATUTORY'::text AS alert_kind,
    'LICENCE · not recorded'::text AS alert_type,
    NULL::date AS due_on, NULL::integer AS days_left, 'EXPIRED'::text AS severity
   FROM operator o
     JOIN party p ON p.party_id = o.party_id
  WHERE o.profile_status = 'ACTIVE'::text
    AND (strpos(upper(o.designation), 'DRIVER') > 0
      OR strpos(upper(o.designation), 'OPERATOR') > 0)
    AND NOT EXISTS (SELECT 1 FROM operator_record r
                     WHERE r.operator_id = o.operator_id
                       AND r.record_type = 'LICENCE' AND r.status = 'ACTIVE')
    AND NOT EXISTS (SELECT 1 FROM party_identity i
                     WHERE i.party_id = o.party_id
                       AND i.system = 'DRIVING_LICENCE'
                       AND COALESCE(TRIM(i.external_code), '') <> '');
