from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.ob import ObSummary
from app.services import ob as svc

router = APIRouter()


@router.get(
    "/summary",
    response_model=ObSummary,
    summary="OB Excavation — BAL OWN vs DASHMESH day-wise plan & actual",
)
def ob_summary(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today

    data = svc.get_ob_summary(db, from_date, to_date)
    return ObSummary(**data)
