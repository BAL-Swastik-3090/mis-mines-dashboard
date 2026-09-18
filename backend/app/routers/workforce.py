"""The roster, the leave, the calendar — and the engine that reads all three.

Everything here answers one question in different shapes: who is working, when,
and on what. The roster says who is expected; leave says who is not; the
calendar says when nobody is; and the allocation engine puts the people who
remain onto the machines that need them.

The engine proposes. Accepting a proposal writes exactly the same deployment
rows a supervisor deploying by hand would write, through the same readiness
check, because a shortcut that skips the check is a shortcut that eventually
puts an unlicensed operator on a dozer.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import deployer, readiness, roster

router = APIRouter(prefix="/api/workforce", tags=["Workforce"])

VIEW = "ops.roster.view"
MANAGE = "ops.roster.manage"
APPLY = "ops.leave.apply"
APPROVE = "ops.leave.approve"
DEPLOY = "ops.shift.manage"


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _perms(request: Request) -> set:
    return getattr(request.state, "permissions", None) or set()


def _require(request: Request, permission: str, what: str) -> None:
    if permission not in _perms(request):
        raise HTTPException(403, f"You do not have permission to {what}. "
                                 "An Access Manager can add it to your role.")


def _event(db, request: Request, event_type: str, *, party_id=None,
           payload: dict | None = None) -> None:
    db.execute(text("""
        INSERT INTO event (event_type, occurred_at, recorded_at, source,
                           party_id, payload, recorded_by)
        VALUES (:t, now(), now(), 'WEB', :p, CAST(:pl AS jsonb), :by)
    """), {"t": event_type, "p": party_id,
           "pl": json.dumps(payload or {}, default=str), "by": _actor(request)})


def _day(value: str | None) -> date:
    return date.fromisoformat(value) if value else date.today()


# ── patterns ─────────────────────────────────────────────────────────────────
@router.get("/patterns")
def list_patterns(request: Request, db: Session = Depends(get_minehub_db)) -> list[dict]:
    _require(request, VIEW, "see the roster")
    return [dict(r) for r in db.execute(text("""
        SELECT rp.*,
               (SELECT count(*) FROM roster_assignment ra
                 WHERE ra.pattern_id = rp.pattern_id AND ra.effective_to IS NULL) AS people
        FROM roster_pattern rp ORDER BY rp.is_active DESC, rp.code
    """)).mappings()]


@router.post("/patterns")
def create_pattern(request: Request, body: dict = Body(...),
                   db: Session = Depends(get_minehub_db)) -> dict:
    """Define a cycle.

    The slots are validated against the shift codes the mine actually runs: a
    pattern referring to a D shift that does not exist is a roster that silently
    puts nobody anywhere.
    """
    _require(request, MANAGE, "manage the roster")

    slots = [str(s or "REST").upper().strip() for s in (body.get("slots") or [])]
    if not slots:
        raise HTTPException(400, "A pattern needs at least one day in its cycle.")

    known = {r[0].upper() for r in db.execute(
        text("SELECT code FROM shift_calendar")).all()} | {roster.REST}
    unknown = sorted({s for s in slots if s not in known})
    if unknown:
        raise HTTPException(400, f"This mine has no shift called {', '.join(unknown)}. "
                                 f"Known shifts: {', '.join(sorted(known - {roster.REST}))}.")

    row = db.execute(text("""
        INSERT INTO roster_pattern (code, name, description, cycle_days, slots, created_by)
        VALUES (:c, :n, :d, :days, CAST(:slots AS jsonb), :by)
        RETURNING pattern_id, code, name, cycle_days, slots
    """), {"c": (body.get("code") or "").strip().upper(),
           "n": body.get("name") or body.get("code"),
           "d": body.get("description"), "days": len(slots),
           "slots": json.dumps(slots), "by": _actor(request)}).mappings().first()

    _event(db, request, "ROSTER_PATTERN_CREATED",
           payload={"code": row["code"], "cycle_days": row["cycle_days"], "slots": slots})
    db.commit()
    return dict(row)


@router.patch("/patterns/{pattern_id}")
def update_pattern(pattern_id: int, request: Request, body: dict = Body(...),
                   db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "manage the roster")
    sets, params = [], {"id": pattern_id}
    for field in ("name", "description", "is_active"):
        if field in body:
            sets.append(f"{field} = :{field}")
            params[field] = body[field]
    if "slots" in body:
        slots = [str(s or "REST").upper() for s in body["slots"]]
        sets += ["slots = CAST(:slots AS jsonb)", "cycle_days = :days"]
        params |= {"slots": json.dumps(slots), "days": len(slots)}
    if not sets:
        raise HTTPException(400, "Nothing to change.")
    row = db.execute(text(f"""
        UPDATE roster_pattern SET {', '.join(sets)}, updated_at = now()
        WHERE pattern_id = :id RETURNING *
    """), params).mappings().first()
    if not row:
        raise HTTPException(404, "That pattern no longer exists.")
    db.commit()
    return dict(row)


# ── who is on which pattern ──────────────────────────────────────────────────
@router.post("/assignments")
def assign_roster(request: Request, body: dict = Body(...),
                  db: Session = Depends(get_minehub_db)) -> dict:
    """Put people on a pattern, from a date.

    Takes a list, because rostering happens a crew at a time and doing it one
    person at a time is thirty clicks for something that is one decision.

    An existing open assignment is closed the day before this one starts rather
    than deleted: the roster has to be able to explain last month.
    """
    _require(request, MANAGE, "manage the roster")

    operator_ids = body.get("operator_ids") or ([body["operator_id"]]
                                                if body.get("operator_id") else [])
    if not operator_ids:
        raise HTTPException(400, "Nobody was selected.")
    pattern_id = body.get("pattern_id")
    if not pattern_id:
        raise HTTPException(400, "Choose a pattern.")

    effective_from = _day(body.get("effective_from"))
    anchor = _day(body.get("anchor_date") or body.get("effective_from"))

    db.execute(text("""
        UPDATE roster_assignment SET effective_to = :yesterday
        WHERE operator_id = ANY(:ids) AND effective_to IS NULL
          AND effective_from <= :yesterday
    """), {"ids": operator_ids, "yesterday": effective_from - timedelta(days=1)})

    # An assignment that never took effect is replaced outright rather than
    # closed with a backwards date the constraint would refuse.
    db.execute(text("""
        DELETE FROM roster_assignment
        WHERE operator_id = ANY(:ids) AND effective_to IS NULL
          AND effective_from >= :from
    """), {"ids": operator_ids, "from": effective_from})

    db.execute(text("""
        INSERT INTO roster_assignment (operator_id, pattern_id, anchor_date,
                                       effective_from, plant_id, remarks, created_by)
        SELECT unnest(CAST(:ids AS bigint[])), :p, :anchor, :from, :plant, :r, :by
    """), {"ids": operator_ids, "p": pattern_id, "anchor": anchor,
           "from": effective_from, "plant": body.get("plant_id"),
           "r": body.get("remarks"), "by": _actor(request)})

    _event(db, request, "ROSTER_ASSIGNED",
           payload={"operators": len(operator_ids), "pattern_id": pattern_id,
                    "effective_from": effective_from.isoformat()})
    db.commit()
    return {"ok": True, "assigned": len(operator_ids),
            "effective_from": effective_from.isoformat()}


@router.delete("/assignments/{operator_id}")
def end_roster(operator_id: int, request: Request,
               on: str | None = Query(None),
               db: Session = Depends(get_minehub_db)) -> dict:
    """Take somebody off the roster from a date, without erasing that they were on it."""
    _require(request, MANAGE, "manage the roster")
    until = _day(on)
    db.execute(text("""
        UPDATE roster_assignment SET effective_to = :until
        WHERE operator_id = :o AND effective_to IS NULL
    """), {"o": operator_id, "until": until})
    _event(db, request, "ROSTER_ENDED",
           payload={"operator_id": operator_id, "effective_to": until.isoformat()})
    db.commit()
    return {"ok": True}


# ── the board ────────────────────────────────────────────────────────────────
@router.get("/board")
def roster_board(request: Request,
                 from_date: str | None = Query(None),
                 to_date: str | None = Query(None),
                 plant_id: int | None = Query(None),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """The calendar grid: everybody, every day in the window.

    Capped at ninety-two days. A year-wide grid is not a screen anybody reads,
    and it is a query that makes the tunnel look broken.
    """
    _require(request, VIEW, "see the roster")
    start = _day(from_date)
    end = _day(to_date) if to_date else start + timedelta(days=30)
    if end < start:
        raise HTTPException(400, "The end of the window is before its start.")
    if (end - start).days > 92:
        raise HTTPException(400, "Ask for at most three months at a time.")

    people = [dict(r) for r in db.execute(text("""
        SELECT o.operator_id, o.operator_ref, o.designation, p.display_name,
               o.org_unit_id, ou.name AS department,
               ra.pattern_id, rp.code AS pattern_code, rp.name AS pattern_name
        FROM operator o
        JOIN party p ON p.party_id = o.party_id
        LEFT JOIN org_unit ou ON ou.org_unit_id = o.org_unit_id
        LEFT JOIN roster_assignment ra
               ON ra.operator_id = o.operator_id AND ra.effective_to IS NULL
        LEFT JOIN roster_pattern rp ON rp.pattern_id = ra.pattern_id
        WHERE o.profile_status = 'ACTIVE'
        ORDER BY rp.code NULLS LAST, p.display_name
    """)).mappings()]

    ids = [p["operator_id"] for p in people]
    board = roster.duty(db, start, end, ids, plant_id)
    hols = roster.holidays(db, start, end, plant_id)

    return {
        "from": start.isoformat(), "to": end.isoformat(),
        "people": [{**p, "days": board.get(p["operator_id"], {})} for p in people],
        "holidays": {d.isoformat(): {k: v for k, v in h.items() if k != "holiday_date"}
                     for d, h in hols.items()},
        "shifts": [dict(r) for r in db.execute(text("""
            SELECT code, name, start_time::text, end_time::text
            FROM shift_calendar WHERE valid_to IS NULL OR valid_to >= CURRENT_DATE
            ORDER BY start_time
        """)).mappings()],
    }


@router.get("/coverage")
def day_coverage(request: Request, day: str | None = Query(None),
                 plant_id: int | None = Query(None),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """What one day looks like before anybody turns up."""
    _require(request, VIEW, "see the roster")
    return roster.coverage(db, _day(day), plant_id)


# ── leave ────────────────────────────────────────────────────────────────────
@router.get("/leave-types")
def list_leave_types(request: Request, db: Session = Depends(get_minehub_db)) -> list[dict]:
    _require(request, VIEW, "see the roster")
    return [dict(r) for r in db.execute(text("""
        SELECT lt.*,
               (SELECT count(*) FROM leave_request lr
                 WHERE lr.leave_type_id = lt.leave_type_id
                   AND lr.status = 'APPROVED'
                   AND lr.from_date >= date_trunc('year', CURRENT_DATE)) AS taken_this_year
        FROM leave_type lt ORDER BY lt.is_active DESC, lt.sort_order, lt.name
    """)).mappings()]


@router.post("/leave-types")
def create_leave_type(request: Request, body: dict = Body(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Define a kind of leave.

    Nothing is seeded. What counts as casual leave at Kaliapani is a matter for
    Kaliapani, and a list invented here would be wrong in a way that only shows
    up when somebody is refused a day they were entitled to.
    """
    _require(request, MANAGE, "manage the roster")
    code = (body.get("code") or "").strip().upper()
    if not code:
        raise HTTPException(400, "A leave type needs a short code.")
    row = db.execute(text("""
        INSERT INTO leave_type (code, name, description, is_paid, annual_quota,
                                blocks_deployment, needs_approval, colour,
                                sort_order, created_by)
        VALUES (:c, :n, :d, :paid, :quota, :blocks, :approval, :col, :sort, :by)
        ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name, description = EXCLUDED.description,
            is_paid = EXCLUDED.is_paid, annual_quota = EXCLUDED.annual_quota,
            blocks_deployment = EXCLUDED.blocks_deployment,
            needs_approval = EXCLUDED.needs_approval, colour = EXCLUDED.colour
        RETURNING *
    """), {"c": code, "n": body.get("name") or code, "d": body.get("description"),
           "paid": body.get("is_paid", True), "quota": body.get("annual_quota"),
           "blocks": body.get("blocks_deployment", True),
           "approval": body.get("needs_approval", True),
           "col": body.get("colour"), "sort": body.get("sort_order", 100),
           "by": _actor(request)}).mappings().first()
    db.commit()
    return dict(row)


