"""Capacity: what the fleet can move today, and what is stopping it.

This replaces a workbook. The workbook's arithmetic is reproduced exactly —
every one of its nine face rows agrees to the second decimal — and two of its
defects are deliberately not reproduced:

  * its `MIN()` on the first row reads the *next* row's excavator capacity, so
    its effective total is 74.88 Cum/day too high;
  * its headline "tipper shortage" reads an empty cell and therefore reports
    the whole fleet as surplus.

It also answers a different question at the end. The workbook totals excavator
capacity against tipper capacity across the mine, which says there is no
shortage — total tipper capacity already exceeds total excavator capacity. That
is true and useless. What is actually happening is that some faces have more
trucks than they can load and others have fewer, so the answer is usually to
move trucks rather than to buy them, and this says which faces and how many.
"""
from __future__ import annotations

import json
from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services.productivity import Cycle, Face, summarise, tipper_cum_per_day

router = APIRouter(prefix="/api/productivity", tags=["Productivity"])

VIEW = "ops.roster.view"
MANAGE = "ops.roster.manage"


def _perms(request: Request) -> set:
    return getattr(request.state, "permissions", None) or set()


def _require(request: Request, permission: str, what: str) -> None:
    if permission not in _perms(request):
        raise HTTPException(403, f"You do not have permission to {what}. "
                                 "An Access Manager can add it to your role.")


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _day(value: str | None) -> date:
    return date.fromisoformat(value) if value else date.today()


def _assumptions(db: Session) -> dict:
    """The set in force. Exactly one row is, and if none is the defaults in the
    migration are what a fresh database gets — so this cannot return nothing."""
    row = db.execute(text("""
        SELECT * FROM productivity_assumption
         WHERE effective_to IS NULL
         ORDER BY effective_from DESC, productivity_assumption_id DESC
         LIMIT 1
    """)).mappings().first()
    if not row:
        raise HTTPException(500, "No productivity assumptions are recorded. "
                                 "Migration 065 should have created one.")
    return dict(row)


def _cycle_for(a: dict, o: dict | None) -> tuple[Cycle, float, float, bool]:
    """The cycle this machine actually runs: the shared row, with any override.

    Each column falls back on its own, so an override that changes the digging
    time does not have to restate the other seven — restating them is how the
    seven drift.
    """
    def pick(name: str):
        if o and o.get(name) is not None:
            return o[name]
        return a[name]

    cycle = Cycle(
        dig_sec=int(pick("dig_sec")), lift_sec=int(pick("lift_sec")),
        swing_sec=int(pick("swing_sec")), lower_sec=int(pick("lower_sec")),
        tilt_sec=int(pick("tilt_sec")), wait_sec=int(pick("wait_sec")),
        unload_sec=int(pick("unload_sec")), return_sec=int(pick("return_sec")))
    overridden = bool(o) and any(
        o.get(k) is not None for k in
        ("fill_factor", "swell_factor", "dig_sec", "lift_sec", "swing_sec",
         "lower_sec", "tilt_sec", "wait_sec", "unload_sec", "return_sec"))
    return (cycle, float(pick("fill_factor")), float(pick("swell_factor")),
            overridden)


