from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.plant import PlantPerformance
from app.services import plant as svc

router = APIRouter()


@router.get(
    "/performance",
    response_model=PlantPerformance,
    summary="Ferro Chrome plant performance — BAL + SUK actuals",
)
def plant_performance(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today

    data = svc.get_plant_performance(db, from_date, to_date)
    return PlantPerformance(**data)
