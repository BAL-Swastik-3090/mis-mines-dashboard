"""
Stock router — mines stock position from IMOS entry (`mines_stock`).

Takes a date because the table is a snapshot per Stock_Date, not a live feed.
The service resolves the latest snapshot on or before that date.
"""
from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.stock import StockPosition
from app.services import stock as svc

router = APIRouter()


@router.get(
    "/position",
    response_model=StockPosition,
    summary="Mines stock position by grade, location and clearance status",
)
def stock_position(
    as_on: date = Query(default=None, description="Show the latest snapshot on or before this date"),
    db: Session = Depends(get_db),
):
    return StockPosition(**svc.get_stock_position(db, as_on))
