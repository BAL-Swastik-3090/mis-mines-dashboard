-- 062: the list of identity systems lives in one place.
--
-- The operator form offered eight choices under "what other systems call
-- them". Three of them could not be saved:
--
--   DRIVER_MASTER   the database calls it LEGACY_DRIVER_MASTER
--   GATE_PASS       not permitted at all
--   OTHER           not permitted at all
--
-- Pick any of those three, fill in a code, press save, and the insert fails on
-- a check constraint. The form had one list, the database had another, and
-- nothing made them agree.
--
-- 061 made it worse rather than better: it added AADHAAR, PAN, UAN, EPF, ESIC
-- and DRIVING_LICENCE to the constraint and left the form offering none of
-- them — so 204 Aadhaar numbers and 196 PANs went in through an import that
-- nobody can add to or correct through the screen that owns this data.
--
-- The fix is not to retype the list a third time. It is to have one list, in a
-- table, that both ends read.

CREATE TABLE IF NOT EXISTS identity_system (
    identity_system_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    label       text NOT NULL,
    -- A PAN and an Aadhaar are not a fleet card. What is sensitive is marked,
    -- so a screen can decide what to show without knowing each code by name.
    is_sensitive boolean NOT NULL DEFAULT false,
    -- Some of these expire — a driving licence does, a PAN does not — and the
    -- form should ask for a validity date only where one means something.
    has_expiry  boolean NOT NULL DEFAULT false,
    hint        text,
    sort_order  integer NOT NULL DEFAULT 100,
    status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);
DROP TRIGGER IF EXISTS identity_system_touch ON identity_system;
CREATE TRIGGER identity_system_touch BEFORE UPDATE ON identity_system
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO identity_system (code, label, is_sensitive, has_expiry, hint, sort_order, created_by) VALUES
  ('SAP',                  'SAP employee number',   FALSE, FALSE,
   'The number SAP pays them under.',                            10, 'MIGRATION 062'),
  ('CONTRACTOR',           'Contractor code',       FALSE, FALSE,
   'The code the contractor''s own muster uses.',                20, 'MIGRATION 062'),
  ('HRMS',                 'HRMS code',             FALSE, FALSE, NULL, 30, 'MIGRATION 062'),
  ('LEGACY_DRIVER_MASTER', 'Driver master',         FALSE, FALSE,
   'From the old driver master the mine kept before this platform.', 40, 'MIGRATION 062'),
  ('BIOMETRIC',            'Biometric ID',          FALSE, FALSE,
   'The enrolment ID on the attendance reader.',                 50, 'MIGRATION 062'),
  ('RFID',                 'RFID card',             FALSE, FALSE, NULL, 60, 'MIGRATION 062'),
  ('GATE_PASS',            'Gate pass number',      FALSE, FALSE, NULL, 70, 'MIGRATION 062'),
  ('AADHAAR_LAST4',        'Aadhaar (last 4)',      FALSE, FALSE,
   'Enough to check a document against, and not worth stealing.',  80, 'MIGRATION 062'),
  ('AADHAAR',              'Aadhaar (full)',        TRUE,  FALSE,
   'Twelve digits. Held at the mine''s direction; shown only to '
   'those granted identity documents.',                          90, 'MIGRATION 062'),
  ('PAN',                  'PAN',                   TRUE,  FALSE,
   'Ten characters, AAAAA9999A.',                               100, 'MIGRATION 062'),
  ('DRIVING_LICENCE',      'Driving licence',       TRUE,  TRUE,
   'Expires. Verified against Perfios, which fills the valid-to date.',
                                                                110, 'MIGRATION 062'),
  ('UAN',                  'UAN',                   TRUE,  FALSE,
   'Universal Account Number — twelve digits, for provident fund.', 120, 'MIGRATION 062'),
  ('EPF',                  'EPF member code',       TRUE,  FALSE, NULL, 130, 'MIGRATION 062'),
  ('ESIC',                 'ESIC number',           TRUE,  FALSE, NULL, 140, 'MIGRATION 062'),
  ('OTHER',                'Something else',        FALSE, FALSE,
   'For a system nobody has added here yet. Better than a code '
   'going unrecorded because the list was short.',               900, 'MIGRATION 062')
ON CONFLICT (code) DO UPDATE
   SET label = EXCLUDED.label,
       is_sensitive = EXCLUDED.is_sensitive,
       has_expiry = EXCLUDED.has_expiry,
       hint = EXCLUDED.hint,
       sort_order = EXCLUDED.sort_order;

-- The constraint now follows the table rather than a list retyped in SQL. A
-- trigger rather than a foreign key, because party_identity.system is a code
-- and not an id, and changing that would touch every query that reads it.
ALTER TABLE party_identity DROP CONSTRAINT IF EXISTS party_identity_system_check;

CREATE OR REPLACE FUNCTION identity_system_is_known() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM identity_system
                    WHERE code = NEW.system AND status = 'ACTIVE') THEN
        RAISE EXCEPTION
            'Unknown identity system %. Add it under identity_system first.',
            NEW.system;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS party_identity_system_known ON party_identity;
CREATE TRIGGER party_identity_system_known
    BEFORE INSERT OR UPDATE OF system ON party_identity
    FOR EACH ROW EXECUTE FUNCTION identity_system_is_known();

COMMENT ON TABLE identity_system IS
    'What other systems call a person, as rows. The operator form reads this '
    'list and party_identity is checked against it, so the two cannot drift '
    'apart the way they had by September 2026 — three of the form''s eight '
    'options could not be saved at all.';
