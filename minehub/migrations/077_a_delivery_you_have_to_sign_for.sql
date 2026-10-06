-- 077: a delivery somebody has to sign for.
--
-- The first tanker form asked fourteen questions and that is not enough for a
-- document a storekeeper puts his name to. Missing, and each one is missing
-- for a reason somebody will eventually need:
--
--   WHO BROUGHT IT      A tanker number with no driver behind it is a vehicle,
--                       not a person. When 60 litres are short, the question is
--                       asked of a driver.
--
--   WAS IT SEALED       A seal number and its condition are the difference
--                       between "short delivered" and "opened on the road".
--                       Recording the quantity without the seal throws away the
--                       only evidence that distinguishes them.
--
--   WAS IT DIESEL       Density and temperature are how you know. HSD at 15 C
--                       runs about 820-845 kg/m3; a load outside that is either
--                       mismeasured or not what the invoice says. Water and
--                       sediment ruin injectors, and the cost of finding out in
--                       a machine is not comparable to the cost of a dip test.
--
--   WHO CHECKED IT      Received and verified are two people and two moments.
--                       One name against both is not a control.
--
--   WHERE IS THE PAPER  A challan number is a promise that a document exists.
--                       The document itself is what settles an argument.
--
-- AND THE DROPDOWNS STOP BEING FIXED. Material and quality specification get
-- masters; vendor and transporter resolve to `party`, which the platform
-- already keeps. Driver names are NOT given a master -- a tanker driver changes
-- week to week and a master nobody maintains is worse than free text, so past
-- receipts become the suggestion list instead.
--
-- SAP still owns the purchase order and the GRN. po_no, po_litres and grn_ref
-- are references so a litre in a tank traces to the documents around it.
-- Nothing is posted.


