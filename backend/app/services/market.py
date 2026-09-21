"""Fetching chrome ore prices and mining news from outside the mine.

Everything here reads public sources and writes to the platform's own tables.
Nothing is written back to anybody else's system, and no source is trusted to
be up: each collector records what happened on its own row, so a screen can
say "IBM last answered at 06:12" rather than showing an empty chart and
leaving the reader to guess whether that means no news or no connection.

WHAT WAS LEARNED BUILDING THIS, because the next person will hit it too:

  * The dedicated Average Sale Price portal at asp.ibm.gov.in does not answer
    at all, from here or from the mine's own server in India. The monthly PDFs
    are still published on the main site, which does answer.

  * IBM's old query-string URLs (?c=pages&m=index&id=912&mid=...) now redirect
    to the homepage. The page moved to /IBMPortal/pages/Average_Sale_Price.
    That is why the URL is a row in market_source and not a constant.

  * The PDF is a table, not prose. Reading it with extract_text loses the
    columns — the grade and the price end up on different lines. The tables
    have to be extracted as tables.

  * OMC is an Angular application whose content arrives from an undocumented
    API. Its collector is the weakest of the four and is written to fail
    quietly and say so, rather than to guess.
"""
from __future__ import annotations

import io
import logging
import re
from datetime import date, datetime, timezone

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

UA = {"User-Agent": "Mozilla/5.0 (compatible; KaliapaniMinesDashboard/1.0)"}
TIMEOUT = 90.0

# The mine produces chrome ore in Odisha. Everything else IBM publishes is
# somebody else's business, and storing it would mean 207 rows a month of
# which 6 are read.
MINERAL = "Chromite"
STATE = "ODISHA"

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], start=1)}

# A price that moves more than this against the month before is more likely a
# parse that went wrong than a market that did. Flagged, never hidden.
JUMP = 0.40

# Written this way because the shell used to author this file eats
# backslash escapes in heredocs, and a mangled separator is a silent bug.
NEWLINE = chr(10)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fetch(url: str) -> httpx.Response:
    # verify=False: several Indian government sites present certificate chains
    # that this container cannot complete, and the alternative is not fetching
    # them. These are public documents read for their content, and the URL of
    # every one is stored beside the figures it produced, so a substituted
    # document would be visible rather than silent.
    with httpx.Client(timeout=TIMEOUT, headers=UA, follow_redirects=True,
                      verify=False) as c:
        r = c.get(url)
        r.raise_for_status()
        return r


# ── IBM Average Sale Price ──────────────────────────────────────────────────

def _asp_pdf_links(page_html: str) -> list[str]:
    """Every ASP PDF the page offers, newest-looking first.

    The filenames carry a hash prefix and cannot be constructed, so the page
    has to be read to find them. Metals and disclaimer PDFs sit on the same
    page and are not wanted.
    """
    # The hrefs are RELATIVE — href="../../writereaddata/files/..." — and some
    # elsewhere on the page carry an /IBMPortal prefix. Anchoring the pattern
    # to the opening quote matches none of them, which is how this first
    # looked like "the page has moved again" when it had not.
    found = re.findall(
        r'(?:\.\./)*/?(?:IBMPortal/+)?writereaddata/files/[^"\'<> ]+?\.pdf',
        page_html, re.I)
    out: list[str] = []
    for href in found:
        name = href.rsplit("/", 1)[-1]
        if not re.search(r"asp", name, re.I):
            continue
        # Metals are priced on another basis and are not what royalty is
        # calculated on; the disclaimers are not prices at all.
        if re.search(r"metal|disclamer|disclaimer", name, re.I):
            continue
        url = "https://ibm.gov.in/writereaddata/" + href.split("writereaddata/", 1)[1]
        if url not in out:
            out.append(url)
    return out


