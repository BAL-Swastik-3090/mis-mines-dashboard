"""
Stock router — current ore inventory position.
No date params: table is a live SAP snapshot.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.stock import StockPosition
from app.services import stock as svc

router = APIRouter()


@router.get(
    "/position",
    response_model=StockPosition,
    summary="Current ore stock position by grade & storage location",
)
def stock_position(db: Session = Depends(get_db)):
    """
    Returns grade-wise and location-wise ore inventory from mm_mb52_inventory_new.
    Always reflects the latest SAP snapshot — not filtered by date.
    """
    data = svc.get_stock_position(db)
    return StockPosition(**data)
