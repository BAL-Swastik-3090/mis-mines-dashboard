-- ─────────────────────────────────────────────────────────────────────────────
-- 119 · A device asks to join, and says where it is
--
-- WHAT WAS WRONG WITH 106'S ENROLMENT
-- A tablet was enrolled by an administrator running a command, who then had to
-- carry a 43-character token to the tablet and type it in, along with a server
-- address. That is a fine model for four tablets installed by one person on one
-- afternoon. It is not a product. Every device that ever joins needs somebody
-- with database access standing next to it, and the token travels by whatever
-- means is to hand -- which in practice is WhatsApp.
--
-- Inverted here. The DEVICE asks, the OFFICE decides:
--
--   1. the app, on first run, registers itself: a self-generated install_id,
--      what hardware it is, who is asking and where it will be used;
--   2. the row lands as PENDING and appears in the dashboard with those facts,
--      so the approver can see "Realme RMX3063, Android 13, Akash, Kaliapani"
--      rather than a code somebody read out over a phone;
--   3. an approver with hoto.admin approves it, which is when the credential is
--      generated -- never before;
--   4. the app, which has been polling, collects it and starts working.
--
-- Nobody types a token. Nobody types a server address. The approval is a record
-- with a name and a time against it, which the old flow had no way to produce.
--
-- THE ONE PLACE A PLAIN TOKEN IS STORED, AND WHY IT IS BOUNDED
-- `token_hash` still holds only a hash and that is still the only thing
-- authentication reads. But the device is not present at the moment of
-- approval, so something must hold the credential until it next calls in.
-- `pending_token` does, under three limits that together make it a different
-- kind of object from a stored password:
--   * it exists only between approval and the device's next poll -- seconds,
--     usually; minutes at worst;
--   * it expires regardless, at `pending_token_expires_at`, after which the
--     approver must re-issue;
--   * collecting it requires `claim_secret_hash` to match a secret that only
--     that installation holds and that never leaves it except as a hash.
-- It is NULLed on collection. An approval nobody collects decays to nothing.
--
-- WHERE THE MACHINE IS
-- `hoto_device_location` is a track, not a current position: the current
-- position is denormalised onto the device row for the dashboard's list, and
-- the history stays here because "where was DEV-7 at 02:00" is the question
-- that actually gets asked after an incident. Fixes arrive in batches, since a
-- device out of signal buffers them and sends the lot on reconnect, so they
-- carry the device's own `recorded_at` as well as `received_at` and are
-- idempotent on `client_uuid` -- a retried batch does not double the track.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── the device now has a life before it has a credential ────────────────────
ALTER TABLE hoto_device
    -- The app generates this once, on first run, and keeps it for the life of
    -- the install. It is the identity BEFORE approval, when there is no token
    -- yet, and it is what makes registering twice idempotent rather than
    -- filling the approval queue with duplicates of one impatient tablet.
    ADD COLUMN IF NOT EXISTS install_id     uuid UNIQUE,
    ADD COLUMN IF NOT EXISTS claim_secret_hash text,

    ADD COLUMN IF NOT EXISTS pending_token  text,
    ADD COLUMN IF NOT EXISTS pending_token_expires_at timestamptz,

    -- What it is. Shown to the approver, because "is this the phone I just
    -- handed to the shift in-charge" is the only question approval answers.
    ADD COLUMN IF NOT EXISTS platform       varchar(12),
    ADD COLUMN IF NOT EXISTS os_version     varchar(40),
    ADD COLUMN IF NOT EXISTS manufacturer   varchar(60),
    ADD COLUMN IF NOT EXISTS model          varchar(80),
    ADD COLUMN IF NOT EXISTS build_number   varchar(24),

    -- Who asked, in their own words, and when.
    ADD COLUMN IF NOT EXISTS requested_at       timestamptz,
    ADD COLUMN IF NOT EXISTS requested_by_name  varchar(80),
    ADD COLUMN IF NOT EXISTS requested_note     text,

    ADD COLUMN IF NOT EXISTS approved_by    varchar(32),
    ADD COLUMN IF NOT EXISTS approved_at    timestamptz,
    ADD COLUMN IF NOT EXISTS decided_reason text,

    -- Denormalised last fix, so the device list does not need a lateral join
    -- per row to answer "where is it".
    ADD COLUMN IF NOT EXISTS last_location_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_lat       numeric(9,6),
    ADD COLUMN IF NOT EXISTS last_lon       numeric(9,6),
    ADD COLUMN IF NOT EXISTS last_accuracy_m numeric(7,1),
    ADD COLUMN IF NOT EXISTS last_battery_pct smallint,
    ADD COLUMN IF NOT EXISTS last_is_charging boolean,

    -- Settable per device from the dashboard. A PERSONAL phone belonging to a
    -- worker is a different consent question from a COMPANY tablet bolted in a
    -- cab, and the mine must be able to answer it per device rather than by
    -- shipping a build.
    ADD COLUMN IF NOT EXISTS track_location boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS location_interval_s integer NOT NULL DEFAULT 300
        CHECK (location_interval_s BETWEEN 30 AND 7200);

