"""Shifting: the day's actual typed in, and the month's plan off a workbook.

TWO ENTRY SHAPES, BECAUSE THEY ARE TWO JOBS. The actual is three figures for
one day and is a form, like Enter Est Actual: what you are about to store is
in front of you, so there is no preview. The plan is thirty days of numbers
off somebody's spreadsheet and is an upload, like Enter De-Silting Plan:
/plan/preview parses and compares and writes nothing, POST /plan writes. The
screen shows what would change before anything does, because a re-upload
REPLACES the month.

Parsing twice -- once to preview, once to commit -- is deliberate, and is the
rule the de-silting upload already follows: holding the parse between two
requests would mean trusting that the file behind a confirmation is the file
that was previewed.
"""
from __future__ import annotations

from datetime import date

from fastapi import (APIRouter, Depends, File, HTTPException, Query, Request,
                     UploadFile)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import shifting as svc
from app.services.shifting import SheetError

router = APIRouter(prefix="/api/shifting", tags=["Shifting"])

#: An .xlsx of thirty rows is 20-odd kB. Anything near this is not a plan.
MAX_UPLOAD = 5 * 1024 * 1024

#: What a browser calls an .xlsx, plus the two it calls one when the file came
#: off a network share. A courtesy check -- openpyxl is the real arbiter.
XLSX_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
    "",
}


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _month(year: int, month: int) -> date:
    try:
        return date(year, month, 1)
    except ValueError:
        raise HTTPException(400, "That is not a month.")


async def _payload(file: UploadFile) -> bytes:
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Please choose an Excel file (.xlsx).")
    if (file.content_type or "") not in XLSX_TYPES:
        raise HTTPException(400, f"That file is a {file.content_type}, not an "
                                 "Excel workbook.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "That file is empty.")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(400, "That file is larger than 5 MB — a month's "
                                 "plan should be a few kilobytes.")
    return data


def _sheet_error(e: SheetError, what: str) -> HTTPException:
    """Every problem, not the first.

    422 rather than 400: the request was well formed and the file readable; it
    was its CONTENTS that did not qualify, and the screen lists `problems` as
    a checklist against the spreadsheet.
    """
    return HTTPException(422, detail={"message": what, "problems": e.problems})


# ── The day's actual ─────────────────────────────────────────────────────────
class ActualIn(BaseModel):
    """One day's three figures. A material left out, or sent as null, is not
    stored -- see save_actual: "not entered" and "nothing moved" are different
    statements and only the second is a figure."""
    entry_date: date = Field(description="The day the work was done")
    lg: float | None = Field(default=None, ge=0)
    tailings: float | None = Field(default=None, ge=0)
    rehandling: float | None = Field(default=None, ge=0)


@router.get("/actual")
def read_actual(entry_date: date = Query(...),
                db: Session = Depends(get_minehub_db)) -> dict:
    """One day as the form shows it: three rows, plan beside actual.

    The plan travels with it so the person entering sees the target against
    the figure they are typing, rather than opening a second screen for it.
    """
    rows = svc.day(db, entry_date)
    return {
        "date": entry_date.isoformat(),
        "unit": svc.UNIT,
        "entered": any(r["actual_cum"] is not None for r in rows),
        "revision": svc.month_revision(db, entry_date, entry_date,
                                       "shifting_actual"),
        "materials": rows,
    }


@router.post("/actual")
def save_actual(body: ActualIn, request: Request,
                db: Session = Depends(get_minehub_db)) -> dict:
    """Store or edit one day. Editing is the same call -- see _apply."""
    qty = {svc.LG: body.lg, svc.TAILINGS: body.tailings,
           svc.REHANDLING: body.rehandling}
    try:
        out = svc.save_actual(db, body.entry_date, qty, _actor(request))
    except SheetError as e:
        raise _sheet_error(e, "The day was not saved.")
    return {**out, "date": body.entry_date.isoformat(),
            "entry_id": _actor(request)}


