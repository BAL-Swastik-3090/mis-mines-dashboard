from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from datetime import date
from ..database import get_db
from ..minehub_db import get_minehub_db
from ..services.fuel_management import (
    get_fuel_overview,
    get_fuel_summary,
    get_vehicle_history,
    get_vehicle_intraday,
)

router = APIRouter(prefix="/api/fuel-management", tags=["Fuel Management"])


@router.get("")
def fuel_management_overview(db: Session = Depends(get_db)):
    return get_fuel_overview(db)


@router.get("/summary")
def fuel_management_summary(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    """Historical fleet fuel aggregates for the selected date range."""
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="from_date must not be after to_date")
    return get_fuel_summary(db, from_date, to_date)


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


# ═══════════════════════════════════════════════════════════════════════════
# Fuel in the tank — read from SAP, written nowhere
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/stock")
def stock(request: Request,
          pg: Session = Depends(get_minehub_db)) -> dict:
    """Diesel at every plant: what is standing, how long it lasts, what is owed.

    Read-only by design. Stock is entered in SAP and keying the same delivery
    into this platform as well would give two systems one fact to disagree
    about.
    """
    from app.services import fuel_stock as svc
    return svc.fuel_stock(pg)


@router.get("/stock/{plant}/projection")
def stock_projection(plant: str, request: Request,
                     days: int = Query(45, ge=7, le=120),
                     pg: Session = Depends(get_minehub_db)) -> dict:
    """What the tank holds each day from here, if nothing changes."""
    from app.services import fuel_stock as svc
    return svc.fuel_projection(pg, plant, days)

@router.get("/stock/movement")
def stock_movement(request: Request, days: int = Query(30, ge=7, le=120),
                   pg: Session = Depends(get_minehub_db)) -> dict:
    """What arrived and what was drawn, day by day, at every plant."""
    from app.services import fuel_stock as svc
    return svc.fuel_movement(pg, days)


@router.get("/stock/{plant}/arrival/{day}")
def stock_arrival(plant: str, day: str, request: Request,
                  pg: Session = Depends(get_minehub_db)) -> dict:
    """What landed at a plant on one day, and what is known about where from."""
    from app.services import fuel_stock as svc
    return svc.fuel_arrival(pg, plant, day)


@router.get("/stock/{plant}/calendar")
def stock_calendar(plant: str, request: Request,
                   back: int = Query(35, ge=7, le=120),
                   forward: int = Query(14, ge=0, le=60),
                   pg: Session = Depends(get_minehub_db)) -> dict:
    """Every day as a square: stock, what arrived, what was posted out."""
    from app.services import fuel_stock as svc
    return svc.fuel_calendar(pg, plant, back, forward)
