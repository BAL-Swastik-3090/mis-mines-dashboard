"""Correcting the gate record, without touching the gate record.

The readers are right about what they saw and silent about everything else. A
worker who came through an unmanned gate, or whose punch failed because the
reader was down, leaves a gap that nobody can currently do anything about.

NOTHING HERE WRITES TO SMARTFACE. That database belongs to the HR application
and other people rely on it; a second system correcting it would make "what
does attendance say" a question with two answers. A correction sits beside the
punch data, so both can always be seen: what the reader recorded, and what
somebody claimed about it.

TWO PEOPLE, NEVER ONE. Raising and approving are separate rights held by
separate people, as leave already works here. A supervisor who could approve
their own corrections could write attendance, and attendance feeds a
contractor's bill. The rule is in the table as a CHECK as well as here,
because an endpoint can be bypassed.
"""
from __future__ import annotations

import json
from datetime import date, datetime, time

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import attendance as frs
from app.services import people

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])

CORRECT = "ops.attendance.correct"
APPROVE = "ops.attendance.approve"

KINDS = {
    "CLOCK_IN":     "a punch in the reader did not take",
    "CLOCK_OUT":    "a punch out the reader did not take",
    "MARK_PRESENT": "present, time unknown",
    "MARK_ABSENT":  "confirmed absent",
    "NOTE":         "an explanation, with no claim attached",
}
NEEDS_TIME = ("CLOCK_IN", "CLOCK_OUT")


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _held(request: Request) -> set:
    return getattr(request.state, "permissions", None) or set()


def _require(request: Request, code: str, what: str) -> None:
    if code not in _held(request):
        raise HTTPException(
            403, f"You do not have permission to {what}. "
                 f"An Access Manager grants {code}.")


def _scope(db: Session, request: Request) -> tuple[int | None, str | None]:
    """The department this person's grants cover, and its name.

    Null means every department, which is what every grant made before the
    scope existed means. The narrowest scope wins where somebody holds more
    than one grant: a right granted narrowly is not widened by a second grant.
    """
    rows = db.execute(text(
        "SELECT u.scope_org_unit_id, ou.name FROM user_access u "
        "LEFT JOIN org_unit ou ON ou.org_unit_id = u.scope_org_unit_id "
        "WHERE u.emp_id = :e"), {"e": _actor(request)}).mappings().all()
    if not rows or any(r["scope_org_unit_id"] is None for r in rows):
        return None, None
    return rows[0]["scope_org_unit_id"], rows[0]["name"]


def _log(db: Session, request: Request, event: str, payload: dict) -> None:
    """Into the same append-only log as every other operational fact, so an
    auditor reads one trail rather than hunting for a second."""
    db.execute(text("""
        INSERT INTO event (event_type, occurred_at, recorded_at, source, payload, recorded_by)
        VALUES (:t, now(), now(), 'WEB', CAST(:p AS jsonb), :by)
    """), {"t": event, "p": json.dumps(payload), "by": _actor(request)})


