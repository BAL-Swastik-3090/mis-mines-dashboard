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


def _event(db: Session, request: Request, event_type: str, *,
           asset_id: int | None = None, day: date | None = None,
           payload: dict | None = None) -> None:
    """Record a change to the plan.

    Written into the same event table the roster uses, so "what happened on
    this machine" can be answered across both without joining two logs.

    The payload carries before and after rather than only after. Anything less
    produces a log that says a number changed and cannot say from what, which
    is exactly the thing somebody is trying to find out.
    """
    db.execute(text("""
        INSERT INTO event (event_type, occurred_at, recorded_at, source,
                           asset_id, production_day, payload, recorded_by)
        VALUES (:t, now(), now(), 'WEB', :a, CAST(:d AS date),
                CAST(:pl AS jsonb), :by)
    """), {"t": event_type, "a": asset_id, "d": day,
           "pl": json.dumps(payload or {}, default=str), "by": _actor(request)})


def _changed(before: dict, after: dict, fields: list[str]) -> dict:
    """Only what actually moved, as {field: [was, now]}.

    A diff that lists every field makes the one that changed hard to find, and
    a log nobody can scan is a log nobody reads.
    """
    out: dict = {}
    for f in fields:
        was, now = before.get(f), after.get(f)
        if now is None or str(was) == str(now):
            continue
        out[f] = [was, now]
    return out


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


# A bucket is in cubic metres or it is not a bucket. asset.capacity is a
# general-purpose number — six excavators hold engine power in it, with HP in
# capacity_uom — and reading it without its unit turned 320 horsepower into a
# 320 cubic metre bucket and 9,216 Cum an hour.
#
# Spelled loosely on purpose: the register holds CUM, and an import that
# writes "Cum" or "m3" tomorrow should not silently put a machine back to
# having no bucket.
BUCKET_UOM = {"CUM", "M3", "M^3", "CU.M", "CUM.", "CBM"}

# And a sanity bound, because a unit can be missing as easily as it can be
# wrong. The largest mining shovels in the world are around 60 cubic metres
# and nothing at Kaliapani is close, so anything above this is a number that
# wandered in from another column.
MAX_SANE_BUCKET_CUM = 50.0


def _bucket_of(o: dict) -> tuple[float, bool, str | None]:
    """The bucket to plan this machine with, and why, if there is none.

    Returns (cum, is_fitted, problem). A fitted bucket always wins: it is
    entered on this screen, in cubic metres, by somebody saying what is on the
    machine now.
    """
    fitted = o.get("fitted_bucket_cum")
    if fitted is not None:
        return float(fitted), True, None

    standard = o.get("standard_bucket")
    if standard is None:
        return 0.0, False, "no bucket recorded"

    uom = (o.get("capacity_uom") or "").strip().upper()
    if uom and uom not in BUCKET_UOM:
        return 0.0, False, f"the register holds {standard:g} {uom}, which is not a bucket"
    if float(standard) > MAX_SANE_BUCKET_CUM:
        return 0.0, False, f"{standard:g} is too large to be a bucket"
    if float(standard) <= 0:
        return 0.0, False, "the recorded bucket is zero"
    return float(standard), False, None


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
    _event(db, request, "CAPACITY_ASSUMPTIONS_CHANGED",
           payload={"changed": _changed(a, merged, fields),
                    "note": body.get("note")})
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
        bucket, is_fitted, problem = _bucket_of(o)
        fitted = o["fitted_bucket_cum"]
        standard = o["standard_bucket"]
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
            "bucket_is_fitted": is_fitted,
            # Why this machine cannot be planned, in words, rather than a
            # figure worked out from a number that is not a bucket.
            "bucket_problem": problem,
            "fill_factor": fill, "swell_factor": swell,
            "cycle_sec": cycle.total_sec,
            "cycles_per_hour": round(cycle.per_hour, 4),
            "cum_per_scoop": round(per_scoop, 4),
            "cum_per_hour": round(cycle.per_hour * per_scoop, 3),
            "cycle_is_overridden": overridden,
            "override_reason": o["override_reason"],
            # A machine with no usable bucket cannot be planned, and saying so
            # on the row is better than a figure derived from the wrong column.
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
    was = db.execute(text("""
        SELECT fleet_code, capacity, fitted_bucket_cum FROM asset WHERE asset_id = :id
    """), {"id": asset_id}).mappings().first()

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
    _event(db, request, "CAPACITY_BUCKET_CHANGED", asset_id=asset_id,
           payload={"fleet_code": was["fleet_code"] if was else None,
                    "standard_bucket": was["capacity"] if was else None,
                    "fitted_bucket_cum": [
                        was["fitted_bucket_cum"] if was else None, cum]})
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


