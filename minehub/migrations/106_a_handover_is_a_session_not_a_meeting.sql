-- 106: a handover is a session, not a meeting.
--
-- ── WHY THE TABLE WE ALREADY HAD IS THE WRONG SHAPE ──────────────────────────
-- `hoto` (migration 026, never used, 0 rows) models ONE row per handover with
-- outgoing_confirmed_* and incoming_confirmed_* on it -- both operators
-- attesting to the same record. Three things break under that:
--
--   A MID-SHIFT CHECK HAS NOWHERE TO LIVE. The mine does one, roughly four
--   hours in: fuel, unusual noise, overheating. It is not a handover and it
--   has no second party.
--
--   THE TWO OPERATORS ARE NOT IN THE SAME PLACE AT THE SAME TIME. The
--   outgoing man finishes at 13:55 and the incoming man accepts at 14:05.
--   Each is attesting to what HE saw. One row makes the record depend on both
--   being at one device at one moment, which is exactly the case that fails
--   when a shift runs over or a machine is parked between them.
--
--   HALF A HANDOVER IS NORMAL. First deployment of the day has no outgoing
--   operator. Parking a machine has no incoming one. A refused takeover has an
--   incoming operator who did not accept. The one-row model has to fabricate a
--   party or leave half a record; sessions just have fewer sessions.
--
-- So: one row per attestation, with a type. A start and an end that belong
-- together point at each other through counterpart_session_id.
--
-- `hoto` is LEFT IN PLACE and marked superseded rather than dropped --
-- ops_exception.hoto_id still references it. Repointing that and dropping the
-- old table is a later migration, once the API is proven. It holds no rows and
-- costs nothing to leave.
--
-- ── THE DEVICE IS PART OF THE RECORD ────────────────────────────────────────
-- A shared tablet is used by many operators across a shift. If the record does
-- not say which device captured it, a disputed handover has no way to
-- distinguish "the operator confirmed this" from "somebody had the tablet".
-- Every session carries its device and the operator identified at the moment
-- of capture, never a signed-in session inherited from whoever used it last.
--
-- ── TWO CLOCKS, AND THE SERVER'S IS THE ONE THAT COUNTS ─────────────────────
-- captured_at is the device's clock; received_at is ours. Device clocks drift
-- and get changed, and an offline handover may arrive six hours after the
-- moment it describes. Both are kept because the gap between them is the only
-- way to explain such a record, and anything that matters is decided on
-- received_at.

-- ── the devices ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hoto_device (
    device_id     bigserial PRIMARY KEY,
    device_code   varchar(32) NOT NULL UNIQUE,
    label         varchar(80) NOT NULL,

    -- PERSONAL  a worker's own phone: one user, app-level security only.
    -- COMPANY   a shared tablet: MDM-locked, kiosk, many operators a day.
    -- The distinction decides whether a session may be inherited at all.
    profile       varchar(10) NOT NULL
                  CHECK (profile IN ('PERSONAL', 'COMPANY')),

    plant_id      bigint REFERENCES plant (plant_id),
    location_id   bigint REFERENCES location (location_id),

    -- The enrolment credential, hashed. The plain token is shown once at
    -- enrolment and never stored -- same rule as any other secret here.
    token_hash    text,
    token_issued_at timestamptz,

    status        varchar(10) NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    last_seen_at  timestamptz,
    last_sync_at  timestamptz,
    app_version   varchar(20),

    enrolled_by   varchar(32),
    enrolled_at   timestamptz NOT NULL DEFAULT now(),
    revoked_by    varchar(32),
    revoked_at    timestamptz,
    remarks       text,

    -- Revoked means it says when and by whom, or it is not revoked.
    CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

COMMENT ON TABLE hoto_device IS
    'Phones and tablets allowed to capture HOTO. A COMPANY device is shared, '
    'so identity is per capture, not per session. See migration 106.';

-- ── the sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hoto_session (
    session_id    bigserial PRIMARY KEY,
    session_ref   varchar(24) UNIQUE,

    -- THE DEVICE GENERATES THIS, NOT US. It travels with the record from the
    -- moment of capture, so a retry after a dropped connection cannot create
    -- the handover twice. The server allocates session_ref; the device owns
    -- this.
    client_uuid   uuid NOT NULL UNIQUE,

    asset_id          bigint NOT NULL REFERENCES asset (asset_id),
    shift_instance_id bigint REFERENCES shift_instance (shift_instance_id),
    deployment_id     bigint REFERENCES deployment (deployment_id),

    -- START_HANDOVER  incoming operator takes the machine on
    -- MID_SHIFT       the T+4h recheck -- one party, no handover
    -- END_HANDOVER    outgoing operator hands it off
    session_type  varchar(16) NOT NULL
                  CHECK (session_type IN ('START_HANDOVER', 'MID_SHIFT', 'END_HANDOVER')),

    -- Not UNIQUE on (asset, shift, type) alone: a mid-shift relief produces a
    -- second start and a second end in one shift, and that is a real thing
    -- rather than a mistake to forbid.
    sequence_no   integer NOT NULL DEFAULT 1 CHECK (sequence_no >= 1),

    -- The one operator attesting. Exactly one per session -- that is the point.
    operator_id   bigint REFERENCES operator (operator_id),
    operator_emp_id varchar(32),

    -- A start and the end it follows point at each other once both exist.
    counterpart_session_id bigint REFERENCES hoto_session (session_id),

    -- The template AS ANSWERED. Not a live pointer: the version is recorded so
    -- a template published next month cannot change what this record says.
    template_id      bigint REFERENCES hoto_checklist_template (template_id),
    template_version integer,

    meter_reading numeric(12,2),
    meter_uom     varchar(8),
    fuel_level    numeric(5,2) CHECK (fuel_level IS NULL
                                      OR (fuel_level >= 0 AND fuel_level <= 100)),
    location_id   bigint REFERENCES location (location_id),

    -- DRAFT      still on the device
    -- SUBMITTED  captured and confirmed
    -- BLOCKED    a critical item failed; the machine is not taken on
    -- ACCEPTED   a start handover the incoming operator accepted
    -- REJECTED   a start handover he refused, with a reason
    -- CANCELLED  withdrawn, with an audited reason
    status        varchar(10) NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT', 'SUBMITTED', 'BLOCKED',
                                    'ACCEPTED', 'REJECTED', 'CANCELLED')),
    blocked_reason text,
    reject_reason  text,

    confirmed_by  varchar(32),
    confirmed_at  timestamptz,

    device_id     bigint REFERENCES hoto_device (device_id),
    captured_at   timestamptz NOT NULL,
    received_at   timestamptz NOT NULL DEFAULT now(),
    captured_offline boolean NOT NULL DEFAULT false,

    -- Where the device thought it was. Kept with its accuracy so a reading
    -- taken with GPS denied is distinguishable from one taken at the face.
    captured_lat  numeric(10,7),
    captured_lon  numeric(10,7),
    gps_accuracy_m numeric(8,2),
    gps_status    varchar(12)
                  CHECK (gps_status IS NULL
                         OR gps_status IN ('OK', 'DENIED', 'STALE', 'UNAVAILABLE')),

    remarks       text,
    created_by    varchar(32),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    varchar(32),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (asset_id, shift_instance_id, session_type, sequence_no),

    -- A blocked session says why. A rejected one says why.
    CHECK (status <> 'BLOCKED'  OR blocked_reason IS NOT NULL),
    CHECK (status <> 'REJECTED' OR reject_reason  IS NOT NULL),
    -- Confirmed means it says by whom and when, or it is not confirmed.
    CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
    -- Anything past DRAFT has been confirmed by somebody.
    CHECK (status = 'DRAFT' OR status = 'CANCELLED' OR confirmed_at IS NOT NULL),
    -- A mid-shift check is not a handover and has no counterpart.
    CHECK (session_type <> 'MID_SHIFT' OR counterpart_session_id IS NULL),
    -- Only a start handover is accepted or rejected.
    CHECK (session_type = 'START_HANDOVER'
           OR status NOT IN ('ACCEPTED', 'REJECTED'))
);

