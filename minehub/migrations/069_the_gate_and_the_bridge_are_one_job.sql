-- The man at the gate and the man at the bridge are the same shift.
--
-- A vehicle is admitted against a gate pass, hauls, is weighed, and is signed
-- out. At Kaliapani that is one person's day, and until now there was no role
-- for it: the only way to give somebody the bridge was Superadmin or piecing
-- permissions onto another role that was never meant to carry them.
--
-- WHAT IT HOLDS is the work of the shift:
--
--   wb.view    see the live weight, today's trips, the weighment record
--   wb.gate    let a vehicle in against a gate pass and sign it out again
--   wb.weigh   capture the weight the bridge is showing
--
-- WHAT IT DELIBERATELY DOES NOT HOLD, and why each one is a decision rather
-- than an oversight:
--
--   wb.manual   typing in a weight the bridge did not supply. This is the one
--               permission that lets somebody write a number the instrument
--               never measured. It exists for a failed indicator and it is the
--               obvious route to a false weighment, so it belongs to a
--               supervisor who can be asked about it, not to every shift.
--   wb.tare     a vehicle's standing tare is subtracted from every haul that
--               vehicle makes. One wrong tare quietly moves hundreds of net
--               tonnes, and it is not noticed on the day.
--   wb.manage   issuing and revoking the token a desktop agent uses to send
--               readings. Whoever holds this can point a bridge at a machine
--               of their choosing.
--   wb.masters  the materials, sources and destinations offered at the bridge.
--               Changing the list changes what every future weighment can say.
--
-- None of those is needed to run a shift, and each of them is a way to make
-- the weighment record say something that did not happen. The role can be
-- widened in a minute by whoever decides it should be; it cannot be narrowed
-- after somebody has used it.

INSERT INTO role (code, name, description, status, is_system, grants_everything, created_by)
SELECT 'GATE_WEIGHBRIDGE', 'Gate & Weighbridge Operator',
       'Run the gate and the weighbridge: admit a vehicle against its gate '
       'pass, capture the weight the bridge shows, and sign it out. Does not '
       'include entering weights by hand, setting a vehicle tare, managing '
       'bridges or agents, or changing the weighbridge lists.',
       'ACTIVE', FALSE, FALSE, 'migration-069'
 WHERE NOT EXISTS (SELECT 1 FROM role WHERE code = 'GATE_WEIGHBRIDGE');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM role r
  JOIN permission p ON p.code IN ('wb.view', 'wb.gate', 'wb.weigh')
 WHERE r.code = 'GATE_WEIGHBRIDGE'
   AND NOT EXISTS (SELECT 1 FROM role_permission rp
                    WHERE rp.role_id = r.role_id
                      AND rp.permission_id = p.permission_id);
