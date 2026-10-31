"""Electric vehicle tracking — upload LiuGong exports and read the fleet back.

The upload is the whole point: the user exports one workbook per machine per
month from the LiuGong portal and drops it here. The machine is identified from
the file name, so nothing has to be typed in.
"""
from __future__ import annotations

import datetime as dt

from fastapi import (APIRouter, Depends, File, Form, HTTPException, Query,
                     Request, UploadFile)
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import ev_vehicle
from app.services.ev_vehicle import EvParseError

router = APIRouter(prefix="/api/ev", tags=["Electric Vehicles"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024      # these exports run ~25 KB; 10 MB is generous


def _actor(request: Request) -> str:
    """Who pressed the button. Recorded against the upload so a disputed
    figure has a name next to it, not just a file name."""
    return getattr(request.state, "emp_id", None) or "unknown"


def _window(date_from: dt.date | None, date_to: dt.date | None) -> tuple[dt.date, dt.date]:
    """Default to the last 30 days when the caller gives no window."""
    end = date_to or dt.date.today()
    start = date_from or (end - dt.timedelta(days=30))
    if start > end:
        raise HTTPException(400, "date_from must not be after date_to")
    return start, end


@router.get("/analytics")
def analytics(from_date: dt.date | None = Query(None, description="Start of the period; defaults to month-to-date"),
              to_date: dt.date | None = Query(None, description="Report day; defaults to the latest the fleet holds"),
              db: Session = Depends(get_minehub_db)) -> dict:
    """Every machine's day, period and lifetime figures on one call."""
    return ev_vehicle.get_fleet_analytics(db, to_date, from_date)


@router.get("/freshness")
def freshness(db: Session = Depends(get_minehub_db)) -> dict:
    """Which machines have not had yesterday's export loaded by 09:30."""
    return ev_vehicle.get_freshness(db)


@router.get("/coverage")
def coverage(db: Session = Depends(get_minehub_db)) -> dict:
    """What the record covers and what it is missing, per machine."""
    return ev_vehicle.get_coverage(db)


@router.get("/uploads/log")
def uploads_log(limit: int = Query(50, ge=1, le=200),
                db: Session = Depends(get_minehub_db)) -> list[dict]:
    """What has actually been uploaded, newest first.

    Distinct from /uploads, which groups the tracking table by source_file and
    so describes the current state rather than the history: a day re-loaded
    from a second file moves to that file and the first one shrinks.
    """
    return ev_vehicle.get_upload_log(db, limit)


@router.get("/uploads/log/{batch_id}/changes")
def uploads_log_changes(batch_id: int,
                        db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Day by day, what that upload did."""
    return ev_vehicle.get_upload_changes(db, batch_id)


@router.post("/upload")
async def upload(
    request: Request,
    files: list[UploadFile] = File(..., description="LiuGong .xlsx exports"),
    serial_no: str | None = Form(None, description="Override the serial read from the file name"),
    dry_run: bool = Form(False, description="Parse and report, write nothing"),
    db: Session = Depends(get_minehub_db),
):
    """Parse one or more exports and store them.

    Re-uploading a month overwrites that month — the primary key is
    (machine, day), so loading the same file twice is safe.
    """
    if serial_no and len(files) > 1:
        raise HTTPException(400, "serial_no can only be used with a single file")

    results, errors = [], []
    for upload_file in files:
        try:
            content = await upload_file.read()
            if len(content) > MAX_UPLOAD_BYTES:
                raise EvParseError(f"File is larger than {MAX_UPLOAD_BYTES // 1024 // 1024} MB")

            parsed = ev_vehicle.parse_workbook(content, upload_file.filename or "", serial_no)
            report = parsed["report"]

            # WHAT IT WOULD DO, ON BOTH PATHS.
            #
            # A dry run that reports only what it read — rows, range, columns —
            # reads the same whether the table is empty or already holds every
            # one of those days. The question being asked by somebody uploading
            # July-to-December over a table that stops on 8 July is which days
            # are new, which get overwritten, and whether anything already held
            # disagrees with the file. That needs the stored rows, so it is
            # computed here and returned either way.
            #
            # On the real path it is computed BEFORE the write, because
            # afterwards the old values are gone and the question is
            # unanswerable.
            impact = ev_vehicle.diff_rows(db, parsed["serial_no"], parsed["rows"])
            report.update(impact)

            if dry_run:
                report["written"] = False
            else:
                written = ev_vehicle.upsert_tracking(
                    db, parsed["serial_no"], parsed["rows"], upload_file.filename or "",
                    impact=impact, actor=_actor(request),
                )
                report.update(written)
                report["written"] = True
            results.append(report)

        except EvParseError as exc:
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


@router.get("/vehicles")
def vehicles(db: Session = Depends(get_minehub_db)):
    """Registered machines and the data coverage each one has."""
    return {"vehicles": ev_vehicle.list_vehicles(db)}


@router.get("/summary")
def summary(
    date_from: dt.date | None = Query(None),
    date_to: dt.date | None = Query(None),
    include_suspect: bool = Query(False, description="Include rows failing the kWh/h sanity check"),
    db: Session = Depends(get_minehub_db),
):
    """Fleet energy and utilisation for a window, per machine and in total."""
    start, end = _window(date_from, date_to)
    return ev_vehicle.get_summary(db, start, end, include_suspect)


@router.get("/daily")
def daily(
    date_from: dt.date | None = Query(None),
    date_to: dt.date | None = Query(None),
    serial_no: str | None = Query(None),
    include_suspect: bool = Query(False),
    db: Session = Depends(get_minehub_db),
):
    """Day-by-day series for charting."""
    start, end = _window(date_from, date_to)
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "series": ev_vehicle.get_daily(db, start, end, serial_no, include_suspect),
    }


@router.get("/data-quality")
def data_quality(db: Session = Depends(get_minehub_db)):
    """Rows the sanity check rejected, and what they do to the totals."""
    return ev_vehicle.get_data_quality(db)


@router.get("/uploads")
def uploads(limit: int = Query(50, ge=1, le=500), db: Session = Depends(get_minehub_db)):
    """Load history — which file produced which days, and when."""
    return {"uploads": ev_vehicle.get_upload_history(db, limit)}
