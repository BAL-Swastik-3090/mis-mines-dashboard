"""Enter Daily Dewatering Data.

A FORM, like Enter Est Actual rather than like the plan uploads: it is one
day's readings, typed from the shift's own record, so there is nothing to
preview -- what is about to be stored is on screen.

WHY SAVING ONE DAY RETURNS A LIST OF OTHER DAYS. Opening stock is the previous
day's closing, so an edit to the 3rd moves every day after it. The service
re-chains them and names them here, because a person who edited one day and
moved twelve should be told that, not discover it later in a report.

The routes live under /api/dewatering-entry rather than /api/dewatering, which
is the existing read-only summary this does not touch.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import dewatering_entry as svc
from app.services.dewatering_entry import DewateringError

router = APIRouter(prefix="/api/dewatering-entry", tags=["Dewatering Entry"])


def _actor(request: Request) -> str:
    """Whoever is signed in. The sheet is a record of who reported what, so a
    day stored without an identifiable author is refused rather than filed
    under 'unknown'."""
    return getattr(request.state, "emp_id", None) or ""


def _problem(e: DewateringError) -> HTTPException:
    """Every problem, not the first: somebody correcting a day should correct
    it once rather than discover the faults one save at a time."""
    return HTTPException(422, detail={"message": "The day was not saved.",
                                      "problems": e.problems})


@router.get("/fields")
def fields() -> dict:
    """The sheet's shape — the KPI list, its order, units and which figures
    are derived. The screen renders from this rather than hardcoding a list
    that would drift from the table it writes to."""
    return {"fields": svc.meta(),
            "sections": [{"key": k, "label": lbl} for k, lbl in svc.SECTIONS]}


@router.get("")
def read_day(data_date: date = Query(...),
             db: Session = Depends(get_minehub_db)) -> dict:
    """One day, with the opening stock that would be carried into it."""
    return svc.day_form(db, data_date)


@router.get("/range")
def read_range(from_date: date = Query(...), to_date: date = Query(...),
               db: Session = Depends(get_minehub_db)) -> dict:
    """A window of days, for a table or a chart."""
    if to_date < from_date:
        raise HTTPException(400, "The end date is before the start date.")
    rows = svc.read_range(db, from_date, to_date)
    return {"from_date": from_date.isoformat(), "to_date": to_date.isoformat(),
            "count": len(rows), "days": rows, "fields": svc.meta()}


@router.post("")
def save_day(request: Request,
             data_date: date = Query(...),
             values: dict = Body(...),
             db: Session = Depends(get_minehub_db)) -> dict:
    """Store or edit one day, and carry the change forward.

    The body is {field: value}. A FIELD LEFT OUT IS LEFT ALONE and a field
    sent as null is CLEARED -- the screen means different things by the two,
    so the payload is read as a set of edits rather than as a whole row.
    """
    try:
        return svc.save_day(db, data_date, values, _actor(request))
    except DewateringError as e:
        raise _problem(e)


@router.get("/history")
def history(from_date: date | None = Query(None),
            to_date: date | None = Query(None),
            field: str | None = Query(None),
            limit: int = Query(300, ge=1, le=2000),
            db: Session = Depends(get_minehub_db)) -> dict:
    """Every change, newest first, with the value before and after.

    `CHAINED` rows are days nobody edited whose opening stock moved because an
    earlier day did -- which is how a figure that changed on its own is traced
    back to the edit that changed it.
    """
    if field and field not in {f for f, *_ in svc.FIELDS}:
        raise HTTPException(400, "not a field on this sheet")
    rows = svc.history(db, from_date, to_date, field, limit)
    return {"count": len(rows), "history": rows}
