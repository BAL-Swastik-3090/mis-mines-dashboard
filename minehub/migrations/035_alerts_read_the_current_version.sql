-- 035: a renewed certificate must stop raising an alert.
--
-- Migration 033 made asset_compliance hold versions: the current row plus the
-- ones it replaced. asset_alert was written before that existed and filters on
-- status = ACTIVE, which superseded rows still are — deliberately, because
-- status says whether the document was valid and last year's policy was
-- perfectly valid last year.
--
-- So every renewal would have left its predecessor raising EXPIRED forever,
-- and the alerts screen would fill with certificates that were replaced months
-- ago. The alert has to read the version in force, which is what
-- superseded_at IS NULL means.
--
-- Found by asking what else reads asset_compliance after changing its shape.

CREATE OR REPLACE VIEW asset_alert AS
 SELECT a.asset_id,
    a.fleet_code,
    a.nickname,
    'COMPLIANCE'::text AS alert_kind,
    c.document_type AS alert_type,
    c.valid_upto AS due_on,
    c.valid_upto - CURRENT_DATE AS days_left,
        CASE
            WHEN c.valid_upto < CURRENT_DATE THEN 'EXPIRED'::text
            WHEN c.valid_upto <= (CURRENT_DATE + COALESCE(c.reminder_days::integer, 30)) THEN 'DUE'::text
            ELSE 'OK'::text
        END AS severity
   FROM asset a
     JOIN asset_compliance c ON c.asset_id = a.asset_id
  WHERE c.status = 'ACTIVE'::text AND c.superseded_at IS NULL AND c.valid_upto IS NOT NULL
UNION ALL
 SELECT a.asset_id,
    a.fleet_code,
    a.nickname,
    'MAINTENANCE'::text AS alert_kind,
    m.name AS alert_type,
    m.next_due_on AS due_on,
    m.next_due_on - CURRENT_DATE AS days_left,
        CASE
            WHEN m.next_due_on < CURRENT_DATE THEN 'EXPIRED'::text
            WHEN m.next_due_on <= (CURRENT_DATE + 15) THEN 'DUE'::text
            ELSE 'OK'::text
        END AS severity
   FROM asset a
     JOIN asset_maintenance_schedule m ON m.asset_id = a.asset_id
  WHERE m.status = 'ACTIVE'::text AND m.next_due_on IS NOT NULL
UNION ALL
 SELECT a.asset_id,
    a.fleet_code,
    a.nickname,
    'COMMERCIAL'::text AS alert_kind,
    'SERVICE_PO'::text || COALESCE(' '::text || a.service_po_no, ''::text) AS alert_type,
    a.po_valid_to AS due_on,
    a.po_valid_to - CURRENT_DATE AS days_left,
        CASE
            WHEN a.po_valid_to < CURRENT_DATE THEN 'EXPIRED'::text
            WHEN a.po_valid_to <= (CURRENT_DATE + 30) THEN 'DUE'::text
            ELSE 'OK'::text
        END AS severity
   FROM asset a
  WHERE a.po_valid_to IS NOT NULL AND (COALESCE(a.status, 'ACTIVE'::text) <> ALL (ARRAY['RELEASED'::text, 'DISPOSED'::text, 'INACTIVE'::text]));;
