-- A handover remembers exactly what was sent.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- A device retries a handover under the same client_uuid until the office
-- acknowledges it, which is right: the pit has no signal and a lost response
-- must not become a lost record. The server decided whether a retry was the
-- same handover by comparing two fields:
--
--     prior.asset_id == payload.asset_id and
--     prior.session_type == payload.session_type
--
-- So a retry carrying different ANSWERS, a different operator, a different
-- meter reading or different GPS was accepted as an identical replay. The
-- server kept its original, returned it, and the tablet marked its own
-- different version as successfully filed. Nobody was told. On a record
-- somebody signs their name to, about whether a machine is safe.
--
-- This column stores a fingerprint of the immutable content as first
-- accepted, so a later retry can be compared against what was actually
-- stored rather than against two columns of it.
--
-- NULLABLE ON PURPOSE. Records filed before this migration have no
-- fingerprint and none can be invented for them: the payload as sent was
-- never kept, and reconstructing one from the stored row would produce a
-- value that means nothing and would compare unequal to every honest retry.
-- They keep the old two-field behaviour, and the code says so where it
-- happens.

ALTER TABLE hoto_session
  ADD COLUMN IF NOT EXISTS payload_sha256 char(64);

COMMENT ON COLUMN hoto_session.payload_sha256 IS 'SHA-256 of the canonical immutable payload as first accepted. NULL for records filed before migration 114 — those fall back to comparing machine and session type only.';

-- Finding a handover by its client_uuid is now on the hot path of every
-- retry, not just of a first submission.
CREATE UNIQUE INDEX IF NOT EXISTS hoto_session_client_uuid_idx
  ON hoto_session (client_uuid);
