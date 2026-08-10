from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import date

from app.database import get_db
from app.schemas.oee import OEEResponse
import app.services.oee as svc

router = APIRouter(prefix="/api/oee", tags=["OEE"])


@router.get("", response_model=OEEResponse)
def get_oee(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today

    result = svc.get_oee_per_machine(db, from_date, to_date)
    return OEEResponse(
        from_date=from_date,
        to_date=to_date,
        machines=result["machines"],
        fleet=result["fleet"],
    )
