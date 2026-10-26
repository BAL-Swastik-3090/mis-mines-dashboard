from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import date

from app.database import get_db
from app.schemas.oee import OEEResponse, TipperOEEResponse
import app.services.oee as svc
from app.services.tipper_oee import get_tipper_oee
from app.services.lcm import get_lcm, get_kam_loss_tree
from app.services.lcm_cob import get_cob_lcm

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

    # SPREAD, DO NOT NAME THE KEYS. Listing them meant that adding fleet_old
    # and fleet_new to the service and the schema still left this call passing
    # neither, and because both are required the endpoint raised a
    # ValidationError and every table on the screen rendered empty. The service
    # decides what one response carries; this hands it over whole.
    return OEEResponse(from_date=from_date, to_date=to_date,
                       **svc.get_oee_per_machine(db, from_date, to_date))


@router.get("/tippers", response_model=TipperOEEResponse)
def tipper_oee(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    """OEE for the tipper fleet, split into old (MAN) and new (PRIMA)."""
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today

    # Spread, never name the keys — see get_oee above for what naming them cost.
    return TipperOEEResponse(from_date=from_date, to_date=to_date,
                             **get_tipper_oee(db, from_date, to_date))


@router.get("/lcm")
def lcm(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    """Lost Cost Matrix — loss hours and planned ore/OB loss per loss head."""
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today
    return get_lcm(db, from_date, to_date)


@router.get("/lcm/cob")
def lcm_cob(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    """LCM for COB — concentrate deviation attributed to feed volume and recovery."""
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today
    return get_cob_lcm(db, from_date, to_date)


@router.get("/lcm/kam-tree")
def lcm_kam_tree(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    """KAM Wise Loss Tree — loss in rupees by accountability head, under Chief of Mines."""
    today = date.today()
    if not from_date:
        from_date = today.replace(day=1)
    if not to_date:
        to_date = today
    return get_kam_loss_tree(db, from_date, to_date)
