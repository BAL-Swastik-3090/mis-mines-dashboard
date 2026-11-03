"""The excavator fleet, and the month's ORE/OB assignment for each machine.

A FORM RATHER THAN AN UPLOAD, which is why there is no /preview here and the
de-silting plan has one. That plan is a month of numbers off a spreadsheet and
has to be shown back before it is stored; this is ten machines and a choice of
two, all of it visible on screen before Save is pressed. What it does share is
the shape: GET returns the fleet with the month's assignment already resolved,
so the screen opens on last month's answer rather than on blanks.

WHY GET RETURNS BOTH `stored` AND `effective`. They are different questions.
`stored` is what this month actually holds -- empty until somebody enters it.
`effective` is what the LCM would use right now, which for an unentered month
is last month's assignment carried forward. A screen that showed only the
second would make an unentered month look entered, and the person would close
it believing they had already done the thing they had not done.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import equipment_plan as svc
from app.services.equipment_plan import PlanError

router = APIRouter(prefix="/api/equipment-plan", tags=["Equipment Excavation Plan"])


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _month(year: int, month: int) -> date:
    try:
        return date(year, month, 1)
    except ValueError:
        raise HTTPException(400, "That is not a month.")


class Assignment(BaseModel):
    equipment_name: str = Field(min_length=1, max_length=60)
    material_type: str = Field(pattern="^(ORE|OB)$")


class MonthIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    assignments: list[Assignment]


@router.get("")
def read(year: int = Query(...), month: int = Query(...),
         db: Session = Depends(get_minehub_db)) -> dict:
    """The fleet, what is stored for this month, and what is in force."""
    m = _month(year, month)
    stored = {r["equipment_name"]: r for r in svc.read_month(db, m)}
    effective = svc.resolve(db, m)
    carried = {c["equipment_name"]: c["from_month"] for c in effective["carried"]}

    machines = []
    for x in svc.fleet(db):
        name = x["equipment_name"]
        machines.append({
            **x,
            # What the mine stored FOR THIS MONTH. None means not entered.
            "stored": stored.get(name, {}).get("material_type"),
            # What the LCM would use. Equal to `stored` on an entered month.
            "effective": effective["assignments"].get(name),
            # Which month `effective` came from, when it was not this one.
            "carried_from": carried.get(name),
            "entry_id": stored.get(name, {}).get("entry_id"),
            "entry_date": stored.get(name, {}).get("entry_date"),
            # Which submission last set THIS row. A row still on 1 after the
            # month has been revised twice is one nobody has touched since.
            "revision": stored.get(name, {}).get("revision"),
        })

    return {
        "month": m.isoformat(),
        "month_entered": effective["month_entered"],
        # 0 = never entered, 1 = entered once, 2+ = entered and since revised.
        # The screen needs this to say "Save" or "Save changes", and to decide
        # whether there is any history worth offering to show.
        "revision": svc.month_revision(db, m),
        "carried_from": effective["carried_from"],
        # Machines with no assignment anywhere, ever. These are the ones the
        # LCM has to leave out, and the screen must put them in front of
        # somebody rather than let them pass as a blank row.
        "unassigned": effective["unassigned"],
        "machines": machines,
    }


@router.post("")
def save(body: MonthIn, request: Request,
         db: Session = Depends(get_minehub_db)) -> dict:
    """Store the month. All active machines or none — see save_month()."""
    m = _month(body.year, body.month)
    assignments = {a.equipment_name: a.material_type for a in body.assignments}
    if len(assignments) != len(body.assignments):
        raise HTTPException(400, "The same machine appears twice.")
    try:
        changes = svc.save_month(db, m, assignments, _actor(request))
    except PlanError as exc:
        # Every problem, not the first: somebody correcting an entry should
        # correct it once rather than discover the faults one save at a time.
        raise HTTPException(400, {"message": "The month was not saved.",
                                  "problems": exc.problems})
    return {**changes, "entry_id": _actor(request)}


@router.get("/history")
def read_history(year: int | None = Query(None), month: int | None = Query(None),
                 equipment_name: str | None = Query(None),
                 limit: int = Query(200, ge=1, le=1000),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Every edit to the plan, newest first.

    Both filters are optional and combine: a month answers "what has been
    changed in this plan", a machine answers "when did this one move between
    ore and overburden", and the two together narrow to a single row's story.
    """
    m = _month(year, month) if year and month else None
    rows = svc.history(db, m, equipment_name, limit)
    return {"month": m.isoformat() if m else None,
            "equipment_name": equipment_name,
            "count": len(rows), "history": rows}


@router.get("/fleet")
def fleet(include_inactive: bool = Query(False),
          db: Session = Depends(get_minehub_db)) -> dict:
    """The equipment master itself, for a screen that manages the fleet."""
    return {"machines": svc.fleet(db, include_inactive=include_inactive)}
