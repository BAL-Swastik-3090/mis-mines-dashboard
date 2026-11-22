"""What is still in the ground, and what it is worth.

    balance(grade) = declared reserve − ore produced since the declaration

THE DECLARATION comes from minehub.mines_resource_reserve, typed on this
dashboard by whoever holds the survey. It is effective-dated: the latest
declaration on or before the date being viewed is the one that applies, so a
resurvey is a new row and a figure quoted in a past meeting still reproduces.

PRODUCTION SINCE comes from the SAME place the Production section reads — SAP
pp_production at plant 1200, keyed on MATERIAL_NO, reversals netted through
PRODUCTION_QTY — plus the mine's own estimate for the days SAP has not posted
yet, exactly as the Lost Cost Matrix and Reality Check already do it. This
screen and the Production section cannot report different tonnages for a day
because they run the same scan through the same functions.

    THE ESTIMATE HAS NO GRADE OF ITS OWN. mines_prev_day_actual stores one ORE
    figure per day. _ore_split in executive_summary.py already spreads it
    across HG / MG / LG by that day's excavation plan, falling back to the
    month's SAP mix, and reports which basis it used. That function is reused
    here rather than reimplemented: two different splits of the same tonnage
    appearing on two screens would be a bug nobody could explain.

    It matters less here than anywhere else it is used. The estimate only ever
    covers the handful of days SAP is behind, against a reserve of thirty-odd
    lakh tonnes, and SAP replaces it exactly within a day or two.

WHAT DOES NOT DEPLETE THE RESERVE:
  · Overburden. It is waste. It was never resource.
  · COB concentrate. The low-grade ore it is made from left the ground as LG
    and already depleted the LG band. Counting the concentrate as well would
    drain the reserve at roughly twice its true rate.
  · Despatch. Moving ore from a stack to a customer does not take anything out
    of the ground; it was mined when SAP posted the production.

THE ASSAY IS HELD FIXED as a band depletes, by the mine's instruction. Strictly
it should move — producing HG at 54.9% out of a band declared at 54.9% leaves
it unchanged, but any other produced grade would shift it. The produced assay
is reported alongside so the true remaining grade is a calculation away if the
geology team ever wants it, but it is not applied to the stored figure.

The TOTAL assay is not fixed and is not stored: it is the tonnage-weighted mean
of the three bands, so it moves as the mix moves. The mine's spreadsheet shows
46.26 against both the opening and closing positions, which cannot both be
right — that cell was not refreshed after the depletion row was filled in.

── VALUATION ───────────────────────────────────────────────────────────────
Rs Crores = Σ (tonnage × IBM average sale price for that band) ÷ 1e7

The rates come from minehub.mineral_price through services/ibm_rates.py, which
serves the latest bulletin published on or before the month asked for, takes
all three bands from the SAME issue, and follows the collector on its own — so
a new bulletin moves this figure with no code change, which is what the mine
asked for.

GROSS AND NET ARE BOTH REPORTED, because the mine's spreadsheet labels its
column "Present Value (Net of Royalty)" and the number in it is GROSS. Checked
against every issue in minehub.mineral_price: the sheet's 7,223.14 Cr is Σ
tonnage × IBM fines rate at MAY 2026 prices, with nothing deducted and never
refreshed since. True net of royalty on that same position is 5,782.12 Cr.
Rather than pick one and have the screen disagree with the sheet for a reason
nobody could see, both are returned and both are labelled for what they are.

Royalty, DMF and NMET come from minehub.royalty_rate, resolved to the rates in
force on the date being viewed — 15% of the sale price, then 30% and 3% OF THE
ROYALTY, not of the price. The basis is read from each row rather than assumed,
because treating the cesses as shares of the price overstates them four times.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import executive_summary as es
from app.services import ibm_rates

logger = logging.getLogger(__name__)

GRADES: tuple[str, ...] = ("HG", "MG", "LG")
LABELS: dict[str, str] = {"HG": "High Grade", "MG": "Medium Grade",
                          "LG": "Low Grade"}
CRORE = 1e7


# ── the declaration ─────────────────────────────────────────────────────────

_LATEST = text("""
    SELECT max(as_on_date) FROM minehub.mines_resource_reserve
     WHERE as_on_date <= :d
""")

_ROWS = text("""
    SELECT grade, tonnage_mt, cr2o3_pct, remarks,
           entry_id, entry_date, updated_at, updated_by
      FROM minehub.mines_resource_reserve
     WHERE as_on_date = :d
     ORDER BY CASE grade WHEN 'HG' THEN 1 WHEN 'MG' THEN 2 ELSE 3 END
