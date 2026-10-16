from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import date, timedelta
from ..database import get_db
from ..minehub_db import get_minehub_db
from ..services.ev_tracking import (get_ev_history_all, get_ev_overview,
                                    get_ev_vehicle_history)

router = APIRouter(prefix="/api/ev-tracking", tags=["Electric Vehicle Tracking"])

@router.get("/overview")
def ev_overview(
    from_date: date = Query(default=None),
    to_date: date = Query(default=None),
    db: Session = Depends(get_db),
    # Only for the machine names, which live in the asset registry. Optional by
    # design: if minehub is unreachable the overview still answers, under the
    # serials it always showed.
    pg: Session = Depends(get_minehub_db),
):
    if not to_date or not from_date:
        latest_date_query = "SELECT MAX(report_date) FROM mines_ev_equipment_tracking"
        latest_date_row = db.execute(text(latest_date_query)).fetchone()
        t_date = latest_date_row[0] if latest_date_row and latest_date_row[0] else date.today()
        f_date = t_date - timedelta(days=30)
        from_date = from_date or f_date
        to_date = to_date or t_date

    return get_ev_overview(db, from_date, to_date, pg)

@router.get("/history")
def ev_history_all(
    from_date: date = Query(default=None),
    to_date: date = Query(default=None),
    db: Session = Depends(get_db),
    pg: Session = Depends(get_minehub_db),
):
    """Every machine's daily rows in one call, for the all-machines view."""
    if not to_date or not from_date:
        row = db.execute(text(
            "SELECT MAX(report_date) FROM mines_ev_equipment_tracking")).fetchone()
        t_date = row[0] if row and row[0] else date.today()
        to_date = to_date or t_date
        from_date = from_date or (t_date - timedelta(days=30))
    return get_ev_history_all(db, from_date, to_date, pg)


@router.get("/vehicle/{ev_equipment_id}/history")
def ev_vehicle_history(
    ev_equipment_id: int,
    from_date: date = Query(default=None),
    to_date: date = Query(default=None),
    db: Session = Depends(get_db)
):
    if not to_date or not from_date:
        latest_date_query = "SELECT MAX(report_date) FROM mines_ev_equipment_tracking"
        latest_date_row = db.execute(text(latest_date_query)).fetchone()
        t_date = latest_date_row[0] if latest_date_row and latest_date_row[0] else date.today()
        f_date = t_date - timedelta(days=30)
        from_date = from_date or f_date
        to_date = to_date or t_date

    result = get_ev_vehicle_history(db, ev_equipment_id, from_date, to_date)
    if result is None:
        raise HTTPException(status_code=404, detail="Electric vehicle not found or has no history")
    return result
