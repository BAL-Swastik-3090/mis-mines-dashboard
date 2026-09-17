"""The operating chain: shift, availability, plan, deployment, handover.

One chain, not three modules. The live fleet screen, the shift board and the
handover centre are different views of the same state, so they are different
reads of the same tables rather than three features that agree by accident.

Readiness is never written down. Every endpoint that needs it asks the readiness
service, which recomputes from what is on file — see services/readiness.py for
why a stored flag would be wrong.

Nothing here creates another machine or person master. asset and operator remain
the only ones; this records what they did.
"""
from __future__ import annotations

import json
from datetime import date, datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import people, readiness

router = APIRouter(prefix="/api/ops", tags=["Operations"])

VIEW = "ops.shift.view"
MANAGE = "ops.shift.manage"
HOTO = "ops.hoto.record"
OVERRIDE = "ops.override"


# ── plumbing ─────────────────────────────────────────────────────────────────
def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _perms(request: Request) -> set:
    return getattr(request.state, "permissions", None) or set()


def _require(request: Request, permission: str, what: str) -> None:
    if permission not in _perms(request):
        raise HTTPException(403, f"You do not have permission to {what}. "
                                 "An Access Manager can add it to your role.")


def _event(db, request: Request, event_type: str, *, asset_id=None, party_id=None,
           shift_id=None, payload: dict | None = None) -> None:
    """The append-only log the whole platform shares."""
    db.execute(text("""
        INSERT INTO event (event_type, occurred_at, recorded_at, source,
                           asset_id, party_id, shift_id, payload, recorded_by)
        VALUES (:t, now(), now(), 'WEB', :a, :p, :s, CAST(:pl AS jsonb), :by)
    """), {"t": event_type, "a": asset_id, "p": party_id, "s": shift_id,
           "pl": json.dumps(payload or {}, default=str), "by": _actor(request)})


def _raise_exception(db, request: Request, kind: str, detail: str, *, severity="MEDIUM",
                     shift_instance_id=None, asset_id=None, operator_id=None,
                     hoto_id=None, dedupe: str | None = None) -> None:
    """Put something on the exception queue, once.

    The same problem noticed every minute is noise, so a dedupe key keeps one
    open row per thing. Re-raising a resolved exception is allowed — if it came
    back, it is news again.
    """
    db.execute(text("""
        INSERT INTO ops_exception (kind, severity, shift_instance_id, asset_id, operator_id,
                                   hoto_id, detail, raised_by, dedupe_key)
        VALUES (:k, :sev, :s, :a, :o, :h, :d, :by, :dk)
        ON CONFLICT (dedupe_key) DO UPDATE
           SET detail = EXCLUDED.detail,
               status = CASE WHEN ops_exception.status IN ('RESOLVED', 'DISMISSED')
                             THEN 'OPEN' ELSE ops_exception.status END
    """), {"k": kind, "sev": severity, "s": shift_instance_id, "a": asset_id,
           "o": operator_id, "h": hoto_id, "d": detail, "by": _actor(request),
           "dk": dedupe or f"{kind}:{asset_id}:{operator_id}:{shift_instance_id}"})


