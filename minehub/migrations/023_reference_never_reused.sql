-- 023: a reference is never handed out twice.
--
-- Both reference functions counted the rows that already existed and added one.
-- That is right exactly until something is deleted: discard a draft and the
-- next registration is handed the number the discarded one had, which either
-- collides with a surviving row — as it just did, OPR-2026-0002 — or, worse,
-- quietly succeeds and two records share a reference in somebody's email.
--
-- They now take the highest number issued this year and go one past it, so a
-- reference is never reused even after the record that held it is gone. That is
-- what a reference is for: the whole value of EQP-2026-0004 is that it means
-- one machine, for ever, including the machine that was thrown away.

CREATE OR REPLACE FUNCTION next_asset_ref() RETURNS text AS $$
DECLARE
    yr   text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
    last integer;
BEGIN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(asset_ref, '^EQP-\d{4}-', ''), '')::integer), 0)
      INTO last
      FROM asset
     WHERE asset_ref LIKE 'EQP-' || yr || '-%';
    RETURN 'EQP-' || yr || '-' || lpad((last + 1)::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION next_operator_ref() RETURNS text AS $$
DECLARE
    yr   text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY');
    last integer;
BEGIN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(operator_ref, '^OPR-\d{4}-', ''), '')::integer), 0)
      INTO last
      FROM operator
     WHERE operator_ref LIKE 'OPR-' || yr || '-%';
    RETURN 'OPR-' || yr || '-' || lpad((last + 1)::text, 4, '0');
END;
$$ LANGUAGE plpgsql;
