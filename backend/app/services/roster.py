"""Who is meant to be here, on a day nobody has lived through yet.

Attendance says who came. The roster says who was expected — and the gap
between the two is the only number a shift supervisor actually acts on at five
in the morning. Without it, "we are four short" is something you discover by
counting heads in the yard.

HOW A DAY IS DECIDED. Three sources, in this order, and the first one that
speaks wins:

    a mine closure      nobody works, whatever the pattern says
    an approved leave   this person does not work, whatever the pattern says
    the pattern         the shift this person works on that day of their cycle

Nothing here is stored. Ask for the same day twice and it is worked out twice,
because a roster that was computed and written down in March is wrong the
moment April's leave is approved, and wrong in a way that looks authoritative.

A PATTERN IS A CYCLE, NOT A WEEK. Six on and one off does not repeat weekly,
and a mine that rotates crews through A, B and C has a cycle of eighteen or
twenty-one days. So a pattern carries a list of slots and each person carries
an anchor date — the day they sat at slot zero — and their position on any
later day is arithmetic rather than a lookup table somebody maintains.

WHAT IT REFUSES TO SAY. Rostered is not present, and this never claims it is.
A person rostered onto A shift who does not punch in is rostered and absent,
which is a two-word answer the shift board needs both halves of.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

REST = "REST"

# What a day can be. Ordered by how much it overrides: a closure beats a leave,
# a leave beats the pattern, and the pattern beats nothing.
HOLIDAY, LEAVE, OFF, ON = "HOLIDAY", "LEAVE", "REST", "ON"


def _days(from_date: date, to_date: date) -> list[date]:
    n = (to_date - from_date).days
    return [from_date + timedelta(days=i) for i in range(n + 1)]


def patterns(db: Session) -> dict[int, dict]:
    """Every cycle the mine has defined, by id."""
    rows = db.execute(text("""
        SELECT pattern_id, code, name, description, cycle_days, slots, is_active
        FROM roster_pattern ORDER BY code
    """)).mappings().all()
    return {r["pattern_id"]: dict(r) for r in rows}


def assignments(db: Session, from_date: date, to_date: date,
                operator_ids: list[int] | None = None) -> dict[int, list[dict]]:
    """Who sat on which pattern over a window, newest first per person.

    The window matters: somebody who changed pattern mid-month has two rows,
    and a report that takes only the current one misreads the first half of
    the month.
    """
    rows = db.execute(text("""
        SELECT ra.roster_assignment_id, ra.operator_id, ra.pattern_id,
               ra.anchor_date, ra.effective_from, ra.effective_to, ra.plant_id
        FROM roster_assignment ra
        WHERE ra.effective_from <= :to
          AND (ra.effective_to IS NULL OR ra.effective_to >= :from)
          AND (CAST(:ops AS bigint[]) IS NULL OR ra.operator_id = ANY(CAST(:ops AS bigint[])))
        ORDER BY ra.operator_id, ra.effective_from DESC
    """), {"from": from_date, "to": to_date, "ops": operator_ids}).mappings().all()

    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r["operator_id"], []).append(dict(r))
    return out


def approved_leave(db: Session, from_date: date, to_date: date,
                   operator_ids: list[int] | None = None) -> dict[int, list[dict]]:
    """Leave that has actually been granted, over a window.

    Only APPROVED. A request sitting unapproved is not a plan the shift board
    should be building around — if it turns out to be one, somebody approves it
    and the board changes on the next read.
    """
    rows = db.execute(text("""
        SELECT lr.leave_request_id, lr.leave_ref, lr.operator_id, lr.from_date,
               lr.to_date, lr.half_day_start, lr.half_day_end,
               lt.code AS type_code, lt.name AS type_name, lt.colour,
               lt.blocks_deployment, lt.is_paid
        FROM leave_request lr
        JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
        WHERE lr.status = 'APPROVED'
          AND lr.from_date <= :to AND lr.to_date >= :from
          AND (CAST(:ops AS bigint[]) IS NULL OR lr.operator_id = ANY(CAST(:ops AS bigint[])))
        ORDER BY lr.operator_id, lr.from_date
    """), {"from": from_date, "to": to_date, "ops": operator_ids}).mappings().all()

    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r["operator_id"], []).append(dict(r))
    return out


def holidays(db: Session, from_date: date, to_date: date,
             plant_id: int | None = None) -> dict[date, dict]:
    """The calendar, keyed by date.

    A plant's own entry beats the all-sites one for the same day, because a
    site that works through a company holiday has said so deliberately.
    """
    rows = db.execute(text("""
        SELECT holiday_id, holiday_date, name, plant_id, kind, stops_work
        FROM holiday
        WHERE holiday_date BETWEEN :from AND :to
          AND (plant_id IS NULL OR plant_id = CAST(:plant AS bigint)
               OR CAST(:plant AS bigint) IS NULL)
        ORDER BY holiday_date, plant_id NULLS LAST
    """), {"from": from_date, "to": to_date, "plant": plant_id}).mappings().all()

    out: dict[date, dict] = {}
    for r in rows:
        # First row per date wins, and the ordering put the site-specific one
        # first, so a site override is honoured without a second query.
        out.setdefault(r["holiday_date"], dict(r))
    return out


def _slot_for(pattern: dict, anchor: date, day: date) -> str:
    """Where a person sits in their cycle on a given day."""
    cycle = int(pattern["cycle_days"]) or 1
    slots = pattern["slots"] or []
    if not slots:
        return REST
    # Python's modulo is already correct for days before the anchor, which is
    # what makes an anchor in the future harmless rather than a crash.
    return str(slots[(day - anchor).days % cycle] or REST).upper()


def duty(db: Session, from_date: date, to_date: date,
         operator_ids: list[int] | None = None,
         plant_id: int | None = None) -> dict[int, dict[str, dict]]:
    """The roster over a window: operator -> ISO date -> what that day is.

    Four queries for any number of people and any number of days. A calendar
    screen asks for a hundred and thirty people across thirty-one days, and
    doing that one person-day at a time is four thousand round trips nobody
    waits for.
    """
    pats = patterns(db)
    assigns = assignments(db, from_date, to_date, operator_ids)
    leaves = approved_leave(db, from_date, to_date, operator_ids)
    hols = holidays(db, from_date, to_date, plant_id)
    span = _days(from_date, to_date)

    people = set(assigns) | set(leaves) | set(operator_ids or [])
    out: dict[int, dict[str, dict]] = {}

    for operator_id in people:
        per_day: dict[str, dict] = {}
        rows = assigns.get(operator_id, [])
        taken = leaves.get(operator_id, [])

        for day in span:
            iso = day.isoformat()

            # A closure stops everything, including the people who would
            # otherwise have been rostered on.
            hol = hols.get(day)
            if hol and hol["stops_work"]:
                per_day[iso] = {"state": HOLIDAY, "shift": None,
                                "label": hol["name"], "kind": hol["kind"]}
                continue

            on_leave = next(
                (lv for lv in taken if lv["from_date"] <= day <= lv["to_date"]), None)
            if on_leave:
                half = ((on_leave["half_day_start"] and day == on_leave["from_date"])
                        or (on_leave["half_day_end"] and day == on_leave["to_date"]))
                per_day[iso] = {
                    "state": LEAVE, "shift": None, "label": on_leave["type_name"],
                    "kind": on_leave["type_code"], "leave_ref": on_leave["leave_ref"],
                    "half_day": half, "colour": on_leave["colour"],
                    "blocks": on_leave["blocks_deployment"],
                }
                continue

            # The assignment in force on this particular day, not the newest
            # one: a pattern change in the middle of the window has to apply
            # from the day it took effect and not before.
            row = next((a for a in rows
                        if a["effective_from"] <= day
                        and (a["effective_to"] is None or a["effective_to"] >= day)), None)
            if not row:
                per_day[iso] = {"state": None, "shift": None,
                                "label": "not on a roster", "kind": None}
                continue

            pattern = pats.get(row["pattern_id"])
            slot = _slot_for(pattern, row["anchor_date"], day) if pattern else REST
            if slot == REST:
                per_day[iso] = {"state": OFF, "shift": None, "label": "rest day",
                                "kind": None, "pattern": pattern["code"] if pattern else None}
            else:
                per_day[iso] = {"state": ON, "shift": slot, "label": f"{slot} shift",
                                "kind": None, "pattern": pattern["code"] if pattern else None,
                                "hol": hol["name"] if hol else None}

        out[operator_id] = per_day

    return out


def rostered_for(db: Session, day: date, shift_code: str | None = None,
                 plant_id: int | None = None) -> dict[int, dict]:
    """Who is on duty on one day, optionally for one shift.

    This is what the deployment engine asks before it considers anybody: a
    person not rostered today is not a candidate, however qualified, because
    deploying them means calling them in.
    """
    board = duty(db, day, day, plant_id=plant_id)
    iso = day.isoformat()
    out = {}
    for operator_id, days in board.items():
        cell = days.get(iso) or {}
        if cell.get("state") != ON:
            continue
        if shift_code and str(cell.get("shift") or "").upper() != shift_code.upper():
            continue
        out[operator_id] = cell
    return out


def leave_blocking(db: Session, day: date) -> dict[int, dict]:
    """Operators whose approved leave stops them being deployed on a day.

    Separate from `duty` because readiness asks only this one question, and
    asking it should not cost a whole roster computation.
    """
    rows = db.execute(text("""
        SELECT lr.operator_id, lr.leave_ref, lr.from_date, lr.to_date,
               lt.name AS type_name, lt.code AS type_code
        FROM leave_request lr
        JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
        WHERE lr.status = 'APPROVED' AND lt.blocks_deployment
          AND :day BETWEEN lr.from_date AND lr.to_date
    """), {"day": day}).mappings().all()
    return {r["operator_id"]: dict(r) for r in rows}


def coverage(db: Session, day: date, plant_id: int | None = None) -> dict:
    """What the roster says the day looks like, in one summary.

    Written for the top of a screen: the counts a supervisor reads first, and
    the reasons behind each one so the number is not something to be taken on
    trust.
    """
    # Everybody active, not only those who already have a roster row — the
    # whole point of the count is to find the people nobody has placed, and
    # asking `duty` without a list returns only the people it already knows.
    everyone = [r[0] for r in db.execute(text(
        "SELECT operator_id FROM operator WHERE profile_status = 'ACTIVE'"))]
    board = duty(db, day, day, everyone, plant_id)
    iso = day.isoformat()
    by_shift: dict[str, int] = {}
    on = off = away = closed = unrostered = 0

    for days in board.values():
        cell = days.get(iso) or {}
        state = cell.get("state")
        if state == ON:
            on += 1
            by_shift[cell["shift"]] = by_shift.get(cell["shift"], 0) + 1
        elif state == OFF:
            off += 1
        elif state == LEAVE:
            away += 1
        elif state == HOLIDAY:
            closed += 1
        else:
            unrostered += 1

    return {"day": iso, "on_duty": on, "resting": off, "on_leave": away,
            "holiday": closed, "not_on_a_roster": unrostered,
            "by_shift": by_shift, "headcount": len(board)}


# ── patterns the mine could adopt ────────────────────────────────────────────
# Offered, never seeded. The same rule departments and leave types follow: a
# platform that invents a mine's working pattern gets it subtly wrong, and
# nobody notices until somebody is rostered onto a shift they do not work.
#
# What makes these safe to offer is that they are built from the shift codes
# this mine actually runs, read out of its own shift calendar. A suggestion can
# therefore never name a shift that does not exist — which is the one way a
# starter pattern could do real damage.

def _cycle(*runs: tuple[str, int]) -> list[str]:
    """A cycle written the way people say it: six of A, one off, six of B…"""
    out: list[str] = []
    for code, count in runs:
        out.extend([code] * count)
    return out


def suggested_patterns(db: Session) -> list[dict]:
    """Ready-made cycles, built from this mine's own shifts.

    Returned rather than created. Somebody picks the ones that match how the
    mine actually works, and can edit any of them afterwards — the point is to
    save typing, not to decide.
    """
    shifts = [r[0].upper() for r in db.execute(text("""
        SELECT code FROM shift_calendar
        WHERE valid_to IS NULL OR valid_to >= CURRENT_DATE
        ORDER BY start_time
    """)).all()]
    if not shifts:
        return []

    existing = {r[0].upper() for r in db.execute(text("SELECT code FROM roster_pattern")).all()}

    # The three rotating shifts, in the order the day runs. GENERAL and
    # anything else the mine has defined are handled separately, because a
    # day-shift pattern and a rotation are different working lives.
    rotating = [c for c in shifts if c in ("A", "B", "C")]
    day = next((c for c in shifts if c in ("GENERAL", "GEN", "G")), None)

    out: list[dict] = []

    if day:
        out.append({
            "code": f"{day}-6", "name": f"{day.title()} shift, six days on",
            "description": "Day work with one rest day a week — the pattern most "
                           "of the office and workshop follow.",
            "slots": _cycle((day, 6), (REST, 1)),
            "why": "Six working days in every seven, about 313 days a year.",
        })

    for code in rotating:
        out.append({
            "code": f"{code}-6", "name": f"{code} shift, six days on",
            "description": f"Fixed {code} shift with one rest day a week. Nobody "
                           f"rotates; the crew works the same hours every week.",
            "slots": _cycle((code, 6), (REST, 1)),
            "why": "Easiest to plan around, hardest on anybody permanently on nights.",
        })

    if len(rotating) == 3:
        a, b, c = rotating
        # Three crews, each a week behind the next. Three patterns rather than
        # one, because each crew starts the same cycle at a different point and
        # the anchor date is what separates them.
        out.append({
            "code": "ROT-21", "name": "Three-crew rotation, 21 days",
            "description": f"Six days on {a}, a rest day, six on {b}, a rest day, "
                           f"six on {c}, a rest day. One crew per starting point.",
            "slots": _cycle((a, 6), (REST, 1), (b, 6), (REST, 1), (c, 6), (REST, 1)),
            "why": "Everybody takes a turn on nights. Set each crew's anchor date "
                   "a week apart and the three cover every shift, every day.",
        })
        out.append({
            "code": "ROT-12", "name": "Faster rotation, 12 days",
            "description": f"Four days on each of {a}, {b} and {c}, with a rest day "
                           f"after each block.",
            "slots": _cycle((a, 3), (REST, 1), (b, 3), (REST, 1), (c, 3), (REST, 1)),
            "why": "Shorter runs of nights, at the cost of changing shift more often.",
        })

    if rotating:
        out.append({
            "code": "CONT-4-2", "name": "Four on, two off",
            "description": f"Four days on {rotating[0]} then two days off, "
                           "repeating — a continuous roster with longer breaks.",
            "slots": _cycle((rotating[0], 4), (REST, 2)),
            "why": "About 243 working days a year and two consecutive rest days, "
                   "which one rest day a week never gives.",
        })

    # Anything already defined is shown as taken rather than hidden, so the
    # list does not silently shrink and leave somebody hunting for the option
    # they used last month.
    for row in out:
        row["exists"] = row["code"].upper() in existing
        row["cycle_days"] = len(row["slots"])
        row["working_days"] = len([s for s in row["slots"] if s != REST])
    return out
