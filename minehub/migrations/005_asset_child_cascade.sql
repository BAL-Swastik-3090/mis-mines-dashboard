-- ============================================================================
-- MineHub · Migration 005 · Child rows follow their machine
-- ============================================================================
-- asset_identity and asset_compliance are wholly owned by one machine and mean
-- nothing without it, but neither cascaded — so removing a wrongly-registered
-- machine failed on a foreign key and left the operator to delete three tables
-- in the right order by hand.
--
-- This is about correcting a mistaken registration. Retiring a machine that
-- really existed is still a status change to DISPOSED, never a delete: its
-- history has to survive.
-- ============================================================================

SET search_path TO minehub, public;

ALTER TABLE asset_identity   DROP CONSTRAINT IF EXISTS asset_identity_asset_id_fkey;
ALTER TABLE asset_identity   ADD  CONSTRAINT asset_identity_asset_id_fkey
    FOREIGN KEY (asset_id) REFERENCES asset(asset_id) ON DELETE CASCADE;

ALTER TABLE asset_compliance DROP CONSTRAINT IF EXISTS asset_compliance_asset_id_fkey;
ALTER TABLE asset_compliance ADD  CONSTRAINT asset_compliance_asset_id_fkey
    FOREIGN KEY (asset_id) REFERENCES asset(asset_id) ON DELETE CASCADE;

-- The event log deliberately does NOT cascade. What happened is a fact, and it
-- stays true whether or not the machine is still registered.
ALTER TABLE event DROP CONSTRAINT IF EXISTS event_asset_id_fkey;
ALTER TABLE event ADD CONSTRAINT event_asset_id_fkey
    FOREIGN KEY (asset_id) REFERENCES asset(asset_id) ON DELETE SET NULL;

INSERT INTO schema_migration (migration_id, description)
VALUES ('005_asset_child_cascade', 'Identity and compliance cascade; events survive with a null asset')
ON CONFLICT (migration_id) DO NOTHING;
