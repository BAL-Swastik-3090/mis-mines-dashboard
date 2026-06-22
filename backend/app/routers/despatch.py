from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import date

from ..database import get_db
from ..services import despatch as svc
from ..schemas.despatch import DespatchSummary, DespatchDaywise

router = APIRouter(tags=["Despatch"])


def _today() -> date:
    return date.today()


def _month_start() -> date:
    t = _today()
    return t.replace(day=1)


@router.get("/summary", response_model=DespatchSummary)
def summary(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    f = from_date or _month_start()
    t = to_date   or _today()

    plan      = svc.get_plan_summary(db, f, t)
    td_plan   = svc.get_td_plan(db, t)
    mtd_act   = svc.get_actuals_summary(db, f, t)
    td_act    = svc.get_actuals_summary(db, t, t)

    return DespatchSummary(
        from_date=f, to_date=t,
        **plan, **td_plan,
        mtd_total_actual=mtd_act["total_actual"],
        mtd_bal_actual=mtd_act["bal_actual"],
        mtd_suk_actual=mtd_act["suk_actual"],
        mtd_unsynced_count=mtd_act["unsynced_count"],
        td_total_actual=td_act["total_actual"],
        td_bal_actual=td_act["bal_actual"],
        td_suk_actual=td_act["suk_actual"],
        td_unsynced_count=td_act["unsynced_count"],
    )


@router.get("/daywise", response_model=DespatchDaywise)
def daywise(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    f = from_date or _month_start()
    t = to_date   or _today()

    rows    = svc.get_daywise(db, f, t)
    plan    = svc.get_plan_summary(db, f, t)
    mtd_act = svc.get_actuals_summary(db, f, t)

    return DespatchDaywise(
        from_date=f, to_date=t, rows=rows,
        **plan,
        mtd_total_actual=mtd_act["total_actual"],
        mtd_bal_actual=mtd_act["bal_actual"],
        mtd_suk_actual=mtd_act["suk_actual"],
        mtd_unsynced_count=mtd_act["unsynced_count"],
    )
