"""
COB Plant Analysis router.
Endpoint: GET /api/cob/summary?from_date=&to_date=
"""
from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.cob import CobSummary
from app.services import cob as svc

router = APIRouter()


@router.get(
    "/summary",
    response_model=CobSummary,
    summary="COB plant day-wise analysis — feed, concentrate, tailings, quality, yield",
)
def cob_summary(
    from_date: date = Query(default=None, description="Start date YYYY-MM-DD"),
    to_date:   date = Query(default=None, description="End date   YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today

    data = svc.get_cob_summary(db, from_date, to_date)
    return CobSummary(**data)