@router.get("/who")
def who(request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    """What this person may do here, and where.

    Asked by the screen before it draws the form, so the department filter can
    be locked rather than offered and then refused on submit.
    """
    held = _held(request)
    org, name = _scope(db, request)
    return {
        "may_raise": CORRECT in held,
        "may_decide": APPROVE in held,
        "may_edit_reasons": APPROVE in held,
        "scope_org_unit_id": org,
        "scope_department": name,
    }


@router.get("/workers")
def workers(request: Request,
            q: str = Query(""),
            org_unit_id: int | None = Query(None),
            employer_party_id: int | None = Query(None),
            trade: str = Query(""),
            db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Who a correction can be raised for, narrowed the way the form narrows.

    Scoped at the source rather than filtered in the browser: a list that
    offers somebody you are not allowed to correct is a list that wastes a
    supervisor's time and then refuses them.
    """
    scope, _ = _scope(db, request)
    rows = db.execute(text("""
        SELECT DISTINCT ON (o.operator_id)
               o.operator_id, o.operator_ref, p.display_name AS name,
               i.external_code AS emp_no, t.name AS trade, t.trade_group,
               e.display_name AS employer, e.party_id AS employer_party_id,
               ou.name AS department, ou.org_unit_id
          FROM operator o
          JOIN party p          ON p.party_id = o.party_id
          JOIN party_identity i ON i.party_id = o.party_id AND i.system = 'CONTRACTOR'
          LEFT JOIN trade t     ON t.trade_id = o.trade_id
          LEFT JOIN party e     ON e.party_id = o.employer_party_id
          LEFT JOIN org_unit ou ON ou.org_unit_id = o.org_unit_id
         WHERE o.profile_status = 'ACTIVE'
           AND (CAST(:scope AS bigint) IS NULL OR o.org_unit_id = CAST(:scope AS bigint))
           AND (CAST(:org AS bigint) IS NULL OR o.org_unit_id = CAST(:org AS bigint))
           AND (CAST(:emp AS bigint) IS NULL OR o.employer_party_id = CAST(:emp AS bigint))
           AND (CAST(:trade AS text) IS NULL OR t.name = CAST(:trade AS text))
           AND (CAST(:q AS text) IS NULL
                OR p.display_name ILIKE '%' || CAST(:q AS text) || '%'
                OR i.external_code ILIKE '%' || CAST(:q AS text) || '%'
                OR t.name ILIKE '%' || CAST(:q AS text) || '%')
         ORDER BY o.operator_id, p.display_name
    """), {"scope": scope, "org": org_unit_id, "emp": employer_party_id,
           "trade": trade or None, "q": q.strip() or None}).mappings().all()
    return sorted([dict(r) for r in rows], key=lambda r: r["name"])


@router.get("/shifts")
def shifts(db: Session = Depends(get_minehub_db)) -> list[dict]:
    """The shifts a manual punch can be taken from.

    A supervisor correcting a whole shift's worth of missed punches should pick
    the shift, not type 06:00 and 14:00 forty times and get one of them wrong.
    """
    rows = db.execute(text("""
        SELECT shift_id, code, name, start_time, end_time, crosses_midnight, planned_hours
          FROM shift_calendar WHERE valid_from <= CURRENT_DATE ORDER BY start_time
    """)).mappings().all()
    return [{**dict(r),
             "start_time": r["start_time"].strftime("%H:%M"),
             "end_time": r["end_time"].strftime("%H:%M"),
             "planned_hours": float(r["planned_hours"]) if r["planned_hours"] else None}
            for r in rows]


@router.get("/corrections")
def list_corrections(
    status: str = Query("", description="PENDING, APPROVED, REJECTED, WITHDRAWN"),
    day_from: str | None = Query(None),
    day_to: str | None = Query(None),
    db: Session = Depends(get_minehub_db),
    corp: Session = Depends(get_db),
) -> list[dict]:
    """The corrections themselves — the queue, and everything decided."""
    rows = db.execute(text("""
        SELECT c.correction_id, c.emp_no, c.on_date, c.kind, c.at_time,
               c.reason_code, c.remarks, c.status,
               c.requested_by, c.requested_at,
               c.decided_by, c.decided_at, c.decision_note,
               p.display_name AS name, o.operator_ref,
               t.name AS trade, e.display_name AS employer, ou.name AS department,
               r.label AS reason
          FROM attendance_correction c
          JOIN party p          ON p.party_id = c.party_id
          LEFT JOIN operator o  ON o.party_id = c.party_id
          LEFT JOIN trade t     ON t.trade_id = o.trade_id
          LEFT JOIN party e     ON e.party_id = o.employer_party_id
          LEFT JOIN org_unit ou ON ou.org_unit_id = o.org_unit_id
          LEFT JOIN checklist_item r
                 ON r.kind = 'ATTENDANCE_REASON' AND r.code = c.reason_code
         WHERE (CAST(:st AS text) IS NULL OR c.status = CAST(:st AS text))
           AND (CAST(:frm AS date) IS NULL OR c.on_date >= CAST(:frm AS date))
           AND (CAST(:to AS date) IS NULL OR c.on_date <= CAST(:to AS date))
         ORDER BY (c.status = 'PENDING') DESC, c.on_date DESC, c.correction_id DESC
    """), {"st": status or None, "frm": day_from, "to": day_to}).mappings().all()

    # The trail is written in employee numbers because those are stable; it is
    # read in names because nobody recognises a number.
    ids = [r["requested_by"] for r in rows] + [r["decided_by"] for r in rows]
    names = people.names_for(corp, [i for i in ids if i])
    return [{
        **dict(r),
        "on_date": r["on_date"].isoformat(),
        "at_time": r["at_time"].strftime("%H:%M") if r["at_time"] else None,
        "requested_at": r["requested_at"].isoformat() if r["requested_at"] else None,
        "decided_at": r["decided_at"].isoformat() if r["decided_at"] else None,
        "requested_by_name": names.get(r["requested_by"]),
        "decided_by_name": names.get(r["decided_by"]),
    } for r in rows]


@router.post("/corrections")
def raise_correction(request: Request, body: dict = Body(...),
                     db: Session = Depends(get_minehub_db)) -> dict:
    """Record what happened where the readers are silent. It goes to somebody
    else to approve; raising one asserts nothing on its own."""
    _require(request, CORRECT, "raise an attendance correction")

    emp_no = str(body.get("emp_no") or "").strip()
    kind = str(body.get("kind") or "").upper()
    reason = str(body.get("reason_code") or "").strip()
    remarks = (body.get("remarks") or "").strip() or None

    if kind not in KINDS:
        raise HTTPException(400, f"Kind must be one of {', '.join(KINDS)}.")
    if not reason:
        raise HTTPException(
            400, "Choose a reason. A correction without one cannot be "
                 "explained six months from now, which is when it is asked about.")
    if not remarks:
        raise HTTPException(
            400, "Say what happened. The reason puts this in one of eight boxes; "
                 "the remark is what somebody reads when they ask about it later.")

    try:
        on = date.fromisoformat(str(body.get("on_date"))[:10])
    except (TypeError, ValueError):
        raise HTTPException(400, "The date is yyyy-mm-dd.")
    if on > date.today():
        raise HTTPException(400, "A correction cannot be dated in the future.")

    at = None
    if kind in NEEDS_TIME:
        raw = str(body.get("at_time") or "").strip()
        try:
            at = time.fromisoformat(raw if len(raw) > 5 else f"{raw}:00")
        except ValueError:
            raise HTTPException(
                400, f"Give the time this happened — {KINDS[kind]} needs one.")
        if on == date.today() and at > datetime.now().time():
            raise HTTPException(400, "That time has not happened yet today.")

    # The reason has to be one the mine currently offers. A retired reason
    # still explains old corrections but cannot be chosen for a new one.
    if not db.execute(text(
        "SELECT 1 FROM checklist_item WHERE kind='ATTENDANCE_REASON' "
        "AND code = :c AND status = 'ACTIVE'"), {"c": reason}).first():
        raise HTTPException(400, "That reason is not on the list.")

    who_row = db.execute(text("""
        SELECT i.party_id, p.display_name, o.org_unit_id, ou.name AS department
          FROM party_identity i
          JOIN party p          ON p.party_id = i.party_id
          LEFT JOIN operator o  ON o.party_id = i.party_id
          LEFT JOIN org_unit ou ON ou.org_unit_id = o.org_unit_id
         WHERE i.external_code = :e AND i.system = 'CONTRACTOR' LIMIT 1
    """), {"e": emp_no}).mappings().first()
    if not who_row:
        raise HTTPException(404, f"No worker on the register carries the number {emp_no}.")
    party = who_row["party_id"]

    scope, scope_name = _scope(db, request)
    if scope is not None and who_row["org_unit_id"] != scope:
        raise HTTPException(
            403, f"{who_row['display_name']} is in "
                 f"{who_row['department'] or 'no department'} and your access covers "
                 f"{scope_name}. Attendance is corrected by the department that "
                 "supervises the person.")

    # A correction fills a gap; it does not argue with the reader. Reading the
    # day first catches the two ways a well-meant correction goes wrong: adding
    # a punch that is already there, and adding one that contradicts the punch
    # that is. Somebody clocked in at 21:02 does not have an out at 17:30 the
    # same day — that is a C shift whose out belongs to tomorrow.
    if kind != "NOTE" and frs.configured():
        try:
            seen = frs.punch_days(on, on, [emp_no]).get((emp_no, on.isoformat()))
        except Exception:                    # noqa: BLE001 — readers down is not
            seen = None                      # a reason to block a correction

        # A gate that saw somebody twice is not silent about them, and absence
        # is the one claim a reader can genuinely contradict. This is the guard
        # that matters most: an approved absence on a day somebody worked is a
        # day missing from their pay.
        if seen and kind == "MARK_ABSENT":
            raise HTTPException(
                409, f"The reader recorded {seen['punches']} punch"
                     f"{'' if seen['punches'] == 1 else 'es'} for {emp_no} that day"
                     + (f", first at {seen['first_in'].strftime('%H:%M')}"
                        if seen["first_in"] else "")
                     + ". Somebody the gate saw was not absent. If the punch belongs "
                       "to a different person, that is an enrolment problem rather "
                       "than an attendance one.")

        if seen and kind == "MARK_PRESENT":
            raise HTTPException(
                409, "The reader already has them that day, so there is nothing "
                     "to assert. Use a missing punch correction if a time is wrong.")

        if seen and kind in NEEDS_TIME:
            existing = seen["first_in"] if kind == "CLOCK_IN" else seen["last_out"]
            if existing:
                raise HTTPException(
                    409, f"The reader already has a {kind.replace('_', ' ').lower()} "
                         f"at {existing.strftime('%H:%M')} that day. There is no gap "
                         "to fill, and a correction never moves a time the reader "
                         "actually recorded.")
            other = seen["last_out"] if kind == "CLOCK_IN" else seen["first_in"]
            if other:
                claimed = datetime.combine(on, at)
                bad = claimed > other if kind == "CLOCK_IN" else claimed < other
                if bad:
                    raise HTTPException(
                        400, f"The reader recorded "
                             f"{'an out' if kind == 'CLOCK_IN' else 'an in'} at "
                             f"{other.strftime('%H:%M')} that day, so "
                             f"{at.strftime('%H:%M')} cannot be right. If this is a "
                             "night shift, the other punch belongs to the next day.")

    open_already = db.execute(text(
        "SELECT correction_id, requested_by FROM attendance_correction "
        "WHERE emp_no = :e AND on_date = :d AND kind = :k AND status = 'PENDING'"),
        {"e": emp_no, "d": on, "k": kind}).mappings().first()
    if open_already:
        raise HTTPException(
            409, f"{open_already['requested_by']} already raised this one and it is "
                 "still waiting. Two of the same correction is the same decision twice.")

    row = db.execute(text("""
        INSERT INTO attendance_correction
            (party_id, emp_no, on_date, kind, at_time, reason_code, remarks, requested_by)
        VALUES (:p, :e, :d, :k, :t, :r, :rem, :by)
        RETURNING correction_id
    """), {"p": party, "e": emp_no, "d": on, "k": kind, "t": at,
           "r": reason, "rem": remarks, "by": _actor(request)}).mappings().first()

    _log(db, request, "ATTENDANCE_CORRECTION_RAISED", {
        "correction_id": row["correction_id"], "emp_no": emp_no,
        "on_date": on.isoformat(), "kind": kind, "reason": reason})
    db.commit()
    return {"ok": True, "correction_id": row["correction_id"], "status": "PENDING"}


def _decide(request: Request, db: Session, correction_id: int,
            to: str, note: str | None) -> dict:
    _require(request, APPROVE, "decide an attendance correction")
    me = _actor(request)

    c = db.execute(text(
        "SELECT * FROM attendance_correction WHERE correction_id = :i"),
        {"i": correction_id}).mappings().first()
    if not c:
        raise HTTPException(404, "That correction is not on the queue.")
    if c["status"] != "PENDING":
        raise HTTPException(
            409, f"That one was already {c['status'].lower()} by {c['decided_by']}. "
                 "A decision is not re-taken quietly; raise a new correction.")
    if c["requested_by"] == me:
        raise HTTPException(
            403, "You raised this one. Somebody else approves it — that is the "
                 "whole point of the two rights being separate.")
    if to == "REJECTED" and not (note or "").strip():
        raise HTTPException(
            400, "Say why it is refused. Whoever raised it sees the reason, and "
                 "a bare rejection only sends it round again.")

    db.execute(text("""
        UPDATE attendance_correction
           SET status = :s, decided_by = :by, decided_at = now(), decision_note = :n
         WHERE correction_id = :i
    """), {"s": to, "by": me, "n": (note or "").strip() or None, "i": correction_id})

    _log(db, request, f"ATTENDANCE_CORRECTION_{to}", {
        "correction_id": correction_id, "emp_no": c["emp_no"],
        "on_date": c["on_date"].isoformat(), "kind": c["kind"],
        "raised_by": c["requested_by"]})
    db.commit()
    return {"ok": True, "correction_id": correction_id, "status": to}


@router.post("/corrections/batch")
def raise_batch(request: Request, body: dict = Body(...),
                db: Session = Depends(get_minehub_db)) -> dict:
    """The same correction for several people at once.

    The case this exists for is the one the data already showed: on 17 and 18
    September the gate failed and thirty-eight people had one punch instead of
    two. Raising that thirty-eight times, typing the same reason and the same
    time into each, is how three of them come out wrong.

    Each worker is still a correction of their own — same shape, same guards,
    same approval. This only saves the typing. A worker the guards refuse is
    reported and the rest go through, because one bad row should not lose the
    other thirty-seven.
    """
    _require(request, CORRECT, "raise an attendance correction")

    emp_nos = [str(e).strip() for e in (body.get("emp_nos") or []) if str(e).strip()]
    if not emp_nos:
        raise HTTPException(400, "Choose at least one worker.")
    if len(emp_nos) > 400:
        raise HTTPException(400, f"{len(emp_nos)} at once is more than this takes.")

    # The reason and the remark belong to the submission, not to any one
    # worker, so they are checked once here rather than thirty-eight times in
    # the fan-out below. Left to the per-worker path they would come back as
    # thirty-eight identical refusals and nothing raised, which reads like the
    # workers were the problem.
    if not str(body.get("reason_code") or "").strip():
        raise HTTPException(
            400, "Choose a reason. A correction without one cannot be "
                 "explained six months from now, which is when it is asked about.")
    if not str(body.get("remarks") or "").strip():
        raise HTTPException(
            400, "Say what happened. The reason puts this in one of eight boxes; "
                 "the remark is what somebody reads when they ask about it later.")

    # A shift is two corrections, not one: the in that was missed and the out
    # that was missed, at the times the shift says. Either can be turned off
    # for the common case where only one end failed.
    kinds: list[tuple[str, str | None]] = []
    shift_id = body.get("shift_id")
    if shift_id:
        sh = db.execute(text(
            "SELECT code, name, start_time, end_time FROM shift_calendar "
            "WHERE shift_id = :i"), {"i": int(shift_id)}).mappings().first()
        if not sh:
            raise HTTPException(400, "That shift is not on the calendar.")
        if body.get("punch_in", True):
            kinds.append(("CLOCK_IN", sh["start_time"].strftime("%H:%M")))
        if body.get("punch_out", True):
            kinds.append(("CLOCK_OUT", sh["end_time"].strftime("%H:%M")))
        if not kinds:
            raise HTTPException(400, "A shift punch needs an in, an out, or both.")
    else:
        kinds.append((str(body.get("kind") or "").upper(), body.get("at_time")))

    done, refused = [], []
    for emp_no in emp_nos:
        for kind, at in kinds:
            one = {**body, "emp_no": emp_no, "kind": kind, "at_time": at}
            one.pop("emp_nos", None)
            try:
                r = raise_correction(request, one, db)
                done.append({"emp_no": emp_no, "kind": kind,
                             "correction_id": r["correction_id"]})
            except HTTPException as e:
                refused.append({"emp_no": emp_no, "kind": kind,
                                "why": str(e.detail)})
    return {"raised": len(done), "refused": len(refused),
            "done": done, "problems": refused}


@router.post("/corrections/{correction_id}/approve")
def approve(correction_id: int, request: Request, body: dict = Body(default={}),
            db: Session = Depends(get_minehub_db)) -> dict:
    """Accept it. From here the day reads as corrected, with this attached."""
    return _decide(request, db, correction_id, "APPROVED", body.get("note"))


@router.post("/corrections/{correction_id}/reject")
def reject(correction_id: int, request: Request, body: dict = Body(default={}),
           db: Session = Depends(get_minehub_db)) -> dict:
    """Refuse it, with a reason the person who raised it can act on."""
    return _decide(request, db, correction_id, "REJECTED", body.get("note"))


@router.post("/corrections/{correction_id}/withdraw")
def withdraw(correction_id: int, request: Request, body: dict = Body(default={}),
             db: Session = Depends(get_minehub_db)) -> dict:
    """Take back your own, while it is still waiting.

    Withdrawing is not deciding: only the person who raised it may, only while
    nobody has acted on it, and the row stays with everything else.
    """
    _require(request, CORRECT, "withdraw an attendance correction")
    me = _actor(request)
    c = db.execute(text(
        "SELECT requested_by, status FROM attendance_correction WHERE correction_id = :i"),
        {"i": correction_id}).mappings().first()
    if not c:
        raise HTTPException(404, "That correction is not on the queue.")
    if c["requested_by"] != me:
        raise HTTPException(403, "Only the person who raised it can withdraw it.")
    if c["status"] != "PENDING":
        raise HTTPException(409, f"That one was already {c['status'].lower()}.")

    db.execute(text(
        "UPDATE attendance_correction SET status = 'WITHDRAWN', "
        "decision_note = :n WHERE correction_id = :i"),
        {"n": (body.get("note") or "").strip() or None, "i": correction_id})
    _log(db, request, "ATTENDANCE_CORRECTION_WITHDRAWN", {"correction_id": correction_id})
    db.commit()
    return {"ok": True, "correction_id": correction_id, "status": "WITHDRAWN"}
