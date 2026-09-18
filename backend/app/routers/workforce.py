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
from datetime import date, datetime, timedelta

from fastapi import (APIRouter, Body, Depends, File, HTTPException, Query,
                     Request, UploadFile)
from fastapi.responses import StreamingResponse
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


@router.get("/patterns/suggestions")
def pattern_suggestions(request: Request,
                        db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Cycles this mine could adopt, built from its own shift calendar."""
    _require(request, VIEW, "see the roster")
    return roster.suggested_patterns(db)


@router.post("/patterns/adopt")
def adopt_patterns(request: Request, body: dict = Body(...),
                   db: Session = Depends(get_minehub_db)) -> dict:
    """Create the suggested patterns somebody picked.

    Only ever creates what was named. A suggestion already on file is left
    exactly as it is, because somebody may well have edited it since — an
    adopt that quietly overwrote a mine's own changes would be the last time
    anybody used this button.
    """
    _require(request, MANAGE, "manage the roster")
    wanted = {str(c).upper() for c in (body.get("codes") or [])}
    if not wanted:
        raise HTTPException(400, "Nothing was chosen.")

    created, skipped = [], []
    for suggestion in roster.suggested_patterns(db):
        if suggestion["code"].upper() not in wanted:
            continue
        if suggestion["exists"]:
            skipped.append(suggestion["code"])
            continue
        db.execute(text("""
            INSERT INTO roster_pattern (code, name, description, cycle_days, slots, created_by)
            VALUES (:c, :n, :d, :days, CAST(:slots AS jsonb), :by)
            ON CONFLICT (code) DO NOTHING
        """), {"c": suggestion["code"], "n": suggestion["name"],
               "d": suggestion["description"], "days": suggestion["cycle_days"],
               "slots": json.dumps(suggestion["slots"]), "by": _actor(request)})
        created.append(suggestion["code"])

    _event(db, request, "ROSTER_PATTERNS_ADOPTED",
           payload={"created": created, "already_there": skipped})
    db.commit()
    return {"ok": True, "created": created, "already_there": skipped,
            "message": (f"{len(created)} pattern(s) created."
                        + (f" {len(skipped)} were already defined and were left alone."
                           if skipped else ""))}


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


@router.get("/people")
def list_people(request: Request, db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Everybody the roster can place, and where they currently sit.

    Its own endpoint rather than the operator register's, because rostering
    somebody does not require the right to read their medical record — and
    borrowing the register's list would have quietly made it require that.
    """
    _require(request, VIEW, "see the roster")
    return [dict(r) for r in db.execute(text("""
        SELECT o.operator_id, o.operator_ref, o.designation, p.display_name,
               rp.code AS pattern_code, rp.name AS pattern_name,
               ra.effective_from
        FROM operator o
        JOIN party p ON p.party_id = o.party_id
        LEFT JOIN roster_assignment ra
               ON ra.operator_id = o.operator_id AND ra.effective_to IS NULL
        LEFT JOIN roster_pattern rp ON rp.pattern_id = ra.pattern_id
        WHERE o.profile_status = 'ACTIVE'
        ORDER BY p.display_name
    """)).mappings()]


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
        WHERE (CAST(:status AS text) IS NULL OR lr.status = CAST(:status AS text))
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


# -- the schedule, as a spreadsheet -------------------------------------------
# The mine keeps its roster in Excel today, and will keep a copy there for a
# long time after this. Refusing to read or write that file would not stop the
# spreadsheet existing -- it would only mean the two drift apart, which is
# worse than either alone.

# A day with no pattern behind it reads as a dash rather than a blank, so the
# spreadsheet cannot be mistaken for one where somebody simply forgot to fill
# a column in.
EXPORT_STATE = {"REST": "REST", "LEAVE": "LEAVE", "HOLIDAY": "HOL"}
EXPORT_UNKNOWN = "-"


@router.get("/export")
def export_roster(request: Request,
                  from_date: str | None = Query(None),
                  to_date: str | None = Query(None),
                  plant_id: int | None = Query(None),
                  db: Session = Depends(get_minehub_db)):
    """The roster as a workbook: the grid to read, the assignments to edit.

    Two sheets on purpose. The grid is what people want to look at and print,
    one column per day with the shift letter in the cell. The assignments sheet
    is the one that can be changed and brought back -- five columns, because a
    roster is edited by saying who is on which pattern from when, not by
    colouring in three hundred squares.
    """
    _require(request, VIEW, "see the roster")
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    start = _day(from_date)
    end = _day(to_date) if to_date else start + timedelta(days=30)
    if (end - start).days > 366:
        raise HTTPException(400, "Ask for at most a year at a time.")

    people = [dict(r) for r in db.execute(text("""
        SELECT o.operator_id, o.operator_ref, p.display_name, o.designation,
               rp.code AS pattern_code, ra.anchor_date, ra.effective_from
        FROM operator o
        JOIN party p ON p.party_id = o.party_id
        LEFT JOIN roster_assignment ra
               ON ra.operator_id = o.operator_id AND ra.effective_to IS NULL
        LEFT JOIN roster_pattern rp ON rp.pattern_id = ra.pattern_id
        WHERE o.profile_status = 'ACTIVE'
        ORDER BY rp.code NULLS LAST, p.display_name
    """)).mappings()]

    ids = [p["operator_id"] for p in people]
    board = roster.duty(db, start, end, ids, plant_id)
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]

    wb = Workbook()
    head = Font(bold=True, color="FFFFFF", size=10)
    navy = PatternFill("solid", fgColor="16233C")
    grey = PatternFill("solid", fgColor="EEF1F5")
    amber = PatternFill("solid", fgColor="FDF1DC")
    violet = PatternFill("solid", fgColor="EFE9FA")
    centre = Alignment(horizontal="center", vertical="center")
    edge = Side(style="thin", color="D8DEE8")
    thin = Border(left=edge, right=edge, top=edge, bottom=edge)

    grid = wb.active
    grid.title = "Roster"
    grid.append(["Operator", "Reference", "Role", "Pattern"]
                + [d.strftime("%d %b") for d in days])
    grid.append(["", "", "", ""] + [d.strftime("%a") for d in days])

    for row in (1, 2):
        for cell in grid[row]:
            cell.font = head
            cell.fill = navy
            cell.alignment = centre
            cell.border = thin

    for person in people:
        cells = []
        for d in days:
            cell = (board.get(person["operator_id"]) or {}).get(d.isoformat()) or {}
            state = cell.get("state")
            cells.append(cell.get("shift") if state == "ON"
                         else EXPORT_STATE.get(state or "", EXPORT_UNKNOWN))
        grid.append([person["display_name"], person["operator_ref"] or "",
                     person["designation"] or "",
                     person["pattern_code"] or "NOT ROSTERED"] + cells)

    for r in range(3, 3 + len(people)):
        for c in range(5, 5 + len(days)):
            cell = grid.cell(row=r, column=c)
            cell.alignment = centre
            cell.border = thin
            if cell.value == "REST":
                cell.fill = grey
            elif cell.value == "LEAVE":
                cell.fill = amber
            elif cell.value == "HOL":
                cell.fill = violet

    for col, width in zip("ABCD", (26, 15, 20, 14)):
        grid.column_dimensions[col].width = width
    for i in range(len(days)):
        grid.column_dimensions[get_column_letter(5 + i)].width = 6
    grid.freeze_panes = "E3"

    # Sheet two: the editable one.
    edit = wb.create_sheet("Assignments")
    edit.append(["Operator reference", "Name", "Pattern code",
                 "Effective from", "Anchor date"])
    for cell in edit[1]:
        cell.font = head
        cell.fill = navy
    for person in people:
        edit.append([person["operator_ref"] or "", person["display_name"],
                     person["pattern_code"] or "",
                     person["effective_from"], person["anchor_date"]])
    for col, width in zip("ABCDE", (22, 26, 18, 16, 16)):
        edit.column_dimensions[col].width = width
    edit.freeze_panes = "A2"

    # Sheet three: what the codes mean, so the file explains itself once it is
    # away from the application that made it.
    key = wb.create_sheet("Key")
    key.append(["This file", ""])
    key.append(["Roster", "One column per day. A letter is the shift worked."])
    key.append(["Assignments", "The editable sheet. Change the pattern code or "
                               "the dates and import this file back."])
    key.append(["", "Rows are matched on the operator reference, never the name."])
    key.append([])
    key.append(["Patterns defined", ""])
    for r in db.execute(text(
            "SELECT code, name, cycle_days FROM roster_pattern WHERE is_active "
            "ORDER BY code")).mappings():
        key.append([r["code"], f"{r['name']} - {r['cycle_days']}-day cycle"])
    key.append([])
    key.append(["Shifts this mine runs", ""])
    for r in db.execute(text(
            "SELECT code, name, start_time, end_time FROM shift_calendar "
            "WHERE valid_to IS NULL OR valid_to >= CURRENT_DATE "
            "ORDER BY start_time")).mappings():
        key.append([r["code"], f"{r['name']} - {r['start_time']} to {r['end_time']}"])
    key.column_dimensions["A"].width = 22
    key.column_dimensions["B"].width = 64
    for cell in key["A"]:
        cell.font = Font(bold=True, size=10)

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    name = f"Kaliapani-roster-{start:%Y%m%d}-{end:%Y%m%d}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


