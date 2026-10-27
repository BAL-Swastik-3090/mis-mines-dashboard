"""Mines & COB product costing — daily cost curve and period summary.

The question this answers: on any day of the month, what cost has been
incurred so far, and what is that per tonne?

DATA SOURCE
-----------
This runs on seed files, not the live ledger. The SAP interface that will
feed `zfi_finance_accounts` with costing-grade data does not exist yet, so
the prototype uses the extract Finance already produced — the FAGLL03 sheet
of the costing workbook — plus the PPIC cost plan. Flip COSTING_SOURCE to
"db" once the interface lands; the computation below does not change.

    app/data/costing/
        ledger_sample.csv      3,924 Dec-2025 lines, from the workbook
        production_sample.csv  day-wise tonnes (SAP movements, reversals signed)
        production_basis.csv   SAP vs Finance tonnage — they disagree
        gl_master.csv          GL -> summary line + bucket
        cost_centre_master.csv cost centre -> Mines/COB section
        cost_plan_2026_P06.csv PPIC monthly plan

BUCKETS
-------
  DAILY      posted continuously -> actuals
  FORM       excavation / overburden / power, contractor-billed monthly
  FEED       ore consumed by the COB plant -> actuals
  MONTH_END  salary, depreciation, overheads -> prorate the plan
  EXCLUDE    not part of product cost

ACCRUAL BASIS
-------------
Default is POSTING date, because the workbook's own extract was pulled that
way and the prototype must reconcile to figures Finance already accepts.
Document date is the more correct basis and is selectable: on posting date,
December 2025 inherits November's accrual reversals. Showing both is the
point — the difference is a finding, not a detail.
"""
from __future__ import annotations

import csv
import logging
import os
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Any

log = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "costing")

SOURCE = os.getenv("COSTING_SOURCE", "seed")
DEFAULT_BASIS = os.getenv("COSTING_ACCRUAL_BASIS", "post")   # "post" | "doc"

ACTUAL_BUCKETS = ("DAILY", "FORM", "FEED")

SUMMARY_ORDER = [
    "Excavation Charges", "Electricity Cost", "Diesel",
    "Cons., Spares & Maintenance", "Labour", "Hire Charges",
    "Sampling & Analysis", "Salary", "Overhead", "Overburden", "Others",
]
DEPRECIATION_LINE = "Depreciation"
FEED_LINE = "Feed Cost"


