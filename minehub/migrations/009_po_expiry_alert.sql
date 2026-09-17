-- 009: a hired machine whose service PO has run out is an alert, not a note.
--
-- Work done after the PO lapses still happens — the machine is on site and the
-- operator is not told about paperwork — but it cannot be billed against
-- anything, so it surfaces weeks later as a dispute over an unbacked invoice.
-- Insurance and fitness already warn before they expire; the PO is the same
-- kind of date and belongs in the same list, which is also where the form says
-- it will appear.
--
-- Thirty days' notice matches the compliance default: long enough for a renewal
-- to move through purchase, short enough that it is still the current problem.

CREATE OR REPLACE VIEW asset_alert AS
SELECT a.asset_id,
       a.fleet_code,
       a.nickname,
       'COMPLIANCE'                                   AS alert_kind,
       c.document_type                                AS alert_type,
       c.valid_upto                                   AS due_on,
       (c.valid_upto - CURRENT_DATE)                  AS days_left,
       CASE WHEN c.valid_upto < CURRENT_DATE THEN 'EXPIRED'
            WHEN c.valid_upto <= CURRENT_DATE + COALESCE(c.reminder_days, 30) THEN 'DUE'
            ELSE 'OK' END                             AS severity
FROM asset a
JOIN asset_compliance c ON c.asset_id = a.asset_id
WHERE c.status = 'ACTIVE' AND c.valid_upto IS NOT NULL

UNION ALL

SELECT a.asset_id,
       a.fleet_code,
       a.nickname,
       'MAINTENANCE',
       m.name,
       m.next_due_on,
       (m.next_due_on - CURRENT_DATE),
       CASE WHEN m.next_due_on < CURRENT_DATE THEN 'EXPIRED'
            WHEN m.next_due_on <= CURRENT_DATE + 15 THEN 'DUE'
            ELSE 'OK' END
FROM asset a
JOIN asset_maintenance_schedule m ON m.asset_id = a.asset_id
WHERE m.status = 'ACTIVE' AND m.next_due_on IS NOT NULL

UNION ALL

-- Only for machines still in service: a released machine's expired PO is
-- history, and putting it on the alert list would train people to ignore the
-- list.
SELECT a.asset_id,
       a.fleet_code,
       a.nickname,
       'COMMERCIAL',
       'SERVICE_PO' || COALESCE(' ' || a.service_po_no, ''),
       a.po_valid_to,
       (a.po_valid_to - CURRENT_DATE),
       CASE WHEN a.po_valid_to < CURRENT_DATE THEN 'EXPIRED'
            WHEN a.po_valid_to <= CURRENT_DATE + 30 THEN 'DUE'
            ELSE 'OK' END
FROM asset a
WHERE a.po_valid_to IS NOT NULL
  AND COALESCE(a.status, 'ACTIVE') NOT IN ('RELEASED', 'DISPOSED', 'INACTIVE');
