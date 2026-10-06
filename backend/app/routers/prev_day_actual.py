"""Yesterday's actuals, typed in by hand, stored in balcorpdb.

WHY THE ACTUAL IS ENTERED RATHER THAN READ. The MIS Plan vs Actual table used
to take its actuals from pp_production. It cannot: on the morning of
24 September, 23 September's ore and OB both still read zero against a plan of
207 MT and 1,091 CuM, because the goods movements had not been posted. Rendered
as variance that claims the mine produced nothing, which is not what happened.
Whoever chairs the morning meeting knows the real figure long before SAP does.

WHY THE PLAN IS STORED WITH IT. mines_daily_excavation_plan and
mines_despatch_plan get revised. A variance agreed in a meeting has to keep the
plan it was agreed against, or the same row quietly reports something else next
week. The client sends the plan it displayed and that is what is kept.

WHO MAY EDIT. Anyone who can open the MIS dashboard — the prefix is mapped to
the "mis" page in services/auth.py, so the middleware already requires
dashboard.mis. Deliberately not behind a new permission: one would have to be
invented and seeded against every role before anybody could enter anything, and
every row already records who wrote it and when, which is the control that
matters for a number argued over in a meeting.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db

router = APIRouter(prefix="/api/prev-day-actual", tags=["Previous Day Actual"])

# The dashboard's keys, and the Material codes stored in the table. Kept as an
# explicit map rather than .upper() so the column keys and the stored codes can
# never drift apart silently — and so the CHECK constraint in
# scripts/sql/004_mines_prev_day_actual.sql has exactly one counterpart here.
MATERIALS: dict[str, str] = {
    "ore": "ORE",
    "ob": "OB",
    "total_excavation": "TOTAL_EXCAVATION",
    "cob": "COB",
    "despatch": "DESPATCH",
}
BY_CODE = {v: k for k, v in MATERIALS.items()}


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


@router.get("", summary="Hand-entered figures for one day")
def get_day(
    on_date: date = Query(..., description="The day the figures belong to"),
    db: Session = Depends(get_db),
) -> dict:
    rows = db.execute(text("""
        SELECT Material, `Plan`, Est_Actual,
               Entry_Id, Entry_Date, Updated_At, Updated_By
          FROM mines_prev_day_actual
         WHERE `Date` = :d
    """), {"d": on_date}).mappings().all()

    # The most recent change anywhere in the day, so the panel can say when the
    # figures it is showing last moved without the client sorting five rows.
    latest = max(rows, key=lambda r: r["Updated_At"]) if rows else None

    return {
        "on_date": on_date,
        "updated_at": latest["Updated_At"].isoformat() if latest else None,
        "updated_by": latest["Updated_By"] if latest else None,
        # Keyed by the dashboard's own column key, so the client reads
        # values[key] without searching. An unknown code is skipped rather than
        # crashing the panel.
        "values": {
            BY_CODE[r["Material"]]: {
                "value": float(r["Est_Actual"]),
                "plan": float(r["Plan"]) if r["Plan"] is not None else None,
                "entered_by": r["Entry_Id"],
                "entered_at": r["Entry_Date"].isoformat() if r["Entry_Date"] else None,
                "updated_by": r["Updated_By"],
                "updated_at": r["Updated_At"].isoformat() if r["Updated_At"] else None,
            }
            for r in rows if r["Material"] in BY_CODE
        },
    }


@router.put("", summary="Submit the day's figures")
def put_day(
    request: Request,
    on_date: date = Body(..., embed=True),
    # The whole row at once. A submit is one action to the person pressing the
    # button, so it is one transaction here: either every figure lands or none
    # does. Saving cell by cell could leave a half-recorded day behind a failed
    # request, which is worse than not saving at all because it looks complete.
    entries: list[dict] = Body(..., embed=True),
    db: Session = Depends(get_db),
) -> dict:
    if on_date > date.today():
        raise HTTPException(400, "Cannot record an actual for a future date.")
    if not entries:
        raise HTTPException(400, "Nothing to submit.")

    # Validate everything BEFORE writing anything, so a bad row cannot leave
    # part of the submission applied.
    plan_of: dict[str, float | None] = {}
    value_of: dict[str, float | None] = {}
    for e in entries:
        key = str(e.get("metric", "")).strip().lower()
        if key not in MATERIALS:
            raise HTTPException(400, f"Unknown metric '{e.get('metric')}'.")
        raw = e.get("value")
        if raw is None or raw == "":
            value_of[key] = None          # clears this material
        else:
            try:
                v = float(raw)
            except (TypeError, ValueError):
                raise HTTPException(400, f"'{raw}' is not a number for {key}.")
            if v < 0:
                raise HTTPException(400, f"{key} cannot be negative.")
            value_of[key] = v
        p = e.get("plan")
        plan_of[key] = None if p is None or p == "" else float(p)

    who = _actor(request)
    saved, cleared = 0, 0
    for key, value in value_of.items():
        material = MATERIALS[key]
        if value is None:
            r = db.execute(text("""
                DELETE FROM mines_prev_day_actual
                 WHERE `Date` = :d AND Material = :m
            """), {"d": on_date, "m": material})
            cleared += r.rowcount or 0
            continue
        # ENTRY_DATE AND ENTRY_ID ARE NOT TOUCHED ON THE UPDATE BRANCH, so they
        # keep saying who first filed this figure and when. Updated_At and
        # Updated_By carry the correction.
        #
        # Updated_At is set explicitly rather than left to an ON UPDATE clause
        # (which the migration removed): MySQL fires ON UPDATE only when a
        # value actually changes, so re-entering a figure that happens to match
        # what is already stored would not be recorded as a change at all. A
        # save is a change to the person who pressed the button, whether or not
        # the digits moved.
        db.execute(text("""
            INSERT INTO mines_prev_day_actual
                   (`Date`, Material, `Plan`, Est_Actual,
                    Entry_Id, Updated_By, Updated_At)
            VALUES (:d, :m, :p, :v, :who, :who, NOW())
            ON DUPLICATE KEY UPDATE
                   `Plan`     = VALUES(`Plan`),
                   Est_Actual = VALUES(Est_Actual),
                   Updated_By = VALUES(Updated_By),
                   Updated_At = NOW()
        """), {"d": on_date, "m": material, "p": plan_of[key],
               "v": value, "who": who})
        saved += 1

    db.commit()
    return {"on_date": on_date, "saved": saved, "cleared": cleared,
            "entered_by": who}