COMMENT ON TABLE hoto_session IS
    'One operator attesting to one machine at one point in a shift. Replaces '
    'the single-row handover in migration 026. See migration 106.';

COMMENT ON COLUMN hoto_session.client_uuid IS
    'Device-generated. Makes a retry idempotent -- the same capture replayed '
    'returns the original session rather than creating a second one.';

COMMENT ON COLUMN hoto_session.captured_at IS
    'The DEVICE clock. received_at is ours. Device clocks drift; decide '
    'anything that matters on received_at and keep both to explain the gap.';

-- ── the answers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hoto_response (
    response_id   bigserial PRIMARY KEY,
    session_id    bigint NOT NULL
                  REFERENCES hoto_session (session_id) ON DELETE CASCADE,
    item_id       bigint NOT NULL
                  REFERENCES hoto_checklist_item (item_id),

    -- THE LABEL AS IT WAS ASKED. Copied, not joined. A retired or re-worded
    -- item must not change what a signed record says it answered.
    item_label    varchar(120),
    response_type varchar(20),

    -- One of these, depending on what the item asked for.
    answer        varchar(12)
                  CHECK (answer IS NULL
                         OR answer IN ('OK', 'CAUTION', 'NOT_OK', 'YES', 'NO',
                                       'LOW', 'NORMAL', 'HIGH', 'NA')),
    numeric_value numeric(12,3),

    -- Resolved at capture against the item's range, so an out-of-range reading
    -- is a stored fact rather than something recomputed later against limits
    -- that may since have changed.
    in_range      boolean,

    -- Resolved at capture from the item's default_severity, for the same
    -- reason -- and so an offline device reaches the verdict the server would.
    severity      varchar(10)
                  CHECK (severity IS NULL
                         OR severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),

    remark        text,
    photo_count   integer NOT NULL DEFAULT 0 CHECK (photo_count >= 0),

    created_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (session_id, item_id),

    -- An answer of some kind, or the row says nothing.
    CHECK (answer IS NOT NULL OR numeric_value IS NOT NULL),
    -- A numeric answer carries a number.
    CHECK (response_type IS DISTINCT FROM 'NUMERIC' OR numeric_value IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS hoto_session_asset_idx
    ON hoto_session (asset_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS hoto_session_shift_idx
    ON hoto_session (shift_instance_id, session_type);
CREATE INDEX IF NOT EXISTS hoto_session_status_idx
    ON hoto_session (status) WHERE status IN ('BLOCKED', 'DRAFT');
CREATE INDEX IF NOT EXISTS hoto_session_received_idx
    ON hoto_session (received_at DESC);
CREATE INDEX IF NOT EXISTS hoto_response_session_idx
    ON hoto_response (session_id);
CREATE INDEX IF NOT EXISTS hoto_response_notok_idx
    ON hoto_response (item_id) WHERE answer = 'NOT_OK' OR in_range = false;

-- ── the old table, superseded ───────────────────────────────────────────────
COMMENT ON TABLE hoto IS
    'SUPERSEDED by hoto_session (migration 106). Never held a row. Left in '
    'place only because ops_exception.hoto_id references it; repointing that '
    'and dropping this is a later migration.';