def _period_of(txt: str, filename: str = "") -> date | None:
    """The month the issue is FOR.

    Preferably from its own cover line, which is unambiguous. Four of the six
    issues published so far do not carry that line in a form this can read, so
    the filename is the fallback — IBM names them ..._June2026.pdf,
    ..._May_2026_2.pdf, ..._Report_Mineral_April_2026.pdf. Less trustworthy
    than the cover, which is why it is second.
    """
    flat = re.sub(r"\s+", " ", txt)
    m = re.search(
        # "March2026" — one issue runs the month into the year, so the
        # separator has to be optional rather than required.
        r"Monthly Statistics of Mineral Production\s+([A-Za-z]+)[,\s]*(\d{4})",
        flat, re.I)
    if m:
        month = MONTHS.get(m.group(1).lower())
        if month:
            return date(int(m.group(2)), month, 1)

    m = re.search(r"(" + "|".join(MONTHS) + r")[_\s-]*(\d{4})", filename, re.I)
    if m:
        month = MONTHS.get(m.group(1).lower())
        if month:
            return date(int(m.group(2)), month, 1)
    return None


_STATE_ROW = re.compile(r"^[A-Z][A-Z &.\-()]{3,}$")
_PUBLISHED = re.compile(
    r"Publish(?:ed)?\s*Date\s*[:\-]?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", re.I)


def _published_on(txt: str) -> date | None:
    """The day the issue was released, from its own cover.

    Worth having because IBM runs about two months behind: the June 2026
    issue came out on 13 August. Without it, "there is no July figure" and
    "the collector has stopped" look the same.
    """
    m = _PUBLISHED.search(re.sub(r"\s+", " ", txt))
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100:
        y += 2000
    try:
        return date(y, mo, d)
    except ValueError:
        return None


class ScannedIssue(RuntimeError):
    """The PDF has no text layer — IBM published a scan of a printout.

    May 2026 is one: fifteen pages, fifteen images, not one character. OCR
    could guess at the digits, and deliberately is not used. These figures
    are what royalty is calculated on, and an OCR misread that happens to be
    plausible passes every check we could put on it. Better to say the month
    cannot be read and link the PDF.
    """


def parse_asp_pdf(content: bytes,
                  filename: str = "") -> tuple[date | None, date | None, list[dict]]:
    """Chromite rows for Odisha, with the period the issue covers.

    The table's first column carries three different things depending on the
    row: a state in capitals, a mineral (which is the row that also carries
    the unit), or a grade (which is the row that carries a price). Walking it
    in order is what tells them apart.
    """
    import pdfplumber  # imported here so the app starts without it installed

    period: date | None = None
    published: date | None = None
    state = mineral = unit = None
    rows: list[dict] = []

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        if not any((p.extract_text() or "").strip() for p in pdf.pages):
            raise ScannedIssue(
                f"{len(pdf.pages)} pages and no text at all — this issue was "
                "published as a scan. Open the PDF to read it.")
        for page in pdf.pages:
            txt = page.extract_text() or ""
            if period is None:
                period = _period_of(txt, filename)
            if published is None:
                published = _published_on(txt)
            for table in page.extract_tables():
                for raw in table:
                    cells = [(c or "").replace("\n", " ").strip() for c in raw]
                    # Four columns in some issues, three in others: January
                    # 2026 has no spacer column, so reading cells[2] and
                    # cells[3] took the unit as the price and found nothing.
                    # Position from the ends — the label is always first and
                    # the price always last, whatever sits between them.
                    if len(cells) < 3:
                        continue
                    label, price = cells[0], cells[-1]
                    u = next((c for c in cells[1:-1] if c), "")
                    if not label or label.startswith("State /"):
                        continue
                    if _STATE_ROW.match(label) and not price:
                        state, mineral = label, None
                        continue
                    if u and not price:
                        mineral, unit = label, u
                        continue
                    if not (price and mineral):
                        continue
                    if state != STATE or MINERAL.lower() not in mineral.lower():
                        continue
                    value = re.sub(r"[^\d.]", "", price)
                    if not value:
                        continue
                    rows.append({"mineral": MINERAL, "grade": label,
                                 "state": state, "unit": unit or "t",
                                 "price": float(value)})
    return period, published, rows


