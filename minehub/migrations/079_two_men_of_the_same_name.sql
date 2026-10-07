-- 079: the driver list could not tell two men of the same name apart.
--
-- Five people, two names. Three Khageswar Mohantas and two Narayan Mohantas,
-- and the weighbridge offered them as identical rows -- same name, same
-- employer, same designation. The operator picked one and a load went against
-- a man who may not have been driving.
--
-- WHAT WOULD SETTLE IT. Not the licence: none of those five has one on file,
-- which is the usual way of it -- the detail that would decide the question is
-- missing for exactly the people who raise it. What they do have is a father's
-- name, different in all five cases, and a date of birth, also different.
--
--     Khageswar Mohanta   PABITRA MOHANTA    1978-04-10
--     Khageswar Mohanta   SAHARAI MOHANTA    1982-04-13
--     Khageswar Mohanta   MAKURU MOHANTA     1978-01-01
--     Narayan Mohanta     PRAFULLA KUMAR...  1981-07-10
--     Narayan Mohanta     GHANASHYAM...      1981-03-07
--
-- Both are already on the party record and neither reached this view, so the
-- screen had nothing to show even though the register knew.
--
-- A father's name is how this is done on paper here -- a gate register, a
-- muster roll and a licence all carry it for exactly this reason. Date of
-- birth is the backstop: 476 of 485 people have one, against 234 with a
-- father's name.

CREATE OR REPLACE VIEW weighable_driver AS
 SELECT 'OPERATOR'::text AS kind,
    o.operator_id,
    NULL::bigint AS visiting_driver_id,
    p.legal_name AS full_name,
    o.operator_ref AS reference,
    lic.document_no AS licence_no,
    upper(regexp_replace(COALESCE(lic.document_no, ''::text), '[^A-Za-z0-9]'::text, ''::text, 'g'::text)) AS licence_normalised,
    lic.valid_upto AS licence_valid_upto,
    p.phone,
    emp.legal_name AS employer,
    o.designation,
    p.status,
    NULL::integer AS visits,
    p.father_name,
    p.date_of_birth
   FROM operator o
     JOIN party p ON p.party_id = o.party_id
     LEFT JOIN party emp ON emp.party_id = o.employer_party_id
     LEFT JOIN LATERAL ( SELECT r.document_no,
            r.valid_upto
           FROM operator_record r
          WHERE r.operator_id = o.operator_id AND r.record_type = 'LICENCE'::text AND r.status <> 'INACTIVE'::text
          ORDER BY r.valid_upto DESC NULLS LAST
         LIMIT 1) lic ON true
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
    -- A visiting driver is recorded against his licence and nothing else. He
    -- is already told apart by that, which is why it is the one field his
    -- record requires.
    NULL::text AS father_name,
    NULL::date AS date_of_birth
   FROM visiting_driver d
     LEFT JOIN party p ON p.party_id = d.transporter_party_id;

COMMENT ON VIEW weighable_driver IS
    'Everyone who may be named against a load: the operator register and the '
    'one-time visiting drivers. Carries father_name and date_of_birth because '
    'five people on it share two names, and the licence that would otherwise '
    'settle it is missing for all five.';
