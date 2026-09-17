-- 019: blood groups are a closed list everywhere on earth.
--
-- Unlike departments or designations, this is not the mine's vocabulary to
-- invent — there are eight, and letting people type them freely produces B+,
-- B Positive and b+ for the same person's blood. The combobox still accepts a
-- new value, for the rare rh-null case nobody plans for.

INSERT INTO lookup (category, value, created_by) VALUES
    ('BLOOD_GROUP', 'O+',  'migration'),
    ('BLOOD_GROUP', 'O-',  'migration'),
    ('BLOOD_GROUP', 'A+',  'migration'),
    ('BLOOD_GROUP', 'A-',  'migration'),
    ('BLOOD_GROUP', 'B+',  'migration'),
    ('BLOOD_GROUP', 'B-',  'migration'),
    ('BLOOD_GROUP', 'AB+', 'migration'),
    ('BLOOD_GROUP', 'AB-', 'migration')
ON CONFLICT DO NOTHING;
