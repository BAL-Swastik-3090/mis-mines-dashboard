-- 088: drop the MySQL-sourced SAP mirror. The OData feed replaces it.
--
-- WHAT THIS REMOVES AND WHY.
--
-- On 27 October this project mirrored five SAP tables out of balcorpdb into
-- minehub, because those tables carry no index on a date and every production
-- read was a full scan of 112 MB to find the mine's 3,381 rows.
--
-- That mirror was the right answer to the wrong question. SAP already writes
-- into this same database through an OData pipeline, into sap_odata_api, and
-- that schema is not a copy of balcorpdb -- it is a superset of it. For the
-- mine's own plants it holds 52,938 quality rows MySQL never received, all of
-- them 2024, and MySQL holds nothing it does not.
--
-- Keeping both would be two copies of one fact, drifting apart on their own
-- schedules, with nothing to say which is right on the day they disagree.
--
-- THEY MUST GO, NOT MERELY STOP BEING WRITTEN. The application reaches the
-- OData tables by putting sap_odata_api on the search path, and an unqualified
-- `FROM pp_production` resolves against the FIRST schema on that path that has
-- the name. minehub comes first. So these tables would silently keep serving a
-- frozen copy from the day the sync stopped, and every figure would stay
-- plausible while quietly going stale -- the worst failure available here,
-- because nothing on the screen would look wrong.
--
-- IF EXISTS throughout: only the machine this ran on ever had them.

DROP TABLE IF EXISTS pp_production;
DROP TABLE IF EXISTS pp_quality_inspection;
DROP TABLE IF EXISTS pp_prod_order_confirmation;
DROP TABLE IF EXISTS zpm_iw29_notifications;
DROP TABLE IF EXISTS mm_plant_maint_calibration;

-- The watermark table the mirror's own sync kept. Nothing reads it now.
DROP TABLE IF EXISTS sap_sync_state;


-- ---------------------------------------------------------------------------
-- What stays on MySQL, deliberately
-- ---------------------------------------------------------------------------
--
-- scm_zmm_stock_mb5b -- the fuel stock snapshots. sap_odata_api holds 299 of
-- the 2,160 rows Fuel Management reads, so switching it would empty that
-- screen. It keeps its own mirror (migration 081, fuel_stock_snapshot), which
-- is complete and current, and moves only when the OData feed carries the
-- whole of matgroup 1046.
--
-- sap_employee_details_new -- the HR master, read by name and never scanned by
-- range. It was never slow and is not part of this.
