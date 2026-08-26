from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import date

from ..database import get_db
from ..services import equipment as svc
from ..schemas.equipment import (
    ExcavatorSummaryResponse,
    ExcavatorTrendResponse,
    ExcavatorFuelResponse,
    TipperSummaryResponse,
    TipperFuelResponse,
    BreakdownDetailsResponse,
    DumperTripResponse,
)

router = APIRouter(tags=["Equipment"])


def _today() -> date:
    return date.today()


def _mstart() -> date:
    return _today().replace(day=1)


@router.get("/excavator/summary", response_model=ExcavatorSummaryResponse)
def excavator_summary(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    return svc.get_excavator_summary(db, from_date or _mstart(), to_date or _today())


@router.get("/excavator/trend", response_model=ExcavatorTrendResponse)
def excavator_trend(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    return svc.get_excavator_trend(db, from_date or _mstart(), to_date or _today())


@router.get("/excavator/fuel", response_model=ExcavatorFuelResponse)
def excavator_fuel(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    return svc.get_excavator_fuel(db, from_date or _mstart(), to_date or _today())


@router.get("/tipper/summary", response_model=TipperSummaryResponse)
def tipper_summary(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    return svc.get_tipper_summary(db, from_date or _mstart(), to_date or _today())


@router.get("/tipper/fuel", response_model=TipperFuelResponse)
def tipper_fuel(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    return svc.get_tipper_fuel(db, from_date or _mstart(), to_date or _today())


@router.get("/breakdown-details", response_model=BreakdownDetailsResponse)
def breakdown_details(
    machine:   str,
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    f = from_date or _mstart()
    t = to_date   or _today()
    events = svc.get_breakdown_details(db, machine, f, t)
    return {"machine": machine, "from_date": f, "to_date": t, "events": events}
