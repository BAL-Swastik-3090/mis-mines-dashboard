-- 055: an outside truck cannot be inside twice either.
--
-- 054 stopped a registered machine being let in while it was already inside,
-- with a unique index on asset_id. Testing the gate showed the other half was
-- open: a vehicle typed in as free text — an outside tipper, a vendor's
-- delivery truck, anything not on the equipment register — could be given a
-- second open gate pass while the first was still running.
--
-- That is not a rare case at this gate. Outside trucks are most of the traffic
-- on a despatch shift, and they are exactly the ones whose number is typed
-- rather than chosen from a list. Two open passes for one truck means two
-- weighments that both look valid and a yard count that drifts all shift.
--
-- Normalised, because the same truck arrives as "OD35F4475", "od35f4475" and
-- "OD 35 F 4475" depending on who is at the gate, and three spellings of one
-- lorry would defeat the check entirely. Spaces and hyphens go, and case with
-- them; what is stored is still exactly what was typed.

CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_one_open_per_vehicle_text
    ON gate_pass (upper(regexp_replace(vehicle_no_text, '[^A-Za-z0-9]', '', 'g')))
    WHERE asset_id IS NULL
      AND nullif(trim(vehicle_no_text), '') IS NOT NULL
      AND status IN ('OPEN', 'WEIGHED');

COMMENT ON INDEX gate_pass_one_open_per_vehicle_text IS
    'One open pass per unregistered vehicle number, ignoring spacing and case. '
    'The registered-machine equivalent is gate_pass_one_open_per_asset.';