@router.get("/leave")
def list_leave(request: Request,
               status: str | None = Query(None),
               operator_id: int | None = Query(None),
               from_date: str | None = Query(None),
               to_date: str | None = Query(None),
               db: Session = Depends(get_minehub_db)) -> list[dict]:
    _require(request, VIEW, "see the roster")
    rows = db.execute(text("""
        SELECT lr.*, lt.code AS type_code, lt.name AS type_name, lt.colour,
               lt.is_paid, lt.blocks_deployment,
               p.display_name, o.operator_ref, o.designation
        FROM leave_request lr
        JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
        JOIN operator o    ON o.operator_id = lr.operator_id
        JOIN party p       ON p.party_id = o.party_id
        WHERE (:status IS NULL OR lr.status = :status)
          AND (CAST(:op AS bigint) IS NULL OR lr.operator_id = CAST(:op AS bigint))
          AND (CAST(:from AS date) IS NULL OR lr.to_date   >= CAST(:from AS date))
          AND (CAST(:to   AS date) IS NULL OR lr.from_date <= CAST(:to   AS date))
        ORDER BY CASE lr.status WHEN 'SUBMITTED' THEN 0 ELSE 1 END,
                 lr.from_date DESC
        LIMIT 500
    """), {"status": status, "op": operator_id,
           "from": from_date, "to": to_date}).mappings().all()
    return [dict(r) for r in rows]