def collect_ibm_asp(db: Session, source: dict) -> dict:
    """Read the ASP page, take any issue we do not already hold, store it."""
    page = _fetch(source["url"]).text
    links = _asp_pdf_links(page)
    if not links:
        raise RuntimeError(
            "The Average Sale Price page offered no ASP PDF. It has probably "
            "moved again — check the URL on this source.")

    written = flagged = 0
    seen_periods: list[str] = []
    skipped: list[str] = []

    # The page lists the last half-dozen issues newest first. Opening all of
    # them each run is cheap and means a month republished as a readable PDF
    # after being posted as a scan gets picked up without anybody asking.
    for url in links[:6]:
        name = url.rsplit("/", 1)[-1]
        try:
            period, published, rows = parse_asp_pdf(_fetch(url).content, name)
        except ScannedIssue as exc:
            # Not a fault — the source did this, and the screen should say so
            # rather than showing a gap in the series with no explanation.
            when = _period_of("", name)
            skipped.append(f"{when or name}: {exc}")
            continue
        except Exception as exc:                      # one bad PDF, not the run
            logger.warning("ASP PDF unreadable %s: %s", url, exc)
            skipped.append(f"{name}: unreadable")
            continue
        if not period:
            skipped.append(f"{name}: could not tell which month it is for")
            continue
        if not rows:
            skipped.append(f"{period}: no Odisha chromite rows in it")
            continue
        seen_periods.append(period.isoformat())
        for r in rows:
            prev = db.execute(text("""
                SELECT price FROM mineral_price
                 WHERE mineral = :m AND grade = :g AND state = :s AND period < :p
                 ORDER BY period DESC LIMIT 1
            """), {"m": r["mineral"], "g": r["grade"], "s": r["state"],
                   "p": period}).scalar()
            reason = None
            if prev and float(prev) > 0:
                moved = abs(r["price"] - float(prev)) / float(prev)
                if moved > JUMP:
                    reason = (f"{moved * 100:.0f}% against the month before "
                              f"({float(prev):,.0f} to {r['price']:,.0f}). "
                              "Check it against the PDF before relying on it.")
            db.execute(text("""
                INSERT INTO mineral_price (source_id, mineral, grade, state,
                                           period, price, unit, document_url,
                                           published_on, is_flagged, flag_reason)
                VALUES (:src, :m, :g, :s, :p, :v, :u, :doc, :pub, :fl, :why)
                ON CONFLICT (mineral, grade, state, period) DO UPDATE
                   SET price = EXCLUDED.price,
                       unit = EXCLUDED.unit,
                       document_url = EXCLUDED.document_url,
                       published_on = EXCLUDED.published_on,
                       fetched_at = now(),
                       is_flagged = EXCLUDED.is_flagged,
                       flag_reason = EXCLUDED.flag_reason
            """), {"src": source["source_id"], "m": r["mineral"], "g": r["grade"],
                   "s": r["state"], "p": period, "v": r["price"], "u": r["unit"],
                   "doc": url, "pub": published,
                   "fl": reason is not None, "why": reason})
            written += 1
            flagged += 1 if reason else 0

    if not written and skipped:
        raise RuntimeError("Nothing readable. " + " | ".join(skipped[:3]))
    return {"prices": written, "flagged": flagged,
            "periods": sorted(set(seen_periods)),
            "skipped": skipped}


# ── news ────────────────────────────────────────────────────────────────────

CHROME_WORDS = re.compile(
    r"chrom|ferro\s*-?chrome|cr2o3|kaliapani|sukinda|jajpur", re.I)
MINING_WORDS = re.compile(
    r"\bmin(e|es|ing)\b|ore\b|royalt|mmdr|ibm\b|bureau of mines|smelter|"
    r"ferroalloy|ferro\s*-?alloy|omc\b|odisha mining", re.I)


def _tags(title: str, summary: str) -> list[str]:
    blob = f"{title} {summary or ''}"
    out = []
    if CHROME_WORDS.search(blob):
        out.append("chrome")
    if MINING_WORDS.search(blob):
        out.append("mining")
    return out or ["other"]


