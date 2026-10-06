"""AMIRA accounting — contained chromium followed from mine to plant.

READ-ONLY and derived entirely from SAP, through the same service that feeds
the End-to-End Quality section. Nothing is entered and nothing is stored, so a
corrected assay appears here as soon as the lab posts it.

WHO MAY LOOK. Mapped to the "mis" page in services/auth.py, so the middleware
already requires dashboard.mis — the same permission as the despatch and
quality sections this sits beside.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.amira import get_amira_accounting

router = APIRouter(prefix="/api/amira", tags=["AMIRA Accounting"])

# Matches the cap on /api/quality-e2e, which this calls: the two must agree, or
# a range this accepted would fail underneath with a less obvious message.
MAX_SPAN_DAYS = 400


@router.get("")
def amira_accounting(
    from_date: date = Query(..., description="First despatch date, inclusive"),
    to_date: date = Query(..., description="Last despatch date, inclusive"),
    db: Session = Depends(get_db),
) -> dict:
    if to_date < from_date:
        raise HTTPException(422, "to_date is before from_date")
    if (to_date - from_date) > timedelta(days=MAX_SPAN_DAYS):
        raise HTTPException(422, f"range exceeds {MAX_SPAN_DAYS} days")
    return get_amira_accounting(db, from_date, to_date)