""")


def declaration(pg: Session, as_on: date | None = None) -> dict:
    """The reserve as declared — the latest survey on or before `as_on`.

    Returns {"as_on_date": date|None, "grades": {g: {tonnage, cr2o3}}, ...}.
    An empty dict of grades means no declaration has ever been filed, which is
    reported as such and never as a reserve of nil.
    """
    when = pg.execute(_LATEST, {"d": as_on or date.today()}).scalar()
    if when is None:
        return {"as_on_date": None, "grades": {}, "rows": [], "filed": False}

    rows = [dict(r) for r in pg.execute(_ROWS, {"d": when}).mappings()]
    return {
        "as_on_date": when,
        "filed": True,
        "grades": {r["grade"]: {"tonnage": float(r["tonnage_mt"]),
                                "cr2o3": float(r["cr2o3_pct"])}
                   for r in rows},
        "rows": rows,
    }


def declarations(pg: Session) -> list[dict]:
    """Every survey on file, newest first — one entry per as_on_date."""
    return [dict(r) for r in pg.execute(text("""
        SELECT as_on_date,
               sum(tonnage_mt)                       AS tonnage_mt,
               CASE WHEN sum(tonnage_mt) > 0
                    THEN sum(tonnage_mt * cr2o3_pct) / sum(tonnage_mt)
                    END                              AS cr2o3_pct,
               count(*)                              AS grades,
               max(updated_at)                       AS updated_at,
               max(updated_by)                       AS updated_by
          FROM minehub.mines_resource_reserve
         GROUP BY as_on_date
         ORDER BY as_on_date DESC
    """)).mappings()]


# ── what has come out since ─────────────────────────────────────────────────

def depletion(db: Session, frm: date, to: date) -> dict:
    """Ore produced by grade between two dates, inclusive.

    SAP first; the mine's own estimate fills only the days SAP has not posted
    at all. Both ends are inclusive; `position` decides which days they are.
    """
    empty = {"grades": dict.fromkeys(GRADES, {"sap": 0.0, "est": 0.0,
                                              "total": 0.0}),
             "est_days": 0, "est_basis": "", "days": 0}
    if to < frm:
        return empty

    # ONE pp_production scan for the whole window. _prod_qty reports (td, mtd)
    # where mtd is the window total, which is the figure wanted here; the td
    # half is for a single report day and is ignored.
    q = es._prod_qty(db, frm, to)

    sap = {g: float(q.ore.get(es.PROD_MATERIALS[g], (0.0, 0.0))[1])
           for g in GRADES}

    # The ungraded estimate, spread the same way every other screen spreads it.
    split, est_days, basis = es._ore_split(db, frm, to, q.mine_days, sap)

    out: dict[str, dict] = {}
    for g in GRADES:
        est = float(split.get(g, (0.0, 0.0))[1])
        out[g] = {"sap": sap[g], "est": est, "total": sap[g] + est}
    return {"grades": out, "est_days": est_days, "est_basis": basis,
            "days": (to - frm).days + 1}


# ── valuation ───────────────────────────────────────────────────────────────

_RATES_IN_FORCE = text("""
    SELECT code, name, percent, basis
      FROM minehub.royalty_rate
     WHERE effective_from <= :d
       AND (effective_to IS NULL OR effective_to >= :d)
     ORDER BY CASE basis WHEN 'ASP' THEN 0 ELSE 1 END, code
