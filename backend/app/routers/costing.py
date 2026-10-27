"""Costing endpoints — daily cost curve, period summary, data coverage.

Served from seed files while the SAP costing interface is being built; see
services/costing.py for what those are and how to switch to the live ledger.
"""
from fastapi import APIRouter, HTTPException, Query

from app.services import costing

router = APIRouter()

SECTIONS = ("MINES", "COB")
BASES = ("post", "doc")


def _validate(period: str, section: str, basis: str) -> None:
    try:
        costing.period_bounds(period)
    except Exception:
        raise HTTPException(400, "period must be YYYY-MM, e.g. 2025-12")
    if section not in SECTIONS:
        raise HTTPException(400, f"section must be one of {SECTIONS}")
    if basis not in BASES:
        raise HTTPException(400, f"basis must be one of {BASES}")


def _default_period() -> str:
    periods = costing.available_periods()
    return periods[0] if periods else "2025-12"


@router.get("/periods")
def periods():
    """Months the data actually covers, so the UI offers only real options."""
    return {
        "source": costing.SOURCE,
        "default_basis": costing.DEFAULT_BASIS,
        "periods": costing.available_periods(),
    }


@router.get("/summary")
def summary(
    period: str = Query(default_factory=_default_period),
    section: str = Query("MINES"),
    basis: str = Query(costing.DEFAULT_BASIS),
):
    """Cost-sheet layout: one row per summary line, actual against plan."""
    _validate(period, section, basis)
    return costing.get_summary(period, section, basis)


@router.get("/daily")
def daily(
    period: str = Query(default_factory=_default_period),
    section: str = Query("MINES"),
    basis: str = Query(costing.DEFAULT_BASIS),
):
    """Cumulative cost and Rs./MT for each day of the period."""
    _validate(period, section, basis)
    return costing.get_daily_curve(period, section, basis)


@router.get("/coverage")
def coverage(
    period: str = Query(default_factory=_default_period),
    section: str = Query("MINES"),
    basis: str = Query(costing.DEFAULT_BASIS),
):
    """What the figure is built from: measured vs accrued, and where it is weak."""
    _validate(period, section, basis)
    return costing.get_coverage(period, section, basis)


@router.get("/production")
def production(period: str = Query(default_factory=_default_period)):
    """Day-wise tonnes, plus every basis on record for the month."""
    _validate(period, "MINES", costing.DEFAULT_BASIS)
    rows = costing.get_production(period)
    return {
        "period": period,
        "ore_mt": round(sum(r["ore_mt"] for r in rows), 2),
        "cob_mt": round(sum(r["cob_mt"] for r in rows), 2),
        "bases": costing.production_basis(period),
        "series": [{"date": r["date"].isoformat(),
                    "ore_mt": round(r["ore_mt"], 2),
                    "cob_mt": round(r["cob_mt"], 2)} for r in rows],
    }


@router.get("/gl-detail")
def gl_detail(
    period: str = Query(default_factory=_default_period),
    section: str = Query("MINES"),
    summary_line: str | None = Query(None),
    basis: str = Query(costing.DEFAULT_BASIS),
):
    """GL-level backing for one cost-sheet line."""
    _validate(period, section, basis)
    rows = costing.get_actuals(period, section, basis)
    if summary_line:
        rows = [r for r in rows if r["summary_line"] == summary_line]

    agg: dict[tuple, dict] = {}
    for r in rows:
        key = (r["gl_account"], r["cost_centre"])
        rec = agg.setdefault(key, {
            "gl_account": r["gl_account"],
            "gl_description": r["gl_description"],
            "summary_line": r["summary_line"],
            "bucket": r["bucket"],
            "cost_centre": r["cost_centre"] or "",
            "cost_centre_desc": r["cost_centre_desc"] or "",
            "amount": 0.0, "lines": 0,
        })
        rec["amount"] += r["amount"]
        rec["lines"] += 1

    out = sorted(agg.values(), key=lambda x: -abs(x["amount"]))
    for r in out:
        r["amount"] = round(r["amount"], 2)
    return {"period": period, "section": section,
            "summary_line": summary_line, "rows": out}


@router.get("/gl-wise")
def gl_wise(
    period: str = Query(default_factory=_default_period),
    basis: str = Query(costing.DEFAULT_BASIS),
):
    """The detailed sheet: every GL, Mines and COB side by side, with remarks."""
    _validate(period, "MINES", basis)
    return costing.get_gl_wise(period, basis)


@router.post("/reload-seeds")
def reload_seeds():
    """Re-read the seed files. The plan arrives monthly without a deploy."""
    return costing.reload_seeds()