# ───────────────────────────── seed loading ─────────────────────────────
def _read_csv(name: str) -> list[dict]:
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        log.warning("costing seed missing: %s", path)
        return []
    with open(path, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _d(s: str | None) -> date | None:
    return datetime.strptime(s, "%Y-%m-%d").date() if s else None


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _load():
    gl = {r["gl_account"]: r for r in _read_csv("gl_master.csv")}
    cc = {r["cost_centre"]: r for r in _read_csv("cost_centre_master.csv")}
    plan = _read_csv("cost_plan_2026_P06.csv")

    ledger = []
    # Every line, including the GLs costing excludes. The cost sheet must not
    # see these, but the GL-wise sheet must: showing "Not Required" GLs with
    # their amounts is how Finance checks that nothing material was dropped on
    # the way to the summary.
    ledger_all = []
    for r in _read_csv("ledger_sample.csv"):
        m = gl.get(r["gl_account"])
        raw_section = "COB" if (r.get("section") or "").upper() == "COB" else "MINES"
        ledger_all.append({
            "post_date": _d(r["post_date"]),
            "doc_date": _d(r["doc_date"]),
            "gl_account": r["gl_account"],
            "section": "COB" if (m and m["bucket"] == "FEED") else raw_section,
            "amount": _f(r["amount"]),
        })
        if m is None or m["include_in_costing"] != "1":
            continue
        # The workbook tags each line Mines/COB by hand; that is the agreed
        # split. Feed is COB by definition — it is what the plant consumes.
        section = "COB" if m["bucket"] == "FEED" else (
            "COB" if (r.get("section") or "").upper() == "COB" else "MINES")
        ledger.append({
            "post_date": _d(r["post_date"]),
            "doc_date": _d(r["doc_date"]),
            "gl_account": r["gl_account"],
            "gl_description": m["gl_description"] or r["gl_description"],
            "summary_line": m["summary_line"],
            "bucket": m["bucket"],
            "cost_centre": r["cost_centre"],
            "cost_centre_desc": r["cost_centre_desc"],
            "section": section,
            "doc_type": r["doc_type"],
            "amount": _f(r["amount"]),
        })

    production = [{"date": _d(r["date"]), "ore_mt": _f(r["ore_mt"]),
                   "cob_mt": _f(r["cob_mt"])} for r in _read_csv("production_sample.csv")]
    basis = _read_csv("production_basis.csv")

    log.info("costing seeds: %d GLs, %d cost centres, %d plan rows, "
             "%d ledger lines, %d production days",
             len(gl), len(cc), len(plan), len(ledger), len(production))
    return gl, cc, plan, ledger, production, basis, ledger_all


GL_MASTER, CC_MASTER, COST_PLAN, LEDGER, PRODUCTION, PROD_BASIS, LEDGER_ALL = _load()


def reload_seeds() -> dict:
    global GL_MASTER, CC_MASTER, COST_PLAN, LEDGER, PRODUCTION, PROD_BASIS, LEDGER_ALL
    GL_MASTER, CC_MASTER, COST_PLAN, LEDGER, PRODUCTION, PROD_BASIS, LEDGER_ALL = _load()
    return {"source": SOURCE, "gls": len(GL_MASTER), "cost_centres": len(CC_MASTER),
            "plan_rows": len(COST_PLAN), "ledger_lines": len(LEDGER),
            "production_days": len(PRODUCTION)}


# ───────────────────────────── helpers ──────────────────────────────────
def period_bounds(period: str) -> tuple[date, date]:
    y, m = (int(x) for x in period.split("-"))
    return date(y, m, 1), date(y, m, monthrange(y, m)[1])


def available_periods() -> list[str]:
    """Months the seed actually covers, newest first."""
    seen = {d["post_date"].strftime("%Y-%m") for d in LEDGER if d["post_date"]}
    return sorted(seen, reverse=True)


def _accrual_date(row: dict, basis: str) -> date | None:
    return row["doc_date"] if basis == "doc" else row["post_date"]


# ───────────────────────────── actuals ──────────────────────────────────
def get_actuals(period: str, section: str | None = None,
                basis: str = DEFAULT_BASIS) -> list[dict]:
    start, end = period_bounds(period)
    out = []
    for r in LEDGER:
        d = _accrual_date(r, basis)
        if d is None or not (start <= d <= end):
            continue
        if section and r["section"] != section:
            continue
        lag = ((r["post_date"] - r["doc_date"]).days
               if (r["post_date"] and r["doc_date"]) else None)
        out.append({**r, "accrual_date": d, "posting_lag_days": lag})
    return out


def get_gl_wise(period: str, basis: str = DEFAULT_BASIS) -> dict:
    """The GL Wise Summary sheet: one row per GL, Mines and COB side by side.

    This is the detailed half of the workbook and the audit trail for the
    summary - every GL the ledger touched, what group it rolls into, whether
    costing uses it, and the department's note on how it should be captured.
    GLs the costing excludes are listed with their amounts rather than hidden,
    because "is anything material sitting outside the cost sheet?" is exactly
    the question this sheet is read to answer.
    """
    start, end = period_bounds(period)
    totals: dict[str, dict[str, float]] = {}
    for r in LEDGER_ALL:
        d = _accrual_date(r, basis)
        if d is None or not (start <= d <= end):
            continue
        slot = totals.setdefault(r["gl_account"], {"MINES": 0.0, "COB": 0.0})
        slot[r["section"]] += r["amount"]

    rows = []
    for account, m in GL_MASTER.items():
        amounts = totals.get(account)
        if amounts is None and m["include_in_costing"] != "1":
            continue                      # no activity and not part of costing
        mines = round((amounts or {}).get("MINES", 0.0), 2)
        cob = round((amounts or {}).get("COB", 0.0), 2)
        rows.append({
            "gl_account": account,
            "gl_description": m["gl_description"],
            "costing_group": m["costing_group"],
            "summary_line": m["summary_line"] or None,
            "bucket": m["bucket"],
            "included": m["include_in_costing"] == "1",
            "remark": m["remark"],
            "total": round(mines + cob, 2),
            "mines": mines,
            "cob": cob,
        })

    rows.sort(key=lambda r: (not r["included"], -abs(r["total"])))
    included = [r for r in rows if r["included"]]
    excluded = [r for r in rows if not r["included"]]
    return {
        "period": period,
        "basis": basis,
        "rows": rows,
        "totals": {
            "included": {
                "rows": len(included),
                "mines": round(sum(r["mines"] for r in included), 2),
                "cob": round(sum(r["cob"] for r in included), 2),
                "total": round(sum(r["total"] for r in included), 2),
            },
            "excluded": {
                "rows": len(excluded),
                "mines": round(sum(r["mines"] for r in excluded), 2),
                "cob": round(sum(r["cob"] for r in excluded), 2),
                "total": round(sum(r["total"] for r in excluded), 2),
            },
        },
    }


def basis_comparison(period: str, section: str) -> dict[str, Any]:
    """Same month, both accrual bases — what the choice is worth."""
    post = sum(a["amount"] for a in get_actuals(period, section, "post"))
    doc = sum(a["amount"] for a in get_actuals(period, section, "doc"))
    return {
        "posting_date": round(post, 2),
        "document_date": round(doc, 2),
        "difference": round(doc - post, 2),
        "reliable": False,
        "note": ("Document date is the more correct basis — posting date pulls "
                 "in accrual reversals raised in the prior month. It cannot be "
                 "evaluated on this extract though: the workbook's FAGLL03 pull "
                 "was itself filtered by posting date, so lines carrying a "
                 "December document date but posted in January are simply absent. "
                 "Treat the document-date figure as indicative until the SAP "
                 "interface supplies a document-date extract."),
    }


# ──────────────────────────── production ────────────────────────────────
def get_production(period: str) -> list[dict]:
    start, end = period_bounds(period)
    return [p for p in PRODUCTION if p["date"] and start <= p["date"] <= end]


def production_basis(period: str) -> list[dict]:
    return [{"basis": r["basis"], "ore_mt": _f(r["ore_mt"]),
             "cob_mt": _f(r["cob_mt"]), "note": r["note"]}
            for r in PROD_BASIS if r["period"] == period]


# ────────────────────────────── plan ────────────────────────────────────
# The plan arrives monthly as a SAP CO export and is uploaded through the
# cost sheet's own Import Plan dialog, which writes minehub.cost_plan. That
# table is the plan of record; the seed CSV below it is a fallback for a
# month nobody has uploaded yet, and for running with minehub unreachable.
def get_plan(section: str | None = None) -> list[dict]:
    rows = [r for r in COST_PLAN if r["include_in_costing"] == "1"]
    return [r for r in rows if r["section"] == section] if section else rows


def _db_plan(period: str) -> list[dict]:
    """Uploaded plan rows for the month, or [] if there are none to be had."""
    try:
        from sqlalchemy import text
        import app.minehub_db as minehub
        if minehub.SessionLocal is None:
            return []
        start, _ = period_bounds(period)
        with minehub.SessionLocal() as db:
            rows = db.execute(text("""
                SELECT cost_element, section, plan_fix_cost
                  FROM minehub.cost_plan_detail
                 WHERE plan_month = :m AND section IN ('MINES', 'COB')
            """), {"m": start}).mappings().all()
        return [dict(r) for r in rows]
    except Exception as exc:                       # minehub down, table absent
        log.warning("costing: uploaded plan unavailable for %s (%s)", period, exc)
        return []


def plan_periods() -> list[str]:
    """Months an uploaded plan exists for, newest first."""
    try:
        from sqlalchemy import text
        import app.minehub_db as minehub
        if minehub.SessionLocal is None:
            return []
        with minehub.SessionLocal() as db:
            rows = db.execute(text("""
                SELECT DISTINCT to_char(plan_month, 'YYYY-MM') AS p
                  FROM minehub.cost_plan_detail
                 WHERE section IN ('MINES', 'COB') ORDER BY 1 DESC
            """)).scalars().all()
        return list(rows)
    except Exception:
        return []


def _db_plan_grouped(period: str, section: str | None, key: str) -> dict[str, float]:
    """Uploaded plan folded onto summary lines or buckets via the GL master."""
    out: dict[str, float] = {}
    for r in _db_plan(period):
        if section and r["section"] != section:
            continue
        m = GL_MASTER.get(str(r["cost_element"]))
        if not m or m["include_in_costing"] != "1" or not m[key]:
            continue
        out[m[key]] = out.get(m[key], 0.0) + float(r["plan_fix_cost"])
    return out


def plan_by_line(section: str | None = None,
                 period: str | None = None) -> dict[str, float]:
    if period:
        live = _db_plan_grouped(period, section, "summary_line")
        if live:
            return live
    out: dict[str, float] = {}
    for r in get_plan(section):
        out[r["summary_line"]] = out.get(r["summary_line"], 0.0) + _f(r["plan_fix_cost_inr"])
    return out


def plan_by_bucket(section: str | None = None,
                   period: str | None = None) -> dict[str, float]:
    if period:
        live = _db_plan_grouped(period, section, "bucket")
        if live:
            return live
    out: dict[str, float] = {}
    for r in get_plan(section):
        out[r["bucket"]] = out.get(r["bucket"], 0.0) + _f(r["plan_fix_cost_inr"])
    return out


def plan_source(period: str) -> str:
    """Where the plan behind this month's accrual came from."""
    return "uploaded" if _db_plan(period) else "seed"


# ──────────────────────────── daily curve ───────────────────────────────
def get_daily_curve(period: str, section: str = "MINES",
                    basis: str = DEFAULT_BASIS) -> dict[str, Any]:
    start, end = period_bounds(period)
    actuals = get_actuals(period, section, basis)
    prod_by_day = {p["date"]: p for p in get_production(period)}
    plan_month_end = plan_by_bucket(section, period).get("MONTH_END", 0.0)
    days_in_month = (end - start).days + 1
    qty_key = "ore_mt" if section == "MINES" else "cob_mt"

    closed = end < date.today()          # period finished, nothing left to accrue

    series, cum = [], {b: 0.0 for b in ACTUAL_BUCKETS}
    cum_month_end_posted = 0.0
    cum_qty = 0.0

    d = start
    while d <= end:
        for a in actuals:
            if a["accrual_date"] == d:
                if a["bucket"] in ACTUAL_BUCKETS:
                    cum[a["bucket"]] += a["amount"]
                elif a["bucket"] == "MONTH_END":
                    cum_month_end_posted += a["amount"]

        p = prod_by_day.get(d)
        if p:
            cum_qty += p[qty_key]

        elapsed = (d - start).days + 1
        accrued = plan_month_end * elapsed / days_in_month
        # Mid-month, taking both the prorated plan and what has already
        # posted would double count, so the larger of the two stands. Once
        # the month is closed there is nothing left to estimate: the posted
        # figure is the answer, and using the plan would leave the curve
        # disagreeing with the cost sheet.
        month_end = cum_month_end_posted if closed else max(accrued, cum_month_end_posted)
        total = sum(cum.values()) + month_end

        series.append({
            "date": d.isoformat(), "day": elapsed,
            "daily": round(cum["DAILY"], 2),
            "form": round(cum["FORM"], 2),
            "feed": round(cum["FEED"], 2),
            "month_end_accrued": round(accrued, 2),
            "month_end_posted": round(cum_month_end_posted, 2),
            "month_end_used": round(month_end, 2),
            "total_cost": round(total, 2),
            "cum_qty_mt": round(cum_qty, 2),
            "rs_per_mt": round(total / cum_qty, 2) if cum_qty > 0 else None,
        })
        d += timedelta(days=1)

    return {"period": period, "section": section, "basis": basis,
            "is_closed": closed,
            "days_in_month": days_in_month, "days_elapsed": len(series),
            "plan_month_end": round(plan_month_end, 2), "series": series}


# ─────────────────────────── period summary ─────────────────────────────
def _bucket_by_line() -> dict[str, str]:
    """Which bucket each cost-sheet line belongs to, from the GL master.

    Read from the master rather than from whatever happened to post, so a
    line with no actuals yet is still known to be a month-end one and gets
    accrued instead of showing nil.
    """
    out: dict[str, str] = {}
    for m in GL_MASTER.values():
        if m["include_in_costing"] == "1" and m["summary_line"]:
            out.setdefault(m["summary_line"], m["bucket"])
    return out


def get_summary(period: str, section: str = "MINES",
                basis: str = DEFAULT_BASIS, as_of: date | None = None) -> dict[str, Any]:
    """The cost sheet as at a date.

    Costs that post once a month - salary, PF, depreciation, the overheads
    uploaded from the plan - have not happened yet when the month is half
    done, but they are being incurred all the same. Asking on the 10th what
    the mine has cost is asking for ten days of them, so a month-end line is
    accrued as plan / days in month x days elapsed.

    Where such a line has ALREADY posted by as_of, the larger of the accrual
    and the posting stands: adding them would count the same cost twice, and
    taking the accrual alone would understate a month where payroll ran early.

    What switches the accrual off is reaching the END of the month on a
    period that has closed - not the period being closed. December is over,
    but "December as at the 10th" is still a question about the 10th, and
    answering it with the full month's salary against ten days of diesel and
    ten days of tonnes would be incoherent in both directions at once.
    """
    start, end = period_bounds(period)
    today = date.today()
    closed = end < today
    # Default to the last day that can have cost on it: today mid-month, the
    # month end once it is over.
    as_of = min(as_of or (end if closed else today), end)
    as_of = max(as_of, start)

    days_in_month = (end - start).days + 1
    days_elapsed = (as_of - start).days + 1
    factor = days_elapsed / days_in_month

    # The whole month asked for, on a month that is over: everything that was
    # going to post has posted, so there is nothing left to estimate. Any
    # earlier as_of - closed month or not - is a part-month question.
    settled = closed and as_of >= end
    prorate = 1.0 if as_of >= end else factor

    actuals = [a for a in get_actuals(period, section, basis) if a["accrual_date"] <= as_of]
    qty_key = "ore_mt" if section == "MINES" else "cob_mt"
    qty = sum(p[qty_key] for p in get_production(period) if p["date"] and p["date"] <= as_of)
    plan_lines = plan_by_line(section, period)
    bucket_of = _bucket_by_line()

    actual_lines: dict[str, float] = {}
    for a in actuals:
        actual_lines[a["summary_line"]] = actual_lines.get(a["summary_line"], 0.0) + a["amount"]
        bucket_of.setdefault(a["summary_line"], a["bucket"])

    def value_for(name: str) -> tuple[float, float, bool]:
        """Actual to use, the accrual behind it, and whether it was accrued."""
        posted = actual_lines.get(name, 0.0)
        if settled or bucket_of.get(name) != "MONTH_END":
            return posted, 0.0, False
        accrued = plan_lines.get(name, 0.0) * factor
        return (accrued, accrued, True) if accrued > posted else (posted, accrued, False)

    lines = []
    for name in SUMMARY_ORDER:
        act, accrued, is_accrued = value_for(name)
        pl = plan_lines.get(name, 0.0) * prorate
        if act == 0 and pl == 0:
            continue
        row = _line(name, act, pl, qty, bucket_of.get(name))
        row["accrued"] = round(accrued, 2)
        row["is_accrued"] = is_accrued
        lines.append(row)

    before = _total("Mining Cost Before Depreciation",
                    sum(l["actual"] for l in lines),
                    sum(l["plan"] for l in lines), qty)

    dep_act, dep_accrued, dep_is_accrued = value_for(DEPRECIATION_LINE)
    dep = _line(DEPRECIATION_LINE, dep_act,
                plan_lines.get(DEPRECIATION_LINE, 0.0) * prorate,
                qty, bucket_of.get(DEPRECIATION_LINE))
    dep["accrued"] = round(dep_accrued, 2)
    dep["is_accrued"] = dep_is_accrued

    after = _total("Mining Cost After Depreciation",
                   before["actual"] + dep["actual"], before["plan"] + dep["plan"], qty)

    out = lines + [before, dep, after]
    if section == "COB":
        feed = _line(FEED_LINE, actual_lines.get(FEED_LINE, 0.0),
                     plan_lines.get(FEED_LINE, 0.0) * prorate, qty, "FEED")
        out += [feed, _total("Total Cost of Concentrate",
                             after["actual"] + feed["actual"],
                             after["plan"] + feed["plan"], qty)]

    return {"period": period, "section": section, "basis": basis,
            "from_date": start.isoformat(), "to_date": end.isoformat(),
            "as_of": as_of.isoformat(), "is_closed": closed,
            "is_settled": settled,
            "plan_source": plan_source(period),
            "has_postings": bool(actuals),
            "days_in_month": days_in_month, "days_elapsed": days_elapsed,
            "accrual_factor": round(factor, 6),
            "production_mt": round(qty, 2),
            "production_basis": production_basis(period),
            "lines": out}


def _line(name: str, actual: float, plan: float, qty: float, bucket: str | None) -> dict:
    return {"line": name, "bucket": bucket,
            "actual": round(actual, 2), "plan": round(plan, 2),
            "variance": round(actual - plan, 2),
            "rs_per_mt": round(actual / qty, 2) if qty > 0 else None,
            "plan_rs_per_mt": round(plan / qty, 2) if qty > 0 else None,
            "is_total": False}


def _total(name: str, actual: float, plan: float, qty: float) -> dict:
    return {"line": name, "bucket": None, "actual": round(actual, 2),
            "plan": round(plan, 2), "variance": round(actual - plan, 2),
            "rs_per_mt": round(actual / qty, 2) if qty > 0 else None,
            "plan_rs_per_mt": None, "is_total": True}


# ───────────────────────── data-quality surface ─────────────────────────
def get_coverage(period: str, section: str = "MINES",
                 basis: str = DEFAULT_BASIS) -> dict[str, Any]:
    """What the figure is built from, and where it is weak.

    The cost is part measured and part estimated, and nothing on the face of
    the number says which. This is what lets the UI say it.
    """
    actuals = get_actuals(period, section, basis)
    plan_b = plan_by_bucket(section, period)

    act_b: dict[str, float] = {}
    for a in actuals:
        act_b[a["bucket"]] = act_b.get(a["bucket"], 0.0) + a["amount"]

    buckets = [{
        "bucket": b,
        "source": "actual" if b in ACTUAL_BUCKETS else "plan, prorated",
        "actual": round(act_b.get(b, 0.0), 2),
        "plan": round(plan_b.get(b, 0.0), 2),
        "has_plan": plan_b.get(b, 0.0) != 0,
    } for b in ("DAILY", "FORM", "FEED", "MONTH_END")]

    lags = [a["posting_lag_days"] for a in actuals if a["posting_lag_days"] is not None]
    lags.sort()
    median = (float(lags[len(lags) // 2]) if lags and len(lags) % 2
              else ((lags[len(lags) // 2 - 1] + lags[len(lags) // 2]) / 2 if lags else None))

    warnings = [f"{b['bucket']} has no plan — it cannot be accrued mid-month"
                for b in buckets if b["bucket"] in ("FORM", "FEED") and not b["has_plan"]]

    bases = production_basis(period)
    if len(bases) > 1:
        qty_key = "ore_mt" if section == "MINES" else "cob_mt"
        a, b = bases[0][qty_key], bases[1][qty_key]
        if a and b and abs(a - b) / max(a, b) > 0.02:
            warnings.append(
                f"Production disagrees between bases: {a:,.0f} MT vs {b:,.0f} MT "
                f"— Rs./MT depends on which is correct (PPIC-01)")

    return {
        "period": period, "section": section, "basis": basis,
        "source": SOURCE,
        "buckets": buckets,
        "posting_lag": {
            "accrued_on": "document date" if basis == "doc" else "posting date",
            "median_lag_days": median,
            "late_posted_lines": 0,
            "late_posted_amount": 0.0,
            "detail": [],
        },
        "basis_comparison": basis_comparison(period, section),
        "production_basis": bases,
        "warnings": warnings,
    }
