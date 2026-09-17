-- 011: a reference of the platform's own, for people to quote.
--
-- Every identifier a machine currently carries belongs to someone else: the
-- fleet code is the mine's, the registration is the RTO's, the SAP equipment
-- number is SAP's, and the asset_id is a database key that will mean nothing on
-- a phone call. None of them can be quoted in an email as "the record", and a
-- draft has not earned a fleet code yet.
--
-- EQP-2026-0001. The year is the year the machine was registered on the
-- platform, so the reference says roughly when the record starts, and the
-- counter runs within that year rather than forever — a number people can read
-- out loud without losing their place.

ALTER TABLE asset ADD COLUMN IF NOT EXISTS asset_ref text;

CREATE SEQUENCE IF NOT EXISTS asset_ref_seq;

CREATE OR REPLACE FUNCTION next_asset_ref() RETURNS text AS $$
DECLARE
    yr  text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
    -- The sequence is shared across years; the count within a year comes from
    -- the rows themselves, so January starts at 1 again without anyone having
    -- to remember to reset anything.
    n   integer;
BEGIN
    SELECT count(*) + 1 INTO n FROM asset WHERE asset_ref LIKE 'EQP-' || yr || '-%';
    RETURN 'EQP-' || yr || '-' || lpad(n::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Existing rows get one in registration order, so the references read in the
-- order the machines actually arrived.
DO $$
DECLARE
    r record;
    n integer := 0;
BEGIN
    FOR r IN SELECT asset_id, created_at FROM asset WHERE asset_ref IS NULL ORDER BY asset_id LOOP
        n := n + 1;
        UPDATE asset
           SET asset_ref = 'EQP-' || to_char(r.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY')
                           || '-' || lpad(n::text, 4, '0')
         WHERE asset_id = r.asset_id;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS asset_ref_uq ON asset (asset_ref);