def _as_date(value, fallback):
    """A date out of a spreadsheet cell, which could be anything."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value in (None, ""):
        return fallback
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return fallback


@router.post("/import")
async def import_roster(request: Request, file: UploadFile = File(...),
                        dry_run: bool = Query(True),
                        db: Session = Depends(get_minehub_db)) -> dict:
    """Read an Assignments sheet back in.

    A dry run by default, and the screen shows what would change before
    anything does. An import that writes first and reports afterwards is one
    nobody dares use on a file they are not certain about -- and nobody is ever
    certain about a spreadsheet that has been round the office.

    Rows are matched on the operator reference, never on the name. Two people
    called Sahoo is not a hypothetical at a mine this size, and a name match
    would put one of them on the other's roster.
    """
    _require(request, MANAGE, "manage the roster")
    from io import BytesIO

    from openpyxl import load_workbook

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "That file is larger than 10 MB.")
    try:
        wb = load_workbook(BytesIO(raw), data_only=True)
    except Exception:                                  # noqa: BLE001
        raise HTTPException(400, "That does not open as an Excel workbook.")

    sheet = wb["Assignments"] if "Assignments" in wb.sheetnames else wb.active

    people = {}
    for r in db.execute(text("""
        SELECT o.operator_id, o.operator_ref, p.display_name
        FROM operator o JOIN party p ON p.party_id = o.party_id
        WHERE o.profile_status = 'ACTIVE' AND o.operator_ref IS NOT NULL
    """)).mappings():
        people[r["operator_ref"].strip().upper()] = dict(r)

    patterns = {r["code"].upper(): r["pattern_id"] for r in db.execute(text(
        "SELECT pattern_id, code FROM roster_pattern WHERE is_active")).mappings()}

    current = {r["operator_id"]: dict(r) for r in db.execute(text("""
        SELECT ra.operator_id, rp.code AS pattern_code, ra.effective_from, ra.anchor_date
        FROM roster_assignment ra
        JOIN roster_pattern rp ON rp.pattern_id = ra.pattern_id
        WHERE ra.effective_to IS NULL
    """)).mappings()}

    today = date.today()
    changes, problems, unchanged = [], [], 0

    for line, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        if not row or not any(row):
            continue
        ref = str(row[0] or "").strip().upper()
        pattern_code = str(row[2] or "").strip().upper() if len(row) > 2 else ""
        if not ref:
            continue

        person = people.get(ref)
        if not person:
            problems.append({"row": line, "ref": ref,
                             "why": "No active operator has that reference"})
            continue
        if not pattern_code:
            continue                        # left blank on purpose: leave them alone
        if pattern_code not in patterns:
            problems.append({"row": line, "ref": ref,
                             "why": f"There is no active pattern called {pattern_code}"})
            continue

        effective_from = _as_date(row[3] if len(row) > 3 else None, today)
        anchor = _as_date(row[4] if len(row) > 4 else None, effective_from)

        was = current.get(person["operator_id"])
        if (was and was["pattern_code"].upper() == pattern_code
                and was["effective_from"] == effective_from
                and was["anchor_date"] == anchor):
            unchanged += 1
            continue

        changes.append({
            "row": line, "operator_id": person["operator_id"], "ref": ref,
            "display_name": person["display_name"],
            "from_pattern": was["pattern_code"] if was else None,
            "to_pattern": pattern_code,
            "effective_from": effective_from.isoformat(),
            "anchor_date": anchor.isoformat(),
        })

    if not dry_run and changes:
        for change in changes:
            operator_id = change["operator_id"]
            effective_from = date.fromisoformat(change["effective_from"])
            db.execute(text("""
                UPDATE roster_assignment SET effective_to = :yesterday
                WHERE operator_id = :o AND effective_to IS NULL
                  AND effective_from <= :yesterday
            """), {"o": operator_id, "yesterday": effective_from - timedelta(days=1)})
            db.execute(text("""
                DELETE FROM roster_assignment
                WHERE operator_id = :o AND effective_to IS NULL
                  AND effective_from >= :from
            """), {"o": operator_id, "from": effective_from})
            db.execute(text("""
                INSERT INTO roster_assignment (operator_id, pattern_id, anchor_date,
                                               effective_from, remarks, created_by)
                VALUES (:o, :p, :anchor, :from, :note, :by)
            """), {"o": operator_id, "p": patterns[change["to_pattern"]],
                   "anchor": date.fromisoformat(change["anchor_date"]),
                   "from": effective_from,
                   "note": f"Imported from {file.filename}", "by": _actor(request)})

        _event(db, request, "ROSTER_IMPORTED",
               payload={"file": file.filename, "applied": len(changes),
                        "rejected": len(problems)})
        db.commit()

    return {
        "dry_run": dry_run, "file": file.filename, "sheet": sheet.title,
        "changes": changes, "problems": problems, "unchanged": unchanged,
        "summary": {"would_change" if dry_run else "changed": len(changes),
                    "rejected": len(problems), "already_right": unchanged},
    }


# -- one person's working life ------------------------------------------------
@router.get("/operators/{operator_id}/worklife")
def worklife(operator_id: int, request: Request,
             days: int = Query(90, ge=7, le=366),
             db: Session = Depends(get_minehub_db)) -> dict:
    """What this person has actually been doing, and what is planned for them.

    The operator register answers who somebody is — their licence, their
    assessments, their qualifications. This answers the other half: the shifts
    they worked, the machines they ran, the leave they took and the roster ahead
    of them. Kept apart deliberately, because rostering somebody should not
    require the right to read their medical record.
    """
    _require(request, VIEW, "see the roster")
    today = date.today()
    since = today - timedelta(days=days)

    person = db.execute(text("""
        SELECT o.operator_id, o.operator_ref, o.designation, o.approval_status,
               o.profile_status, o.joined_on, p.display_name, p.phone,
               pl.name AS plant, ou.name AS department
        FROM operator o
        JOIN party p ON p.party_id = o.party_id
        LEFT JOIN plant pl ON pl.plant_id = o.plant_id
        LEFT JOIN org_unit ou ON ou.org_unit_id = o.org_unit_id
        WHERE o.operator_id = :id
    """), {"id": operator_id}).mappings().first()
    if not person:
        raise HTTPException(404, "That operator is not on the register.")

    # The roster, a fortnight back and a fortnight forward: enough to see the
    # pattern they are on without asking for a year of it.
    board = roster.duty(db, today - timedelta(days=14), today + timedelta(days=14),
                        [operator_id])
    ahead = board.get(operator_id, {})

    history = [dict(r) for r in db.execute(text("""
        SELECT d.deployment_id, d.deployment_ref, d.status, d.started_at, d.ended_at,
               d.start_reading, d.end_reading, d.activity,
               a.fleet_code, a.asset_ref, t.name AS asset_type,
               si.production_day, sc.code AS shift_code
        FROM deployment d
        JOIN asset a ON a.asset_id = d.asset_id
        LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        LEFT JOIN shift_instance si ON si.shift_instance_id = d.shift_instance_id
        LEFT JOIN shift_calendar sc ON sc.shift_id = si.shift_id
        WHERE d.operator_id = :id AND COALESCE(si.production_day, d.started_at::date) >= :since
        ORDER BY COALESCE(si.production_day, d.started_at::date) DESC, d.started_at DESC
        LIMIT 200
    """), {"id": operator_id, "since": since}).mappings()]

    leave = [dict(r) for r in db.execute(text("""
        SELECT lr.leave_request_id, lr.leave_ref, lr.from_date, lr.to_date, lr.days,
               lr.status, lr.reason, lt.name AS type_name, lt.code AS type_code,
               lt.is_paid, lt.annual_quota
        FROM leave_request lr
        JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
        WHERE lr.operator_id = :id
          AND lr.from_date >= date_trunc('year', CURRENT_DATE)
        ORDER BY lr.from_date DESC
    """), {"id": operator_id}).mappings()]

    # How many days of each kind have been used this year, against the quota the
    # mine set — a balance for planning, never a payroll figure. SAP owns that.
    used: dict[str, dict] = {}
    for row in leave:
        if row["status"] != "APPROVED":
            continue
        bucket = used.setdefault(row["type_code"], {
            "name": row["type_name"], "quota": float(row["annual_quota"] or 0) or None,
            "taken": 0.0})
        bucket["taken"] += float(row["days"] or 0)

    # What they can run, so the dashboard can say what to deploy them on without
    # a second call to the register.
    classes = [dict(r) for r in db.execute(text("""
        SELECT c.asset_type_id, c.level, c.rating, c.valid_upto, c.next_assessment_due,
               t.name AS asset_type,
               (SELECT count(*) FROM asset a
                 WHERE a.asset_type_id = c.asset_type_id
                   AND COALESCE(a.status, 'ACTIVE') NOT IN ('DISPOSED', 'INACTIVE')) AS machines
        FROM operator_competency c
        JOIN asset_type t ON t.asset_type_id = c.asset_type_id
        WHERE c.operator_id = :id AND c.dimension = 'OVERALL'
          AND c.asset_id IS NULL AND c.status = 'ACTIVE'
        ORDER BY c.level DESC NULLS LAST, t.name
    """), {"id": operator_id}).mappings()]

    live = db.execute(text("""
        SELECT d.deployment_ref, d.status, d.started_at, a.fleet_code, t.name AS asset_type
        FROM deployment d
        JOIN asset a ON a.asset_id = d.asset_id
        LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        WHERE d.operator_id = :id AND d.status IN ('READY', 'RUNNING', 'PAUSED')
        ORDER BY d.started_at DESC LIMIT 1
    """), {"id": operator_id}).mappings().first()

    # Which machines they have actually spent time on, which is the question an
    # appraisal asks and a list of deployments does not answer.
    on_machines: dict[str, dict] = {}
    for row in history:
        code = row["fleet_code"]
        seen = on_machines.setdefault(code, {"fleet_code": code,
                                             "asset_type": row["asset_type"],
                                             "shifts": 0, "last": None})
        seen["shifts"] += 1
        day = row["production_day"] or (row["started_at"].date() if row["started_at"] else None)
        if day and (seen["last"] is None or day > seen["last"]):
            seen["last"] = day

    return {
        "operator": dict(person),
        "roster": ahead,
        "today": ahead.get(today.isoformat()),
        "on_machine_now": dict(live) if live else None,
        "classes": classes,
        "deployments": history,
        "machines": sorted(on_machines.values(), key=lambda m: -m["shifts"]),
        "leave": leave,
        "leave_used": used,
        "window_days": days,
        "summary": {
            "shifts_worked": len({r["production_day"] for r in history if r["production_day"]}),
            "machines_run": len(on_machines),
            "classes_competent": len([c for c in classes if (c["level"] or 0) >= 2]),
            "leave_days_this_year": round(sum(b["taken"] for b in used.values()), 1),
            "leave_waiting": len([r for r in leave if r["status"] == "SUBMITTED"]),
        },
    }


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
