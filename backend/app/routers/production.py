"""
Production router — Ore, OB, COB KPI endpoints.
All endpoints accept ?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
"""
from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.production import ProductionSummary, ProductionDaywise, GradeBreakdown, KpiCard
from app.services import production as svc

router = APIRouter()


def _f0(v) -> float:
    """Coerce SQL NULL (None) → 0.0 so Pydantic float fields never see None."""
    return float(v or 0)


def _kpi(actual, plan, unit: str) -> KpiCard:
    pct = round(actual / plan * 100, 1) if plan and plan != 0 else None
    return KpiCard(
        today_actual=actual, today_plan=plan,
        today_pct=pct,
        mtd_actual=None, mtd_plan=None, mtd_pct=None,
        unit=unit
    )


# ── GET /api/production/summary ───────────────────────────────
@router.get("/summary", response_model=ProductionSummary, summary="Production KPI summary")
def production_summary(
    from_date: date = Query(default=None, description="Start date YYYY-MM-DD"),
    to_date:   date = Query(default=None, description="End date   YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    """
    Returns today + MTD totals vs plan for Ore, OB, COB.
    If no dates provided, defaults to current month.
    """
    today     = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today

    # TD data — use to_date (last day of selected range)
    td_actual = svc.get_today_actuals(db, to_date)
    td_plan   = svc.get_today_plan(db, to_date)

    # MTD totals
    mtd = svc.get_mtd_totals(db, from_date, to_date)

    def pct(a, p):
        return round(a / p * 100, 1) if p and p != 0 and a is not None else None

    return ProductionSummary(
        as_on     = today,
        from_date = from_date,
        to_date   = to_date,
        ore = KpiCard(
            today_actual = svc._f(td_actual.get("ore_total")),
            today_plan   = td_plan.get("ore_plan"),
            today_pct    = pct(svc._f(td_actual.get("ore_total")) or 0, td_plan.get("ore_plan")),
            mtd_actual   = mtd["ore_actual"],
            mtd_plan     = mtd["ore_plan"],
            mtd_pct      = pct(mtd["ore_actual"], mtd["ore_plan"]),
            unit         = "MT",
        ),
        ob = KpiCard(
            today_actual = svc._f(td_actual.get("ob_qty")),
            today_plan   = td_plan.get("ob_plan"),
            today_pct    = pct(svc._f(td_actual.get("ob_qty")) or 0, td_plan.get("ob_plan")),
            mtd_actual   = mtd["ob_actual"],
            mtd_plan     = mtd["ob_plan"],
            mtd_pct      = pct(mtd["ob_actual"], mtd["ob_plan"]),
            unit         = "CuM",
        ),
        cob = KpiCard(
            today_actual = svc._f(td_actual.get("cob_qty")),
            today_plan   = td_plan.get("cob_plan"),
            today_pct    = pct(svc._f(td_actual.get("cob_qty")) or 0, td_plan.get("cob_plan")),
            mtd_actual   = mtd["cob_actual"],
            mtd_plan     = mtd["cob_plan"],
            mtd_pct      = pct(mtd["cob_actual"], mtd["cob_plan"]),
            unit         = "MT",
        ),
        de_silt = KpiCard(
            today_actual = svc.get_desilt_actual(db, to_date, to_date),
            today_plan   = None,
            today_pct    = None,
            mtd_actual   = svc.get_desilt_actual(db, from_date, to_date),
            mtd_plan     = None,
            mtd_pct      = None,
            unit         = "CuM",
        ),
    )


# ── GET /api/production/daywise ───────────────────────────────
@router.get("/daywise", response_model=ProductionDaywise, summary="Day-wise production plan vs actual")
def production_daywise(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today

    rows = svc.get_production_daywise(db, from_date, to_date)
    mtd  = svc.get_mtd_totals(db, from_date, to_date)

    return ProductionDaywise(
        from_date      = from_date,
        to_date        = to_date,
        rows           = rows,
        mtd_ore_actual = _f0(mtd["ore_actual"]),
        mtd_ore_plan   = _f0(mtd["ore_plan"]),
        mtd_ob_actual  = _f0(mtd["ob_actual"]),
        mtd_ob_plan    = _f0(mtd["ob_plan"]),
        mtd_cob_actual = _f0(mtd["cob_actual"]),
        mtd_cob_plan   = _f0(mtd["cob_plan"]),
        mtd_hg         = _f0(mtd["hg_actual"]),
        mtd_mg         = _f0(mtd["mg_actual"]),
        mtd_lg         = _f0(mtd["lg_actual"]),
    )


# ── GET /api/production/grade ─────────────────────────────────
@router.get("/grade", response_model=GradeBreakdown, summary="Grade-wise ore breakdown HG/MG/LG")
def production_grade(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today

    rows = svc.get_production_daywise(db, from_date, to_date)
    mtd  = svc.get_mtd_totals(db, from_date, to_date)

    grade_rows = [
        {
            "date":      r["date"],
            "hg_actual": r["ore_hg"],
            "mg_actual": r["ore_mg"],
            "lg_actual": r["ore_lg"],
            "hg_plan":   r["hg_plan"],
            "mg_plan":   r["mg_plan"],
            "lg_plan":   r["lg_plan"],
            "total":     r["ore_actual"],
        }
        for r in rows
    ]

    return GradeBreakdown(
        from_date  = from_date,
        to_date    = to_date,
        rows       = grade_rows,
        mtd_hg     = _f0(mtd["hg_actual"]),
        mtd_mg     = _f0(mtd["mg_actual"]),
        mtd_lg     = _f0(mtd["lg_actual"]),
        mtd_total  = _f0(mtd["ore_actual"]),
    )
