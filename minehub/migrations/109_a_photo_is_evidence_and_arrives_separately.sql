-- 109: a photo is evidence, and it arrives separately from the handover.
--
-- ── WHY IT IS NOT PART OF THE SESSION PAYLOAD ───────────────────────────────
-- A handover is a few kilobytes of JSON. A photo is a few hundred. At the gate,
-- on a 2G signal that lasts as long as it takes a tipper to pass, the JSON gets
-- through and the photo often does not -- and if they travel together, the
-- handover does not get through either. So the session is filed first and the
-- photos follow, each on its own, and a photo that never arrives leaves a
-- handover that is still a complete record of what was found.
--
-- `hoto_response.photo_count` (migration 106) is what the operator attested to:
-- "I took two photos of this". The rows here are what actually reached the
-- server. The two being different is not an error -- it is the normal state for
-- hours -- but a supervisor looking at a defect needs to be able to tell "no
-- photo was taken" from "the photo has not arrived yet", and without this table
-- those look identical.
--
-- ── WHY bytea RATHER THAN A FILE PATH ───────────────────────────────────────
-- These are evidence. A dispute about a machine that killed somebody is the
-- case this table exists for, and in that case the photo and the record of the
-- handover must come out of a backup together or neither is worth anything. A
-- path into a directory tree is a second system with its own backup story,
-- its own orphans and its own silent deletions. `mail_report_file` (migration
-- 085) already stores binaries this way for the same reason.
--
-- The cost is size, and it is bounded deliberately: the device downsizes to
-- 1600px at 70% before upload, so a photo is 200-400 kB, and a mine filing 25
-- photo-bearing handovers a day adds under 3 GB a year.

CREATE TABLE IF NOT EXISTS hoto_photo (
    photo_id     bigserial PRIMARY KEY,

    -- The DEVICE's id for it, generated at capture. This is what makes an
    -- interrupted upload safe to repeat: the same photo retried carries the
    -- same uuid and lands on the conflict rather than being stored twice.
    photo_uuid   uuid NOT NULL UNIQUE,

    session_id   bigint NOT NULL REFERENCES hoto_session (session_id) ON DELETE CASCADE,
    -- Nullable: a photo of the machine as a whole belongs to the handover, not
    -- to any one check.
    response_id  bigint REFERENCES hoto_response (response_id) ON DELETE SET NULL,
    item_id      bigint REFERENCES hoto_checklist_item (item_id),

    -- Copied, not joined, for the same reason the response copies its label: a
    -- retired item must not change what an eight-month-old photo says it is of.
    item_label   varchar(120),

    sha256       char(64) NOT NULL,
    size_bytes   integer NOT NULL CHECK (size_bytes > 0),
    content_type varchar(40) NOT NULL DEFAULT 'image/jpeg',
    content      bytea NOT NULL,

    -- The device's clock when the shutter was pressed, and ours when it landed.
    -- The gap is how long the tablet was out of signal, which is worth seeing.
    captured_at  timestamptz NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now(),

    captured_lat   numeric(10,7),
    captured_lon   numeric(10,7),
    gps_accuracy_m numeric(7,2),

    uploaded_by  varchar(32),

    -- A photo cannot have reached us before it was taken by more than a device
    -- clock could plausibly drift. Not a hard CHECK on ordering, because a
    -- tablet whose clock is genuinely ahead would otherwise have its evidence
    -- refused -- and refusing evidence is worse than recording a strange time.
    CHECK (captured_at > timestamptz '2020-01-01')
);

-- THE SAME PHOTO TWICE IS ONE PHOTO. A device re-uploading after a half
-- finished transfer sends the same bytes under the same uuid; the UNIQUE above
-- catches that. This catches the other case -- the same bytes arriving under a
-- new uuid, which is what happens if a device's local row is lost and recreated
-- -- so a response does not accumulate four copies of one cracked hose.
CREATE UNIQUE INDEX IF NOT EXISTS hoto_photo_one_per_response_hash
    ON hoto_photo (session_id, COALESCE(item_id, -1), sha256);

CREATE INDEX IF NOT EXISTS hoto_photo_session_idx ON hoto_photo (session_id);
CREATE INDEX IF NOT EXISTS hoto_photo_item_idx ON hoto_photo (item_id, captured_at DESC);

COMMENT ON TABLE hoto_photo IS
    'Evidence attached to a handover. Uploaded separately from the session so a '
    'slow photo never stops the handover reaching the server. See migration 109.';

COMMENT ON COLUMN hoto_photo.photo_uuid IS
    'The device''s own id, generated at capture. Makes an interrupted upload '
    'safe to repeat.';


-- ── what the register needs to say ──────────────────────────────────────────
-- "Two photos were taken, one has arrived" is a sentence the register must be
-- able to produce, and it needs both numbers to do it. This view is the join
-- that every reader would otherwise write slightly differently.
CREATE OR REPLACE VIEW hoto_response_evidence AS
SELECT r.response_id,
       r.session_id,
       r.item_id,
       r.item_label,
       r.photo_count                        AS photos_attested,
       count(p.photo_id)                    AS photos_arrived,
       -- The honest three-way answer. NONE and PENDING look identical without
       -- this table, and they mean opposite things to a supervisor deciding
       -- whether to believe a defect.
       CASE WHEN r.photo_count = 0 THEN 'NONE'
            WHEN count(p.photo_id) >= r.photo_count THEN 'COMPLETE'
            ELSE 'PENDING' END              AS evidence_state
  FROM hoto_response r
  LEFT JOIN hoto_photo p ON p.response_id = r.response_id
 GROUP BY r.response_id, r.session_id, r.item_id, r.item_label, r.photo_count;

COMMENT ON VIEW hoto_response_evidence IS
    'How much evidence a check has, and whether what is missing was never taken '
    'or has not arrived yet. See migration 109.';


-- ── the app role ────────────────────────────────────────────────────────────
-- Migration 095 granted mines_app rights on everything in minehub AT THAT TIME.
-- A table created afterwards is not covered, so each migration that adds one
-- grants on it explicitly. Guarded, because a fresh database replaying the full
-- set may not have reached 095 yet in some orderings, and a missing role must
-- not stop the schema being built.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mines_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON hoto_photo TO mines_app;
        GRANT USAGE, SELECT ON SEQUENCE hoto_photo_photo_id_seq TO mines_app;
        GRANT SELECT ON hoto_response_evidence TO mines_app;
    END IF;
END $$;