@router.post("/tipper-classes")
def add_tipper_class(request: Request, body: dict = Body(...),
                     db: Session = Depends(get_minehub_db)) -> dict:
    """A kind of truck the mine did not have before.

    The fleet arrives in kinds, not in one kind. A 25-tonne dumper turning up
    on hire is a different number of trips and a different number of trucks per
    face, and a screen that offers only the two classes somebody seeded it with
    is a screen that gets abandoned the first time a third arrives.
    """
    _require(request, MANAGE, "add a kind of truck")
    code = (body.get("code") or "").strip().upper().replace(" ", "_")
    if not code:
        raise HTTPException(422, "A kind of truck needs a short code.")
    try:
        row = db.execute(text("""
            INSERT INTO tipper_class (code, label, payload_t, effective_cum,
                                      loading_min, travel_min)
            VALUES (:code, :label, :pay, :cum,
                    COALESCE(:load, 5), COALESCE(:travel, 35))
            RETURNING tipper_class_id
        """), {"code": code,
               "label": (body.get("label") or "").strip() or code.title(),
               "pay": body.get("payload_t"), "cum": body.get("effective_cum"),
               "load": body.get("loading_min"),
               "travel": body.get("travel_min")}).first()
    except Exception as exc:                        # noqa: BLE001
        db.rollback()
        raise HTTPException(422, f"That could not be saved: {exc}") from exc
    _event(db, request, "CAPACITY_TRUCK_CLASS_ADDED",
           payload={"code": code, "label": body.get("label"),
                    "payload_t": body.get("payload_t"),
                    "effective_cum": body.get("effective_cum")})
    db.commit()
    return {"ok": True, "tipper_class_id": row[0]}