def collect_rss(db: Session, source: dict) -> dict:
    import feedparser

    raw = _fetch(source["url"]).content
    feed = feedparser.parse(raw)
    added = 0
    for e in feed.entries[:60]:
        url = (getattr(e, "link", "") or "").strip()
        title = (getattr(e, "title", "") or "").strip()
        if not url or not title:
            continue
        summary = re.sub(r"<[^>]+>", " ", getattr(e, "summary", "") or "")
        summary = re.sub(r"\s+", " ", summary).strip()[:900] or None
        when = None
        parsed = getattr(e, "published_parsed", None) or getattr(e, "updated_parsed", None)
        if parsed:
            when = datetime(*parsed[:6], tzinfo=timezone.utc)
        # The same story reaches several feeds. url is unique, so the first
        # feed to carry it owns the row and the rest are no-ops.
        r = db.execute(text("""
            INSERT INTO market_news (source_id, title, url, published_at, summary, tags)
            VALUES (:src, :t, :u, :p, :s, :g)
            ON CONFLICT (url) DO NOTHING
        """), {"src": source["source_id"], "t": title[:500], "u": url,
               "p": when, "s": summary, "g": _tags(title, summary or "")})
        added += r.rowcount or 0
    return {"news": added, "offered": len(feed.entries)}


# ── OMC e-auction prices ────────────────────────────────────────────────────

# The site is Angular: https://omcltd.in/en/our-business/ore-prices returns 404
# to a plain fetch because the route is resolved in the browser. The figures
# come from their own API, whose key is published in their JavaScript bundle —
# it identifies the site's own client, not a user, and this reads the same
# public prices the page shows. The key is read from the bundle at run time
# rather than pinned here, because theirs rotates when they rebuild.
OMC_BUNDLE = re.compile(r"main\.[a-f0-9]+\.js")
OMC_KEY = re.compile(r"OMCapiKey\s*=\s*[\"']([^\"']+)")

# "For The Period From Dt.20.08.2026 to 18.09.2026 (As Per National E-Auction
# Dt.19.08.2026)"
OMC_WINDOW = re.compile(
    r"From\s*Dt\.?\s*(\d{2})\.(\d{2})\.(\d{4}).{0,12}?to\s*(\d{2})\.(\d{2})\.(\d{4})",
    re.I | re.S)
OMC_AUCTION = re.compile(r"E-?Auction\s*Dt\.?\s*(\d{2})\.(\d{2})\.(\d{4})", re.I)

_TAG = re.compile(r"<[^>]+>")
_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S | re.I)


def _clean(html: str) -> str:
    t = _TAG.sub(" ", html)
    for a, b in (("&amp;", "&"), ("&nbsp;", " "), ("&#39;", "'"), ("&quot;", '"')):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t).strip()


def _omc_key() -> str:
    home = _fetch("https://omcltd.in/").text
    m = OMC_BUNDLE.search(home)
    if not m:
        raise RuntimeError("Could not find OMC's script bundle to read their key from.")
    js = _fetch("https://omcltd.in/" + m.group(0)).text
    k = OMC_KEY.search(js)
    if not k:
        raise RuntimeError("OMC's bundle no longer carries the key this reads.")
    return k.group(1)


def parse_omc_chrome(html: str) -> tuple[date | None, date | None, date | None, list[dict]]:
    """The chrome ore table: mine, grade band, basis, price.

    The mine name is a rowspan, so it appears once per group and the rows
    under it have one cell fewer. Carrying the last mine forward is what keeps
    Sukrangi's grades from being filed under South Kaliapani.
    """
    head = _clean(html)
    w = OMC_WINDOW.search(head)
    frm = date(int(w.group(3)), int(w.group(2)), int(w.group(1))) if w else None
    to = date(int(w.group(6)), int(w.group(5)), int(w.group(4))) if w else None
    a = OMC_AUCTION.search(head)
    auction = date(int(a.group(3)), int(a.group(2)), int(a.group(1))) if a else None

    out: list[dict] = []
    mine = None
    for row in _ROW.findall(html):
        cells = [_clean(c) for c in _CELL.findall(row)]
        if len(cells) >= 4:
            mine, grade, basis, price = cells[0], cells[1], cells[2], cells[3]
        elif len(cells) == 3 and mine:
            grade, basis, price = cells
        else:
            continue
        if not re.search(r"\d", price) or "Weighted" in price:
            continue
        value = re.sub(r"[^\d.]", "", price)
        if not value:
            continue
        pct = re.sub(r"[^\d.]", "", basis)
        out.append({"mine": mine, "grade": grade,
                    "basis_pct": float(pct) if pct else None,
                    "price": float(value)})
    return frm, to, auction, out


