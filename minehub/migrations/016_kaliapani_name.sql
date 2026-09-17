-- 016: call 1200 what the people there call it.
--
-- SAP names the plant "Sukinda Mines", after the valley. Everyone at the mine
-- says Kaliapani, and a dropdown that disagrees with the person reading it
-- makes them stop and check whether it means somewhere else — particularly with
-- a genuine Sukinda Plant (1110) sitting next to it in the same list.
-- The code stays 1200, which is what SAP is matched on.

UPDATE plant SET name = 'Kaliapani Mines' WHERE code = '1200';
