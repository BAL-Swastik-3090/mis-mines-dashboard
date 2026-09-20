"""The attendance register — what the gate readers recorded, day by day.

READ-ONLY, AND NOTHING IS STORED. Every figure on this screen is read from
SmartFace at the moment it is asked for and joined to the manpower register in
memory. The mine has not yet decided how much punch history MineHub should
hold, whether a missing punch means absent, or how manual corrections are
approved — and building a table before those are settled is how a schema ends
up with the wrong answer baked into it.

So this is the master table and only the master table: who, which day, first
in, last out, how long, which reader. It is also the thing that makes those
decisions easier to take, because it puts the real data in front of the people
taking them.

WHAT A PUNCH IS AND IS NOT. A punch at the gate is not presence on a machine,
and silence is not absence: the mine has gates people walk through without
punching. A worker with no punch is shown as "not clocked", which is a gap in
the record rather than a claim about where they were.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import attendance as frs

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])

# A month at a time. The query is one round trip whatever the span, but a year
# of rows is a table nobody reads and a payload nobody needs.
MAX_DAYS = 62


def _minutes(first_in, last_out) -> int | None:
    """Time between the first in and the last out.

    Not "hours worked": it counts the gap, including the break in the middle,
    because the readers record two punches a day for most people and inventing
    a break nobody recorded would be inventing a number.

    A last-out before the first-in is somebody who left after midnight on a C
    shift. That is a real day, not a negative one, so it wraps.
    """
    if not first_in or not last_out:
        return None
    mins = int((last_out - first_in).total_seconds() // 60)
    return mins + 1440 if mins < 0 else mins


@router.get("/register")
def register(
    day_from: str = Query(..., description="yyyy-mm-dd"),
    day_to: str | None = Query(None, description="yyyy-mm-dd; defaults to day_from"),
    db: Session = Depends(get_minehub_db),
) -> dict:
    """One row per worker per day, for the range asked for."""
    try:
        frm = date.fromisoformat(day_from[:10])
        to = date.fromisoformat((day_to or day_from)[:10])
    except ValueError:
        raise HTTPException(400, "Dates are yyyy-mm-dd.")
    if to < frm:
        frm, to = to, frm
    if (to - frm).days + 1 > MAX_DAYS:
        raise HTTPException(
            400, f"That is {(to - frm).days + 1} days; this reads at most {MAX_DAYS} "
                 "at a time. Narrow the range.")

    people = frs.register(db)
    if not people:
        return {"configured": frs.configured(), "days": [], "rows": [], "people": 0,
                "note": "Nobody on the register carries a number the readers know."}

    days = [(frm + timedelta(days=i)).isoformat() for i in range((to - frm).days + 1)]

    if not frs.configured():
        return {"configured": False, "days": days, "rows": [], "people": len(people),
                "note": "The mine has not told this platform where the readers write."}

    try:
        punched = frs.punch_days(frm, to, [p["emp_no"] for p in people])
    except Exception:                        # noqa: BLE001
        raise HTTPException(503, "The attendance readers could not be reached.")

    today = date.today().isoformat()
    rows = []
    for p in people:
        for on in days:
            hit = punched.get((p["emp_no"], on))
            first_in = hit["first_in"] if hit else None
            last_out = hit["last_out"] if hit else None
            mins = _minutes(first_in, last_out)
            # Said rather than computed into a boolean, because the mine has
            # not decided what silence means and this screen must not decide
            # it for them.
            state = ("NOT_CLOCKED" if not hit
                     else "IN_ONLY" if first_in and not last_out
                     else "OUT_ONLY" if last_out and not first_in
                     else "COMPLETE")
            rows.append({
                "operator_id": p["operator_id"],
                "operator_ref": p["operator_ref"],
                "name": p["display_name"],
                "emp_no": p["emp_no"],
                "trade": p["trade"],
                "trade_group": p["trade_group"],
                "employer": p["employer"],
                "department": p["department"],
                "designation": p["designation"],
                "on_date": on,
                "first_in": first_in.isoformat() if first_in else None,
                "last_out": last_out.isoformat() if last_out else None,
                "minutes": mins,
                "punches": hit["punches"] if hit else 0,
                "devices": hit["devices"] if hit else 0,
                "in_gate": hit["in_gate"] if hit else None,
                "out_gate": hit["out_gate"] if hit else None,
                "state": state,
                # A day still running is not an incomplete record.
                "running": on == today and state == "IN_ONLY",
            })

    return {"configured": True, "days": days, "people": len(people), "rows": rows}


@router.get("/punches")
def punches(
    day: str = Query(..., description="yyyy-mm-dd"),
    emp_no: str = Query(..., description="the number the readers know them by"),
) -> list[dict]:
    """Every punch one person made on one day, with the reader that took it."""
    if not frs.configured():
        raise HTTPException(503, "The attendance readers are not configured.")
    try:
        on = date.fromisoformat(day[:10])
    except ValueError:
        raise HTTPException(400, "The date is yyyy-mm-dd.")
    try:
        return [{**p, "at": p["at"].isoformat()} for p in frs.punches_on(on, emp_no)]
    except Exception:                        # noqa: BLE001
        raise HTTPException(503, "The attendance readers could not be reached.")