@router.get("/assumptions")
def assumptions(request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    """The shared parameters, and what they come to."""
    _require(request, VIEW, "see the capacity plan")
    a = _assumptions(db)
    cycle, fill, swell, _ = _cycle_for(a, None)
    return {
        **{k: (float(v) if hasattr(v, "quantize") else v) for k, v in a.items()},
        "cycle_sec": cycle.total_sec,
        "cycles_per_hour": round(cycle.per_hour, 4),
        "overrides": db.execute(text(
            "SELECT count(*) FROM excavator_cycle")).scalar() or 0,
    }


@router.put("/assumptions")
def set_assumptions(request: Request, body: dict = Body(...),
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Change the shared parameters.

    The current row is closed and a new one opened rather than updated in
    place. A capacity agreed in a meeting has to stay explicable afterwards,
    and it cannot be if the numbers behind it were quietly overwritten.
    """
    _require(request, MANAGE, "change the capacity assumptions")
    a = _assumptions(db)

    fields = ["fill_factor", "swell_factor", "dig_sec", "lift_sec", "swing_sec",
              "lower_sec", "tilt_sec", "wait_sec", "unload_sec", "return_sec",
              "operating_hours", "ore_t_per_cum"]
    merged = {f: body.get(f, a[f]) for f in fields}

    db.execute(text("""
        UPDATE productivity_assumption
           SET effective_to = CURRENT_DATE
         WHERE productivity_assumption_id = :id
    """), {"id": a["productivity_assumption_id"]})
    db.execute(text(f"""
        INSERT INTO productivity_assumption
               ({', '.join(fields)}, note, created_by)
        VALUES ({', '.join(':' + f for f in fields)}, :note, :by)
    """), {**merged, "note": body.get("note"), "by": _actor(request)})
    db.commit()
    return assumptions(request, db)


@router.get("/machines")
def machines(request: Request, db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Every excavator, with the bucket it is running and what that comes to."""
    _require(request, VIEW, "see the capacity plan")
    a = _assumptions(db)

    rows = db.execute(text("""
        SELECT a.asset_id, a.fleet_code, a.nickname, a.ownership, a.status,
               a.capacity AS standard_bucket, a.capacity_uom,
               a.fitted_bucket_cum, a.fitted_bucket_since,
               t.name AS asset_type,
               (SELECT i.external_code FROM asset_identity i
                 WHERE i.asset_id = a.asset_id AND i.system = 'BUSINESS_PLAN'
                 LIMIT 1) AS plan_name,
               ec.fill_factor, ec.swell_factor, ec.dig_sec, ec.lift_sec,
               ec.swing_sec, ec.lower_sec, ec.tilt_sec, ec.wait_sec,
               ec.unload_sec, ec.return_sec, ec.reason AS override_reason
          FROM asset a
          JOIN asset_type t ON t.asset_type_id = a.asset_type_id
          LEFT JOIN excavator_cycle ec ON ec.asset_id = a.asset_id
         WHERE t.name ILIKE '%%excavat%%'
           AND a.status NOT IN ('DISPOSED', 'SCRAPPED', 'CANNIBALISED')
         ORDER BY (a.fitted_bucket_cum IS NULL AND a.capacity IS NULL),
                  a.ownership, a.fleet_code
    """)).mappings().all()

    out = []
    for r in rows:
        o = dict(r)
        cycle, fill, swell, overridden = _cycle_for(a, o)
        fitted = o["fitted_bucket_cum"]
        standard = o["standard_bucket"]
        bucket = float(fitted if fitted is not None else (standard or 0))
        per_scoop = bucket * fill * swell
        out.append({
            "asset_id": o["asset_id"], "fleet_code": o["fleet_code"],
            "nickname": o["nickname"], "ownership": o["ownership"],
            "status": o["status"], "plan_name": o["plan_name"],
            "standard_bucket": float(standard) if standard is not None else None,
            "capacity_uom": o["capacity_uom"],
            "fitted_bucket_cum": float(fitted) if fitted is not None else None,
            "fitted_bucket_since": o["fitted_bucket_since"],
            "bucket_used": bucket or None,
            "bucket_is_fitted": fitted is not None,
            "fill_factor": fill, "swell_factor": swell,
            "cycle_sec": cycle.total_sec,
            "cycles_per_hour": round(cycle.per_hour, 4),
            "cum_per_scoop": round(per_scoop, 4),
            "cum_per_hour": round(cycle.per_hour * per_scoop, 3),
            "cycle_is_overridden": overridden,
            "override_reason": o["override_reason"],
            # A machine with no bucket recorded cannot be planned, and saying
            # so on the row is better than showing it as capable of nothing.
            "needs_bucket": bucket <= 0,
        })
    return out


@router.put("/machines/{asset_id}/bucket")
def set_bucket(asset_id: int, request: Request, body: dict = Body(...),
               db: Session = Depends(get_minehub_db)) -> dict:
    """Record the bucket currently fitted.

    Null clears it, which means "the standard bucket is back on" rather than
    "unknown" — the standard one is in asset.capacity and never goes away.
    """
    _require(request, MANAGE, "change a machine's bucket")
    cum = body.get("fitted_bucket_cum")
    if cum is not None and (float(cum) <= 0 or float(cum) >= 50):
        raise HTTPException(422, "A bucket is between 0 and 50 cubic metres.")
    done = db.execute(text("""
        UPDATE asset
           SET fitted_bucket_cum = CAST(:cum AS numeric),
               fitted_bucket_since = CASE WHEN CAST(:cum AS numeric) IS NULL
                                          THEN NULL ELSE CURRENT_DATE END,
               updated_at = now()
         WHERE asset_id = :id
        RETURNING asset_id
    """), {"cum": cum, "id": asset_id}).first()
    if not done:
        raise HTTPException(404, "That machine is not on the register.")
    db.commit()
    return {"ok": True}


@router.get("/tipper-classes")
def tipper_classes(request: Request, db: Session = Depends(get_minehub_db)) -> list[dict]:
    _require(request, VIEW, "see the capacity plan")
    a = _assumptions(db)
    hours = float(a["operating_hours"])
    out = []
    for r in db.execute(text("""
        SELECT * FROM tipper_class WHERE is_active ORDER BY effective_cum
    """)).mappings().all():
        o = dict(r)
        cycle_min = float(o["loading_min"]) + float(o["travel_min"])
        out.append({
            "tipper_class_id": o["tipper_class_id"], "code": o["code"],
            "label": o["label"], "payload_t": float(o["payload_t"]),
            "effective_cum": float(o["effective_cum"]),
            "loading_min": float(o["loading_min"]),
            "travel_min": float(o["travel_min"]),
            "cycle_min": cycle_min,
            "trips_per_hour": round(60.0 / cycle_min, 3) if cycle_min else 0,
            "trips_per_day": round(60.0 / cycle_min * hours, 2) if cycle_min else 0,
            "cum_per_day": round(tipper_cum_per_day(
                float(o["effective_cum"]), float(o["loading_min"]),
                float(o["travel_min"]), hours), 2),
        })
    return out


@router.get("/plan")
def plan(request: Request, on: str | None = Query(None),
         db: Session = Depends(get_minehub_db)) -> dict:
    """The day's faces, what each can move, and where the two sides disagree."""
    _require(request, VIEW, "see the capacity plan")
    day = _day(on)
    a = _assumptions(db)
    hours = float(a["operating_hours"])

    classes = {c["tipper_class_id"]: c for c in tipper_classes(request, db)}
    default_class = min(classes.values(), key=lambda c: c["effective_cum"]) \
        if classes else None

    rows = db.execute(text("""
        SELECT fp.face_plan_id, fp.asset_id, fp.location, fp.material,
               fp.running_hours, fp.tippers, fp.tipper_class_id, fp.note,
               a.fleet_code, a.nickname, a.capacity AS standard_bucket,
               a.fitted_bucket_cum,
               (SELECT i.external_code FROM asset_identity i
                 WHERE i.asset_id = a.asset_id AND i.system = 'BUSINESS_PLAN'
                 LIMIT 1) AS plan_name,
               ec.fill_factor, ec.swell_factor, ec.dig_sec, ec.lift_sec,
               ec.swing_sec, ec.lower_sec, ec.tilt_sec, ec.wait_sec,
               ec.unload_sec, ec.return_sec
          FROM face_plan fp
          JOIN asset a ON a.asset_id = fp.asset_id
          LEFT JOIN excavator_cycle ec ON ec.asset_id = fp.asset_id
         WHERE fp.on_date = :d
         ORDER BY fp.location, a.fleet_code
    """), {"d": day}).mappings().all()

    faces: list[Face] = []
    for r in rows:
        o = dict(r)
        cycle, fill, swell, overridden = _cycle_for(a, o)
        fitted, standard = o["fitted_bucket_cum"], o["standard_bucket"]
        bucket = float(fitted if fitted is not None else (standard or 0))
        cls = classes.get(o["tipper_class_id"]) or default_class
        faces.append(Face(
            face_plan_id=o["face_plan_id"], asset_id=o["asset_id"],
            fleet_code=o["fleet_code"], plan_name=o["plan_name"],
            location=o["location"], material=o["material"],
            running_hours=float(o["running_hours"]), tippers=int(o["tippers"]),
            tipper_class=cls["code"] if cls else None,
            bucket_cum=bucket, bucket_is_fitted=fitted is not None,
            cycle=cycle, fill_factor=fill, swell_factor=swell,
            cycle_is_overridden=overridden,
            per_tipper_cum_day=cls["cum_per_day"] if cls else 0.0,
        ).compute())

    s = summarise(faces, default_class["cum_per_day"] if default_class else 0.0,
                  float(a["ore_t_per_cum"]))

    return {
        "on_date": day.isoformat(),
        "operating_hours": hours,
        "faces": [{
            "face_plan_id": f.face_plan_id, "asset_id": f.asset_id,
            "fleet_code": f.fleet_code, "plan_name": f.plan_name,
            "location": f.location, "material": f.material,
            "running_hours": f.running_hours, "tippers": f.tippers,
            "tipper_class": f.tipper_class,
            "bucket_cum": f.bucket_cum, "bucket_is_fitted": f.bucket_is_fitted,
            "cycle_sec": f.cycle.total_sec,
            "cycle_is_overridden": f.cycle_is_overridden,
            "cum_per_hour": round(f.cum_per_hour, 3),
            "excavator_cum_day": round(f.excavator_cum_day, 2),
            "tipper_cum_day": round(f.tipper_cum_day, 2),
            "effective_cum_day": round(f.effective_cum_day, 2),
            "limited_by": f.limited_by,
            "lost_cum_day": round(f.lost_cum_day, 2),
        } for f in faces],
        "summary": {
            "excavator_cum_day": round(s.excavator_cum_day, 2),
            "tipper_cum_day": round(s.tipper_cum_day, 2),
            "effective_cum_day": round(s.effective_cum_day, 2),
            "lost_cum_day": round(s.lost_cum_day, 2),
            "tippers_deployed": s.tippers_deployed,
            "tippers_needed": s.tippers_needed,
            "tippers_spare": s.tippers_spare,
            "short_of_tippers": s.faces_short_of_tippers,
            "short_of_digging": s.faces_short_of_digging,
            "by_material": {k: round(v, 2) for k, v in s.by_material.items()},
            "ore_mt": round(s.ore_mt, 2),
        },
        "tipper_classes": list(classes.values()),
    }


@router.post("/plan")
def add_face(request: Request, body: dict = Body(...),
             db: Session = Depends(get_minehub_db)) -> dict:
    """Put a machine on a face for a day."""
    _require(request, MANAGE, "change the capacity plan")
    try:
        db.execute(text("""
            INSERT INTO face_plan (on_date, asset_id, location, material,
                                   running_hours, tippers, tipper_class_id,
                                   note, created_by)
            VALUES (CAST(:on AS date), :a, :loc, :mat, :hrs, :tip,
                    CAST(:cls AS bigint), :note, :by)
            ON CONFLICT (on_date, asset_id, location, material) DO UPDATE
               SET running_hours = EXCLUDED.running_hours,
                   tippers = EXCLUDED.tippers,
                   tipper_class_id = EXCLUDED.tipper_class_id,
                   note = EXCLUDED.note,
                   updated_at = now()
        """), {"on": body.get("on_date") or date.today().isoformat(),
               "a": body["asset_id"], "loc": (body.get("location") or "").strip(),
               "mat": (body.get("material") or "").strip(),
               "hrs": body.get("running_hours"), "tip": body.get("tippers") or 0,
               "cls": body.get("tipper_class_id"), "note": body.get("note"),
               "by": _actor(request)})
    except Exception as exc:                        # noqa: BLE001
        db.rollback()
        raise HTTPException(422, f"That row could not be saved: {exc}") from exc
    db.commit()
    return {"ok": True}


@router.put("/plan/{face_plan_id}")
def edit_face(face_plan_id: int, request: Request, body: dict = Body(...),
              db: Session = Depends(get_minehub_db)) -> dict:
    """Change the hours or the trucks on a face — the calculator's own handle."""
    _require(request, MANAGE, "change the capacity plan")
    done = db.execute(text("""
        UPDATE face_plan
           SET running_hours   = COALESCE(:hrs, running_hours),
               tippers         = COALESCE(:tip, tippers),
               tipper_class_id = COALESCE(CAST(:cls AS bigint), tipper_class_id),
               location        = COALESCE(:loc, location),
               material        = COALESCE(:mat, material),
               note            = COALESCE(:note, note),
               updated_at      = now()
         WHERE face_plan_id = :id
        RETURNING face_plan_id
    """), {"id": face_plan_id, "hrs": body.get("running_hours"),
           "tip": body.get("tippers"), "cls": body.get("tipper_class_id"),
           "loc": body.get("location"), "mat": body.get("material"),
           "note": body.get("note")}).first()
    if not done:
        raise HTTPException(404, "That row is not on the plan.")
    db.commit()
    return {"ok": True}


@router.delete("/plan/{face_plan_id}")
def drop_face(face_plan_id: int, request: Request,
              db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "change the capacity plan")
    db.execute(text("DELETE FROM face_plan WHERE face_plan_id = :id"),
               {"id": face_plan_id})
    db.commit()
    return {"ok": True}


@router.post("/plan/copy")
def copy_day(request: Request, body: dict = Body(...),
             db: Session = Depends(get_minehub_db)) -> dict:
    """Start a day from another day's plan.

    Most days are the day before with two things changed. Typing nine rows
    again to change two is how a plan stops being kept.
    """
    _require(request, MANAGE, "change the capacity plan")
    frm, to = _day(body.get("from_date")), _day(body.get("to_date"))
    if frm == to:
        raise HTTPException(422, "Those are the same day.")
    n = db.execute(text("""
        INSERT INTO face_plan (on_date, asset_id, location, material,
                               running_hours, tippers, tipper_class_id,
                               note, created_by)
        SELECT CAST(:to AS date), asset_id, location, material,
               running_hours, tippers, tipper_class_id, note, :by
          FROM face_plan WHERE on_date = CAST(:frm AS date)
        ON CONFLICT (on_date, asset_id, location, material) DO NOTHING
    """), {"frm": frm, "to": to, "by": _actor(request)}).rowcount
    db.commit()
    return {"ok": True, "copied": n}


@router.get("/data-quality")
def data_quality(request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    """What would make these numbers wrong, said before anybody relies on them.

    A capacity screen that shows a total and says nothing about the state of
    the register behind it invites the total to be quoted. These are the three
    things found when the plan was first mapped, and they are reported rather
    than fixed because each is somebody's decision, not the screen's.
    """
    _require(request, VIEW, "see the capacity plan")

    no_bucket = db.execute(text("""
        SELECT a.fleet_code, a.nickname, a.ownership
          FROM asset a JOIN asset_type t ON t.asset_type_id = a.asset_type_id
         WHERE t.name ILIKE '%%excavat%%'
           AND a.status NOT IN ('DISPOSED','SCRAPPED','CANNIBALISED')
           AND a.capacity IS NULL AND a.fitted_bucket_cum IS NULL
         ORDER BY a.fleet_code
    """)).mappings().all()

    # Two rows describing one machine: a bare EX-n beside one whose nickname
    # names the same number. Reported, not merged — which row survives is a
    # decision about the mine, not about the data.
    twins = db.execute(text("""
        WITH d AS (
          SELECT a.asset_id, a.fleet_code, a.nickname, a.make,
                 lower(substring(coalesce(a.fleet_code,'') || ' ' ||
                                 coalesce(a.nickname,'')
                                 from 'ex[ -]*([0-9]+)')) AS n
            FROM asset a JOIN asset_type t ON t.asset_type_id = a.asset_type_id
           WHERE t.name ILIKE '%%excavat%%'
             AND a.status NOT IN ('DISPOSED','SCRAPPED','CANNIBALISED')
        )
        SELECT n, json_agg(json_build_object(
                     'asset_id', asset_id, 'fleet_code', fleet_code,
                     'nickname', nickname, 'make', make) ORDER BY asset_id) AS rows
          FROM d WHERE n IS NOT NULL
         GROUP BY n HAVING count(*) > 1 ORDER BY n
    """)).mappings().all()

    unmapped = db.execute(text("""
        SELECT a.fleet_code, a.nickname, a.ownership
          FROM asset a JOIN asset_type t ON t.asset_type_id = a.asset_type_id
         WHERE t.name ILIKE '%%excavat%%'
           AND a.status NOT IN ('DISPOSED','SCRAPPED','CANNIBALISED')
           AND NOT EXISTS (SELECT 1 FROM asset_identity i
                            WHERE i.asset_id = a.asset_id
                              AND i.system = 'BUSINESS_PLAN')
         ORDER BY a.fleet_code
    """)).mappings().all()

    return {
        "no_bucket": [dict(r) for r in no_bucket],
        "same_machine_twice": [{"ex": r["n"], "rows": r["rows"]} for r in twins],
        "not_in_the_plan": [dict(r) for r in unmapped],
        # Named here rather than derived: the plan works a second Zaxis 370 and
        # the register does not hold one. Nobody should map it by guessing.
        "plan_names_with_no_machine": ["370-5"],
    }