def _leave_days(from_date: date, to_date: date,
                half_start: bool, half_end: bool) -> float:
    days = (to_date - from_date).days + 1
    if half_start:
        days -= 0.5
    if half_end and to_date != from_date:
        days -= 0.5
    return max(0.5, days)


@router.post("/leave")
def apply_leave(request: Request, body: dict = Body(...),
                db: Session = Depends(get_minehub_db)) -> dict:
    """Raise a leave request.

    A request that clashes with one already approved is refused here with the
    reference of the clash, rather than being allowed through to fail on a
    database constraint whose message means nothing to a supervisor.
    """
    _require(request, APPLY, "apply for leave")

    operator_id = body.get("operator_id")
    leave_type_id = body.get("leave_type_id")
    if not operator_id or not leave_type_id:
        raise HTTPException(400, "Choose who is going, and what kind of leave.")

    from_date, to_date = _day(body.get("from_date")), _day(body.get("to_date"))
    if to_date < from_date:
        raise HTTPException(400, "The last day of the leave is before the first.")

    clash = db.execute(text("""
        SELECT leave_ref, from_date, to_date FROM leave_request
        WHERE operator_id = :o AND status = 'APPROVED'
          AND daterange(from_date, to_date, '[]') && daterange(:f, :t, '[]')
        LIMIT 1
    """), {"o": operator_id, "f": from_date, "t": to_date}).mappings().first()
    if clash:
        raise HTTPException(409,
            f"They already have approved leave over those dates "
            f"({clash['leave_ref']}, {clash['from_date']:%d %b} to {clash['to_date']:%d %b}).")

    needs = db.execute(text("SELECT needs_approval FROM leave_type WHERE leave_type_id = :t"),
                       {"t": leave_type_id}).scalar()
    status = body.get("status") or ("SUBMITTED" if needs else "APPROVED")

    row = db.execute(text("""
        INSERT INTO leave_request (leave_ref, operator_id, leave_type_id, from_date, to_date,
                                   half_day_start, half_day_end, days, reason, status,
                                   applied_by, applied_at, is_retrospective,
                                   decided_by, decided_at)
        VALUES (next_leave_ref(), :o, :t, :f, :to, :hs, :he, :days, :r, :st,
                :by, now(), :retro,
                CASE WHEN :st = 'APPROVED' THEN :by END,
                CASE WHEN :st = 'APPROVED' THEN now() END)
        RETURNING leave_request_id, leave_ref, status, days
    """), {"o": operator_id, "t": leave_type_id, "f": from_date, "to": to_date,
           "hs": bool(body.get("half_day_start")), "he": bool(body.get("half_day_end")),
           "days": _leave_days(from_date, to_date, bool(body.get("half_day_start")),
                               bool(body.get("half_day_end"))),
           "r": body.get("reason"), "st": status, "by": _actor(request),
           "retro": to_date < date.today()}).mappings().first()

    _event(db, request, "LEAVE_APPLIED",
           payload={"leave_ref": row["leave_ref"], "operator_id": operator_id,
                    "from": from_date.isoformat(), "to": to_date.isoformat(),
                    "status": row["status"]})
    db.commit()
    return dict(row)


