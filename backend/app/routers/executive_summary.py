"""Mines Executive Summary — the daily report on one screen.

READ-ONLY. Every figure is composed from the services that already own it, so
there is nothing to enter and nothing to store.

THE CALLER SENDS THE FILTER'S END DATE, NOT THE REPORT DAY. The two as-on dates
are derived here, from one rule, rather than being passed in — a client that
computed them itself could put the stock block and the performance block on
days that do not belong together, which is exactly the confusion this report
exists to remove.

WHO MAY LOOK. Mapped to the "mis" page in services/auth.py: the summary shows
nothing the MIS dashboard does not already show, it only shows it on one screen.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.executive_summary import ExecutiveSummaryResponse
from app.services.executive_summary import get_executive_summary

router = APIRouter(prefix="/api/executive-summary", tags=["Executive Summary"])


def _report_day(to_date: date, today: date) -> date:
    """The last day that has ENDED, never later than the filter's end.

    Mirrors reportDay() in frontend/src/lib/prevDay.ts. The filter's end is used
    as-is when it is already in the past — a range ending 30 September reports on
    the 30th, not the 29th — and only a range running to today or beyond falls
    back to yesterday, because today has not finished.
    """
    yesterday = today - timedelta(days=1)
    return to_date if to_date < yesterday else yesterday


def _stock_as_on(report_day: date, today: date) -> date:
    """The snapshot that shows where report_day left the mine: the NEXT morning.

    The stock form is filled at the start of a day and dated that day, so the
    position resulting from the 8th's work is the snapshot dated the 9th. Never
    past today — there is no tomorrow to have filed anything.
    """
    return min(report_day + timedelta(days=1), today)


@router.get("", response_model=ExecutiveSummaryResponse)
def executive_summary(
    to_date: date = Query(..., description="End of the dashboard's date filter"),
    db: Session = Depends(get_db),
) -> ExecutiveSummaryResponse:
    today = date.today()
    if to_date < date(2020, 1, 1):
        raise HTTPException(422, "to_date is implausibly early")
    rd = _report_day(to_date, today)
    return get_executive_summary(db, rd, _stock_as_on(rd, today))