def collect_omc_prices(db: Session, source: dict) -> dict:
    key = _omc_key()
    with httpx.Client(timeout=TIMEOUT, headers={**UA, "ApiKey": key},
                      follow_redirects=True, verify=False) as c:
        r = c.get(source["url"])
        r.raise_for_status()
        payload = r.json()

    tabs = payload.get("data") or []
    chrome = next((t for t in tabs
                   if "chrome" in str(t.get("title", "")).lower()
                   and "ferro" not in str(t.get("title", "")).lower()), None)
    if not chrome:
        raise RuntimeError(
            "OMC answered, but with no Chrome Ore tab. They publish "
            f"{', '.join(str(t.get('title')) for t in tabs) or 'nothing'}.")

    frm, to, auction, rows = parse_omc_chrome(chrome.get("content") or "")
    if not rows:
        raise RuntimeError("The Chrome Ore tab held no priced rows.")
    if not frm:
        raise RuntimeError(
            "Could not read the period the prices hold for, and a price "
            "without its window is not worth storing.")

    written = 0
    for r_ in rows:
        db.execute(text("""
            INSERT INTO auction_price (source_id, mine, grade, basis_pct, price,
                                       valid_from, valid_to, auction_date,
                                       document_url)
            VALUES (:src, :mine, :g, :b, :p, :f, :t, :a, :doc)
            ON CONFLICT (mine, grade, valid_from) DO UPDATE
               SET price = EXCLUDED.price,
                   basis_pct = EXCLUDED.basis_pct,
                   valid_to = EXCLUDED.valid_to,
                   auction_date = EXCLUDED.auction_date,
                   fetched_at = now()
        """), {"src": source["source_id"], "mine": r_["mine"], "g": r_["grade"],
               "b": r_["basis_pct"], "p": r_["price"], "f": frm,
               "t": to or frm, "a": auction,
               "doc": "https://omcltd.in/en/our-business/ore-prices"})
        written += 1

    mines = sorted({r_["mine"] for r_ in rows})
    return {"auction_prices": written, "mines": len(mines),
            "window": f"{frm} to {to}"}


# ── translation ─────────────────────────────────────────────────────────────

# The Ministry of Mines feed is Hindi. Detected from the characters rather
# than trusted from the feed, because feeds declare the wrong language
# routinely. Devanagari, Odia, Bengali, Tamil, Telugu — the scripts a source
# here might plausibly arrive in.
_NON_LATIN = re.compile(
    r"[ऀ-ॿ଀-୿ঀ-৿஀-௿ఀ-౿]")


def detect_lang(text_in: str) -> str:
    """'en' or 'other'. Deliberately coarse — the only decision it feeds is
    whether to spend a model call, and a wrong 'other' costs one call while a
    wrong 'en' leaves a headline nobody reads."""
    return "other" if _NON_LATIN.search(text_in or "") else "en"


def translate_pending(db: Session, limit: int = 40) -> dict:
    """Render untranslated headlines into English with the on-premise model.

    Batched into one call per run: forty separate requests for forty headlines
    is forty round trips to a model that answers in seconds, and the whole
    point is that this happens in the background without anybody waiting.

    The original is never touched. If the model returns the wrong number of
    lines the batch is abandoned rather than misaligned — a headline attached
    to the wrong story is worse than an untranslated one.
    """
    from openai import OpenAI
    from app.config import get_settings

    rows = db.execute(text("""
        SELECT news_id, title FROM market_news
         WHERE title_en IS NULL AND lang IS DISTINCT FROM 'en'
         ORDER BY news_id DESC LIMIT :n
    """), {"n": limit}).mappings().all()
    if not rows:
        return {"translated": 0, "already_english": 0}

    english, todo = [], []
    for r in rows:
        (english if detect_lang(r["title"]) == "en" else todo).append(r)

    for r in english:
        db.execute(text("UPDATE market_news SET lang = 'en' WHERE news_id = :i"),
                   {"i": r["news_id"]})
    if not todo:
        db.commit()
        return {"translated": 0, "already_english": len(english)}

    cfg = get_settings()
    if not cfg.qwen_api_key:
        db.commit()
        return {"translated": 0, "already_english": len(english),
                "note": "No BAL-AI key configured, so nothing was translated."}

    numbered = NEWLINE.join(f"{i + 1}. {r['title']}" for i, r in enumerate(todo))
    client = OpenAI(base_url=cfg.qwen_base_url + "/v1",
                    api_key=cfg.qwen_api_key, timeout=120)
    reply = client.chat.completions.create(
        model=cfg.qwen_model,
        messages=[
            {"role": "system", "content":
             "You translate Indian government and mining press headlines into "
             "plain English. Reply with the same number of lines, each "
             "'N. translation', same numbering, nothing else — no preamble, no "
             "notes, no blank lines. Keep names, places, organisations and "
             "figures exactly as they are. If a line is already English, "
             "repeat it unchanged."},
            {"role": "user", "content": numbered},
        ],
        max_tokens=4000, temperature=0)
    out = (reply.choices[0].message.content or "").strip()

    got: dict[int, str] = {}
    for line in out.splitlines():
        m = re.match(r"\s*(\d+)[.)]\s*(.+)", line)
        if m:
            got[int(m.group(1))] = m.group(2).strip()

    # Misalignment here would caption a story with another story's headline.
    if len(got) != len(todo):
        db.commit()
        raise RuntimeError(
            f"The model returned {len(got)} lines for {len(todo)} headlines. "
            "Left untranslated rather than risk pairing a headline with the "
            "wrong story.")

    for i, r in enumerate(todo, start=1):
        db.execute(text("""
            UPDATE market_news
               SET title_en = :t, lang = 'other', translated_at = now(),
                   translated_by = :by
             WHERE news_id = :i
        """), {"t": got[i][:500], "by": cfg.qwen_model, "i": r["news_id"]})
    db.commit()
    return {"translated": len(todo), "already_english": len(english),
            "model": cfg.qwen_model}


