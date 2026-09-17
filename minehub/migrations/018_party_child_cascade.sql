-- 018: a person's children go with the person.
--
-- Discarding a draft operator deletes the party row it created, and
-- party_identity held a plain foreign key — so the delete failed for exactly
-- the operators most likely to be discarded: the ones where someone had already
-- typed a SAP or contractor code. The same applies to employment history.
--
-- Cascade is right here in a way it is not for events: an identity or an
-- employment row describes a person and means nothing without them, while an
-- event records something that happened and outlives the record it pointed at.

ALTER TABLE party_identity DROP CONSTRAINT IF EXISTS party_identity_party_id_fkey;
ALTER TABLE party_identity ADD CONSTRAINT party_identity_party_id_fkey
    FOREIGN KEY (party_id) REFERENCES party (party_id) ON DELETE CASCADE;

ALTER TABLE party_employment DROP CONSTRAINT IF EXISTS party_employment_party_id_fkey;
ALTER TABLE party_employment ADD CONSTRAINT party_employment_party_id_fkey
    FOREIGN KEY (party_id) REFERENCES party (party_id) ON DELETE CASCADE;

ALTER TABLE competency DROP CONSTRAINT IF EXISTS competency_party_id_fkey;
ALTER TABLE competency ADD CONSTRAINT competency_party_id_fkey
    FOREIGN KEY (party_id) REFERENCES party (party_id) ON DELETE CASCADE;

-- The activity log is the exception. An event records something that happened;
-- it must outlive the record it pointed at, or discarding a draft would erase
-- the evidence that the draft ever existed — which is the one thing the log is
-- for. So the reference is cleared, not the row, exactly as event.asset_id
-- already does for machines.
ALTER TABLE event DROP CONSTRAINT IF EXISTS event_party_id_fkey;
ALTER TABLE event ADD CONSTRAINT event_party_id_fkey
    FOREIGN KEY (party_id) REFERENCES party (party_id) ON DELETE SET NULL;
