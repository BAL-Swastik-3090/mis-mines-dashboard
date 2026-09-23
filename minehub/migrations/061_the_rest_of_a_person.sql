-- 061: the rest of what the contractor knows about a person.
--
-- The CLL manpower sheet carries thirty-five columns about 204 workmen and the
-- platform had a home for about eight of them. Everything else — the PAN, the
-- Aadhaar, the UAN, the bank account, the nominee, the father's name, the pay
-- grade — has been sitting in a spreadsheet on somebody's desktop.
--
-- WHY IDENTIFIERS GO IN party_identity RATHER THAN COLUMNS ON party
-- party_identity already exists to answer "what does the outside world call
-- this person": SAP employee numbers, contractor codes, RFID cards. A PAN and
-- a driving licence are the same kind of fact. Putting them there rather than
-- adding six columns means they inherit what that table already has — a
-- uniqueness rule per system, so two people cannot claim one PAN, and
-- valid_from/valid_to, which is exactly what a driving licence needs when
-- Perfios comes back with its expiry.
--
-- WHY THE BANK DETAILS GET THEIR OWN TABLE
-- Not squeamishness — permissions. An account number is the one field here
-- that is directly worth money to a thief, and a separate table can be granted
-- separately from the rest of an operator's record. A supervisor checking
-- somebody's licence should not be shown their bank account on the way past.
--
-- AADHAAR IN FULL
-- Migration 001 allowed only AADHAAR_LAST4, on the reasoning that four digits
-- confirm a document and twelve are worth stealing. The mine has decided it
-- wants the full number held, so the full number is held. The concern was
-- raised and answered; what follows from it is that this data now needs the
-- access control below rather than a comment saying it should have one.

-- ---------------------------------------------------------------------------
-- 1. The person
-- ---------------------------------------------------------------------------
ALTER TABLE party ADD COLUMN IF NOT EXISTS father_name text;
ALTER TABLE party ADD COLUMN IF NOT EXISTS marital_status text;
ALTER TABLE party DROP CONSTRAINT IF EXISTS party_marital_known;
ALTER TABLE party ADD CONSTRAINT party_marital_known CHECK (
    marital_status IS NULL OR
    marital_status IN ('MARRIED', 'UNMARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED'));

COMMENT ON COLUMN party.marital_status IS
    'One word for one state. The source sheet used SINGLE and UNMARRIED for '
    'the same thing, which is how a headcount by marital status comes out '
    'wrong in two places at once.';

-- ---------------------------------------------------------------------------
-- 2. The identifiers
-- ---------------------------------------------------------------------------
ALTER TABLE party_identity DROP CONSTRAINT IF EXISTS party_identity_system_check;
ALTER TABLE party_identity ADD CONSTRAINT party_identity_system_check CHECK (
    system IN ('SAP', 'HRMS', 'CONTRACTOR', 'RFID', 'BIOMETRIC',
               'AADHAAR_LAST4', 'LEGACY_DRIVER_MASTER',
               -- Added 061, at the mine's direction.
               'AADHAAR', 'PAN', 'UAN', 'EPF', 'ESIC', 'DRIVING_LICENCE'));

-- A driving licence is the one identifier here that expires, and the platform
-- already knows how to chase an expiry — operator_record does it for the
-- licences it holds. valid_to on the identity is what Perfios will fill.
COMMENT ON COLUMN party_identity.valid_to IS
    'When this identifier stops being valid. Meaningful for a driving licence, '
    'which expires and is verified against Perfios; null for a PAN or an '
    'Aadhaar, which do not.';

ALTER TABLE party_identity ADD COLUMN IF NOT EXISTS verified_by text;
ALTER TABLE party_identity ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE party_identity ADD COLUMN IF NOT EXISTS verification_source text;

COMMENT ON COLUMN party_identity.verification_source IS
    'Who says this identifier is real — PERFIOS for an automated check, or the '
    'name of whoever saw the document. An unverified number is somebody''s '
    'typing; a verified one is evidence.';

-- ---------------------------------------------------------------------------
-- 3. Where the wages go
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_bank_account (
    party_bank_account_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    party_id      bigint NOT NULL REFERENCES party (party_id),
    bank_name     text NOT NULL,
    branch        text,
    ifsc          text,
    account_no    text NOT NULL,
    account_type  text,
    is_primary    boolean NOT NULL DEFAULT true,
    valid_from    date NOT NULL DEFAULT CURRENT_DATE,
    valid_to      date,
    verified_by   text,
    verified_at   timestamptz,
    remarks       text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text
);
CREATE INDEX IF NOT EXISTS ix_bank_party ON party_bank_account (party_id);
-- One live primary account per person. Two is an unanswered question about
-- which one payroll used.
CREATE UNIQUE INDEX IF NOT EXISTS bank_one_primary
    ON party_bank_account (party_id) WHERE is_primary AND valid_to IS NULL;

