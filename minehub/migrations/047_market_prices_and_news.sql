-- 047: what chrome ore is worth, and what is being said about it.
--
-- The mine's royalty is calculated on the Indian Bureau of Mines Average Sale
-- Price for chromite in Odisha, published monthly as a PDF. Today somebody
-- downloads it and reads the number off. That works until the month nobody
-- remembers, and it leaves no series — "what has 40-52% lumps done since
-- April" is a question that currently means opening twelve PDFs.
--
-- WHAT IS STORED AND WHAT IS NOT. The price as published, against the period
-- it was published for, with the URL of the document it came from on every
-- row. Nothing is derived on the way in: trends, changes and averages are
-- computed when read, so a corrected figure corrects everything downstream
-- rather than leaving a stale average behind it.
--
-- THE SOURCE IS DATA. Government sites move — the IBM Average Sale Price page
-- moved from a query-string URL to /IBMPortal/pages/Average_Sale_Price while
-- this was being written, and the separate asp.ibm.gov.in portal does not
-- answer at all. A source in a table is a URL somebody can fix at two in the
-- afternoon; a source in code is a release.

-- ── where things come from ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_source (
    source_id    bigserial PRIMARY KEY,
    code         text NOT NULL UNIQUE,
    name         text NOT NULL,

    -- PRICE sources yield numbers, NEWS sources yield items to read. Kept in
    -- one table because they share everything else: a URL, a schedule, and
    -- the question of whether the last run worked.
    kind         text NOT NULL CHECK (kind IN ('PRICE', 'NEWS')),

    url          text NOT NULL,
    -- Which collector handles it. Adding a source of a shape that already has
    -- a collector is a row; a new shape is a release.
    parser       text NOT NULL,
    is_active    boolean NOT NULL DEFAULT TRUE,

    -- Plain English, shown on the screen beside whatever it produced, so the
    -- reader can judge the number without leaving the page.
    about        text,

    every_hours  integer NOT NULL DEFAULT 24 CHECK (every_hours > 0),
    last_run_at  timestamptz,
    last_ok_at   timestamptz,
    last_status  text,
    last_error   text,

    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE market_source IS
    'Where prices and news are fetched from. Rows, not code, because these '
    'are government sites and they move.';

-- ── the prices ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mineral_price (
    price_id     bigserial PRIMARY KEY,
    source_id    bigint NOT NULL REFERENCES market_source(source_id),

    mineral      text NOT NULL,
    -- As the publication words it: "40% To Below 52 % Cr2O3,Lumps". Kept
    -- verbatim rather than tidied into a code, because the grade IS the
    -- publication's own wording and a rewrite is a chance to change meaning.
    grade        text NOT NULL,
    state        text NOT NULL,

    -- First of the month the price is FOR, not the day it was fetched. The
    -- February issue is the February price whenever it happens to be read.
    period       date NOT NULL,

    price        numeric(14, 2) NOT NULL CHECK (price >= 0),
    unit         text NOT NULL DEFAULT 't',

    -- Provenance on the row itself. Somebody questioning a figure should
    -- reach the PDF it came from in one click, not be told where to look.
    document_url text,
    fetched_at   timestamptz NOT NULL DEFAULT now(),

    -- A parse that goes wrong rarely produces a plausible number; it produces
    -- a wild one. Flagged rows are shown, marked, and counted — never hidden,
    -- because a hidden row is one nobody checks.
    is_flagged   boolean NOT NULL DEFAULT FALSE,
    flag_reason  text,

    CONSTRAINT price_period_is_a_month CHECK (EXTRACT(day FROM period) = 1)
);

-- One price per grade per state per month. Re-reading the same PDF, or IBM
-- republishing a corrected one, updates rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mineral_price_point
    ON mineral_price (mineral, grade, state, period);

CREATE INDEX IF NOT EXISTS ix_mineral_price_series
    ON mineral_price (mineral, state, period DESC);
CREATE INDEX IF NOT EXISTS ix_mineral_price_flagged
    ON mineral_price (is_flagged) WHERE is_flagged;

COMMENT ON COLUMN mineral_price.period IS
    'First of the month the price applies to. The February issue is the '
    'February price however late it is read.';

-- ── the news ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_news (
    news_id      bigserial PRIMARY KEY,
    source_id    bigint NOT NULL REFERENCES market_source(source_id),

    title        text NOT NULL,
    -- The natural key. The same notice reached twice is one notice, and
    -- several feeds carry the same story.
    url          text NOT NULL UNIQUE,

    published_at timestamptz,
    summary      text,
    fetched_at   timestamptz NOT NULL DEFAULT now(),

    -- Set by the collector from words in the title and summary. Lets the
    -- screen separate "this concerns chrome" from the rest of the sector
    -- without another request.
    tags         text[] NOT NULL DEFAULT ARRAY[]::text[]
);

CREATE INDEX IF NOT EXISTS ix_market_news_recent
    ON market_news (COALESCE(published_at, fetched_at) DESC);
CREATE INDEX IF NOT EXISTS ix_market_news_tags
    ON market_news USING gin (tags);

-- ── who may look ────────────────────────────────────────────────────────────

INSERT INTO permission (code, module, name, description, is_sensitive, sort_order) VALUES
 ('market.view', 'Market', 'See prices and market news',
  'Chrome ore sale prices as published by the Indian Bureau of Mines, and '
  'mining and metals news. Read-only: nothing here is the mine''s own data.',
  FALSE, 340),
 ('market.refresh', 'Market', 'Fetch from the sources now',
  'Run the collectors without waiting for the schedule. Useful when a '
  'publication is expected and nobody wants to wait until tomorrow.',
  FALSE, 341)
ON CONFLICT (code) DO NOTHING;

-- Anybody who can already read a dashboard can read a published price: it is
-- public information and the royalty is calculated on it.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM role r, permission p
WHERE p.code = 'market.view'
  AND r.code IN ('DASHBOARD_VIEWER', 'SHIFT_SUPERVISOR', 'ACCESS_MANAGER')
ON CONFLICT DO NOTHING;

-- ── the sources themselves ──────────────────────────────────────────────────
-- Verified reachable from the mine's own server on 21 September 2026. The
-- separate asp.ibm.gov.in portal is deliberately absent: it does not answer.

INSERT INTO market_source (code, name, kind, url, parser, about, every_hours) VALUES
 ('IBM_ASP', 'IBM Average Sale Price', 'PRICE',
  'https://ibm.gov.in/IBMPortal/pages/Average_Sale_Price', 'ibm_asp_pdf',
  'The Indian Bureau of Mines publishes state-wise average sale price by '
  'mineral and grade each month, as a PDF extracted from the Monthly '
  'Statistics of Mineral Production. Chromite for Odisha is what the royalty '
  'is calculated on.', 12),

 ('MINES_MIN_PIB', 'Ministry of Mines (PIB)', 'NEWS',
  'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', 'rss',
  'Government press releases from the Ministry of Mines.', 6),

 ('GMINING_NEWS', 'Google News — Indian mining and metals', 'NEWS',
  'https://news.google.com/rss/search?q=(chrome+ore+OR+ferrochrome+OR+chromite+OR+%22Odisha+mining%22+OR+%22Indian+Bureau+of+Mines%22)&hl=en-IN&gl=IN&ceid=IN:en',
  'rss',
  'Chrome ore, ferrochrome and Odisha mining coverage from the trade and '
  'general press.', 3),

 ('OMC_NOTICES', 'Odisha Mining Corporation', 'NEWS',
  'https://omcltd.in/', 'omc',
  'OMC notices and tenders. Their site is a single-page application backed '
  'by an undocumented API, so this collector is the least certain of the '
  'four and says so when it cannot read anything.', 12)
ON CONFLICT (code) DO NOTHING;
