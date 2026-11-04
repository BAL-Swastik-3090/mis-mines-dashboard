"""Dewatering Operations — the read side.

ON THE MINEHUB SESSION, NOT THE SHARED MySQL ONE. The figures now come from
`minehub.dewatering_daily_data`, which the Enter Daily Dewatering Data form
writes; the old `mines_dewatering_daily_data` KPI pivot on balcorpdb is no
longer read by this screen. `get_minehub_db` also answers 503 rather than 500
when the platform database is unreachable, so an outage reads as "not
available" instead of "broken".

The write side lives in routers/dewatering_entry.py, under
/api/dewatering-entry. This router is read-only.
"""
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..minehub_db import get_minehub_db
from ..services import dewatering as svc
from ..schemas.dewatering import DewateringSummaryResponse

router = APIRouter(tags=["Dewatering"])


def _today() -> date:
    return date.today()


def _mstart() -> date:
    return _today().replace(day=1)


@router.get("/summary", response_model=DewateringSummaryResponse)
def dewatering_summary(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_minehub_db),
):
    fd = from_date or _mstart()
    td = to_date   or _today()
    return svc.get_summary(db, fd, td)