# ── running them ────────────────────────────────────────────────────────────

COLLECTORS = {
    "ibm_asp_pdf": collect_ibm_asp,
    "rss": collect_rss,
    "omc_prices": collect_omc_prices,
}


def due_sources(db: Session, force: bool = False) -> list[dict]:
    return [dict(r) for r in db.execute(text("""
        SELECT * FROM market_source
         WHERE is_active
           AND (:force OR last_run_at IS NULL
                OR last_run_at < now() - make_interval(hours => every_hours))
         ORDER BY kind, code
    """), {"force": force}).mappings()]


def run_source(db: Session, source: dict) -> dict:
    """Run one collector. A failure is recorded against the source, not raised:
    one dead government site must not stop the other three."""
    fn = COLLECTORS.get(source["parser"])
    started = _now()
    if fn is None:
        note = f"No collector called '{source['parser']}'."
        db.execute(text("""UPDATE market_source SET last_run_at = :t,
                           last_status = 'no collector', last_error = :e
                            WHERE source_id = :i"""),
                   {"t": started, "e": note, "i": source["source_id"]})
        db.commit()
        return {"code": source["code"], "ok": False, "error": note}

    try:
        out = fn(db, source)
        db.execute(text("""UPDATE market_source
                              SET last_run_at = :t, last_ok_at = :t,
                                  last_status = :s, last_error = NULL
                            WHERE source_id = :i"""),
                   {"t": started,
                    "s": ", ".join(f"{k} {v}" for k, v in out.items())[:200],
                    "i": source["source_id"]})
        db.commit()
        return {"code": source["code"], "ok": True, **out}
    except Exception as exc:
        db.rollback()
        msg = str(exc)[:500]
        logger.warning("market source %s failed: %s", source["code"], msg)
        db.execute(text("""UPDATE market_source SET last_run_at = :t,
                           last_status = 'failed', last_error = :e
                            WHERE source_id = :i"""),
                   {"t": started, "e": msg, "i": source["source_id"]})
        db.commit()
        return {"code": source["code"], "ok": False, "error": msg}


def run_all(db: Session, force: bool = False) -> list[dict]:
    out = [run_source(db, s) for s in due_sources(db, force)]
    # Whatever arrived, rendered into English before anybody opens the page.
    # Its own step rather than part of a collector: the headlines come from
    # several feeds and the model call is batched across all of them.
    try:
        t = translate_pending(db)
        if t.get("translated"):
            out.append({"code": "TRANSLATE", "ok": True, **t})
    except Exception as exc:
        logger.warning("translation pass failed: %s", exc)
        out.append({"code": "TRANSLATE", "ok": False, "error": str(exc)[:300]})
    return out
