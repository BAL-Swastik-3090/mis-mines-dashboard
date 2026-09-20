-- 041: the other departments Kaliapani employs people in.
--
-- The platform had two units, Mining Operation and Automobile, which covers
-- the 195 of CLL's 211 workmen who move rock or fix the things that move it.
-- The remaining sixteen are in departments that exist on site and not on the
-- platform: seven in HR, two on the chrome ore beneficiation plant, two in
-- electrical, one in IT, one on the effluent treatment plant, one in HR/IR.
--
-- Left alone, every one of those people would be registered with no unit and a
-- note explaining why, which turns "somebody should look at this" into
-- sixteen rows of "nothing to look at here" and buries the eight that do need
-- a person. A missing department is not a data problem, it is a department we
-- had not got round to writing down.
--
-- HR/IR is not given a unit of its own: industrial relations is part of HR
-- everywhere on this site, and one person's designation is not a department.

INSERT INTO org_unit (code, name, created_by) VALUES
    ('HR',         'Human Resources',                'MIGRATION 041'),
    ('ELECTRICAL', 'Electrical',                     'MIGRATION 041'),
    ('IT',         'Information Technology',         'MIGRATION 041'),
    ('COBP',       'Chrome Ore Beneficiation Plant', 'MIGRATION 041'),
    ('ETP',        'Effluent Treatment Plant',       'MIGRATION 041')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE org_unit IS
    'The departments people are posted to. Kept as rows because a headcount by '
    'department is a question the mine asks weekly, and a department that is '
    'only a string in somebody''s designation cannot answer it.';
