from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import date

from ..database import get_db
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
    db: Session = Depends(get_db),
):
    fd = from_date or _mstart()
    td = to_date   or _today()
    return svc.get_summary(db, fd, td)
