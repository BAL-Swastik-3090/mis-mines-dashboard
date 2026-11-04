"""OEE and the Lost Cost Matrix.

EVERY ENDPOINT HERE REPORTS COMPLETED DAYS ONLY, and resolves its window
through one helper so none of them can disagree with the rest of the
dashboard — or with each other. See _window below for what went wrong before
it existed.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import date

from app.database import get_db
from app.schemas.oee import OEEResponse, TipperOEEResponse
import app.services.oee as svc
from app.services.report_window import clamp
from app.services.tipper_oee import get_tipper_oee
from app.services.lcm import get_lcm, get_kam_loss_tree
from app.services.lcm_cob import get_cob_lcm

router = APIRouter(prefix="/api/oee", tags=["OEE"])


def _window(from_date: date | None, to_date: date | None) -> tuple[date, date]:
    """The month to date by default, cut back to the days that have ENDED.

    ── WHY THE CLAMP IS HERE AND NOT IN EACH SERVICE ──────────────────────
    These five endpoints describe one window from five angles: machine OEE,
    the tipper fleet, the Lost Cost Matrix, the COB matrix and the KAM loss
    tree. The LCM divides a deviation by the loss hours behind it, so the two
    halves MUST cover the same days — and before this they did not. The plan
    and the SAP actual were taken over the filter's full span while the loss
    hours came from the shift log, which only exists for days that have
    finished. A filter of 1–4 November run on the 4th compared a four-day
    plan against three days of log and reported the result as a rate per
    hour, which the screen then multiplied back out across every loss head.

    Resolving it once, here, means a service cannot be called with a window
    the others were not. Each response echoes the dates it actually used, so
    the screen shows the window it was answered for rather than the one it
    asked for.
    """
    today = date.today()
    fd = from_date or today.replace(day=1)
    td = to_date or today
    return clamp(fd, td, today)


@router.get("", response_model=OEEResponse)
def get_oee(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    from_date, to_date = _window(from_date, to_date)

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
    from_date, to_date = _window(from_date, to_date)

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
    from_date, to_date = _window(from_date, to_date)
    return get_lcm(db, from_date, to_date)


@router.get("/lcm/cob")
def lcm_cob(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    """LCM for COB — concentrate deviation attributed to feed volume and recovery."""
    from_date, to_date = _window(from_date, to_date)
    return get_cob_lcm(db, from_date, to_date)


@router.get("/lcm/kam-tree")
def lcm_kam_tree(
    from_date: date = Query(default=None),
    to_date:   date = Query(default=None),
    db: Session = Depends(get_db),
):
    """KAM Wise Loss Tree — loss in rupees by accountability head, under Chief of Mines."""
    from_date, to_date = _window(from_date, to_date)
    return get_kam_loss_tree(db, from_date, to_date)
