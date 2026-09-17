-- 021: the contractors the mine actually engages, and the words for next of kin.
--
-- The employer picker offered BAL and "Sample Contractor" — the second of which
-- I created to seed demonstration machines, and neither of which covers the
-- agencies whose people are on site. The mine's own agency master names four:
-- BAL, DASHMESH, SANY and SIDHIVINAYAK. They are copied in as parties, which is
-- what a contractor already is on the equipment side, so a hired machine and a
-- contract operator point at the same organisation rather than at two records
-- that happen to share a name.
--
-- Relationships are seeded rather than typed because "brother" arrives as
-- Borther, Brother and BROTHER within a week otherwise, and an emergency
-- contact is read in a hurry by someone who has no time to work out that three
-- spellings are one word. The list stays open — anyone can add to it.

INSERT INTO party (party_type, legal_name, display_name, org_category, status, created_by)
VALUES
    ('ORGANISATION', 'Dashmesh',      'DASHMESH',     'CONTRACTOR', 'ACTIVE', 'migration'),
    ('ORGANISATION', 'Sany',          'SANY',         'CONTRACTOR', 'ACTIVE', 'migration'),
    ('ORGANISATION', 'Sidhivinayak',  'SIDHIVINAYAK', 'CONTRACTOR', 'ACTIVE', 'migration')
ON CONFLICT DO NOTHING;

-- The placeholder contractor from the demonstration fleet, renamed rather than
-- deleted: machines point at it, and a dangling reference is worse than an
-- honest label.
UPDATE party SET display_name = 'Sample Contractor (demo)',
                 legal_name   = 'Sample Contractor (demo)'
WHERE display_name = 'Sample Contractor';

INSERT INTO lookup (category, value, created_by) VALUES
    ('RELATIONSHIP', 'Wife',        'migration'),
    ('RELATIONSHIP', 'Husband',     'migration'),
    ('RELATIONSHIP', 'Father',      'migration'),
    ('RELATIONSHIP', 'Mother',      'migration'),
    ('RELATIONSHIP', 'Brother',     'migration'),
    ('RELATIONSHIP', 'Sister',      'migration'),
    ('RELATIONSHIP', 'Son',         'migration'),
    ('RELATIONSHIP', 'Daughter',    'migration'),
    ('RELATIONSHIP', 'Guardian',    'migration'),
    ('RELATIONSHIP', 'Friend',      'migration'),
    ('RELATIONSHIP', 'Other',       'migration')
ON CONFLICT DO NOTHING;

INSERT INTO lookup (category, value, created_by) VALUES
    ('SHIFT_PATTERN', 'Rotating A/B/C', 'migration'),
    ('SHIFT_PATTERN', 'General shift',  'migration'),
    ('SHIFT_PATTERN', 'Day only',       'migration'),
    ('SHIFT_PATTERN', 'Night only',     'migration')
ON CONFLICT DO NOTHING;
