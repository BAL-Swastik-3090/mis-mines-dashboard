"""Upload and read the mine's day-wise de-silting plan.

THREE ENDPOINTS FOR WHAT LOOKS LIKE ONE ACTION, and the split is the point.
/preview parses and compares and writes nothing; POST / writes. The screen
walks month → file → check → submit, and the person submitting has by then
seen the figures that are about to be stored and what they will replace.

Parsing twice -- once to preview, once to commit -- is deliberate. The
alternative is holding the parsed rows on the server between the two calls,
which means state keyed by session, a lifetime for it, and a question nobody
can answer about what happens when two people upload at once. The file is
small, the parse is milliseconds, and the second parse is also a second
chance to notice the file changed under us.
"""
from __future__ import annotations

from datetime import date

from fastapi import (APIRouter, Depends, File, HTTPException, Query, Request,
                     UploadFile)
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import desilting_plan as svc
from app.services.desilting_plan import SheetError

router = APIRouter(prefix="/api/desilting-plan", tags=["De-Silting Plan"])

#: An .xlsx is 20-odd kB. Anything approaching this is not a month's plan.
MAX_UPLOAD = 5 * 1024 * 1024

#: What a browser calls an .xlsx, plus the two it calls one when the file came
#: off a network share. Checked as a courtesy -- openpyxl is the real arbiter
#: and refuses anything it cannot open.
XLSX_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
    "",
}


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


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


def _sheet_error(e: SheetError) -> HTTPException:
    """Every problem, not the first.

    422 rather than 400: the request was well formed and the file was readable;
    it was its CONTENTS that did not qualify, and the screen lists `problems`
    as a checklist against the spreadsheet.
    """
    return HTTPException(422, detail={
        "message": "That sheet could not be read as a de-silting plan.",
        "problems": e.problems,
    })


@router.get("", summary="The de-silting plan stored for one month")
def get_month(year: int = Query(..., ge=2020, le=2100),
              month: int = Query(..., ge=1, le=12),
              db: Session = Depends(get_minehub_db)) -> dict:
    rows = svc.read_month(db, year, month)
    return {
        "year": year, "month": month,
        "rows": rows,
        "total": round(sum(r["plan_qty"] for r in rows), 3) if rows else None,
        # The screen says "revising October" rather than "uploading October"
        # when something is already there, so nobody overwrites a plan they
        # did not know existed.
        "has_plan": bool(rows),
    }


@router.post("/preview", summary="Read a workbook and say what it would change")
async def preview(request: Request,
                  year: int = Query(..., ge=2020, le=2100),
                  month: int = Query(..., ge=1, le=12),
                  file: UploadFile = File(...),
                  db: Session = Depends(get_minehub_db)) -> dict:
    """NOTHING IS STORED HERE. Not the rows, not the file."""
    data = await _payload(file)
    try:
        parsed = svc.parse(data, year, month)
    except SheetError as e:
        raise _sheet_error(e) from e

    return {
        "file_name": file.filename,
        "qty_heading": parsed["qty_heading"],
        "header_row": parsed["header_row"],
        "rows": [{"plan_date": r["plan_date"].isoformat(),
                  "plan_qty": r["plan_qty"]} for r in parsed["rows"]],
        "total": parsed["total"],
        "sheet_total": parsed["sheet_total"],
        "warnings": parsed["warnings"],
        "diff": svc.diff(db, parsed),
    }


@router.post("", summary="Store the plan for one month")
async def submit(request: Request,
                 year: int = Query(..., ge=2020, le=2100),
                 month: int = Query(..., ge=1, le=12),
                 file: UploadFile = File(...),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Make the month exactly what the file holds, and say what changed."""
    data = await _payload(file)
    try:
        parsed = svc.parse(data, year, month)
    except SheetError as e:
        raise _sheet_error(e) from e

    changes = svc.replace_month(db, parsed, _actor(request))
    return {
        "status": "success",
        "year": year, "month": month,
        "stored": len(parsed["rows"]),
        "total": parsed["total"],
        "changes": changes,
        "entry_id": _actor(request),
    }


@router.delete("", summary="Remove the plan stored for one month")
def clear_month(request: Request,
                year: int = Query(..., ge=2020, le=2100),
                month: int = Query(..., ge=1, le=12),
                db: Session = Depends(get_minehub_db)) -> dict:
    """For a month uploaded by mistake.

    Deleted rather than zeroed, so the dashboard goes back to saying no plan
    exists instead of claiming the mine planned to shift nothing.
    """
    from calendar import monthrange
    from sqlalchemy import text
    n = db.execute(text("""
        DELETE FROM minehub.desilting_plan WHERE plan_date BETWEEN :f AND :t
    """), {"f": date(year, month, 1),
           "t": date(year, month, monthrange(year, month)[1])}).rowcount
    db.commit()
    return {"status": "success", "removed": n}
