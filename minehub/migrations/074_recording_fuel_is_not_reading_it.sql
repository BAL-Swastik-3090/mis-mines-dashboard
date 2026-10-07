-- 074: recording fuel is not the same as reading it.
--
-- The fuel screens are on dashboard.fuel, which every dashboard role holds.
-- Reading how much diesel a machine burnt is a reporting question and belongs
-- there. Writing a totaliser reading, booking an issue, or changing what a
-- machine is measured in are not: they change the record that the whole
-- reconciliation is built on.
--
-- Two permissions, because the people who do them are not the same people.
-- The man at the fuel point reads a meter twice a shift and should not be able
-- to redefine the fleet; the fuel office maintains the masters and is not
-- standing at the pump at 6am.

INSERT INTO permission (code, name, description, module, is_sensitive, sort_order)
SELECT 'fuel.record',
       'Record fuel readings and issues',
       'Enter pump totaliser readings, machine hour or kilometre readings, and '
       'issues of diesel. The entry is deliberately permissive -- a reading '
       'that looks wrong is stored and flagged, never refused -- so this is '
       'the permission to give the people actually at the fuel point.',
       'Operations', FALSE,
       COALESCE((SELECT MAX(sort_order) FROM permission WHERE module = 'Operations'), 0) + 1
 WHERE NOT EXISTS (SELECT 1 FROM permission WHERE code = 'fuel.record');

INSERT INTO permission (code, name, description, module, is_sensitive, sort_order)
SELECT 'fuel.manage',
       'Manage fuel masters',
       'Define issuing points and tanks, say what each machine is measured in, '
       'set consumption benchmarks and the tolerances that decide which gaps '
       'get raised. These settings decide what the reconciliation reports, so '
       'they sit apart from day-to-day recording.',
       'Operations', FALSE,
       COALESCE((SELECT MAX(sort_order) FROM permission WHERE module = 'Operations'), 0) + 2
 WHERE NOT EXISTS (SELECT 1 FROM permission WHERE code = 'fuel.manage');
