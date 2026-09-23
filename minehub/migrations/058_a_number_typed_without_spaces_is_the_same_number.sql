-- 058: find a vehicle however its number is typed.
--
-- The gate search matched registration numbers literally. The equipment
-- register stores them as the RTO writes them — "OD 04 G 5856" — and a gate
-- operator types "OD04G5856", because nobody puts spaces in a number they are
-- reading off a bumper at six in the morning.
--
-- So the search found nothing, and the operator's next move is to press "not on
-- the register" and describe a lorry that was on it all along. That is exactly
-- the duplicate this whole design is meant to prevent, reached by a different
-- route.
--
-- visiting_vehicle already kept a normalised column for its unique index. The
-- view now exposes one for both registers, so searching is done on the
-- comparable form and the stored number stays exactly as it was entered.

-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW can add
-- columns only at the end, and the normalised number belongs beside the number
-- it is derived from. Nothing depends on this view but the gate search.
DROP VIEW IF EXISTS weighable_vehicle;
CREATE VIEW weighable_vehicle AS
SELECT 'ASSET'::text        AS kind,
       a.asset_id           AS asset_id,
       NULL::bigint         AS visiting_vehicle_id,
       a.registration_no    AS registration_no,
       upper(regexp_replace(COALESCE(a.registration_no, ''), '[^A-Za-z0-9]', '', 'g'))
                            AS reg_normalised,
       a.fleet_code         AS fleet_code,
       at.name              AS vehicle_type,
       a.make, a.model,
       a.payload_capacity_kg,
       a.standing_tare_kg, a.tare_taken_at,
       o.display_name       AS owner,
       a.ownership          AS ownership,
       a.status             AS status
  FROM asset a
  LEFT JOIN asset_type at ON at.asset_type_id = a.asset_type_id
  LEFT JOIN party o       ON o.party_id = a.owner_party_id
UNION ALL
SELECT 'VISITOR',
       NULL,
       v.visiting_vehicle_id,
       v.registration_no,
       v.reg_normalised,
       NULL,
       v.vehicle_type,
       v.make, v.model,
       v.payload_capacity_kg,
       v.standing_tare_kg, v.tare_taken_at,
       COALESCE(p.display_name, v.owner_name_text),
       'VISITOR',
       v.status
  FROM visiting_vehicle v
  LEFT JOIN party p ON p.party_id = v.transporter_party_id;

COMMENT ON COLUMN weighable_vehicle.reg_normalised IS
    'The registration number with spaces, hyphens and case removed, for '
    'matching only. The number shown to anybody is registration_no, exactly '
    'as it was entered.';
