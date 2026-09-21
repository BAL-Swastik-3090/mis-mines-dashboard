-- 051: changing a statutory rate is its own right.
--
-- The rate editor was gated on market.refresh, which is the right to re-run a
-- collector — a harmless, repeatable action. Changing the royalty percentage
-- is neither: it moves every figure on the screen and the figures feed a
-- payment. Somebody trusted to press Fetch now is not thereby trusted to
-- decide the mine owes eighteen per cent.
--
-- Nobody is given it here beyond the superadmin, who has it through the
-- standing grant. An Access Manager decides who else, deliberately, once.

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order)
VALUES ('market.rates.manage', 'Market', 'Change a statutory rate',
        'Record a new royalty, DMF or NMET percentage from a date. Every '
        'royalty figure on the platform is worked out from these, and the '
        'previous rate is kept so past periods still compute correctly.',
        TRUE, 342)
ON CONFLICT (code) DO NOTHING;
