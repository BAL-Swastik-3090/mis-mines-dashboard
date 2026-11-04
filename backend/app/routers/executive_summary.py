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

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.executive_summary import ExecutiveSummaryResponse
from app.services.executive_summary import get_executive_summary
# THE RULE LIVES IN ONE MODULE NOW. It was written out here and again in
# prevDay.ts and nowhere at all in the OEE and LCM endpoints, which is how
# the Lost Cost Matrix came to divide a four-day plan by three days of shift
# log. Both copies that were here are gone; this is the same arithmetic.
from app.services.report_window import report_day as _report_day_rule
from app.services.report_window import stock_as_on as _stock_as_on_rule

router = APIRouter(prefix="/api/executive-summary", tags=["Executive Summary"])


def _report_day(to_date: date, today: date) -> date:
    return _report_day_rule(to_date, today)


def _stock_as_on(report_day: date, today: date) -> date:
    return _stock_as_on_rule(report_day, today)


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
