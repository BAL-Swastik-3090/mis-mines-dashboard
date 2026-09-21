"""Chrome ore prices and mining news.

Read-only to the mine: none of this is BAL's own data. It is what the Indian
Bureau of Mines published and what the press wrote, stored so there is a
series rather than a folder of PDFs, and so the screen can say when it last
managed to reach each source.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import access as access_svc
from app.services import market as svc

router = APIRouter(prefix="/api/market", tags=["Market"])

VIEW = "market.view"
REFRESH = "market.refresh"
# Re-running a collector is repeatable and harmless. Deciding the mine
# owes a different percentage is neither, so it is its own right.
RATES = "market.rates.manage"


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _require(db, request: Request, code: str) -> None:
    if not access_svc.has_permission(db, _actor(request), code):
        raise HTTPException(403, f"This needs the '{code}' permission.")


@router.get("/prices")
def prices(request: Request,
           mineral: str = Query("Chromite"),
           state: str = Query("ODISHA"),
           months: int = Query(24, ge=1, le=120),
           db: Session = Depends(get_db),
           pg: Session = Depends(get_minehub_db)) -> dict:
    """The published series, one row per grade per month.

    Change against the previous month is computed here rather than stored, so
    a corrected figure corrects the change with it.
    """
    _require(db, request, VIEW)

    rows = [dict(r) for r in pg.execute(text("""
        SELECT p.grade, p.period, p.price, p.unit, p.document_url,
               p.is_flagged, p.flag_reason, p.fetched_at, p.first_seen_at,
               p.published_on,
               (SELECT count(*) FROM price_revision v
                 WHERE v.kind = 'ASP' AND v.ref_id = p.price_id) AS revisions,
               lag(p.price) OVER (PARTITION BY p.grade ORDER BY p.period) AS prev
          FROM mineral_price p
         WHERE p.mineral = :m AND p.state = :s
           AND p.period >= (date_trunc('month', CURRENT_DATE)
                            - make_interval(months => :n))
         ORDER BY p.grade, p.period
    """), {"m": mineral, "s": state, "n": months}).mappings()]

    for r in rows:
        prev = r.pop("prev")
        r["price"] = float(r["price"])
        r["previous"] = float(prev) if prev is not None else None
        r["change_pct"] = (round((r["price"] - float(prev)) / float(prev) * 100, 1)
                           if prev and float(prev) else None)

    # The latest month that has anything, and what each grade did in it.
    latest = max((r["period"] for r in rows), default=None)
    return {
        "mineral": mineral, "state": state,
        "latest_period": latest,
        "grades": sorted({r["grade"] for r in rows}),
        "rows": rows,
        "flagged": sum(1 for r in rows if r["is_flagged"]),
    }


@router.get("/royalty")
def royalty(request: Request,
            period: str = Query("", description="yyyy-mm-01; latest if omitted"),
            db: Session = Depends(get_db),
            pg: Session = Depends(get_minehub_db)) -> dict:
    """What is owed per tonne on each grade, at the IBM average sale price.

    Royalty is a share of the ASP. DMF and NMET are shares OF THE ROYALTY —
    thirty and three per cent — not of the price. Treating them as shares of
    the price overstates the total by roughly four times, so the basis is read
    from the rate row rather than assumed here.

    Computed on read against the rates in force, never stored. A rate
    notification is a new row, and every figure recomputes against the right
    one instead of a stored total quietly disagreeing with the percentages
    printed beside it.
    """
    _require(db, request, VIEW)

    rates = [dict(r) for r in pg.execute(text("""
        SELECT code, name, percent, basis, effective_from, note
          FROM royalty_rate
         WHERE effective_to IS NULL
         ORDER BY CASE code WHEN 'ROYALTY' THEN 0 ELSE 1 END, code
    """)).mappings()]
    for r in rates:
        r["percent"] = float(r["percent"])

    base = next((r for r in rates if r["basis"] == "ASP"), None)
    if not base:
        raise HTTPException(500, "No rate is defined against the sale price.")

    when = period or pg.execute(text(
        "SELECT max(period)::text FROM mineral_price WHERE mineral = 'Chromite'"
    )).scalar()
    if not when:
        return {"period": None, "rates": rates, "rows": [], "note":
                "No average sale price has been read yet."}

    prices = pg.execute(text("""
        SELECT grade, price, unit, document_url, is_flagged
          FROM mineral_price
         WHERE mineral = 'Chromite' AND state = 'ODISHA' AND period = :p
         ORDER BY grade
    """), {"p": when}).mappings().all()

    rows = []
    for p_ in prices:
        asp = float(p_["price"])
        royalty_amt = asp * base["percent"] / 100.0
        parts = []
        total = royalty_amt
        for r in rates:
            if r["code"] == base["code"]:
                continue
            amt = royalty_amt * r["percent"] / 100.0
            parts.append({"code": r["code"], "name": r["name"],
                          "percent": r["percent"], "amount": round(amt, 4)})
            total += amt
        rows.append({
            "grade": p_["grade"], "asp": asp, "unit": p_["unit"],
            "royalty": round(royalty_amt, 4),
            "parts": parts,
            "total": round(total, 4),
            # What a tonne actually costs in charges, as a share of its value.
            "effective_pct": round(total / asp * 100, 3) if asp else None,
            "document_url": p_["document_url"],
            "is_flagged": p_["is_flagged"],
        })

    # Provenance, so the table can be checked rather than believed. One
    # document backs the whole month, so it is stated once rather than per row.
    issue = pg.execute(text("""
        SELECT document_url, max(fetched_at) AS fetched_at, count(*) AS grades
          FROM mineral_price
         WHERE mineral = 'Chromite' AND state = 'ODISHA' AND period = :p
         GROUP BY document_url ORDER BY count(*) DESC LIMIT 1
    """), {"p": when}).mappings().first()

    return {
        "period": str(when), "rates": rates, "rows": rows,
        "basis": {
            "publisher": "Indian Bureau of Mines",
            "publication": "Monthly Statistics of Mineral Production",
            "mineral": "Chromite", "state": "ODISHA",
            "period": str(when),
            "document_url": issue["document_url"] if issue else None,
            "fetched_at": issue["fetched_at"] if issue else None,
            "grades": issue["grades"] if issue else 0,
            # If a figure this was computed from has been restated, the
            # provenance panel is exactly where somebody should find out.
            "revisions": pg.execute(text("""
                SELECT count(*) FROM price_revision v
                  JOIN mineral_price p ON p.price_id = v.ref_id
                 WHERE v.kind = 'ASP' AND p.period = :p
            """), {"p": when}).scalar() or 0,
        },
    }


@router.get("/royalty-rates")
def royalty_rates(request: Request,
                  db: Session = Depends(get_db),
                  pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """Every rate, including the ones no longer in force."""
    _require(db, request, VIEW)
    return [dict(r) for r in pg.execute(text("""
        SELECT rate_id, code, name, percent, basis, effective_from,
               effective_to, note, created_by
          FROM royalty_rate ORDER BY code, effective_from DESC
    """)).mappings()]


@router.put("/royalty-rates/{code}")
def set_royalty_rate(code: str, request: Request, body: dict = Body(...),
                     db: Session = Depends(get_db),
                     pg: Session = Depends(get_minehub_db)) -> dict:
    """Record a changed rate.

    The old row is closed the day before the new one starts rather than
    edited, so last quarter still computes on last quarter's rate. A
    notification changes what is owed from a date, not what was owed before
    it.
    """
    _require(db, request, RATES)

    try:
        pct = float(body.get("percent"))
    except (TypeError, ValueError):
        raise HTTPException(400, "A percentage is required.")
    if pct < 0 or pct > 100:
        raise HTTPException(400, "A rate outside 0 to 100 per cent is not a rate.")
    basis = str(body.get("basis") or "").upper()
    if basis not in ("ASP", "ROYALTY"):
        raise HTTPException(
            400, "Say what the percentage is of: ASP or ROYALTY. DMF and NMET "
                 "are shares of the royalty, not of the sale price.")
    frm = str(body.get("effective_from") or "")[:10]
    if not frm:
        raise HTTPException(400, "A rate needs a date it takes effect from.")

    cur = pg.execute(text(
        "SELECT rate_id, name, percent, basis FROM royalty_rate "
        "WHERE code = :c AND effective_to IS NULL"), {"c": code}).mappings().first()
    if not cur:
        raise HTTPException(404, f"No charge called '{code}'.")

    pg.execute(text("""
        UPDATE royalty_rate SET effective_to = (CAST(:f AS date) - 1)
         WHERE rate_id = :i
    """), {"f": frm, "i": cur["rate_id"]})
    pg.execute(text("""
        INSERT INTO royalty_rate (code, name, percent, basis, effective_from,
                                  note, created_by)
        VALUES (:c, :n, :p, :b, CAST(:f AS date), :note, :by)
    """), {"c": code, "n": body.get("name") or cur["name"], "p": pct,
           "b": basis, "f": frm, "note": body.get("note"),
           "by": _actor(request)})
    pg.commit()
    return {"ok": True, "code": code,
            "was": f"{float(cur['percent'])}% of {cur['basis']}",
            "now": f"{pct}% of {basis}"}


@router.get("/auction")
def auction(request: Request,
            mine: str = Query(""),
            window: str = Query("", description="valid_from of a window; latest if omitted"),
            db: Session = Depends(get_db),
            pg: Session = Depends(get_minehub_db)) -> dict:
    """OMC e-auction prices for one window.

    A window is what OMC actually publishes — a price that holds from one
    date to another, set by a named auction. Showing every window at once
    mixes periods that are not comparable, so one is chosen and the rest are
    offered.

    Whether the chosen window has lapsed is answered here rather than left to
    the browser: the screen must be able to say "this is last month's price
    and OMC has not published the next one" instead of presenting a stale
    figure as if it were current.
    """
    _require(db, request, VIEW)

    windows = [dict(r) for r in pg.execute(text("""
        SELECT valid_from, valid_to, auction_date, count(*) AS rows
          FROM auction_price
         GROUP BY valid_from, valid_to, auction_date
         ORDER BY valid_from DESC
    """)).mappings()]

    chosen = window or (windows[0]["valid_from"].isoformat() if windows else "")
    rows = [dict(r) for r in pg.execute(text("""
        SELECT a.mine, a.grade, a.basis_pct, a.price, a.unit,
               a.valid_from, a.valid_to, a.auction_date, a.document_url,
               a.fetched_at, a.first_seen_at,
               (SELECT count(*) FROM price_revision v
                 WHERE v.kind = 'AUCTION' AND v.ref_id = a.auction_price_id)
                 AS revisions
          FROM auction_price a
         WHERE (:m = '' OR a.mine = :m)
           AND (:w = '' OR a.valid_from = CAST(:w AS date))
         ORDER BY a.valid_from DESC, a.mine, a.basis_pct DESC NULLS LAST
    """), {"m": mine, "w": chosen}).mappings()]
    for r in rows:
        r["price"] = float(r["price"])
        r["basis_pct"] = float(r["basis_pct"]) if r["basis_pct"] is not None else None

    valid_to = rows[0]["valid_to"] if rows else None
    today = date.today()
    lapsed = bool(valid_to and valid_to < today)
    return {
        "rows": rows,
        "mines": sorted({r["mine"] for r in rows}),
        "windows": windows,
        "window": chosen or None,
        "latest_from": rows[0]["valid_from"] if rows else None,
        "latest_to": valid_to,
        "auction_date": rows[0]["auction_date"] if rows else None,
        # The screen says so rather than presenting a lapsed price as current.
        "lapsed": lapsed,
        "days_lapsed": (today - valid_to).days if lapsed else 0,
        "is_latest": bool(windows) and chosen == windows[0]["valid_from"].isoformat(),
    }


@router.get("/revisions")
def revisions(request: Request,
              kind: str = Query("", description="ASP | AUCTION; both if omitted"),
              limit: int = Query(100, ge=1, le=500),
              db: Session = Depends(get_db),
              pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """Every time a published figure was restated after we first read it.

    Normally empty, and that is the useful part: an empty list means nothing
    the royalty was worked out on has moved since. A row here means a
    publisher changed their mind, and says what it was before.
    """
    _require(db, request, VIEW)
    rows = [dict(r) for r in pg.execute(text("""
        SELECT revision_id, kind, label, period_label,
               old_price, new_price, old_document_url, new_document_url,
               changed_at
          FROM price_revision
         WHERE (:k = '' OR kind = :k)
         ORDER BY changed_at DESC
         LIMIT :lim
    """), {"k": kind.upper(), "lim": limit}).mappings()]
    for r in rows:
        r["old_price"] = float(r["old_price"]) if r["old_price"] is not None else None
        r["new_price"] = float(r["new_price"]) if r["new_price"] is not None else None
        if r["old_price"] and r["new_price"]:
            r["change_pct"] = round(
                (r["new_price"] - r["old_price"]) / r["old_price"] * 100, 2)
        else:
            r["change_pct"] = None
    return rows


@router.get("/news")
def news(request: Request,
         tag: str = Query("", description="chrome | mining | other"),
         limit: int = Query(60, ge=1, le=300),
         db: Session = Depends(get_db),
         pg: Session = Depends(get_minehub_db)) -> list[dict]:
    _require(db, request, VIEW)
    return [dict(r) for r in pg.execute(text("""
        SELECT n.news_id, n.title, n.title_en, n.summary_en, n.lang,
               n.translated_by, n.url, n.published_at, n.summary, n.tags,
               n.fetched_at, s.name AS source
          FROM market_news n JOIN market_source s ON s.source_id = n.source_id
         WHERE (:tag = '' OR :tag = ANY(n.tags))
         ORDER BY COALESCE(n.published_at, n.fetched_at) DESC
         LIMIT :lim
    """), {"tag": tag, "lim": limit}).mappings()]


@router.get("/sources")
def sources(request: Request,
            db: Session = Depends(get_db),
            pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """How each source is behaving.

    Shown on the screen beside the figures. An empty chart because IBM has not
    published yet and an empty chart because the collector has been failing
    for a week look identical without this.
    """
    _require(db, request, VIEW)
    return [dict(r) for r in pg.execute(text("""
        SELECT s.source_id, s.code, s.name, s.kind, s.url, s.about,
               s.is_active, s.every_hours, s.last_run_at, s.last_ok_at,
               s.last_status, s.last_error,
               (SELECT count(*) FROM mineral_price p WHERE p.source_id = s.source_id) AS prices,
               (SELECT count(*) FROM market_news n WHERE n.source_id = s.source_id) AS items
          FROM market_source s
         ORDER BY s.kind, s.code
    """)).mappings()]


@router.post("/refresh")
def refresh(request: Request, body: dict = Body(default={}),
            db: Session = Depends(get_db),
            pg: Session = Depends(get_minehub_db)) -> dict:
    """Run the collectors now rather than waiting for the schedule."""
    _require(db, request, REFRESH)
    only = (body or {}).get("code")
    if only:
        row = pg.execute(text("SELECT * FROM market_source WHERE code = :c"),
                         {"c": only}).mappings().first()
        if not row:
            raise HTTPException(404, f"No source called '{only}'.")
        return {"ran": [svc.run_source(pg, dict(row))]}
    return {"ran": svc.run_all(pg, force=True)}
