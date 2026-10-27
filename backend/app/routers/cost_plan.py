"""Cost plan - upload the SAP CO plan exports and read the plan back.

Two uploads, because the export carries numbers and the workbook carries
what they mean: /upload takes the monthly plan files, /masters takes the
CE and CC List. The plan is readable only once both have been loaded.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import cost_plan
from app.services.cost_plan import PlanParseError

router = APIRouter(prefix="/api/cost-plan", tags=["Cost Plan"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024      # these exports run well under 100 KB
SECTIONS = ("MINES", "COB")


def _latest(db: Session) -> tuple[int, int]:
    periods = cost_plan.available_periods(db)
    if not periods:
        raise HTTPException(404, "No cost plan has been uploaded yet.")
    return periods[0]["fiscal_year"], periods[0]["period"]


@router.post("/upload")
async def upload(
    files: list[UploadFile] = File(..., description="SAP CO plan exports (.csv or .xlsx)"),
    dry_run: bool = Form(False, description="Parse and report, write nothing"),
    uploaded_by: str | None = Form(None),
    db: Session = Depends(get_minehub_db),
):
    """Load one or more monthly plan exports.

    The files of a month are disjoint, so uploading all of them builds one
    plan. Re-uploading a file overwrites only the rows it contains.
    """
    results, errors = [], []
    for upload_file in files:
        try:
            content = await upload_file.read()
            if len(content) > MAX_UPLOAD_BYTES:
                raise PlanParseError(f"File is larger than {MAX_UPLOAD_BYTES // 1024 // 1024} MB")

            parsed = cost_plan.parse_plan(content, upload_file.filename or "")
            report = parsed["report"]
            if dry_run:
                report["written"] = False
            else:
                report.update(cost_plan.upsert_plan(
                    db, parsed["meta"], parsed["rows"],
                    upload_file.filename or "", uploaded_by))
                report["written"] = True
            results.append(report)
        except PlanParseError as exc:
            errors.append({"file": upload_file.filename, "error": str(exc)})
        finally:
            await upload_file.close()

    if errors and not results:
        raise HTTPException(400, {"message": "No file could be processed", "errors": errors})

    return {
        "files_accepted": len(results),
        "files_rejected": len(errors),
        "rows_written": sum(r.get("rows_received", 0) for r in results if r.get("written")),
        "results": results,
        "errors": errors,
    }


@router.post("/masters")
async def upload_masters(
    file: UploadFile = File(..., description="CE and CC List workbook (.xlsx)"),
    db: Session = Depends(get_minehub_db),
):
    """Load the cost element and cost centre descriptions."""
    try:
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise PlanParseError(f"File is larger than {MAX_UPLOAD_BYTES // 1024 // 1024} MB")
        parsed = cost_plan.parse_masters(content, file.filename or "")
        written = cost_plan.upsert_masters(
            db, parsed["cost_elements"], parsed["cost_centres"], file.filename or "")
        return {**parsed["report"], **written, "written": True}
    except PlanParseError as exc:
        raise HTTPException(400, str(exc))
    finally:
        await file.close()


@router.get("/periods")
def periods(db: Session = Depends(get_minehub_db)):
    """Months the plan actually covers, so the UI offers only real options."""
    return {"periods": cost_plan.available_periods(db),
            "masters": cost_plan.get_master_status(db)}


@router.get("/summary")
def summary(
    fiscal_year: int | None = Query(None),
    period: int | None = Query(None, ge=1, le=16),
    section: str | None = Query(None, description="MINES or COB"),
    db: Session = Depends(get_minehub_db),
):
    """Planned cost for a period, broken down by section, element and centre."""
    if section and section not in SECTIONS:
        raise HTTPException(400, f"section must be one of {SECTIONS}")
    if fiscal_year is None or period is None:
        fiscal_year, period = _latest(db)
    return cost_plan.get_summary(db, fiscal_year, period, section)


@router.get("/rows")
def rows(
    fiscal_year: int | None = Query(None),
    period: int | None = Query(None, ge=1, le=16),
    section: str | None = Query(None),
    cost_centre: str | None = Query(None),
    cost_element: str | None = Query(None),
    limit: int = Query(1000, ge=1, le=10000),
    db: Session = Depends(get_minehub_db),
):
    """The plan line by line, with descriptions resolved."""
    if section and section not in SECTIONS:
        raise HTTPException(400, f"section must be one of {SECTIONS}")
    if fiscal_year is None or period is None:
        fiscal_year, period = _latest(db)
    return {
        "fiscal_year": fiscal_year, "period": period, "section": section,
        "rows": cost_plan.get_rows(db, fiscal_year, period, section,
                                   cost_centre, cost_element, limit),
    }


@router.get("/uploads")
def uploads(limit: int = Query(50, ge=1, le=500), db: Session = Depends(get_minehub_db)):
    """Load history - which file produced which rows, and what moved."""
    return {"uploads": cost_plan.get_uploads(db, limit)}
