from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..services.fuel_management import get_fuel_overview, get_vehicle_history, get_vehicle_intraday

router = APIRouter(prefix="/api/fuel-management", tags=["Fuel Management"])


@router.get("")
def fuel_management_overview(db: Session = Depends(get_db)):
    return get_fuel_overview(db)


@router.get("/vehicle/{vehicle_desc}/history")
def vehicle_history(
    vehicle_desc: str,
    days: int = Query(default=7, ge=1, le=30),
    db: Session = Depends(get_db),
):
    result = get_vehicle_history(db, vehicle_desc, days)
    if result is None:
        raise HTTPException(status_code=404, detail="Vehicle not found or no history available")
    return result


@router.get("/vehicle/{vehicle_desc}/intraday")
def vehicle_intraday(
    vehicle_desc: str,
    db: Session = Depends(get_db),
):
    result = get_vehicle_intraday(db, vehicle_desc)
    if result is None:
        raise HTTPException(status_code=404, detail="No intraday data for this vehicle today")
    return result
