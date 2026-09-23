-- 059: the same rule for drivers as for vehicles.
--
-- 057 stopped the gate asking somebody to type a vehicle number when the
-- equipment register already held it. The driver box was left as free text, and
-- it is the same fault: the operator register holds 211 drivers — every one of
-- them a contractor's, employed by CLL, which is exactly the population the
-- gate deals with — and typing "SWASTIK" against a load attributes it to
-- nobody.
--
-- A driver who works here is registered. That is already true and needs no new
-- table: operator carries the person, their employer, their trade and their
-- competencies, and operator_record carries the driving licence with its
-- number, issuer and expiry date. A contractor's long-term driver belongs
-- there beside the rest, and the gate picks him from it.
--
-- WHAT THE REGISTER SHOULD NOT SWALLOW
-- The man who drives a despatch lorry in once and is never seen again is not
-- that. Registering him properly means a competency file, an induction record
-- and a medical that nobody is going to complete for a delivery. So visiting
-- drivers get the same small table visiting vehicles got, keyed on the licence
-- number, deduplicated the same way, and kept out of the operator register
-- where competency actually means something.
--
-- THE LICENCE IS THE POINT
-- A weighbridge is where a mine finds out, too late, that the man who has been
-- hauling all month has an expired licence. The register already knows —
-- operator_record.valid_upto is there, with renewals tracked — and nothing was
-- reading it at the gate. The view below surfaces it, so the licence and its
-- expiry are in front of whoever admits the driver rather than in a folder.

-- ---------------------------------------------------------------------------
-- 1. Drivers who visit but are not on the register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visiting_driver (
    visiting_driver_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name       text NOT NULL,
    licence_no      text NOT NULL,
    -- The licence number is the natural key, the way a registration number is
    -- for a lorry. Generated and stored so the unique index is the database's
    -- and not a convention somebody can type around.
    licence_normalised text GENERATED ALWAYS AS
                         (upper(regexp_replace(licence_no, '[^A-Za-z0-9]', '', 'g'))) STORED,
    licence_valid_upto date,
    phone           text,
    transporter_party_id bigint REFERENCES party (party_id),
    employer_name_text text,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz,
    visits          integer NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'BLACKLISTED', 'INACTIVE')),
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text
);
CREATE UNIQUE INDEX IF NOT EXISTS visiting_driver_one_per_licence
    ON visiting_driver (licence_normalised);

DROP TRIGGER IF EXISTS visiting_driver_touch ON visiting_driver;
CREATE TRIGGER visiting_driver_touch BEFORE UPDATE ON visiting_driver
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE visiting_driver IS
    'Drivers who come with an outside vehicle and are not on the operator '
    'register. Keyed on the licence number so the same man is one row however '
    'his name is spelled. Deliberately not the operator register: there is no '
    'competency, induction or medical record here, and pretending otherwise '
    'would make the operator register mean less than it does.';

COMMENT ON COLUMN visiting_driver.visits IS
    'How many times this driver has been admitted. A stranger and a man who '
    'has been here forty times are different risks at a gate.';

-- ---------------------------------------------------------------------------
-- 2. A gate pass and a trip name a driver
-- ---------------------------------------------------------------------------
ALTER TABLE gate_pass ADD COLUMN IF NOT EXISTS visiting_driver_id bigint
    REFERENCES visiting_driver (visiting_driver_id);
ALTER TABLE trip ADD COLUMN IF NOT EXISTS visiting_driver_id bigint
    REFERENCES visiting_driver (visiting_driver_id);
CREATE INDEX IF NOT EXISTS ix_trip_visiting_driver
    ON trip (visiting_driver_id, production_date DESC);

-- The free-text driver fields go from the trip. A load has to be attributable
-- to a person, and a name in a text box is not a person.
ALTER TABLE trip DROP COLUMN IF EXISTS driver_name_text;

-- On the gate pass they stay, but only as what they always were: a note of who
-- happened to be driving when the vehicle came through the gate months ago.
-- The driver that matters is the one on each trip.
COMMENT ON COLUMN gate_pass.driver_name_text IS
    'Who drove the vehicle in on the day it was admitted. Not the driver of '
    'any particular load — a vehicle that stays six months is driven by a '
    'different person every shift, and each trip names its own.';

-- ---------------------------------------------------------------------------
-- 3. One driver, whichever register they are in
-- ---------------------------------------------------------------------------
-- The licence comes from operator_record, taking the latest driving licence
-- held and whether it is still in date. That is the fact a gate needs and has
-- never had in front of it.
CREATE OR REPLACE VIEW weighable_driver AS
SELECT 'OPERATOR'::text     AS kind,
       o.operator_id        AS operator_id,
       NULL::bigint         AS visiting_driver_id,
       p.legal_name         AS full_name,
       o.operator_ref       AS reference,
       lic.document_no      AS licence_no,
       upper(regexp_replace(COALESCE(lic.document_no, ''), '[^A-Za-z0-9]', '', 'g'))
                            AS licence_normalised,
       lic.valid_upto       AS licence_valid_upto,
       p.phone              AS phone,
       emp.legal_name       AS employer,
       o.designation        AS designation,
       p.status             AS status,
       NULL::integer        AS visits
  FROM operator o
  JOIN party p       ON p.party_id = o.party_id
  LEFT JOIN party emp ON emp.party_id = o.employer_party_id
  LEFT JOIN LATERAL (
        SELECT r.document_no, r.valid_upto
          FROM operator_record r
         WHERE r.operator_id = o.operator_id
           AND r.record_type = 'LICENCE'
           AND r.status <> 'INACTIVE'
         ORDER BY r.valid_upto DESC NULLS LAST
         LIMIT 1
  ) lic ON TRUE
UNION ALL
SELECT 'VISITOR',
       NULL,
       d.visiting_driver_id,
       d.full_name,
       NULL,
       d.licence_no,
       d.licence_normalised,
       d.licence_valid_upto,
       d.phone,
       COALESCE(p.display_name, d.employer_name_text),
       NULL,
       d.status,
       d.visits
  FROM visiting_driver d
  LEFT JOIN party p ON p.party_id = d.transporter_party_id;

COMMENT ON VIEW weighable_driver IS
    'Everyone who can be named as driving a load: the operator register and the '
    'visiting drivers, in one shape, each with the licence they hold and when '
    'it runs out. The operator register''s own screens do not read this.';