@router.post("/leave/{leave_request_id}/decide")
def decide_leave(leave_request_id: int, request: Request, body: dict = Body(...),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Approve, reject or cancel.

    Approving somebody who is on a machine right now does not quietly release
    them — it says so, and leaves the release to a human, because pulling an
    operator off a running excavator from a leave screen is not a decision this
    should be making on its own.
    """
    _require(request, APPROVE, "approve leave")

    decision = (body.get("status") or "").upper()
    if decision not in ("APPROVED", "REJECTED", "CANCELLED"):
        raise HTTPException(400, "A decision is approve, reject or cancel.")

    row = db.execute(text("""
        UPDATE leave_request
           SET status = :st, decided_by = :by, decided_at = now(),
               decision_note = :note, updated_at = now()
         WHERE leave_request_id = :id
        RETURNING leave_request_id, leave_ref, operator_id, status, from_date, to_date
    """), {"st": decision, "by": _actor(request),
           "note": body.get("note"), "id": leave_request_id}).mappings().first()
    if not row:
        raise HTTPException(404, "That leave request no longer exists.")

    warning = None
    if decision == "APPROVED" and row["from_date"] <= date.today() <= row["to_date"]:
        live = db.execute(text("""
            SELECT d.deployment_ref, a.fleet_code FROM deployment d
            JOIN asset a ON a.asset_id = d.asset_id
            WHERE d.operator_id = :o AND d.status IN ('READY', 'RUNNING', 'PAUSED')
            LIMIT 1
        """), {"o": row["operator_id"]}).mappings().first()
        if live:
            warning = (f"They are on {live['fleet_code']} right now "
                       f"({live['deployment_ref']}). Release them on the shift board "
                       f"— this has not done it for you.")

    _event(db, request, f"LEAVE_{decision}", payload={"leave_ref": row["leave_ref"]})
    db.commit()
    return {**dict(row), "warning": warning}


# ── the calendar ─────────────────────────────────────────────────────────────
@router.get("/holidays")
def list_holidays(request: Request, year: int | None = Query(None),
                  db: Session = Depends(get_minehub_db)) -> list[dict]:
    _require(request, VIEW, "see the roster")
    return [dict(r) for r in db.execute(text("""
        SELECT h.*, pl.name AS plant_name
        FROM holiday h LEFT JOIN plant pl ON pl.plant_id = h.plant_id
        WHERE EXTRACT(YEAR FROM h.holiday_date) = COALESCE(CAST(:yr AS int),
                                                           EXTRACT(YEAR FROM CURRENT_DATE))
        ORDER BY h.holiday_date
    """), {"yr": year}).mappings()]


@router.post("/holidays")
def add_holiday(request: Request, body: dict = Body(...),
                db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "manage the roster")
    entries = body.get("holidays") or [body]
    saved = []
    for entry in entries:
        if not entry.get("holiday_date") or not entry.get("name"):
            continue
        row = db.execute(text("""
            INSERT INTO holiday (holiday_date, name, plant_id, kind, stops_work,
                                 remarks, created_by)
            VALUES (CAST(:d AS date), :n, :p, :k, :stops, :r, :by)
            ON CONFLICT (holiday_date, plant_id) DO UPDATE SET
                name = EXCLUDED.name, kind = EXCLUDED.kind,
                stops_work = EXCLUDED.stops_work, remarks = EXCLUDED.remarks
            RETURNING *
        """), {"d": entry["holiday_date"], "n": entry["name"],
               "p": entry.get("plant_id"), "k": entry.get("kind", "PUBLIC"),
               "stops": entry.get("stops_work", True), "r": entry.get("remarks"),
               "by": _actor(request)}).mappings().first()
        saved.append(dict(row))
    _event(db, request, "HOLIDAY_SET", payload={"count": len(saved)})
    db.commit()
    return {"ok": True, "saved": len(saved), "holidays": saved}


@router.delete("/holidays/{holiday_id}")
def remove_holiday(holiday_id: int, request: Request,
                   db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "manage the roster")
    db.execute(text("DELETE FROM holiday WHERE holiday_id = :id"), {"id": holiday_id})
    db.commit()
    return {"ok": True}


# ── the allocation engine ────────────────────────────────────────────────────
@router.get("/allocate/{shift_instance_id}")
def propose_allocation(shift_instance_id: int, request: Request,
                       db: Session = Depends(get_minehub_db)) -> dict:
    """What the engine would do with this shift, and why.

    A read. Nothing is written, nothing is reserved, and asking twice gives the
    same answer unless something underneath has changed.
    """
    _require(request, VIEW, "see the roster")
    result = deployer.propose(db, shift_instance_id)
    if not result.get("found"):
        raise HTTPException(404, "That shift no longer exists.")
    return result


@router.post("/allocate/{shift_instance_id}")
def accept_allocation(shift_instance_id: int, request: Request, body: dict = Body(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Turn accepted proposals into deployments.

    Each line goes through the same readiness check as a hand-made deployment,
    against the state at this moment rather than the state when the proposal was
    generated — a page open since six o'clock is not evidence about half past
    seven. Anything that has since become blocked is reported back, unwritten.
    """
    _require(request, DEPLOY, "deploy machines")

    pairs = body.get("pairs") or []
    if not pairs:
        raise HTTPException(400, "Nothing was accepted.")

    deployed, refused = [], []
    for pair in pairs:
        asset_id, operator_id = pair.get("asset_id"), pair.get("operator_id")
        if not asset_id or not operator_id:
            continue

        check = readiness.deployment_readiness(db, asset_id, operator_id, shift_instance_id)
        if check.status == "BLOCKED":
            refused.append({"asset_id": asset_id, "operator_id": operator_id,
                            "blockers": check.blockers})
            continue

        row = db.execute(text("""
            INSERT INTO deployment (deployment_ref, shift_instance_id, asset_id, operator_id,
                                    status, readiness_at_start, created_by)
            VALUES (next_deployment_ref(), :s, :a, :o, 'READY',
                    CAST(:check AS jsonb), :by)
            RETURNING deployment_id, deployment_ref
        """), {"s": shift_instance_id, "a": asset_id, "o": operator_id,
               "check": json.dumps({"status": check.status, "blockers": check.blockers,
                                    "warnings": check.warnings,
                                    "source": "ALLOCATION_ENGINE"}, default=str),
               "by": _actor(request)}).mappings().first()

        deployed.append({"asset_id": asset_id, "operator_id": operator_id,
                         "deployment_ref": row["deployment_ref"],
                         "warnings": check.warnings})

    _event(db, request, "ALLOCATION_ACCEPTED",
           payload={"shift_instance_id": shift_instance_id,
                    "deployed": len(deployed), "refused": len(refused),
                    "engine": True})
    db.commit()
    return {"ok": True, "deployed": deployed, "refused": refused,
            "message": (f"{len(deployed)} deployed"
                        + (f", {len(refused)} refused because something changed"
                           if refused else "."))}
