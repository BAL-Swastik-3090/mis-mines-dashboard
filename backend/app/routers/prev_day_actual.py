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

from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/prev-day-actual", tags=["Previous Day Actual"])

# The dashboard's keys, and the Material codes stored in the table. Kept as an
# explicit map rather than .upper() so the column keys and the stored codes can
# never drift apart silently — and so the CHECK constraint in
# minehub/migrations/110 has exactly one counterpart here.
MATERIALS: dict[str, str] = {
    "ore": "ORE",
    "ob": "OB",
    "total_excavation": "TOTAL_EXCAVATION",
    "cob": "COB",
    # De-silting, in CuM. Its actual comes from IMOS rather than SAP, and IMOS
    # is no quicker — the figure is known at the morning meeting and arrives in
    # mines_day_wise_excavation later, which is the same gap the other four
    # rows exist to cover. NOT part of TOTAL_EXCAVATION: that is ore plus
    # overburden, and silt is neither.
    "silt": "SILT",
    "despatch": "DESPATCH",
}
BY_CODE = {v: k for k, v in MATERIALS.items()}


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


@router.get("", summary="Hand-entered figures for one day")
def get_day(
    on_date: date = Query(..., description="The day the figures belong to"),
    db: Session = Depends(get_minehub_db),
) -> dict:
    rows = db.execute(text("""
        SELECT material, plan, est_actual,
               entry_id, entry_date, updated_at, updated_by
          FROM minehub.mines_prev_day_actual
         WHERE date = :d
    """), {"d": on_date}).mappings().all()

    # The most recent change anywhere in the day, so the panel can say when the
    # figures it is showing last moved without the client sorting five rows.
    latest = max(rows, key=lambda r: r["updated_at"]) if rows else None

    return {
        "on_date": on_date,
        "updated_at": latest["updated_at"].isoformat() if latest else None,
        "updated_by": latest["updated_by"] if latest else None,
        # Keyed by the dashboard's own column key, so the client reads
        # values[key] without searching. An unknown code is skipped rather than
        # crashing the panel.
        "values": {
            BY_CODE[r["material"]]: {
                "value": float(r["est_actual"]),
                "plan": float(r["plan"]) if r["plan"] is not None else None,
                "entered_by": r["entry_id"],
                "entered_at": r["entry_date"].isoformat() if r["entry_date"] else None,
                "updated_by": r["updated_by"],
                "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
            }
            for r in rows if r["material"] in BY_CODE
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
    db: Session = Depends(get_minehub_db),
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
                DELETE FROM minehub.mines_prev_day_actual
                 WHERE date = :d AND material = :m
            """), {"d": on_date, "m": material})
            cleared += r.rowcount or 0
            continue
        # ENTRY_DATE AND ENTRY_ID ARE NOT TOUCHED ON THE UPDATE BRANCH, so they
        # keep saying who first filed this figure and when. Updated_At and
        # Updated_By carry the correction.
        #
        # updated_at is set explicitly rather than left to a trigger: a save
        # is a change to the person who pressed the button, whether or not the
        # digits moved, so re-entering a figure that matches what is already
        # stored must still be recorded as a change.
        db.execute(text("""
            INSERT INTO minehub.mines_prev_day_actual
                   (date, material, plan, est_actual,
                    entry_id, updated_by, updated_at)
            VALUES (:d, :m, :p, :v, :who, :who, now())
            ON CONFLICT (date, material) DO UPDATE SET
                   plan       = EXCLUDED.plan,
                   est_actual = EXCLUDED.est_actual,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now()
        """), {"d": on_date, "m": material, "p": plan_of[key],
               "v": value, "who": who})
        saved += 1

    db.commit()
    return {"on_date": on_date, "saved": saved, "cleared": cleared,
            "entered_by": who}
