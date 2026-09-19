-- 031: anybody on the platform can write a note.
--
-- Migration 030 gave platform.comment.write to the roles that do work on the
-- platform — supervisors, registrars, approvers, assessors — and left Dashboard
-- Viewer, Shift Viewer and Access Manager able to read notes but not add one.
-- That was the wrong line to draw, in three places.
--
-- A viewer is not a lesser participant, they are somebody whose job is to look.
-- The person who notices that a machine has been standing for three days is
-- usually reading a dashboard, not registering equipment. A platform that lets
-- them see the problem but not say anything about it is one where they say it
-- somewhere else — which is the exact failure notes exist to fix.
--
-- So the grant goes to every role there is, including ones created later, and
-- the permission stops being a line anybody has to maintain. What makes that
-- safe is that nothing here is anonymous: a note carries its author and its
-- time, an edited one says so, and a deleted one leaves its row.
--
-- MODERATING IS A DIFFERENT THING and stays where it was. Deleting or closing
-- somebody else's note is not the same as having something to say.

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r, permission p
WHERE p.code = 'platform.comment.write'
ON CONFLICT DO NOTHING;

-- A role created next month should not have to be remembered either. The owner
-- trigger from 014 does this for the Superadmin when a permission is added;
-- this does it for this one permission when a role is added.
CREATE OR REPLACE FUNCTION grant_notes_to_new_role() RETURNS trigger AS $$
BEGIN
    INSERT INTO role_permission (role_id, permission_id)
    SELECT NEW.role_id, permission_id FROM permission
     WHERE code = 'platform.comment.write'
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS role_may_write_notes ON role;
CREATE TRIGGER role_may_write_notes
    AFTER INSERT ON role
    FOR EACH ROW EXECUTE FUNCTION grant_notes_to_new_role();