""")


def _charges(pg: Session, as_on: date) -> dict:
    """Royalty and the cesses on it, as a single fraction of the sale price.

    Returns {"parts": [...], "fraction": 0.1995} — or fraction None when no
    rate is on file, which the caller reports instead of valuing at zero
    charges and calling the result "net".
    """
    rows = [dict(r) for r in pg.execute(_RATES_IN_FORCE, {"d": as_on}).mappings()]
    for r in rows:
        r["percent"] = float(r["percent"])
    base = next((r for r in rows if r["basis"] == "ASP"), None)
    if base is None:
        return {"parts": rows, "fraction": None}

    royalty = base["percent"] / 100.0
    total = royalty
    parts = [{"code": base["code"], "name": base["name"],
              "percent": base["percent"], "basis": "ASP",
              "fraction": royalty}]
    for r in rows:
        if r is base:
            continue
        # OF THE ROYALTY, not of the price. Read from the row, never assumed.
        share = royalty * r["percent"] / 100.0 if r["basis"] == "ROYALTY" \
            else r["percent"] / 100.0
        total += share
        parts.append({"code": r["code"], "name": r["name"],
                      "percent": r["percent"], "basis": r["basis"],
                      "fraction": share})
    return {"parts": parts, "fraction": total}


def value(pg: Session, tonnes: dict[str, float], as_on: date) -> dict:
    """Value a position at the IBM rates in force, gross and net of royalty.

    Never raises. Unpriced bands are named rather than valued at nil: a crore
    figure quietly missing a grade is worse than one that says it is missing.
    """
    book = ibm_rates.rates_for(as_on)
    rates = book.get("rates") or {}
    charges = _charges(pg, as_on)

    lines, gross, unpriced = [], 0.0, []
    for g in GRADES:
        qty = float(tonnes.get(g) or 0.0)
        rate = rates.get(g)
        amount = qty * float(rate) if rate is not None else None
        if rate is None and qty:
            unpriced.append(g)
        if amount is not None:
            gross += amount
        lines.append({"grade": g, "label": LABELS[g], "tonnage": qty,
                      "rate": float(rate) if rate is not None else None,
                      "value_cr": round(amount / CRORE, 2)
                      if amount is not None else None})

    frac = charges["fraction"]
    gross_cr = round(gross / CRORE, 2)
    return {
        "lines": lines,
        "gross_cr": gross_cr,
        # The deduction and the net, or None throughout when no rate is on
        # file. A "net" that deducted nothing would be a lie in the label.
        "charges_cr": round(gross * frac / CRORE, 2) if frac is not None else None,
        "net_cr": round(gross * (1 - frac) / CRORE, 2) if frac is not None else None,
        "charge_parts": charges["parts"],
        "charge_pct": round(frac * 100, 3) if frac is not None else None,
        "rate_period": book.get("period"),
        "rate_source": book.get("source"),
        "rate_stale": bool(book.get("stale")),
        "rates_available": bool(book.get("available")),
        "flagged": book.get("flagged") or [],
        "unpriced": unpriced,
    }


# ── the whole position ──────────────────────────────────────────────────────

def _weighted(rows: list[dict], t: str = "tonnage", g: str = "cr2o3") -> float | None:
    tot = sum(float(r[t] or 0) for r in rows)
    if tot <= 0:
        return None
    return sum(float(r[t] or 0) * float(r[g] or 0) for r in rows) / tot


def position(db: Session, pg: Session, as_on: date | None = None) -> dict:
    """Declared reserve, what has come out since, and what is left.

    The shape of the mine's own sheet: an opening row, a depletion row and a
    closing row, three grades across, with a weighted total and a valuation.
    """
    as_on = as_on or date.today()
    decl = declaration(pg, as_on)

    if not decl["filed"]:
        return {"as_on": as_on.isoformat(), "filed": False,
                "note": "No resource reserve has been declared yet.",
                "opening": [], "closing": [], "depletion": None,
                "totals": None, "valuation": None}

    base_date: date = decl["as_on_date"]
    # A RESERVE DATE IS THE MORNING OF THAT DAY, the same convention the stock
    # snapshot uses for Stock_Date. So the declaration day's OWN production
    # still depletes it, and the day being viewed has not happened yet:
    #
    #     depletion = production from base_date .. (as_on − 1), inclusive
    #
    # Not a judgement call — checked against the mine's own sheet. Its "Reserve
    # as on 01.11.2026" row is the 01.08.2026 declaration less 54,729 MG and
    # 19,376 LG, and this window reproduces both to the tonne. The window that
    # started the day after the declaration came out 525 MG and 336 LG light,
    # which is 1 August's production — a whole day of ore quietly left in the
    # ground. Off by one here is never visible in the total; it just reads low.
    frm = base_date
    to = as_on - timedelta(days=1)
    used = depletion(db, frm, to)

    opening, closing = [], []
    for g in GRADES:
        d = decl["grades"].get(g)
        if d is None:
            continue
        out = used["grades"][g]["total"]
        opening.append({"grade": g, "label": LABELS[g],
                        "tonnage": d["tonnage"], "cr2o3": d["cr2o3"]})
        closing.append({
            "grade": g, "label": LABELS[g],
            "tonnage": d["tonnage"] - out,
            # Held fixed by instruction — see the module docstring.
            "cr2o3": d["cr2o3"],
            "depleted": out,
            "depleted_sap": used["grades"][g]["sap"],
            "depleted_est": used["grades"][g]["est"],
        })

    open_t = sum(r["tonnage"] for r in opening)
    close_t = sum(r["tonnage"] for r in closing)
    val_open = value(pg, {r["grade"]: r["tonnage"] for r in opening}, as_on)
    val_close = value(pg, {r["grade"]: r["tonnage"] for r in closing}, as_on)

    return {
        "as_on": as_on.isoformat(),
        "filed": True,
        "declared_on": base_date.isoformat(),
        "opening": opening,
        "closing": closing,
        "depletion": {
            "from": frm.isoformat(),
            "to": to.isoformat(),
            "days": used["days"],
            "est_days": used["est_days"],
            "est_basis": used["est_basis"],
            "grades": used["grades"],
            "total": sum(v["total"] for v in used["grades"].values()),
        },
        "totals": {
            "opening_tonnage": open_t,
            "closing_tonnage": close_t,
            "depleted_tonnage": open_t - close_t,
            # Weighted, not carried over. The mix changes as the bands deplete
            # at different rates, so this figure moves even though each band's
            # own assay is held fixed.
            "opening_cr2o3": _weighted(opening),
            "closing_cr2o3": _weighted(closing),
        },
        "valuation": {"opening": val_open, "closing": val_close},
    }
