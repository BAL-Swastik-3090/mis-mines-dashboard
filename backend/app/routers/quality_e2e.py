"""End-to-end quality tracking — mine despatch against plant receipt.

READ-ONLY. Every figure is derived from SAP; there is nothing to enter and
nothing to store, so a stale row is impossible and a corrected assay appears
here the moment it is posted.

QUANTITY AND TRIPS RECEIVED currently mirror the despatched figures, at the
mine's request, until the plant-side gate record is identified. The variance
columns for those two are therefore zero by construction — that is honest
rather than misleading only because the service builds the received side from
the same numbers, so nothing here claims the plant independently confirmed
them. Wiring the real figures is a change in services/quality_e2e.py alone:
the "plant" block of each row, and nothing else.

WHO MAY LOOK. Mapped to the "mis" page in services/auth.py, so the middleware
already requires dashboard.mis — the same permission that shows the despatch
and stock sections this table sits beneath.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.quality_e2e import get_quality_e2e

router = APIRouter(prefix="/api/quality-e2e", tags=["End to End Quality"])

# A month of consignments is roughly 30 rows. The cap is there to stop a
# mistyped year pulling two years of inspection lots through the join.
MAX_SPAN_DAYS = 400


@router.get("")
def quality_e2e(
    from_date: date = Query(..., description="First despatch date, inclusive"),
    to_date: date = Query(..., description="Last despatch date, inclusive"),
    db: Session = Depends(get_db),
) -> dict:
    if to_date < from_date:
        raise HTTPException(422, "to_date is before from_date")
    if (to_date - from_date) > timedelta(days=MAX_SPAN_DAYS):
        raise HTTPException(422, f"range exceeds {MAX_SPAN_DAYS} days")
    return get_quality_e2e(db, from_date, to_date)
