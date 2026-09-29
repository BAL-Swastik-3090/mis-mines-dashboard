"""Plant output — ferrochrome produced and its composite analysis.

READ-ONLY, derived entirely from SAP. Nothing is entered and nothing is stored,
so a corrected assay appears here as soon as the lab posts it.

WHO MAY LOOK. Mapped to the "mis" page in services/auth.py, so the middleware
already requires dashboard.mis — the same permission as the end-to-end quality
section this sits beneath.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.plant_output import get_plant_output

router = APIRouter(prefix="/api/plant-output", tags=["Plant Output"])

# A month is about 150 furnace-days. The cap stops a mistyped year dragging two
# years of inspection results through the join.
MAX_SPAN_DAYS = 400


@router.get("")
def plant_output(
    from_date: date = Query(..., description="First production date, inclusive"),
    to_date: date = Query(..., description="Last production date, inclusive"),
    db: Session = Depends(get_db),
) -> dict:
    if to_date < from_date:
        raise HTTPException(422, "to_date is before from_date")
    if (to_date - from_date) > timedelta(days=MAX_SPAN_DAYS):
        raise HTTPException(422, f"range exceeds {MAX_SPAN_DAYS} days")
    return get_plant_output(db, from_date, to_date)
