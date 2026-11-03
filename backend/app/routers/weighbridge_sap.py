"""Weighbridge · Report from SAP.

READ-ONLY. The feed is SAP's; nothing on this screen writes to it.

GUARDED HERE, NOT BY A PATH PREFIX. /api/weighbridge is absent from
auth.PREFIX_PAGE and checks wb.view inside each handler instead; this does the
same, so the two halves of the section cannot end up with different answers to
"who may look". It is the SAME permission deliberately — they are one section
split by which system recorded the weighing, and a second code would have to
be invented and seeded against every role before anybody could open the half
of a page they already hold.

The permission is checked against balcorpdb while the data is read from
Postgres, which is why this takes two sessions. access_svc holds the roles on
MySQL with the rest of the application's own tables.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import access as access_svc
from app.services import weighbridge_sap as svc

VIEW = "wb.view"

router = APIRouter(prefix="/api/weighbridge-sap", tags=["Weighbridge (SAP)"])

#: A year at a time is already more than the register draws. Beyond that the
#: request is a mistake — a date picker left at its minimum, usually — and
#: answering it costs the database a scan nobody wanted.
MAX_SPAN_DAYS = 400


@router.get("", summary="Weighings as SAP recorded them")
def report(
    request: Request,
    from_date: date = Query(..., description="First production date"),
    to_date: date = Query(..., description="Last production date"),
    db: Session = Depends(get_minehub_db),
    mysql: Session = Depends(get_db),
) -> dict:
    actor = getattr(request.state, "emp_id", None) or "unknown"
    if not access_svc.has_permission(mysql, actor, VIEW):
        raise HTTPException(403, f"This needs the '{VIEW}' permission.")
    if to_date < from_date:
        raise HTTPException(422, "to_date is before from_date.")
    if to_date - from_date > timedelta(days=MAX_SPAN_DAYS):
        raise HTTPException(
            422, f"That range is longer than {MAX_SPAN_DAYS} days.")
    return svc.get_report(db, from_date, to_date)