-- PENDING and REJECTED are new. The old constraint named only the three
-- states a device could reach when a human created the row already approved.
ALTER TABLE hoto_device DROP CONSTRAINT IF EXISTS hoto_device_status_check;
ALTER TABLE hoto_device ADD CONSTRAINT hoto_device_status_check
    CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED'));

-- A device waiting for approval must never hold a credential. This is the
-- rule the whole flow rests on, so it is the database's job and not a
-- service's: no code path, present or future, can approve by accident.
ALTER TABLE hoto_device DROP CONSTRAINT IF EXISTS hoto_device_pending_has_no_token;
ALTER TABLE hoto_device ADD CONSTRAINT hoto_device_pending_has_no_token
    CHECK (status <> 'PENDING' OR (token_hash IS NULL AND pending_token IS NULL));

-- An approval says who and when, or it did not happen.
ALTER TABLE hoto_device DROP CONSTRAINT IF EXISTS hoto_device_approval_is_attributed;
ALTER TABLE hoto_device ADD CONSTRAINT hoto_device_approval_is_attributed
    CHECK ((approved_at IS NULL) = (approved_by IS NULL));

COMMENT ON COLUMN hoto_device.install_id IS
    'Generated by the app on first run. The identity a device has before it '
    'has a credential, and what makes re-registration idempotent. Migration 110.';
COMMENT ON COLUMN hoto_device.pending_token IS
    'A credential in the clear, between approval and the device collecting it. '
    'NULLed on collection, expires regardless, and collecting it requires the '
    'install own claim secret. Nothing else in this schema stores a plain '
    'credential. See migration 119.';

CREATE INDEX IF NOT EXISTS hoto_device_pending_idx
    ON hoto_device (requested_at DESC) WHERE status = 'PENDING';

-- ── where it has been ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hoto_device_location (
    ping_id       bigserial PRIMARY KEY,
    device_id     bigint NOT NULL REFERENCES hoto_device (device_id) ON DELETE CASCADE,

    -- THE DEVICE'S OWN CLOCK, at the moment of the fix. Kept apart from
    -- received_at because a device that was out of signal for six hours sends
    -- six hours of history at once, and a track built on arrival time would
    -- show it teleporting.
    recorded_at   timestamptz NOT NULL,
    received_at   timestamptz NOT NULL DEFAULT now(),

    lat           numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon           numeric(9,6) NOT NULL CHECK (lon BETWEEN -180 AND 180),
    accuracy_m    numeric(7,1),
    altitude_m    numeric(7,1),
    speed_mps     numeric(6,2),
    heading       numeric(5,1),

    battery_pct   smallint CHECK (battery_pct BETWEEN 0 AND 100),
    is_charging   boolean,

    -- BACKGROUND  the 24/7 task, which is most of them
    -- FOREGROUND  the app was open
    -- CAPTURE     taken at the moment a handover was filed, which ties the
    --             record to a place as well as a machine
    source        varchar(12) NOT NULL DEFAULT 'BACKGROUND'
                  CHECK (source IN ('BACKGROUND', 'FOREGROUND', 'CAPTURE')),

    -- The device allocates this, exactly as it does for a handover, so a batch
    -- resent after a dropped connection does not double the track.
    client_uuid   uuid UNIQUE
);

COMMENT ON TABLE hoto_device_location IS
    'Where each device has been. Written by the background task and by capture. '
    'A track, not a position -- the current one is on hoto_device. Migration 110.';

CREATE INDEX IF NOT EXISTS hoto_device_location_track_idx
    ON hoto_device_location (device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS hoto_device_location_recent_idx
    ON hoto_device_location (recorded_at DESC);

GRANT SELECT, INSERT ON hoto_device_location TO mines_app;
GRANT USAGE, SELECT ON SEQUENCE hoto_device_location_ping_id_seq TO mines_app;

COMMIT;
