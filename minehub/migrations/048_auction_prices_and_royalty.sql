-- 048: what the ore fetched at auction, and what the mine owes on it.
--
-- Two additions, and they are deliberately separate things.
--
-- AUCTION PRICES are not average sale prices. OMC publishes a weighted
-- average achieved at a national e-auction, per mine, per grade band, for a
-- stated window — 20.08.2026 to 18.09.2026, say. IBM publishes a statistical
-- average for a whole state over a calendar month. Putting both in
-- mineral_price would mean a series that silently mixes two definitions, and
-- somebody would eventually average them. Different table, different
-- columns, shown side by side and never added together.
--
-- One of the mines OMC prices is South Kaliapani Chromite Mines, in the same
-- valley as this one and on the same ore, so it is the closest thing to a
-- market benchmark the mine has.
--
-- ROYALTY RATES are the percentages the statutory charges are worked out on.
-- Royalty is a share of the IBM average sale price; DMF and NMET are shares
-- OF THE ROYALTY, not of the price — 30% and 3% respectively. Getting that
-- wrong overstates the total by a factor of about four, which is why the
-- basis is a column and not an assumption in code.
--
-- The rates change by notification. They are rows with effective dates, so a
-- change is an INSERT and last quarter still computes on last quarter's
-- rates, rather than every historical figure silently moving.

-- ── OMC auction prices ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auction_price (
    auction_price_id bigserial PRIMARY KEY,
    source_id        bigint NOT NULL REFERENCES market_source(source_id),

    mine             text NOT NULL,
    mineral          text NOT NULL DEFAULT 'Chromite',
    -- As published: "+54%", "52-54%", "42-44%". The band, not a number,
    -- because the band is what was sold.
    grade            text NOT NULL,
    -- The Cr2O3 percentage the price is quoted on. A number, because this one
    -- is used for sorting and comparison.
    basis_pct        numeric(5, 2),

    price            numeric(14, 2) NOT NULL CHECK (price >= 0),
    unit             text NOT NULL DEFAULT 'MT',

    -- The window the price holds for, and the auction that set it.
    valid_from       date NOT NULL,
    valid_to         date NOT NULL,
    auction_date     date,

    document_url     text,
    fetched_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT auction_window_is_forwards CHECK (valid_to >= valid_from)
);

-- One price per mine per grade per window. Re-reading the same page updates.
CREATE UNIQUE INDEX IF NOT EXISTS ux_auction_price_point
    ON auction_price (mine, grade, valid_from);
CREATE INDEX IF NOT EXISTS ix_auction_price_recent
    ON auction_price (valid_from DESC, mine);

COMMENT ON TABLE auction_price IS
    'Weighted average achieved at OMC national e-auction, by mine and grade '
    'band, for a stated window. NOT an average sale price and not '
    'interchangeable with one.';

-- ── the statutory charges ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS royalty_rate (
    rate_id        bigserial PRIMARY KEY,
    code           text NOT NULL,
    name           text NOT NULL,

    percent        numeric(7, 4) NOT NULL CHECK (percent >= 0),

    -- What the percentage is OF. This is the column that stops the classic
    -- mistake: DMF is 30% of the royalty, not 30% of the sale price.
    basis          text NOT NULL CHECK (basis IN ('ASP', 'ROYALTY')),

    effective_from date NOT NULL,
    effective_to   date,
    note           text,

    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     text,

    CONSTRAINT rate_window_is_forwards
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- One rate per charge in force at a time. A new notification closes the old
-- row and opens a new one rather than editing history.
CREATE UNIQUE INDEX IF NOT EXISTS ux_royalty_rate_open
    ON royalty_rate (code) WHERE effective_to IS NULL;

COMMENT ON COLUMN royalty_rate.basis IS
    'ASP: a share of the average sale price. ROYALTY: a share of the royalty '
    'itself, which is how DMF and NMET are levied.';

INSERT INTO royalty_rate (code, name, percent, basis, effective_from, note) VALUES
 ('ROYALTY', 'Royalty', 15.0000, 'ASP', DATE '2020-01-01',
  'Chromite, as a share of the IBM average sale price.'),
 ('DMF', 'District Mineral Foundation', 30.0000, 'ROYALTY', DATE '2020-01-01',
  'Thirty per cent OF THE ROYALTY, not of the sale price.'),
 ('NMET', 'National Mineral Exploration Trust', 3.0000, 'ROYALTY', DATE '2020-01-01',
  'Three per cent OF THE ROYALTY, not of the sale price.')
ON CONFLICT DO NOTHING;

-- ── the source ──────────────────────────────────────────────────────────────
-- The site is an Angular application; the ore-prices URL returns 404 to a
-- plain fetch because the route is resolved in the browser. The figures come
-- from ourbusiness/orePricesList on their own API, which is what this reads.

UPDATE market_source
   SET url = 'https://omcltd.in/api/ourbusiness/orePricesList',
       parser = 'omc_prices',
       kind = 'PRICE',
       name = 'OMC e-auction prices',
       about = 'Odisha Mining Corporation publishes the weighted average '
               'price achieved at each national e-auction, by mine and grade. '
               'South Kaliapani Chromite Mines is the same ore in the same '
               'valley, so it is the closest market benchmark available.',
       every_hours = 12,
       last_error = NULL,
       last_status = NULL
 WHERE code = 'OMC_NOTICES';

UPDATE market_source SET code = 'OMC_PRICES' WHERE code = 'OMC_NOTICES';
