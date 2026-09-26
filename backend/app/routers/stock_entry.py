"""Mines stock position, entered on the dashboard instead of the IMOS portal.

WHAT A SUBMISSION IS. One day's complete position: 25 figures — four grades in
each of six buckets, plus LG for COB which applies to Low Grade only. A zero is
an assertion that there is none of that grade in that bucket, not a blank, so
every cell is written. To retract a day entirely, DELETE it.

ONE TRANSACTION. The whole day is replaced in a single transaction: a failure
leaves the previous position exactly as it was rather than half overwritten.
A stock position that is 60% of yesterday and 40% of today is worse than one
that is simply yesterday's, because it looks current.

DELETE-THEN-INSERT rather than upsert, and deliberately: a bucket that has been
removed from the form, or a grade that stops being reported, would otherwise
linger from an earlier save and quietly inflate a total nobody is looking at.
Replacing the day means what is stored is exactly what was submitted.

WHO MAY EDIT. Anyone who can open the MIS dashboard — the prefix is mapped to
the "mis" page in services/auth.py, so the middleware already requires
dashboard.mis. Set STOCK_PERMISSION below to tighten it from Access Control
later; nothing else needs to change. Every row records who saved it and when.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db

router = APIRouter(prefix="/api/stock-entry", tags=["Mines Stock Entry"])

GRADES = ("HG", "MG", "COB", "LG")

# Bucket -> whether it sits at the mine. Must match the CHECK constraint in
# scripts/sql/005_mines_stock_entry.sql; this is its only counterpart in code.
BUCKETS: dict[str, bool] = {
    "MINE_PERMISSION_IN_HAND":    True,
    "MINE_AWAITING_PERMISSION":   True,
    "MINE_AWAITING_VERIFICATION": True,
    "MINE_AWAITING_STACKING":     True,
    "BAL_PLANT":                  False,
    "SUK_PLANT":                  False,
    "LG_FOR_COB":                 False,
}

# LG for COB exists on the Low Grade row only — the IMOS form shows a dash for
# every other grade, and the database refuses anything else.
LG_ONLY = "LG_FOR_COB"

# None means "anyone who can open the MIS dashboard". Put a permission code here
# to restrict it.
STOCK_PERMISSION: str | None = None


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _valid_cell(grade: str, bucket: str) -> bool:
    if grade not in GRADES or bucket not in BUCKETS:
        return False
    return not (bucket == LG_ONLY and grade != "LG")


@router.get("", summary="The stock position entered for one day")
def get_day(
    on_date: date = Query(..., description="The Stock_Date to read"),
    db: Session = Depends(get_db),
) -> dict:
    rows = db.execute(text("""
        SELECT Grade, Bucket, Qty, Entry_Id, Entry_Date
          FROM mines_stock_entry
         WHERE Stock_Date = :d
    """), {"d": on_date}).mappings().all()

    # Keyed "GRADE|BUCKET" so the form reads one cell without searching.
    return {
        "on_date": on_date,
        "has_data": len(rows) > 0,
        "cells": {f"{r['Grade']}|{r['Bucket']}": float(r["Qty"]) for r in rows},
        "entered_by": rows[0]["Entry_Id"] if rows else None,
        "entered_at": (rows[0]["Entry_Date"].isoformat()
                       if rows and rows[0]["Entry_Date"] else None),
    }


@router.put("", summary="Replace one day's stock position")
def put_day(
    request: Request,
    on_date: date = Body(..., embed=True),
    # [{grade, bucket, qty}] — the whole day.
    cells: list[dict] = Body(..., embed=True),
    db: Session = Depends(get_db),
) -> dict:
    if STOCK_PERMISSION:
        from app.services import access as access_svc
        if not access_svc.has_permission(db, _actor(request), STOCK_PERMISSION):
            raise HTTPException(403, "You may not enter stock figures.")

    if on_date > date.today():
        raise HTTPException(400, "Cannot record a stock position for a future date.")

    # Validate the WHOLE submission before writing any of it, so a bad cell
    # cannot leave the day half replaced.
    clean: list[tuple[str, str, float]] = []
    seen: set[tuple[str, str]] = set()
    for c in cells:
        grade = str(c.get("grade", "")).strip().upper()
        bucket = str(c.get("bucket", "")).strip().upper()
        if not _valid_cell(grade, bucket):
            raise HTTPException(400, f"'{grade}' is not stored in '{bucket}'.")
        if (grade, bucket) in seen:
            raise HTTPException(400, f"{grade} / {bucket} appears twice.")
        seen.add((grade, bucket))

        raw = c.get("qty")
        try:
            qty = float(raw if raw not in (None, "") else 0)
        except (TypeError, ValueError):
            raise HTTPException(400, f"'{raw}' is not a number for {grade} / {bucket}.")
        if qty < 0:
            raise HTTPException(400, f"{grade} / {bucket} cannot be negative.")
        clean.append((grade, bucket, qty))

    if not clean:
        raise HTTPException(400, "Nothing to submit.")

    who = _actor(request)
    db.execute(text("DELETE FROM mines_stock_entry WHERE Stock_Date = :d"),
               {"d": on_date})
    db.execute(text("""
        INSERT INTO mines_stock_entry (Stock_Date, Grade, Bucket, Qty, Entry_Id)
        VALUES (:d, :g, :b, :q, :who)
    """), [{"d": on_date, "g": g, "b": b, "q": q, "who": who} for g, b, q in clean])
    db.commit()

    return {"on_date": on_date, "saved": len(clean), "entered_by": who}


@router.delete("", summary="Remove a day's stock position entirely")
def delete_day(
    request: Request,
    on_date: date = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    if STOCK_PERMISSION:
        from app.services import access as access_svc
        if not access_svc.has_permission(db, _actor(request), STOCK_PERMISSION):
            raise HTTPException(403, "You may not enter stock figures.")
    r = db.execute(text("DELETE FROM mines_stock_entry WHERE Stock_Date = :d"),
                   {"d": on_date})
    db.commit()
    return {"on_date": on_date, "removed": r.rowcount or 0}