-- ---------------------------------------------------------------------------
-- 1. What is being delivered
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fuel_material (
    material_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    label       text NOT NULL,
    -- The SAP material number, so the two systems can be reconciled without
    -- matching on a description somebody retyped.
    sap_material text,
    uom         text NOT NULL DEFAULT 'L',
    is_active   boolean NOT NULL DEFAULT true,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO fuel_material (code, label, note)
SELECT * FROM (VALUES
    ('HSD', 'High Speed Diesel',
     'What the mine runs on. The SAP material number belongs here once '
     'somebody with access to the material master confirms it.'),
    ('LDO', 'Light Diesel Oil', 'For burners, where used.'),
    ('LUBE', 'Lubricant', 'Not a fuel, but it arrives on the same challan.')
) AS v(code, label, note)
 WHERE NOT EXISTS (SELECT 1 FROM fuel_material);


-- ---------------------------------------------------------------------------
-- 2. What "good" looks like, so the form can say when it is not
-- ---------------------------------------------------------------------------
--
-- Effective-dated with a reason, like every other norm on this platform: a
-- specification nobody can explain six months later is indistinguishable from
-- a typo, and this one decides whether a tanker is accepted.

CREATE TABLE IF NOT EXISTS fuel_quality_spec (
    spec_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    material_id bigint NOT NULL REFERENCES fuel_material(material_id),

    density_min numeric(7,2),          -- kg/m3 at the reference temperature
    density_max numeric(7,2),
    density_ref_temp_c numeric(5,2) DEFAULT 15.0,
    temp_max_c  numeric(5,2),
    water_sediment_allowed boolean NOT NULL DEFAULT false,

    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_to   date,
    reason      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,

    CONSTRAINT fuel_quality_range CHECK (
        density_min IS NULL OR density_max IS NULL OR density_max >= density_min)
);

INSERT INTO fuel_quality_spec (material_id, density_min, density_max,
                               temp_max_c, reason, created_by)
SELECT m.material_id, 820.00, 845.00, 45.00,
       'The ordinary range for High Speed Diesel at 15 C. A load outside it is '
       'either mismeasured or not what the invoice says, and either way is a '
       'question to ask before the tanker leaves. Editable: this is the fuel '
       'office''s specification, not a developer''s.',
       'migration 077'
  FROM fuel_material m
 WHERE m.code = 'HSD'
   AND NOT EXISTS (SELECT 1 FROM fuel_quality_spec WHERE material_id = m.material_id);


-- ---------------------------------------------------------------------------
-- 3. The delivery, in full
-- ---------------------------------------------------------------------------

-- what it is, and against which document
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS material_id bigint
    REFERENCES fuel_material(material_id);
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS po_line text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS po_litres numeric(10,2);
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS storage_location text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS transporter_party_id bigint
    REFERENCES party(party_id);

-- who brought it
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS driver_name text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS driver_mobile text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS driver_licence text;

-- was it sealed
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS seal_no text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS seal_condition text;
ALTER TABLE fuel_receipt DROP CONSTRAINT IF EXISTS fuel_receipt_seal_ck;
ALTER TABLE fuel_receipt ADD CONSTRAINT fuel_receipt_seal_ck CHECK (
    seal_condition IS NULL OR seal_condition IN
    ('INTACT', 'BROKEN', 'MISSING', 'NOT_SEALED'));

-- was it diesel
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS density numeric(7,2);
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS temperature_c numeric(5,2);
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS water_sediment boolean;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS sample_ref text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS quality_status text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS quality_remarks text;
ALTER TABLE fuel_receipt DROP CONSTRAINT IF EXISTS fuel_receipt_quality_ck;
ALTER TABLE fuel_receipt ADD CONSTRAINT fuel_receipt_quality_ck CHECK (
    quality_status IS NULL OR quality_status IN
    ('PASSED', 'FAILED', 'PENDING', 'NOT_TESTED'));

-- who checked it, and where it stands
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS verified_by text;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS approval_status text
    NOT NULL DEFAULT 'DRAFT';
ALTER TABLE fuel_receipt DROP CONSTRAINT IF EXISTS fuel_receipt_approval_ck;
ALTER TABLE fuel_receipt ADD CONSTRAINT fuel_receipt_approval_ck CHECK (
    approval_status IN ('DRAFT', 'VERIFIED', 'APPROVED', 'REJECTED'));
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS grn_ref text;

-- Its own number, so people can refer to one on the telephone. Generated,
-- never typed: two storekeepers on one morning pick the same number.
ALTER TABLE fuel_receipt ADD COLUMN IF NOT EXISTS receipt_no text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_receipt_no
    ON fuel_receipt (receipt_no) WHERE receipt_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fuel_receipt_po ON fuel_receipt (po_no);
CREATE INDEX IF NOT EXISTS ix_fuel_receipt_tanker ON fuel_receipt (tanker_no);
CREATE INDEX IF NOT EXISTS ix_fuel_receipt_pending
    ON fuel_receipt (approval_status, on_date DESC)
    WHERE approval_status IN ('DRAFT', 'VERIFIED');

COMMENT ON COLUMN fuel_receipt.density IS
    'kg/m3. Checked against fuel_quality_spec for the material — outside the '
    'range is a question to ask before the tanker leaves, not a rejection.';
COMMENT ON COLUMN fuel_receipt.seal_condition IS
    'The difference between a short delivery and a load opened on the road. '
    'Recording a quantity without it throws away the only evidence that tells '
    'those two apart.';
COMMENT ON COLUMN fuel_receipt.approval_status IS
    'DRAFT is entered, VERIFIED is checked by a second person, APPROVED is '
    'accepted into stock. Received by and verified by are two people and two '
    'moments; one name against both is not a control.';


-- ---------------------------------------------------------------------------
-- 4. The paper behind it
-- ---------------------------------------------------------------------------
--
-- Same shape as asset_document, which already works: the file on disk, the
-- row here, and the original filename kept because "scan_0041.pdf" is not
-- what anybody will search for.

CREATE TABLE IF NOT EXISTS fuel_receipt_document (
    fuel_document_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_id  bigint NOT NULL REFERENCES fuel_receipt(receipt_id) ON DELETE CASCADE,

    kind        text NOT NULL DEFAULT 'OTHER'
                CHECK (kind IN ('INVOICE', 'CHALLAN', 'EWAY_BILL',
                                'DELIVERY_NOTE', 'TANKER_PHOTO', 'SEAL_PHOTO',
                                'DIP_EVIDENCE', 'QUALITY_REPORT', 'OTHER')),
    title       text,
    file_name   text NOT NULL,
    stored_name text NOT NULL,
    content_type text,
    size_bytes  bigint,
    uploaded_by text,
    uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fuel_doc_receipt
    ON fuel_receipt_document (receipt_id);


-- ---------------------------------------------------------------------------
-- 5. Numbers for the deliveries already recorded
-- ---------------------------------------------------------------------------
--
-- Only the ones without one, and only if any exist. Ordered by arrival so the
-- sequence means something.

WITH numbered AS (
    SELECT receipt_id,
           'FR-' || TO_CHAR(on_date, 'YYMMDD') || '-' ||
           LPAD(ROW_NUMBER() OVER (PARTITION BY on_date
                                   ORDER BY receipt_id)::text, 3, '0') AS n
      FROM fuel_receipt WHERE receipt_no IS NULL
)
UPDATE fuel_receipt r SET receipt_no = numbered.n
  FROM numbered WHERE numbered.receipt_id = r.receipt_id;

-- And HSD as the default material where nothing says otherwise, because
-- everything recorded so far was diesel.
UPDATE fuel_receipt SET material_id = (
        SELECT material_id FROM fuel_material WHERE code = 'HSD')
 WHERE material_id IS NULL;
