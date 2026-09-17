-- ============================================================================
-- MineHub · Migration 008 · The commercial reference differs by ownership
-- ============================================================================
-- A machine's commercial identity is not one field.
--
--   Owned    it is an asset in SAP, and carries an equipment number
--   Hired    it belongs to a contract, and is worked against a service PO
--
-- Holding both in sap_asset_no would mean a column whose meaning changes row by
-- row, which nothing downstream can read safely: contractor billing needs the
-- PO, fixed-asset reporting needs the equipment number, and neither can tell
-- which it is looking at.
-- ============================================================================

SET search_path TO minehub, public;

ALTER TABLE asset
    -- Owned: what SAP calls this machine.
    ADD COLUMN IF NOT EXISTS sap_equipment_no text,
    -- Hired: the contract it is engaged under, and the PO work is booked to.
    ADD COLUMN IF NOT EXISTS contract_no      text,
    ADD COLUMN IF NOT EXISTS service_po_no    text,
    ADD COLUMN IF NOT EXISTS po_valid_from    date,
    ADD COLUMN IF NOT EXISTS po_valid_to      date;

COMMENT ON COLUMN asset.sap_equipment_no IS
    'SAP equipment number. Owned machines only.';
COMMENT ON COLUMN asset.service_po_no IS
    'Service PO the hired machine is worked against. Contractor billing reads this.';

-- sap_asset_no was carrying the equipment number before the distinction
-- existed. Move it rather than leave two columns meaning the same thing.
UPDATE asset
   SET sap_equipment_no = sap_asset_no
 WHERE sap_asset_no IS NOT NULL
   AND btrim(sap_asset_no) <> ''
   AND sap_equipment_no IS NULL;

-- Suggestion lists for both, so the same PO is not typed three ways.
INSERT INTO lookup (category, value, is_system, created_by)
SELECT DISTINCT 'SAP_EQUIPMENT', a.sap_equipment_no, false, 'MIGRATION_008'
FROM asset a
WHERE a.sap_equipment_no IS NOT NULL AND btrim(a.sap_equipment_no) <> ''
  AND NOT EXISTS (SELECT 1 FROM lookup l
                  WHERE l.category = 'SAP_EQUIPMENT' AND l.value = a.sap_equipment_no);

INSERT INTO lookup (category, value, is_system, created_by)
SELECT DISTINCT 'SERVICE_PO', a.service_po_no, false, 'MIGRATION_008'
FROM asset a
WHERE a.service_po_no IS NOT NULL AND btrim(a.service_po_no) <> ''
  AND NOT EXISTS (SELECT 1 FROM lookup l
                  WHERE l.category = 'SERVICE_PO' AND l.value = a.service_po_no);

INSERT INTO schema_migration (migration_id, description)
VALUES ('008_asset_commercial_ref',
        'SAP equipment number for owned machines; contract and service PO for hired')
ON CONFLICT (migration_id) DO NOTHING;