# ── the live fleet ───────────────────────────────────────────────────────────
@router.get("/fleet")
def live_fleet(plant_id: int | None = Query(None),
               db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Every machine, what it is doing, and who has it.

    Machine state and deployment readiness are different columns on purpose. A
    machine can be perfectly available and still undeployable because nobody is
    cleared to sit in it, and a board that merges the two hides which of the two
    problems the supervisor actually has.
    """
    rows = db.execute(text("""
        SELECT a.asset_id, a.asset_ref, a.fleet_code, a.nickname, a.status AS register_status,
               a.approval_status, t.name AS asset_type, t.asset_type_id,
               a.current_reading, a.reading_uom, pl.name AS plant
        FROM asset a
        LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        LEFT JOIN plant pl     ON pl.plant_id = a.plant_id
        WHERE (CAST(:plant AS bigint) IS NULL OR a.plant_id = CAST(:plant AS bigint))
          AND COALESCE(a.status, 'ACTIVE') NOT IN ('DISPOSED')
        ORDER BY a.fleet_code
    """), {"plant": plant_id}).mappings().all()

    out = []
    for r in rows:
        state = readiness.machine_state(db, r["asset_id"])
        deployment = state.get("deployment")
        check = readiness.deployment_readiness(
            db, r["asset_id"], deployment["operator_id"] if deployment else None)
        out.append({
            **dict(r),
            "state": state["state"],
            "holds": state["holds"],
            "expired_documents": state["expired_documents"],
            "operator": deployment["operator_name"] if deployment else None,
            "operator_id": deployment["operator_id"] if deployment else None,
            "deployment_ref": deployment["deployment_ref"] if deployment else None,
            "deployment_status": deployment["status"] if deployment else None,
            "open_hoto": state["open_hoto"],
            "readiness": check.status,
            "blockers": check.blockers,
            "warnings": check.warnings,
        })
    return out


@router.get("/assets/{asset_id}/readiness")
def asset_readiness(asset_id: int, operator_id: int | None = Query(None),
                    shift_instance_id: int | None = Query(None),
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Can this machine start work with this person, right now — and if not, why."""
    return readiness.deployment_readiness(db, asset_id, operator_id, shift_instance_id).as_dict()


@router.get("/assets/{asset_id}/candidates")
def asset_candidates(asset_id: int, db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Who could take this machine. Suggested, never chosen."""
    return readiness.candidates_for(db, asset_id)


# ── shifts ───────────────────────────────────────────────────────────────────
@router.get("/shifts")
def list_shifts(day: str | None = Query(None), db: Session = Depends(get_minehub_db),
                corp: Session = Depends(get_db)) -> list[dict]:
    """Shifts on a day — today unless asked otherwise."""
    on = day or date.today().isoformat()
    rows = db.execute(text("""
        SELECT si.*, sc.code AS shift_code, sc.name AS shift_name,
               sc.start_time, sc.end_time, pl.name AS plant, l.name AS location,
               (SELECT count(*) FROM shift_plan sp WHERE sp.shift_instance_id = si.shift_instance_id) AS planned,
               (SELECT count(*) FROM deployment d
                 WHERE d.shift_instance_id = si.shift_instance_id
                   AND d.status IN ('READY','RUNNING','PAUSED'))                    AS live,
               (SELECT count(*) FROM ops_exception e
                 WHERE e.shift_instance_id = si.shift_instance_id AND e.status = 'OPEN') AS open_exceptions
        FROM shift_instance si
        JOIN shift_calendar sc ON sc.shift_id = si.shift_id
        LEFT JOIN plant pl     ON pl.plant_id = si.plant_id
        LEFT JOIN location l   ON l.location_id = si.location_id
        WHERE si.production_day = CAST(:on AS date)
        ORDER BY sc.start_time
    """), {"on": on}).mappings().all()

    names = people.names_for(corp, [r["supervisor_emp_id"] for r in rows])
    return [{**dict(r), "supervisor_name": names.get(r["supervisor_emp_id"])} for r in rows]


@router.get("/shift-calendar")
def shift_calendar(db: Session = Depends(get_minehub_db)) -> list[dict]:
    """The shift definitions the mine works to."""
    rows = db.execute(text(
        "SELECT shift_id, code, name, start_time, end_time, crosses_midnight, planned_hours "
        "FROM shift_calendar WHERE valid_to IS NULL OR valid_to >= CURRENT_DATE ORDER BY start_time"
    )).mappings().all()
    return [dict(r) for r in rows]


@router.post("/shifts")
def open_shift(request: Request, body: dict = Body(...),
               db: Session = Depends(get_minehub_db)) -> dict:
    """Open a shift, or return the one already open.

    Opening twice is not an error worth a message — two supervisors reaching for
    the same button at six in the morning is ordinary, and the second one wants
    the shift, not an argument about who got there first.
    """
    _require(request, MANAGE, "run the shift")
    shift_id = body.get("shift_id")
    if not shift_id:
        raise HTTPException(400, "Choose which shift this is.")
    on = body.get("production_day") or date.today().isoformat()
    plant_id = body.get("plant_id") or db.execute(
        text("SELECT plant_id FROM plant WHERE is_default LIMIT 1")).scalar()

    existing = db.execute(text("""
        SELECT shift_instance_id, status FROM shift_instance
        WHERE shift_id = :s AND production_day = CAST(:d AS date)
          AND plant_id IS NOT DISTINCT FROM CAST(:p AS bigint)
    """), {"s": shift_id, "d": on, "p": plant_id}).mappings().first()

    if existing:
        if existing["status"] == "PLANNED":
            db.execute(text("UPDATE shift_instance SET status = 'OPEN', actual_start = now() "
                            "WHERE shift_instance_id = :i"), {"i": existing["shift_instance_id"]})
            db.commit()
        return {"ok": True, "shift_instance_id": existing["shift_instance_id"],
                "already_open": existing["status"] == "OPEN"}

    row = db.execute(text("""
        INSERT INTO shift_instance (shift_id, production_day, plant_id, location_id,
                                    supervisor_emp_id, status, actual_start, created_by)
        VALUES (:s, CAST(:d AS date), :p, :l, :sup, 'OPEN', now(), :by)
        RETURNING shift_instance_id
    """), {"s": shift_id, "d": on, "p": plant_id, "l": body.get("location_id"),
           "sup": body.get("supervisor_emp_id") or _actor(request),
           "by": _actor(request)}).mappings().first()

    _event(db, request, "SHIFT_STARTED", shift_id=shift_id,
           payload={"shift_instance_id": row["shift_instance_id"], "production_day": on})
    db.commit()
    return {"ok": True, "shift_instance_id": row["shift_instance_id"], "already_open": False}


@router.post("/shifts/{shift_instance_id}/close")
def close_shift(shift_instance_id: int, request: Request, body: dict = Body(default={}),
                db: Session = Depends(get_minehub_db)) -> dict:
    """Close a shift, and refuse to leave work hanging.

    No deployment should stay open indefinitely: an operator who is still
    recorded as running a machine at noon the next day makes every utilisation
    figure wrong and every handover ambiguous. Closing therefore releases what
    is still running, and says how many it released rather than doing it
    quietly.
    """
    _require(request, MANAGE, "run the shift")
    shift = db.execute(text(
        "SELECT status FROM shift_instance WHERE shift_instance_id = :i"
    ), {"i": shift_instance_id}).mappings().first()
    if not shift:
        raise HTTPException(404, "Shift not found.")
    if shift["status"] == "CLOSED":
        raise HTTPException(400, "That shift is already closed.")

    released = db.execute(text("""
        UPDATE deployment SET status = 'RELEASED', ended_at = now(), updated_at = now()
        WHERE shift_instance_id = :i AND status IN ('READY', 'RUNNING', 'PAUSED')
        RETURNING deployment_id, asset_id, operator_id
    """), {"i": shift_instance_id}).mappings().all()

    stranded = db.execute(text("""
        UPDATE hoto SET status = 'CANCELLED', updated_at = now()
        WHERE shift_instance_id = :i AND status = 'PENDING'
        RETURNING hoto_id, hoto_ref
    """), {"i": shift_instance_id}).mappings().all()

    for d in released:
        _event(db, request, "DEPLOYMENT_ENDED", asset_id=d["asset_id"],
               shift_id=None, payload={"deployment_id": d["deployment_id"],
                                       "reason": "Shift closed"})

    db.execute(text("UPDATE shift_instance SET status = 'CLOSED', actual_end = now(), "
                    "remarks = COALESCE(:r, remarks) WHERE shift_instance_id = :i"),
               {"i": shift_instance_id, "r": body.get("remarks")})
    _event(db, request, "SHIFT_ENDED", payload={"shift_instance_id": shift_instance_id,
                                                "released": len(released),
                                                "cancelled_hoto": len(stranded)})
    db.commit()
    return {"ok": True, "released": len(released), "cancelled_hoto": len(stranded)}


@router.get("/shifts/{shift_instance_id}/board")
def shift_board(shift_instance_id: int, db: Session = Depends(get_minehub_db),
                corp: Session = Depends(get_db)) -> dict:
    """Everything a supervisor needs before a shift starts, on one screen.

    Planned against available, present against eligible, what is blocked and
    why. The shortages are counted here rather than left to the eye, because
    "two dumpers short" is the sentence somebody has to act on and it should not
    depend on anyone counting rows correctly at half past five.
    """
    shift = db.execute(text("""
        SELECT si.*, sc.code AS shift_code, sc.name AS shift_name, pl.name AS plant
        FROM shift_instance si
        JOIN shift_calendar sc ON sc.shift_id = si.shift_id
        LEFT JOIN plant pl ON pl.plant_id = si.plant_id
        WHERE si.shift_instance_id = :i
    """), {"i": shift_instance_id}).mappings().first()
    if not shift:
        raise HTTPException(404, "Shift not found.")

    plans = db.execute(text("""
        SELECT sp.*, a.fleet_code, a.nickname, t.name AS asset_type,
               p.display_name AS operator_name, o.operator_ref, l.name AS location
        FROM shift_plan sp
        LEFT JOIN asset a      ON a.asset_id = sp.asset_id
        LEFT JOIN asset_type t ON t.asset_type_id = COALESCE(sp.asset_type_id, a.asset_type_id)
        LEFT JOIN operator o   ON o.operator_id = sp.operator_id
        LEFT JOIN party p      ON p.party_id = o.party_id
        LEFT JOIN location l   ON l.location_id = sp.location_id
        WHERE sp.shift_instance_id = :i
        ORDER BY sp.shift_plan_id
    """), {"i": shift_instance_id}).mappings().all()

    deployments = db.execute(text("""
        SELECT d.*, a.fleet_code, a.nickname, t.name AS asset_type,
               p.display_name AS operator_name, o.operator_ref, l.name AS location
        FROM deployment d
        JOIN asset a           ON a.asset_id = d.asset_id
        LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        LEFT JOIN operator o   ON o.operator_id = d.operator_id
        LEFT JOIN party p      ON p.party_id = o.party_id
        LEFT JOIN location l   ON l.location_id = d.location_id
        WHERE d.shift_instance_id = :i
        ORDER BY d.created_at
    """), {"i": shift_instance_id}).mappings().all()

    hotos = db.execute(text("""
        SELECT h.hoto_id, h.hoto_ref, h.status, h.blocked_reason, h.asset_id,
               a.fleet_code, po.display_name AS outgoing_name, pi.display_name AS incoming_name
        FROM hoto h
        JOIN asset a ON a.asset_id = h.asset_id
        LEFT JOIN operator oo ON oo.operator_id = h.outgoing_operator_id
        LEFT JOIN party po    ON po.party_id = oo.party_id
        LEFT JOIN operator oi ON oi.operator_id = h.incoming_operator_id
        LEFT JOIN party pi    ON pi.party_id = oi.party_id
        WHERE h.shift_instance_id = :i
        ORDER BY h.created_at DESC
    """), {"i": shift_instance_id}).mappings().all()

    exceptions = db.execute(text("""
        SELECT e.*, a.fleet_code, p.display_name AS operator_name
        FROM ops_exception e
        LEFT JOIN asset a    ON a.asset_id = e.asset_id
        LEFT JOIN operator o ON o.operator_id = e.operator_id
        LEFT JOIN party p    ON p.party_id = o.party_id
        WHERE e.shift_instance_id = :i AND e.status IN ('OPEN', 'ACKNOWLEDGED')
        ORDER BY CASE e.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                                 WHEN 'MEDIUM' THEN 2 ELSE 3 END, e.created_at DESC
    """), {"i": shift_instance_id}).mappings().all()

    # What was asked for against what can actually be crewed.
    shortages = []
    wanted = db.execute(text("""
        SELECT COALESCE(sp.asset_type_id, a.asset_type_id) AS asset_type_id,
               t.name AS asset_type, sum(sp.required_count) AS wanted
        FROM shift_plan sp
        LEFT JOIN asset a      ON a.asset_id = sp.asset_id
        LEFT JOIN asset_type t ON t.asset_type_id = COALESCE(sp.asset_type_id, a.asset_type_id)
        WHERE sp.shift_instance_id = :i AND sp.status <> 'CANCELLED'
          AND COALESCE(sp.asset_type_id, a.asset_type_id) IS NOT NULL
        GROUP BY 1, 2
    """), {"i": shift_instance_id}).mappings().all()

    for w in wanted:
        machines = db.execute(text("""
            SELECT count(*) FROM asset a
            WHERE a.asset_type_id = :t AND COALESCE(a.status, 'ACTIVE') = 'ACTIVE'
              AND NOT EXISTS (SELECT 1 FROM availability_event ae
                               WHERE ae.asset_id = a.asset_id AND ae.ended_at IS NULL
                                 AND ae.state IN ('BREAKDOWN','MAINTENANCE','INSPECTION_HOLD',
                                                  'COMPLIANCE_HOLD','PLANNED_DOWN'))
        """), {"t": w["asset_type_id"]}).scalar()
        crew = db.execute(text("""
            SELECT count(*) FROM operator o
            JOIN operator_competency c ON c.operator_id = o.operator_id
             AND c.asset_type_id = :t AND c.dimension = 'OVERALL' AND c.asset_id IS NULL
            WHERE o.profile_status = 'ACTIVE' AND COALESCE(c.level, 0) >= 2
              AND NOT EXISTS (SELECT 1 FROM availability_event ae
                               WHERE ae.operator_id = o.operator_id AND ae.ended_at IS NULL
                                 AND ae.state IN ('ABSENT','LEAVE','MEDICAL_HOLD','SUSPENDED'))
        """), {"t": w["asset_type_id"]}).scalar()
        if machines < w["wanted"] or crew < w["wanted"]:
            shortages.append({
                "asset_type": w["asset_type"], "wanted": int(w["wanted"]),
                "machines_available": machines, "operators_eligible": crew,
                "machine_short": max(0, int(w["wanted"]) - machines),
                "operator_short": max(0, int(w["wanted"]) - crew),
            })

    counts = {
        "planned": len(plans),
        "deployed": len([d for d in deployments if d["status"] in ("READY", "RUNNING", "PAUSED")]),
        "running": len([d for d in deployments if d["status"] == "RUNNING"]),
        "released": len([d for d in deployments if d["status"] == "RELEASED"]),
        "hoto_pending": len([h for h in hotos if h["status"] == "PENDING"]),
        "hoto_blocked": len([h for h in hotos if h["status"] == "BLOCKED"]),
        "exceptions": len(exceptions),
    }

    return {"shift": dict(shift), "counts": counts,
            "plans": [dict(p) for p in plans],
            "deployments": [dict(d) for d in deployments],
            "hoto": [dict(h) for h in hotos],
            "exceptions": [dict(e) for e in exceptions],
            "shortages": shortages}


# ── availability ─────────────────────────────────────────────────────────────
@router.post("/availability")
def declare_unavailable(request: Request, body: dict = Body(...),
                        db: Session = Depends(get_minehub_db)) -> dict:
    """Record that a machine or a person is not available, and why.

    One endpoint for both, because a breakdown and an absence are the same shape:
    it started, there is a reason, and it stands until somebody releases it.
    """
    _require(request, MANAGE, "run the shift")
    asset_id = body.get("asset_id")
    operator_id = body.get("operator_id")
    state = (body.get("state") or "").upper()
    if not state:
        raise HTTPException(400, "Say what state this is.")
    if not asset_id and not operator_id:
        raise HTTPException(400, "Say which machine or which operator.")

    # An open hold of the same kind is not repeated; it is still that.
    open_now = db.execute(text("""
        SELECT availability_event_id FROM availability_event
        WHERE ended_at IS NULL AND state = :s
          AND asset_id IS NOT DISTINCT FROM CAST(:a AS bigint)
          AND operator_id IS NOT DISTINCT FROM CAST(:o AS bigint)
    """), {"s": state, "a": asset_id, "o": operator_id}).scalar()
    if open_now:
        return {"ok": True, "availability_event_id": open_now, "already_open": True}

    row = db.execute(text("""
        INSERT INTO availability_event (asset_id, operator_id, state, reason,
                                        shift_instance_id, source, recorded_by, remarks)
        VALUES (:a, :o, :s, :r, :si, :src, :by, :rem)
        RETURNING availability_event_id
    """), {"a": asset_id, "o": operator_id, "s": state, "r": body.get("reason"),
           "si": body.get("shift_instance_id"), "src": body.get("source", "MANUAL"),
           "by": _actor(request), "rem": body.get("remarks")}).mappings().first()

    # A machine that breaks down while somebody is on it: the deployment stops
    # here rather than being left to look like eight hours of production.
    if asset_id and state in readiness.BLOCKING_MACHINE_STATES:
        stopped = db.execute(text("""
            UPDATE deployment SET status = 'RELEASED', ended_at = now(), updated_at = now()
            WHERE asset_id = :a AND status IN ('READY', 'RUNNING', 'PAUSED')
            RETURNING deployment_id, operator_id, shift_instance_id
        """), {"a": asset_id}).mappings().all()
        for d in stopped:
            _raise_exception(db, request, "MACHINE_UNAVAILABLE",
                             f"{state.replace('_', ' ').capitalize()} stopped a live deployment",
                             severity="HIGH", shift_instance_id=d["shift_instance_id"],
                             asset_id=asset_id, operator_id=d["operator_id"],
                             dedupe=f"MACHINE_UNAVAILABLE:{d['deployment_id']}")

    if operator_id and state in readiness.BLOCKING_OPERATOR_STATES:
        _raise_exception(db, request, "OPERATOR_ABSENT",
                         f"Operator {state.lower()} — a replacement may be needed",
                         severity="HIGH", shift_instance_id=body.get("shift_instance_id"),
                         operator_id=operator_id,
                         dedupe=f"OPERATOR_ABSENT:{operator_id}:{body.get('shift_instance_id')}")

    _event(db, request, "MACHINE_UNAVAILABLE" if asset_id else "OPERATOR_ABSENT",
           asset_id=asset_id, payload={"state": state, "reason": body.get("reason")})
    db.commit()
    return {"ok": True, "availability_event_id": row["availability_event_id"]}


@router.post("/availability/{availability_event_id}/release")
def release_availability(availability_event_id: int, request: Request,
                         body: dict = Body(default={}),
                         db: Session = Depends(get_minehub_db)) -> dict:
    """End a hold — the machine is repaired, the person is back."""
    _require(request, MANAGE, "run the shift")
    row = db.execute(text("""
        UPDATE availability_event
           SET ended_at = now(), released_by = :by,
               remarks = COALESCE(:rem, remarks)
        WHERE availability_event_id = :i AND ended_at IS NULL
        RETURNING asset_id, operator_id, state
    """), {"i": availability_event_id, "by": _actor(request),
           "rem": body.get("remarks")}).mappings().first()
    if not row:
        raise HTTPException(404, "That hold is not open.")

    _event(db, request, "MACHINE_RELEASED" if row["asset_id"] else "OPERATOR_PRESENT",
           asset_id=row["asset_id"], payload={"state": row["state"]})
    db.commit()
    return {"ok": True}


@router.post("/attendance")
def record_attendance(request: Request, body: dict = Body(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Mark who is here.

    Presence is recorded rather than assumed. An operator nothing has been said
    about reads as ATTENDANCE_PENDING everywhere, never as present — the whole
    point of asking is that silence is not an answer.
    """
    _require(request, MANAGE, "run the shift")
    marked = 0
    for entry in body.get("operators") or []:
        operator_id = entry.get("operator_id")
        present = bool(entry.get("present"))
        if not operator_id:
            continue

        # Whatever was said before about this shift is superseded.
        db.execute(text("""
            UPDATE availability_event SET ended_at = now(), released_by = :by
            WHERE operator_id = :o AND ended_at IS NULL
              AND state IN ('PRESENT', 'ABSENT')
        """), {"o": operator_id, "by": _actor(request)})

        db.execute(text("""
            INSERT INTO availability_event (operator_id, state, reason, shift_instance_id,
                                            source, recorded_by)
            VALUES (:o, :s, :r, :si, :src, :by)
        """), {"o": operator_id, "s": "PRESENT" if present else "ABSENT",
               "r": entry.get("reason"), "si": body.get("shift_instance_id"),
               "src": body.get("source", "MANUAL"), "by": _actor(request)})

        if not present:
            _raise_exception(db, request, "OPERATOR_ABSENT",
                             "Marked absent — a replacement may be needed", severity="HIGH",
                             shift_instance_id=body.get("shift_instance_id"),
                             operator_id=operator_id,
                             dedupe=f"OPERATOR_ABSENT:{operator_id}:{body.get('shift_instance_id')}")
        marked += 1

    _event(db, request, "ATTENDANCE_RECEIVED",
           payload={"shift_instance_id": body.get("shift_instance_id"), "marked": marked})
    db.commit()
    return {"ok": True, "marked": marked}


# ── the plan ─────────────────────────────────────────────────────────────────
@router.post("/shifts/{shift_instance_id}/plans")
def add_plan(shift_instance_id: int, request: Request, body: dict = Body(...),
             db: Session = Depends(get_minehub_db)) -> dict:
    """Add a planned line: a machine, an operator, or the two together."""
    _require(request, MANAGE, "run the shift")
    if not (body.get("asset_id") or body.get("operator_id") or body.get("asset_type_id")):
        raise HTTPException(400, "A plan line needs a machine, an operator or a class.")

    row = db.execute(text("""
        INSERT INTO shift_plan (shift_instance_id, asset_id, operator_id, asset_type_id,
                                required_count, activity, location_id, role, planned_hours,
                                remarks, created_by)
        VALUES (:si, :a, :o, :t, :n, :act, :l, :role, :hrs, :rem, :by)
        RETURNING shift_plan_id
    """), {"si": shift_instance_id, "a": body.get("asset_id"), "o": body.get("operator_id"),
           "t": body.get("asset_type_id"), "n": body.get("required_count", 1),
           "act": body.get("activity"), "l": body.get("location_id"),
           "role": (body.get("role") or "PRIMARY").upper(),
           "hrs": body.get("planned_hours"), "rem": body.get("remarks"),
           "by": _actor(request)}).mappings().first()
    db.commit()
    return {"ok": True, "shift_plan_id": row["shift_plan_id"]}


@router.post("/shifts/{shift_instance_id}/publish")
def publish_plan(shift_instance_id: int, request: Request,
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Publish the plan, so the shift knows what it is trying to do."""
    _require(request, MANAGE, "run the shift")
    n = db.execute(text("""
        UPDATE shift_plan SET status = 'PUBLISHED', published_by = :by, published_at = now()
        WHERE shift_instance_id = :i AND status = 'DRAFT'
    """), {"i": shift_instance_id, "by": _actor(request)}).rowcount
    _event(db, request, "SHIFT_PLAN_PUBLISHED",
           payload={"shift_instance_id": shift_instance_id, "lines": n})
    db.commit()
    return {"ok": True, "published": n}


@router.delete("/plans/{shift_plan_id}")
def remove_plan(shift_plan_id: int, request: Request,
                db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "run the shift")
    db.execute(text("DELETE FROM shift_plan WHERE shift_plan_id = :i"), {"i": shift_plan_id})
    db.commit()
    return {"ok": True}


# ── deployment ───────────────────────────────────────────────────────────────
@router.post("/deployments")
def deploy(request: Request, body: dict = Body(...),
           db: Session = Depends(get_minehub_db)) -> dict:
    """Put an operator on a machine for this shift.

    Readiness is checked first and recorded with the deployment, so what was
    true at the moment of the decision survives — a licence that expires
    tomorrow should not make yesterday's deployment look reckless.

    A blocked deployment can still go ahead, but only with the override
    permission and a reason, and the reason is stored on the row. A mine that
    cannot override at two in the morning gets a mine that works around the
    system; a mine that overrides silently gets no record of having done it.
    """
    _require(request, MANAGE, "run the shift")
    asset_id, operator_id = body.get("asset_id"), body.get("operator_id")
    shift_instance_id = body.get("shift_instance_id")
    if not asset_id or not shift_instance_id:
        raise HTTPException(400, "A deployment needs a machine and a shift.")

    check = readiness.deployment_readiness(db, asset_id, operator_id, shift_instance_id)
    override_reason = (body.get("override_reason") or "").strip()

    if check.status == "BLOCKED":
        if OVERRIDE not in _perms(request):
            raise HTTPException(409, {
                "message": "This deployment is blocked.",
                "blockers": check.blockers, "warnings": check.warnings,
            })
        if not override_reason:
            raise HTTPException(400, "Overriding a block needs a reason, which is recorded.")

    row = db.execute(text("""
        INSERT INTO deployment (deployment_ref, shift_instance_id, asset_id, operator_id,
                                shift_plan_id, location_id, activity, role, status,
                                start_reading, readiness_at_start, override_by, override_reason,
                                created_by)
        VALUES (next_deployment_ref(), :si, :a, :o, :sp, :l, :act, :role, 'READY',
                :reading, CAST(:readiness AS jsonb), :ovby, :ovreason, :by)
        RETURNING deployment_id, deployment_ref
    """), {"si": shift_instance_id, "a": asset_id, "o": operator_id,
           "sp": body.get("shift_plan_id"), "l": body.get("location_id"),
           "act": body.get("activity"), "role": (body.get("role") or "PRIMARY").upper(),
           "reading": body.get("start_reading"),
           "readiness": json.dumps(check.as_dict(), default=str),
           "ovby": _actor(request) if check.status == "BLOCKED" else None,
           "ovreason": override_reason or None,
           "by": _actor(request)}).mappings().first()

    if check.status == "BLOCKED":
        _raise_exception(db, request, "DEPLOYED_OVER_BLOCK",
                         f"Deployed against: {'; '.join(check.blockers)} — {override_reason}",
                         severity="CRITICAL", shift_instance_id=shift_instance_id,
                         asset_id=asset_id, operator_id=operator_id,
                         dedupe=f"DEPLOYED_OVER_BLOCK:{row['deployment_id']}")

    _event(db, request, "DEPLOYMENT_CREATED", asset_id=asset_id,
           payload={"deployment_ref": row["deployment_ref"], "operator_id": operator_id,
                    "readiness": check.status, "overridden": check.status == "BLOCKED"})
    db.commit()
    return {"ok": True, "deployment_id": row["deployment_id"],
            "deployment_ref": row["deployment_ref"], "readiness": check.as_dict()}


@router.post("/deployments/{deployment_id}/start")
def start_deployment(deployment_id: int, request: Request, body: dict = Body(default={}),
                     db: Session = Depends(get_minehub_db)) -> dict:
    """The machine is working."""
    _require(request, MANAGE, "run the shift")
    row = db.execute(text("""
        UPDATE deployment SET status = 'RUNNING', started_at = COALESCE(started_at, now()),
               start_reading = COALESCE(CAST(:reading AS numeric), start_reading),
               updated_at = now()
        WHERE deployment_id = :i AND status IN ('READY', 'PAUSED')
        RETURNING asset_id, deployment_ref
    """), {"i": deployment_id, "reading": body.get("start_reading")}).mappings().first()
    if not row:
        raise HTTPException(400, "That deployment is not waiting to start.")
    _event(db, request, "DEPLOYMENT_STARTED", asset_id=row["asset_id"],
           payload={"deployment_ref": row["deployment_ref"]})
    db.commit()
    return {"ok": True}


@router.post("/deployments/{deployment_id}/release")
def release_deployment(deployment_id: int, request: Request, body: dict = Body(default={}),
                       db: Session = Depends(get_minehub_db)) -> dict:
    """The operator is finished with the machine.

    The closing meter reading is asked for here because this is the only moment
    anyone is standing next to it. Asked later, it becomes a guess.
    """
    _require(request, MANAGE, "run the shift")
    row = db.execute(text("""
        UPDATE deployment SET status = 'RELEASED', ended_at = now(),
               end_reading = COALESCE(CAST(:reading AS numeric), end_reading),
               updated_at = now()
        WHERE deployment_id = :i AND status IN ('READY', 'RUNNING', 'PAUSED')
        RETURNING asset_id, operator_id, deployment_ref, start_reading, end_reading
    """), {"i": deployment_id, "reading": body.get("end_reading")}).mappings().first()
    if not row:
        raise HTTPException(400, "That deployment is not open.")

    # The register's own meter moves with it, so the next person sees the truth.
    if row["end_reading"] is not None:
        db.execute(text("""
            UPDATE asset SET current_reading = :r, reading_as_on = CURRENT_DATE
            WHERE asset_id = :a AND (current_reading IS NULL OR current_reading < :r)
        """), {"r": row["end_reading"], "a": row["asset_id"]})

    _event(db, request, "DEPLOYMENT_ENDED", asset_id=row["asset_id"],
           payload={"deployment_ref": row["deployment_ref"],
                    "hours": float(row["end_reading"] - row["start_reading"])
                             if row["end_reading"] is not None and row["start_reading"] is not None
                             else None})
    db.commit()
    return {"ok": True}


# ── handover ─────────────────────────────────────────────────────────────────
@router.get("/hoto/template")
def hoto_template(asset_type_id: int | None = Query(None),
                  db: Session = Depends(get_minehub_db)) -> dict:
    """The checklist for a class, or the standard one."""
    row = db.execute(text("""
        SELECT hoto_template_id, name, items FROM hoto_template
        WHERE status = 'ACTIVE' AND (asset_type_id = CAST(:t AS bigint) OR asset_type_id IS NULL)
        ORDER BY asset_type_id NULLS LAST LIMIT 1
    """), {"t": asset_type_id}).mappings().first()
    return dict(row) if row else {"items": []}


@router.post("/hoto")
def start_hoto(request: Request, body: dict = Body(...),
               db: Session = Depends(get_minehub_db)) -> dict:
    """Begin a handover.

    A handover is the transaction that moves responsibility for a machine from
    one person to another, not a form that gets filled in afterwards. It is
    therefore allowed to start while blocked — the block is the information —
    and it cannot complete until what blocks it is resolved.
    """
    _require(request, HOTO, "record handover")
    asset_id = body.get("asset_id")
    if not asset_id:
        raise HTTPException(400, "Which machine is being handed over?")

    incoming = body.get("incoming_operator_id")
    machine = readiness.machine_state(db, asset_id)
    if not machine["found"]:
        raise HTTPException(404, "Machine not found.")

    live = machine.get("deployment")
    outgoing = body.get("outgoing_operator_id") or (live["operator_id"] if live else None)

    template = db.execute(text("""
        SELECT hoto_template_id, items FROM hoto_template
        WHERE status = 'ACTIVE' AND (asset_type_id = :t OR asset_type_id IS NULL)
        ORDER BY asset_type_id NULLS LAST LIMIT 1
    """), {"t": machine["asset_type_id"]}).mappings().first()

    checks = [{**item, "status": None, "remarks": None}
              for item in (template["items"] if template else [])]

    status, blocked_reason = "PENDING", None
    if incoming:
        check = readiness.deployment_readiness(db, asset_id, incoming)
        if check.blockers:
            status, blocked_reason = "BLOCKED", "; ".join(check.blockers)

    row = db.execute(text("""
        INSERT INTO hoto (hoto_ref, asset_id, shift_instance_id, outgoing_operator_id,
                          incoming_operator_id, outgoing_deployment_id, template_id,
                          meter_reading, location_id, checks, status, blocked_reason, created_by)
        VALUES (next_hoto_ref(), :a, :si, :out, :in, :dep, :tpl, :meter, :loc,
                CAST(:checks AS jsonb), :st, :reason, :by)
        RETURNING hoto_id, hoto_ref, status
    """), {"a": asset_id, "si": body.get("shift_instance_id"), "out": outgoing,
           "in": incoming, "dep": live["deployment_id"] if live else None,
           "tpl": template["hoto_template_id"] if template else None,
           "meter": body.get("meter_reading") or machine.get("reading"),
           "loc": body.get("location_id"), "checks": json.dumps(checks),
           "st": status, "reason": blocked_reason, "by": _actor(request)}).mappings().first()

    if status == "BLOCKED":
        _raise_exception(db, request, "HOTO_BLOCKED", blocked_reason or "Handover blocked",
                         severity="HIGH", shift_instance_id=body.get("shift_instance_id"),
                         asset_id=asset_id, operator_id=incoming, hoto_id=row["hoto_id"],
                         dedupe=f"HOTO_BLOCKED:{row['hoto_id']}")

    _event(db, request, "HOTO_STARTED", asset_id=asset_id,
           payload={"hoto_ref": row["hoto_ref"], "status": status})
    db.commit()
    return {"ok": True, **dict(row), "blocked_reason": blocked_reason}


@router.put("/hoto/{hoto_id}")
def update_hoto(hoto_id: int, request: Request, body: dict = Body(...),
                db: Session = Depends(get_minehub_db)) -> dict:
    """Record the inspection, and what is wrong with the machine."""
    _require(request, HOTO, "record handover")
    fields, params = [], {"i": hoto_id}
    for key, column in (("checks", "checks"), ("defects", "defects")):
        if key in body:
            fields.append(f"{column} = CAST(:{key} AS jsonb)")
            params[key] = json.dumps(body[key], default=str)
    for key in ("meter_reading", "fuel_level", "incoming_operator_id", "remarks"):
        if key in body:
            fields.append(f"{key} = :{key}")
            params[key] = body[key]
    if not fields:
        return {"ok": True, "changed": 0}

    row = db.execute(text(
        f"UPDATE hoto SET {', '.join(fields)}, updated_at = now() "
        "WHERE hoto_id = :i AND status IN ('PENDING', 'BLOCKED') RETURNING hoto_id"
    ), params).mappings().first()
    if not row:
        raise HTTPException(400, "That handover is finished or cancelled.")
    db.commit()
    return {"ok": True, "changed": len(fields)}


@router.post("/hoto/{hoto_id}/complete")
def complete_hoto(hoto_id: int, request: Request, body: dict = Body(default={}),
                  db: Session = Depends(get_minehub_db)) -> dict:
    """Finish the handover: responsibility moves.

    Three things stop it. An unanswered checklist, because a handover that skips
    the inspection is a signature on a machine nobody looked at. A critical item
    marked bad — that is the point of marking it critical, and a shift change
    must not become the way an unsafe machine gets back to work. And an incoming
    operator who is not cleared for it.

    When it completes, the outgoing deployment is released and the incoming one
    created in the same breath, because responsibility does not go through a gap
    where nobody holds it.
    """
    _require(request, HOTO, "record handover")
    row = db.execute(text("""
        SELECT h.*, a.asset_id FROM hoto h JOIN asset a ON a.asset_id = h.asset_id
        WHERE h.hoto_id = :i
    """), {"i": hoto_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Handover not found.")
    if row["status"] == "COMPLETED":
        raise HTTPException(400, "That handover is already complete.")

    checks = row["checks"] or []
    unanswered = [c["label"] for c in checks if not c.get("status")]
    if unanswered:
        raise HTTPException(400, f"{len(unanswered)} item(s) not answered, starting with "
                                 f"{unanswered[0]}. A handover that skips the inspection is a "
                                 "signature on a machine nobody looked at.")

    critical_bad = [c["label"] for c in checks
                    if c.get("critical") and str(c.get("status")).upper() in ("BAD", "FAIL", "NOT_OK")]
    if critical_bad:
        db.execute(text("UPDATE hoto SET status = 'BLOCKED', blocked_reason = :r, updated_at = now() "
                        "WHERE hoto_id = :i"),
                   {"i": hoto_id, "r": f"Critical defect: {', '.join(critical_bad)}"})
        # The machine is held, not merely noted: the next person to try will be
        # told why rather than discovering it on the bench.
        db.execute(text("""
            INSERT INTO availability_event (asset_id, state, reason, shift_instance_id,
                                            source, recorded_by)
            VALUES (:a, 'INSPECTION_HOLD', :r, :si, 'HOTO', :by)
        """), {"a": row["asset_id"], "r": f"Critical defect at handover: {', '.join(critical_bad)}",
               "si": row["shift_instance_id"], "by": _actor(request)})
        _raise_exception(db, request, "HOTO_CRITICAL_DEFECT",
                         f"Critical defect at handover: {', '.join(critical_bad)}",
                         severity="CRITICAL", shift_instance_id=row["shift_instance_id"],
                         asset_id=row["asset_id"], hoto_id=hoto_id,
                         dedupe=f"HOTO_CRITICAL_DEFECT:{hoto_id}")
        _event(db, request, "HOTO_BLOCKED", asset_id=row["asset_id"],
               payload={"hoto_ref": row["hoto_ref"], "critical": critical_bad})
        db.commit()
        raise HTTPException(409, {"message": "Handover blocked by a critical defect.",
                                  "critical": critical_bad,
                                  "action": "The machine is on inspection hold until it is released."})

    incoming = body.get("incoming_operator_id") or row["incoming_operator_id"]
    incoming_deployment = None

    if incoming:
        check = readiness.deployment_readiness(db, row["asset_id"], incoming,
                                               row["shift_instance_id"])
        if check.blockers and OVERRIDE not in _perms(request):
            raise HTTPException(409, {"message": "The incoming operator cannot take this machine.",
                                      "blockers": check.blockers})

    if row["outgoing_deployment_id"]:
        db.execute(text("""
            UPDATE deployment SET status = 'RELEASED', ended_at = now(),
                   end_reading = COALESCE(CAST(:meter AS numeric), end_reading), updated_at = now()
            WHERE deployment_id = :d AND status IN ('READY', 'RUNNING', 'PAUSED')
        """), {"d": row["outgoing_deployment_id"], "meter": row["meter_reading"]})

    if incoming and row["shift_instance_id"]:
        made = db.execute(text("""
            INSERT INTO deployment (deployment_ref, shift_instance_id, asset_id, operator_id,
                                    start_reading, status, created_by)
            VALUES (next_deployment_ref(), :si, :a, :o, CAST(:meter AS numeric), 'READY', :by)
            RETURNING deployment_id, deployment_ref
        """), {"si": row["shift_instance_id"], "a": row["asset_id"], "o": incoming,
               "meter": row["meter_reading"], "by": _actor(request)}).mappings().first()
        incoming_deployment = made["deployment_id"]

    db.execute(text("""
        UPDATE hoto SET status = 'COMPLETED', incoming_operator_id = COALESCE(:in, incoming_operator_id),
               incoming_deployment_id = :dep, blocked_reason = NULL,
               outgoing_confirmed_by = COALESCE(outgoing_confirmed_by, :by),
               outgoing_confirmed_at = COALESCE(outgoing_confirmed_at, now()),
               incoming_confirmed_by = :by, incoming_confirmed_at = now(),
               remarks = COALESCE(:rem, remarks), updated_at = now()
        WHERE hoto_id = :i
    """), {"i": hoto_id, "in": incoming, "dep": incoming_deployment,
           "by": _actor(request), "rem": body.get("remarks")})

    db.execute(text("UPDATE ops_exception SET status = 'RESOLVED', resolved_by = :by, "
                    "resolved_at = now(), resolution = 'Handover completed' "
                    "WHERE hoto_id = :i AND status IN ('OPEN', 'ACKNOWLEDGED')"),
               {"i": hoto_id, "by": _actor(request)})

    _event(db, request, "HOTO_COMPLETED", asset_id=row["asset_id"],
           payload={"hoto_ref": row["hoto_ref"], "incoming_operator_id": incoming,
                    "deployment_id": incoming_deployment})
    db.commit()
    return {"ok": True, "deployment_id": incoming_deployment}


@router.get("/hoto")
def list_hoto(status: str = Query(""), db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Handovers, open ones first."""
    where = ["1=1"]
    params: dict = {}
    if status:
        where.append("h.status = :st")
        params["st"] = status.upper()
    rows = db.execute(text(f"""
        SELECT h.hoto_id, h.hoto_ref, h.status, h.blocked_reason, h.meter_reading,
               h.created_at, h.updated_at, a.fleet_code, a.nickname, t.name AS asset_type,
               po.display_name AS outgoing_name, pi.display_name AS incoming_name,
               jsonb_array_length(h.checks) AS check_count,
               (SELECT count(*) FROM jsonb_array_elements(h.checks) c
                 WHERE c ->> 'status' IS NOT NULL)                 AS answered
        FROM hoto h
        JOIN asset a           ON a.asset_id = h.asset_id
        LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        LEFT JOIN operator oo  ON oo.operator_id = h.outgoing_operator_id
        LEFT JOIN party po     ON po.party_id = oo.party_id
        LEFT JOIN operator oi  ON oi.operator_id = h.incoming_operator_id
        LEFT JOIN party pi     ON pi.party_id = oi.party_id
        WHERE {' AND '.join(where)}
        ORDER BY CASE h.status WHEN 'BLOCKED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,
                 h.created_at DESC
        LIMIT 100
    """), params).mappings().all()
    return [dict(r) for r in rows]


@router.get("/hoto/{hoto_id}")
def get_hoto(hoto_id: int, db: Session = Depends(get_minehub_db)) -> dict:
    row = db.execute(text("""
        SELECT h.*, a.fleet_code, a.nickname, a.asset_type_id, t.name AS asset_type,
               po.display_name AS outgoing_name, pi.display_name AS incoming_name
        FROM hoto h
        JOIN asset a           ON a.asset_id = h.asset_id
        LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        LEFT JOIN operator oo  ON oo.operator_id = h.outgoing_operator_id
        LEFT JOIN party po     ON po.party_id = oo.party_id
        LEFT JOIN operator oi  ON oi.operator_id = h.incoming_operator_id
        LEFT JOIN party pi     ON pi.party_id = oi.party_id
        WHERE h.hoto_id = :i
    """), {"i": hoto_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Handover not found.")
    return dict(row)


# ── exceptions ───────────────────────────────────────────────────────────────
@router.get("/exceptions")
def list_exceptions(status: str = Query("OPEN"), db: Session = Depends(get_minehub_db),
                    corp: Session = Depends(get_db)) -> list[dict]:
    """Everything stopping planned work, in one queue."""
    rows = db.execute(text("""
        SELECT e.*, a.fleet_code, p.display_name AS operator_name, h.hoto_ref
        FROM ops_exception e
        LEFT JOIN asset a    ON a.asset_id = e.asset_id
        LEFT JOIN operator o ON o.operator_id = e.operator_id
        LEFT JOIN party p    ON p.party_id = o.party_id
        LEFT JOIN hoto h     ON h.hoto_id = e.hoto_id
        WHERE (:st = 'ALL' OR e.status = :st)
        ORDER BY CASE e.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                                 WHEN 'MEDIUM' THEN 2 ELSE 3 END, e.created_at DESC
        LIMIT 200
    """), {"st": status.upper()}).mappings().all()
    names = people.names_for(corp, [r["raised_by"] for r in rows])
    return [{**dict(r), "raised_by_name": names.get(r["raised_by"])} for r in rows]


@router.post("/exceptions/{ops_exception_id}/resolve")
def resolve_exception(ops_exception_id: int, request: Request, body: dict = Body(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Close an exception, with what was done about it."""
    _require(request, MANAGE, "run the shift")
    resolution = (body.get("resolution") or "").strip()
    if not resolution:
        raise HTTPException(400, "Say what was done — a queue of silently closed "
                                 "exceptions teaches people to close them silently.")
    row = db.execute(text("""
        UPDATE ops_exception SET status = :st, resolution = :r, resolved_by = :by,
               resolved_at = now()
        WHERE ops_exception_id = :i RETURNING ops_exception_id
    """), {"i": ops_exception_id, "r": resolution, "by": _actor(request),
           "st": "DISMISSED" if body.get("dismiss") else "RESOLVED"}).mappings().first()
    if not row:
        raise HTTPException(404, "Exception not found.")
    db.commit()
    return {"ok": True}


@router.get("/meta/me")
def whoami(request: Request) -> dict:
    """What this user may do here, so the screen offers only what will work."""
    perms = _perms(request)
    return {"emp_id": _actor(request),
            "may_view": VIEW in perms, "may_manage": MANAGE in perms,
            "may_hoto": HOTO in perms, "may_override": OVERRIDE in perms}
