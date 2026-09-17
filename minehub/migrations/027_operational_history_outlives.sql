-- 027: what happened outlives who it happened to.
--
-- Deleting an operator failed because a deployment still pointed at them. The
-- foreign key was right to object and wrong about what to do: a deployment is a
-- record of eight hours of work that did happen, and it should not be deletable
-- by removing the person, nor should it stop the person being removed.
--
-- So the reference is cleared rather than the row — the same rule the event log
-- already follows. The deployment keeps its machine, its hours and its shift;
-- what it loses is the name, which is exactly what removing a person means.
-- Availability events and plans are different: an absence with nobody absent is
-- not a fact about anything, so those go with the person.

ALTER TABLE deployment DROP CONSTRAINT IF EXISTS deployment_operator_id_fkey;
ALTER TABLE deployment ADD CONSTRAINT deployment_operator_id_fkey
    FOREIGN KEY (operator_id) REFERENCES operator (operator_id) ON DELETE SET NULL;

ALTER TABLE hoto DROP CONSTRAINT IF EXISTS hoto_outgoing_operator_id_fkey;
ALTER TABLE hoto ADD CONSTRAINT hoto_outgoing_operator_id_fkey
    FOREIGN KEY (outgoing_operator_id) REFERENCES operator (operator_id) ON DELETE SET NULL;

ALTER TABLE hoto DROP CONSTRAINT IF EXISTS hoto_incoming_operator_id_fkey;
ALTER TABLE hoto ADD CONSTRAINT hoto_incoming_operator_id_fkey
    FOREIGN KEY (incoming_operator_id) REFERENCES operator (operator_id) ON DELETE SET NULL;

-- A machine leaving the register is the same argument.
ALTER TABLE deployment DROP CONSTRAINT IF EXISTS deployment_asset_id_fkey;
ALTER TABLE deployment ADD CONSTRAINT deployment_asset_id_fkey
    FOREIGN KEY (asset_id) REFERENCES asset (asset_id) ON DELETE RESTRICT;