@router.put("/tipper-classes/{tipper_class_id}")
def edit_tipper_class(tipper_class_id: int, request: Request,
                      body: dict = Body(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Correct what a kind of truck carries, or retire it.

    Retired rather than deleted: a class a face was planned against last month
    has to keep existing, or that plan can no longer be explained.
    """
    _require(request, MANAGE, "change a kind of truck")
    was = db.execute(text(
        "SELECT * FROM tipper_class WHERE tipper_class_id = :id"),
        {"id": tipper_class_id}).mappings().first()
    done = db.execute(text("""
        UPDATE tipper_class
           SET label         = COALESCE(:label, label),
               payload_t     = COALESCE(:pay, payload_t),
               effective_cum = COALESCE(:cum, effective_cum),
               loading_min   = COALESCE(:load, loading_min),
               travel_min    = COALESCE(:travel, travel_min),
               is_active     = COALESCE(CAST(:active AS boolean), is_active)
         WHERE tipper_class_id = :id
        RETURNING tipper_class_id
    """), {"id": tipper_class_id, "label": body.get("label"),
           "pay": body.get("payload_t"), "cum": body.get("effective_cum"),
           "load": body.get("loading_min"), "travel": body.get("travel_min"),
           "active": body.get("is_active")}).first()
    if not done:
        raise HTTPException(404, "There is no such kind of truck.")
    _event(db, request, "CAPACITY_TRUCK_CLASS_CHANGED",
           payload={"code": was["code"] if was else None,
                    "changed": _changed(dict(was or {}), body, [
                        "label", "payload_t", "effective_cum",
                        "loading_min", "travel_min", "is_active"])})
    db.commit()
    return {"ok": True}


@router.put("/machines/{asset_id}/cycle")
def set_cycle(asset_id: int, request: Request, body: dict = Body(...),
              db: Session = Depends(get_minehub_db)) -> dict:
    """Give one machine a cycle of its own.

    THE TABLE THIS WRITES WAS PREVIOUSLY UNREACHABLE. excavator_cycle was read
    on every request and written by nothing, so every machine silently ran the
    shared cycle and a screen that showed "its own" could never say it.

    Every field is optional and falls back to the shared row, so changing the
    digging time does not mean restating the other seven — restating them is
    how the seven drift. A reason is not optional: an override nobody
    explained cannot be told from a typo six months later.
    """
    _require(request, MANAGE, "change a machine's cycle")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(
            422, "Say why this machine differs. An unexplained override "
                 "cannot be told from a mistake later.")

    fields = ["fill_factor", "swell_factor", "dig_sec", "lift_sec", "swing_sec",
              "lower_sec", "tilt_sec", "wait_sec", "unload_sec", "return_sec"]
    vals = {f: body.get(f) for f in fields}
    if all(v is None for v in vals.values()):
        raise HTTPException(
            422, "An override that changes nothing is not an override. "
                 "Clear it instead if this machine runs the shared cycle.")

    if not db.execute(text("SELECT 1 FROM asset WHERE asset_id = :id"),
                      {"id": asset_id}).first():
        raise HTTPException(404, "That machine is not on the register.")

    sets = ", ".join(f"{f} = EXCLUDED.{f}" for f in fields)
    db.execute(text(f"""
        INSERT INTO excavator_cycle (asset_id, {', '.join(fields)}, reason, created_by)
        VALUES (:id, {', '.join(':' + f for f in fields)}, :reason, :by)
        ON CONFLICT (asset_id) DO UPDATE
           SET {sets}, reason = EXCLUDED.reason, updated_at = now()
    """), {"id": asset_id, **vals, "reason": reason, "by": _actor(request)})
    _event(db, request, "CAPACITY_CYCLE_SET", asset_id=asset_id,
           payload={"reason": reason,
                    "set": {k: v for k, v in vals.items() if v is not None}})
    db.commit()
    return {"ok": True}


@router.delete("/machines/{asset_id}/cycle")
def clear_cycle(asset_id: int, request: Request,
                db: Session = Depends(get_minehub_db)) -> dict:
    """Put a machine back on the shared cycle."""
    _require(request, MANAGE, "change a machine's cycle")
    was = db.execute(text(
        "SELECT reason FROM excavator_cycle WHERE asset_id = :id"),
        {"id": asset_id}).scalar()
    db.execute(text("DELETE FROM excavator_cycle WHERE asset_id = :id"),
               {"id": asset_id})
    _event(db, request, "CAPACITY_CYCLE_CLEARED", asset_id=asset_id,
           payload={"was_because": was})
    db.commit()
    return {"ok": True}


@router.put("/machines/{asset_id}/plan-name")
def set_plan_name(asset_id: int, request: Request, body: dict = Body(...),
                  db: Session = Depends(get_minehub_db)) -> dict:
    """Record what the business plan calls this machine.

    Without this the mapping could only ever be set by running a script, which
    means "370-5" stays unresolved for as long as nobody runs one — and the
    864 Cum/day behind it stays missing from the totals with no way for the
    person who knows the pit to fix it.

    A plan name belongs to one machine. Moving it says the earlier row was
    wrong, which is the usual reason for touching this at all, so the old link
    is replaced rather than refused.
    """
    _require(request, MANAGE, "change what the plan calls a machine")
    name = (body.get("plan_name") or "").strip()

    if not db.execute(text("SELECT 1 FROM asset WHERE asset_id = :id"),
                      {"id": asset_id}).first():
        raise HTTPException(404, "That machine is not on the register.")

    if not name:
        db.execute(text("""
            DELETE FROM asset_identity
             WHERE asset_id = :id AND system = 'BUSINESS_PLAN'
        """), {"id": asset_id})
        _event(db, request, "CAPACITY_PLAN_NAME_SET", asset_id=asset_id,
               payload={"plan_name": [None, None], "cleared": True})
        db.commit()
        return {"ok": True, "plan_name": None}

    moved_from = db.execute(text("""
        SELECT a.fleet_code FROM asset_identity i JOIN asset a ON a.asset_id = i.asset_id
         WHERE i.system = 'BUSINESS_PLAN' AND i.external_code = :n
           AND i.asset_id <> :id
    """), {"n": name, "id": asset_id}).scalar()

    db.execute(text("""
        DELETE FROM asset_identity
         WHERE asset_id = :id AND system = 'BUSINESS_PLAN'
    """), {"id": asset_id})
    db.execute(text("""
        INSERT INTO asset_identity (asset_id, system, external_code, created_by)
             VALUES (:id, 'BUSINESS_PLAN', :n, :by)
        ON CONFLICT (system, external_code) DO UPDATE
           SET asset_id = EXCLUDED.asset_id
    """), {"id": asset_id, "n": name, "by": _actor(request)})
    _event(db, request, "CAPACITY_PLAN_NAME_SET", asset_id=asset_id,
           payload={"plan_name": name, "taken_from": moved_from})
    db.commit()
    return {"ok": True, "plan_name": name, "taken_from": moved_from}


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
               a.capacity_uom, a.fitted_bucket_cum,
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
        bucket, is_fitted, _problem = _bucket_of(o)
        cls = classes.get(o["tipper_class_id"]) or default_class
        faces.append(Face(
            face_plan_id=o["face_plan_id"], asset_id=o["asset_id"],
            fleet_code=o["fleet_code"], plan_name=o["plan_name"],
            location=o["location"], material=o["material"],
            running_hours=float(o["running_hours"]), tippers=int(o["tippers"]),
            tipper_class=cls["code"] if cls else None,
            bucket_cum=bucket, bucket_is_fitted=is_fitted,
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
        # What has been typed into these before, so the next person picks
        # rather than retypes. Free text stays free — a location master that
        # did not already hold "Stack Yard / LG Dump / ETP" would force the
        # planner to choose between the truth and the dropdown — but a list of
        # what the mine actually calls its faces stops "North East" and
        # "North-East" becoming two places.
        "known_locations": [r[0] for r in db.execute(text("""
            SELECT DISTINCT location FROM face_plan
             WHERE location IS NOT NULL AND btrim(location) <> ''
             ORDER BY location
        """)).all()],
        "known_materials": [r[0] for r in db.execute(text("""
            SELECT DISTINCT material FROM face_plan
             WHERE material IS NOT NULL AND btrim(material) <> ''
             ORDER BY material
        """)).all()],
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
    _event(db, request, "CAPACITY_FACE_PLANNED", asset_id=body["asset_id"],
           day=_day(body.get("on_date")),
           payload={"location": body.get("location"),
                    "material": body.get("material"),
                    "running_hours": body.get("running_hours"),
                    "tippers": body.get("tippers") or 0})
    db.commit()
    return {"ok": True}


@router.put("/plan/{face_plan_id}")
def edit_face(face_plan_id: int, request: Request, body: dict = Body(...),
              db: Session = Depends(get_minehub_db)) -> dict:
    """Change the hours or the trucks on a face — the calculator's own handle."""
    _require(request, MANAGE, "change the capacity plan")
    # Read first. The update is a COALESCE of whatever was sent, so without
    # the old row the log could only repeat what the caller already knew.
    was = db.execute(text("""
        SELECT fp.*, a.fleet_code FROM face_plan fp
          JOIN asset a ON a.asset_id = fp.asset_id
         WHERE fp.face_plan_id = :id
    """), {"id": face_plan_id}).mappings().first()

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
    diff = _changed(dict(was or {}), body, ["location", "material", "running_hours", "tippers", "tipper_class_id", "note"])
    if diff:
        _event(db, request, "CAPACITY_FACE_CHANGED",
               asset_id=was["asset_id"] if was else None,
               day=was["on_date"] if was else None,
               payload={"fleet_code": was["fleet_code"] if was else None,
                        "location": was["location"] if was else None,
                        "changed": diff})
    db.commit()
    return {"ok": True}


@router.delete("/plan/{face_plan_id}")
def drop_face(face_plan_id: int, request: Request,
              db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "change the capacity plan")
    was = db.execute(text("""
        SELECT fp.*, a.fleet_code FROM face_plan fp
          JOIN asset a ON a.asset_id = fp.asset_id
         WHERE fp.face_plan_id = :id
    """), {"id": face_plan_id}).mappings().first()
    db.execute(text("DELETE FROM face_plan WHERE face_plan_id = :id"),
               {"id": face_plan_id})
    if was:
        _event(db, request, "CAPACITY_FACE_REMOVED", asset_id=was["asset_id"],
               day=was["on_date"],
               payload={"fleet_code": was["fleet_code"],
                        "location": was["location"], "material": was["material"],
                        "running_hours": was["running_hours"],
                        "tippers": was["tippers"]})
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
    _event(db, request, "CAPACITY_DAY_COPIED", day=to,
           payload={"from_date": frm.isoformat(), "rows": n})
    db.commit()
    return {"ok": True, "copied": n}


# Every kind of change this screen can make. Named here rather than matched on
# a prefix so a new event type has to be added deliberately — a log that
# silently widens is a log that starts showing things nobody meant it to.
CAPACITY_EVENTS = [
    "CAPACITY_FACE_PLANNED", "CAPACITY_FACE_CHANGED", "CAPACITY_FACE_REMOVED",
    "CAPACITY_DAY_COPIED", "CAPACITY_BUCKET_CHANGED", "CAPACITY_CYCLE_SET",
    "CAPACITY_CYCLE_CLEARED", "CAPACITY_PLAN_NAME_SET",
    "CAPACITY_ASSUMPTIONS_CHANGED", "CAPACITY_TRUCK_CLASS_ADDED",
    "CAPACITY_TRUCK_CLASS_CHANGED",
]

# What each field is called out loud. "running_hours" is what the column is
# named; "hours" is what the person who changed it would say.
_SAID = {
    "running_hours": "hours", "tippers": "trucks",
    "tipper_class_id": "kind of truck", "fitted_bucket_cum": "fitted bucket",
    "location": "place", "material": "material", "note": "note",
    "fill_factor": "fill factor", "swell_factor": "swell factor",
    "operating_hours": "operating hours", "ore_t_per_cum": "ore density",
    "dig_sec": "digging", "lift_sec": "lifting", "swing_sec": "swing",
    "lower_sec": "lowering", "tilt_sec": "tilting", "wait_sec": "waiting",
    "unload_sec": "unloading", "return_sec": "return",
    "payload_t": "payload", "effective_cum": "effective capacity",
    "loading_min": "loading time", "travel_min": "road time",
    "is_active": "in use", "label": "name",
}


def _said(field: str) -> str:
    return _SAID.get(field, field.replace("_", " "))


def _sentence(event_type: str, p: dict) -> str:
    """One line a person can read without knowing the schema."""
    fleet = p.get("fleet_code") or ""
    where = p.get("location") or ""
    at = f" at {where}" if where else ""

    if event_type == "CAPACITY_FACE_PLANNED":
        return (f"Put {fleet or 'a machine'} on {p.get('location') or 'a face'} "
                f"for {p.get('material') or 'work'} — {p.get('running_hours')} "
                f"hours, {p.get('tippers')} trucks")
    if event_type == "CAPACITY_FACE_REMOVED":
        return (f"Took {fleet} off {where}"
                f" ({p.get('running_hours')} hours, {p.get('tippers')} trucks)")
    if event_type == "CAPACITY_DAY_COPIED":
        return f"Started the day from {p.get('from_date')} — {p.get('rows')} rows"
    if event_type == "CAPACITY_CYCLE_SET":
        return f"Gave {fleet or 'a machine'} its own cycle: {p.get('reason') or ''}"
    if event_type == "CAPACITY_CYCLE_CLEARED":
        return f"Put {fleet or 'a machine'} back on the shared cycle"
    if event_type == "CAPACITY_PLAN_NAME_SET":
        if p.get("cleared"):
            return "Cleared what the plan calls this machine"
        taken = p.get("taken_from")
        return (f"The plan calls this machine {p.get('plan_name')}"
                + (f", taken from {taken}" if taken else ""))
    if event_type == "CAPACITY_TRUCK_CLASS_ADDED":
        return (f"Added a kind of truck: {p.get('label') or p.get('code')} — "
                f"{p.get('payload_t')} t, {p.get('effective_cum')} Cum")
    if event_type == "CAPACITY_BUCKET_CHANGED":
        pair = p.get("fitted_bucket_cum") or [None, None]
        was, now = pair[0], pair[1] if len(pair) > 1 else None
        if now is None:
            return (f"{fleet or 'A machine'} is back on its standard bucket"
                    f" ({p.get('standard_bucket')} Cum)")
        return f"Fitted bucket on {fleet or 'a machine'}: {was or '—'} to {now} Cum"

    # Everything that carries a diff reads the same way, so a new one needs no
    # new sentence here.
    changed = p.get("changed") or {}
    if changed:
        parts = [f"{_said(k)} {v[0]} to {v[1]}" for k, v in changed.items()
                 if isinstance(v, list) and len(v) == 2]
        head = {"CAPACITY_FACE_CHANGED": f"{fleet}{at}",
                "CAPACITY_ASSUMPTIONS_CHANGED": "The model",
                "CAPACITY_TRUCK_CLASS_CHANGED": p.get("code") or "A kind of truck",
                }.get(event_type, "Changed")
        return f"{head}: " + ", ".join(parts) if parts else f"{head} changed"
    return event_type.replace("CAPACITY_", "").replace("_", " ").lower()


@router.get("/activity")
def activity(request: Request, days: int = Query(30, ge=1, le=365),
             asset_id: int | None = Query(None),
             limit: int = Query(200, ge=1, le=1000),
             db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Every change to the capacity plan, newest first.

    Read from the event log rather than from the rows. The rows say what the
    plan is now; they cannot say who typed it, when, or what it said before —
    and "who put four trucks on the Sany" is a question about people.

    The events are narrowed to this screen's own kinds first, in their own
    step, before anything is joined or cast. The roster does the same thing for
    the same reason: a payload from some other adapter holding a word where
    this expects a number would otherwise fail the whole query.
    """
    _require(request, VIEW, "see the capacity plan")

    rows = db.execute(text("""
        WITH mine AS (
            SELECT e.event_id, e.event_type, e.occurred_at, e.recorded_by,
                   e.asset_id, e.production_day, e.payload
              FROM event e
             WHERE e.event_type = ANY(:types)
               AND e.occurred_at > now() - make_interval(days => :days)
        )
        SELECT m.event_id, m.event_type, m.occurred_at, m.recorded_by,
               m.asset_id, m.production_day, m.payload,
               a.fleet_code, a.nickname
          FROM mine m
          LEFT JOIN asset a ON a.asset_id = m.asset_id
         WHERE (CAST(:aid AS bigint) IS NULL
                OR m.asset_id = CAST(:aid AS bigint))
         ORDER BY m.occurred_at DESC
         LIMIT :lim
    """), {"types": CAPACITY_EVENTS, "days": days, "aid": asset_id,
           "lim": limit}).mappings().all()

    out = []
    for r in rows:
        payload = dict(r["payload"] or {})
        # The machine's real fleet code beats whatever was in the payload when
        # the event was written: a machine can be renamed, and the log should
        # read as the register reads today.
        if r["fleet_code"]:
            payload["fleet_code"] = r["fleet_code"]
        out.append({
            "event_id": str(r["event_id"]),
            "event_type": r["event_type"],
            "occurred_at": r["occurred_at"],
            "by": r["recorded_by"],
            "asset_id": r["asset_id"],
            "fleet_code": r["fleet_code"],
            "on_date": r["production_day"],
            "said": _sentence(r["event_type"], payload),
            "payload": payload,
        })
    return out


@router.get("/data-quality")
def data_quality(request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    """What would make these numbers wrong, said before anybody relies on them.

    A capacity screen that shows a total and says nothing about the state of
    the register behind it invites the total to be quoted. These are the three
    things found when the plan was first mapped, and they are reported rather
    than fixed because each is somebody's decision, not the screen's.
    """
    _require(request, VIEW, "see the capacity plan")

    # Asked through the same reading the rest of the screen uses, so the panel
    # cannot disagree with the table above it.
    no_bucket = []
    for r in db.execute(text("""
        SELECT a.fleet_code, a.nickname, a.ownership, a.capacity AS standard_bucket,
               a.capacity_uom, a.fitted_bucket_cum
          FROM asset a JOIN asset_type t ON t.asset_type_id = a.asset_type_id
         WHERE t.name ILIKE '%%excavat%%'
           AND a.status NOT IN ('DISPOSED','SCRAPPED','CANNIBALISED')
         ORDER BY a.fleet_code
    """)).mappings().all():
        _cum, _fit, problem = _bucket_of(dict(r))
        if problem:
            no_bucket.append({"fleet_code": r["fleet_code"],
                              "nickname": r["nickname"],
                              "ownership": r["ownership"], "problem": problem})

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