@router.get("/actual/month")
def read_actual_month(year: int = Query(...), month: int = Query(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """A whole month of actuals beside the plan — what a table would show."""
    frm = _month(year, month)
    to = svc.month_end(frm)
    plan = svc.plan_for(db, frm, to)
    act = {(date.fromisoformat(r["date"]), r["material"]): r
           for r in svc.read_range(db, frm, to, "shifting_actual")}
    days: list[dict] = []
    d = frm
    while d <= to:
        days.append({
            "date": d.isoformat(),
            "materials": [{
                "material": m, "label": svc.LABELS[m],
                "plan_cum": plan.get((d, m)),
                "actual_cum": act[(d, m)]["qty_cum"] if (d, m) in act else None,
                "updated_date": act[(d, m)]["updated_date"] if (d, m) in act else None,
            } for m in svc.MATERIALS],
        })
        d = d.fromordinal(d.toordinal() + 1)
    return {"year": year, "month": month, "unit": svc.UNIT, "days": days}


# ── The month's plan ─────────────────────────────────────────────────────────
@router.get("/plan")
def read_plan(year: int = Query(...), month: int = Query(...),
              db: Session = Depends(get_minehub_db)) -> dict:
    """What is stored for the month, with its totals and how it got there."""
    frm = _month(year, month)
    to = svc.month_end(frm)
    rows = svc.read_range(db, frm, to, "shifting_plan")
    totals = {m: round(sum(r["qty_cum"] for r in rows if r["material"] == m), 3)
              for m in svc.MATERIALS}
    uploaded = [r["updated_date"] or r["entry_date"] for r in rows]
    return {
        "year": year, "month": month, "unit": svc.UNIT,
        "from_date": frm.isoformat(), "to_date": to.isoformat(),
        "entered": bool(rows),
        "revision": svc.month_revision(db, frm, to, "shifting_plan"),
        "days": len({r["date"] for r in rows}),
        "totals": totals,
        # The most recent write to any row in the month: what the screen means
        # by "last uploaded".
        "last_change": max(uploaded) if uploaded else None,
        "rows": rows,
    }


@router.post("/plan/preview")
async def preview_plan(request: Request,
                       year: int = Query(..., ge=2020, le=2100),
                       month: int = Query(..., ge=1, le=12),
                       file: UploadFile = File(...),
                       db: Session = Depends(get_minehub_db)) -> dict:
    """Read a workbook and say what it WOULD change. Writes nothing."""
    data = await _payload(file)
    try:
        parsed = svc.parse(data, year, month)
    except SheetError as e:
        raise _sheet_error(e, "That sheet could not be read as a shifting plan.")
    return {
        "year": year, "month": month, "unit": svc.UNIT,
        "filename": file.filename,
        "header_row": parsed["header_row"],
        "days": parsed["days"],
        "totals": parsed["totals"],
        "skipped_total_rows": parsed["skipped_total_rows"],
        "change": svc.diff(db, parsed),
    }


@router.post("/plan")
async def submit_plan(request: Request,
                      year: int = Query(..., ge=2020, le=2100),
                      month: int = Query(..., ge=1, le=12),
                      file: UploadFile = File(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Store the month, replacing what was there and keeping what it replaced."""
    data = await _payload(file)
    try:
        parsed = svc.parse(data, year, month)
        out = svc.replace_month(db, parsed, _actor(request))
    except SheetError as e:
        raise _sheet_error(e, "That sheet could not be read as a shifting plan.")
    return {**out, "filename": file.filename, "entry_id": _actor(request)}


# ── The trail ────────────────────────────────────────────────────────────────
@router.get("/history")
def read_history(which: str = Query("plan", pattern="^(plan|actual)$"),
                 year: int | None = Query(None), month: int | None = Query(None),
                 material: str | None = Query(None),
                 limit: int = Query(300, ge=1, le=2000),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Every change, newest first, with the value before and after."""
    frm = to = None
    if year and month:
        frm = _month(year, month)
        to = svc.month_end(frm)
    if material and material not in svc.MATERIALS:
        raise HTTPException(400, "not a shifting material")
    rows = svc.history(db, frm, to, material, which, limit)
    return {"which": which, "count": len(rows), "history": rows}