DROP TRIGGER IF EXISTS party_bank_account_touch ON party_bank_account;
CREATE TRIGGER party_bank_account_touch BEFORE UPDATE ON party_bank_account
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE party_bank_account IS
    'Where a person is paid. Its own table so it can be granted separately: a '
    'supervisor checking a licence has no business seeing an account number.';

-- ---------------------------------------------------------------------------
-- 4. Who is nominated
-- ---------------------------------------------------------------------------
-- Dated rows rather than a column, because a nomination changes — on marriage,
-- on a death — and the one that mattered is the one in force on the day.
CREATE TABLE IF NOT EXISTS party_nominee (
    party_nominee_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    party_id      bigint NOT NULL REFERENCES party (party_id),
    nominee_name  text NOT NULL,
    relation      text,
    share_pct     numeric(5,2),
    phone         text,
    valid_from    date NOT NULL DEFAULT CURRENT_DATE,
    valid_to      date,
    remarks       text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text
);
CREATE INDEX IF NOT EXISTS ix_nominee_party ON party_nominee (party_id, valid_from DESC);

-- ---------------------------------------------------------------------------
-- 5. What the contractor grades them as
-- ---------------------------------------------------------------------------
ALTER TABLE operator ADD COLUMN IF NOT EXISTS skill_grade text;
ALTER TABLE operator DROP CONSTRAINT IF EXISTS operator_skill_grade_known;
ALTER TABLE operator ADD CONSTRAINT operator_skill_grade_known CHECK (
    skill_grade IS NULL OR
    skill_grade IN ('UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED'));

ALTER TABLE operator ADD COLUMN IF NOT EXISTS pay_grade text;
ALTER TABLE operator ADD COLUMN IF NOT EXISTS retirement_on date;

COMMENT ON COLUMN operator.skill_grade IS
    'The statutory skill classification wages are set against. SEMI_SKILLED '
    'with an underscore because the source wrote SEMISKILLED and a category '
    'that is spelled two ways is two categories.';
COMMENT ON COLUMN operator.pay_grade IS
    'The contractor''s own grade — E6, E7. Came from an unlabelled column in '
    'the manpower sheet and is recorded as read.';

-- ---------------------------------------------------------------------------
-- 6. Qualification is one ladder, not two axes
-- ---------------------------------------------------------------------------
-- An earlier reading of this treated school level and technical training as
-- separate facts, and so left fifteen ITI and Diploma holders with no
-- qualification at all — which is exactly backwards. A fitter who finished ITI
-- has ITI as his highest qualification; the 10th he sat before it is implied
-- by the admission rule, not a separate thing to record.
--
-- The ladder, lowest to highest:
--   CLASS_2 .. CLASS_9, CLASS_10_FAIL, CLASS_10_PASS, ITI,
--   HIGHER_SECONDARY, DIPLOMA, GRADUATE, POST_GRADUATE
--
-- highest_qualification holds the top of that ladder. qualification_type holds
-- the stream or trade — Fitter, Electrical, Arts, Mining Engineering — so
-- "ITI / Fitter" and "GRADUATE / Arts" both read naturally.
COMMENT ON COLUMN operator.highest_qualification IS
    'The highest thing held, on one ladder: CLASS_2..CLASS_9, CLASS_10_FAIL, '
    'CLASS_10_PASS, ITI, HIGHER_SECONDARY, DIPLOMA, GRADUATE, POST_GRADUATE. '
    'An ITI holder is recorded as ITI, not as the class 10 that let him in.';
COMMENT ON COLUMN operator.qualification_type IS
    'The stream or trade behind the level — Fitter, Electrician, Arts, '
    'Mining Engineering, MBA (HR).';

-- ---------------------------------------------------------------------------
-- 7. Who may see it
-- ---------------------------------------------------------------------------
INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
  ('platform.operators.identity', 'Platform', 'See identity documents',
   'A person''s PAN, Aadhaar, UAN, EPF and driving licence numbers. Held for '
   'statutory returns and licence verification; it is not needed to run a '
   'shift, so it is granted on its own.', TRUE, 250),
  ('platform.operators.bank', 'Platform', 'See bank details',
   'Where a person is paid: bank, branch, IFSC and account number. The one '
   'field on this platform that is directly worth money to a thief.',
   TRUE, 251)
ON CONFLICT (code) DO NOTHING;
