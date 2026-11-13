"""The Shift HOTO Board — what a supervisor looks at before a shift goes out.

── WHY THE UNIT IS THE MACHINE, NOT THE HANDOVER ────────────────────────────
The register (phase 7) lists handovers, and that is the right shape for a
record. It is the wrong shape for a supervisor, because the machines that need
attention most are the ones with NO handover, and they are exactly the rows a
list of handovers cannot contain.

So the board starts from every active machine and attaches whatever handover
exists, which may be none. A machine nobody filled in is a visible row saying
so, not an absence.

── WHY IT DOES NOT KEY OFF shift_instance ───────────────────────────────────
`shift_instance` exists and is the right home for a planned shift, but in
practice it holds five rows, the newest from October, all still OPEN -- nothing
creates one per shift today, and the captured handovers carry a NULL
shift_instance_id. A board joined to it would be permanently empty while
appearing to work.

So the current shift is derived from `shift_calendar` and the production day,
which is information that exists whether or not anybody opened a shift row, and
the shift_instance is attached when one happens to be there. If shift instances
later become routine, this reads them without changing shape.

── WHAT THIS DELIBERATELY DOES NOT ANSWER ───────────────────────────────────
What a missing handover COUNTS AS -- a non-compliance, an idle machine, or a
machine nobody was rostered on. That is question 2 of the three still open in
docs/hoto-scope.md section 9, and the board reports the three cases separately
rather than adding them up into a percentage whose denominator nobody agreed:

    captured         a handover exists for this machine in this shift
    not_captured     no handover, and the machine is in a working state
    not_expected     no handover, and the machine is already off work
                     (BREAKDOWN, UNDER_MAINTENANCE, LOCKED)

The third is the one that makes a bare "60% compliance" misleading: a machine
in the workshop has no handover because it is in the workshop.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.hoto_defects import SEVERITY_STATE, set_state

logger = logging.getLogger(__name__)

# HOW MUCH WORK EACH STATE PERMITS -- which is not the same as how serious it
# sounds. The board's one rule turns on this ordering: moving a machine to a
# state that permits LESS work is an ordinary supervisory act; moving it to one
# that permits MORE work than its open defects justify is an override.
#
# BREAKDOWN and UNDER_MAINTENANCE sit level with LOCKED because in all three
# the machine does no work, and that is the only thing this ordering measures.
# Ranking them below LOCKED -- which the first draft did, on how severe each
# sounds -- made sending a locked machine to the workshop look like releasing
# it, and demanded an override to do the obviously right thing. A rule that
# fires on the correct action is a rule people learn to route around.
WORK_PERMITTED = {
    "AVAILABLE": 3,          # works, nothing against it
    "RUNNING": 3,            # works, an operator has it
    "CAUTION": 2,            # works, something needs watching
    "RESTRICTED": 1,         # works, but limited
    "BREAKDOWN": 0,          # stopped
    "UNDER_MAINTENANCE": 0,  # the workshop has it
    "LOCKED": 0,             # held, by a critical defect or a supervisor
}

# A machine in one of these is already off work, so no handover is expected.
OFF_WORK = ("BREAKDOWN", "UNDER_MAINTENANCE", "LOCKED")


class BoardError(ValueError):
    def __init__(self, problems: list[str], status: int = 422):
        self.problems = problems
        self.status = status
        super().__init__("; ".join(problems))


# ── which shift is it ────────────────────────────────────────────────────────

def current_shift(db: Session, at: datetime | None = None) -> dict[str, Any] | None:
    """The shift in force, and the production day it belongs to.

    The production day is the part people get wrong. A handover at 02:00 on C
    shift belongs to the day the shift STARTED, not the calendar date on the
    clock -- so a night shift's work does not get split across two days in
    every report that follows.
    """
    now = at or datetime.now().astimezone()
    t = now.time()

    rows = db.execute(text("""
        SELECT shift_id, code, name, start_time, end_time, crosses_midnight,
               production_day_rule, planned_hours
          FROM shift_calendar
         WHERE (valid_to IS NULL OR valid_to >= CURRENT_DATE)
           AND code <> 'GENERAL'
         ORDER BY start_time
    """)).mappings().all()

    for r in rows:
        start, end = r["start_time"], r["end_time"]
        if r["crosses_midnight"]:
            inside = t >= start or t < end
        else:
            inside = start <= t < end
        if not inside:
            continue

        # A shift that crosses midnight and is being read AFTER midnight started
        # yesterday, so its production day is yesterday's.
        day = now.date()
        if r["crosses_midnight"] and t < end:
            day = day - timedelta(days=1)

        begins = datetime.combine(day, start, tzinfo=now.tzinfo)
        ends = begins + _length(start, end, r["crosses_midnight"])
        return {
            "shift_id": r["shift_id"], "code": r["code"], "name": r["name"],
            "production_day": day.isoformat(),
            "starts_at": begins.isoformat(),
            "ends_at": ends.isoformat(),
            "crosses_midnight": r["crosses_midnight"],
        }
    return None


def _length(start: time, end: time, crosses: bool) -> timedelta:
    a = timedelta(hours=start.hour, minutes=start.minute)
    b = timedelta(hours=end.hour, minutes=end.minute)
    return (b + timedelta(days=1) - a) if crosses else (b - a)


def shift_window(db: Session, *, shift_id: int | None = None,
                 production_day: date | None = None,
                 at: datetime | None = None) -> dict[str, Any]:
    """The window the board is reporting on.

    With nothing given it is the shift happening now. With a shift and a day it
    is that one, so a supervisor can look back at the shift that just ended --
    which is when the awkward questions actually get asked.
    """
    if shift_id is None or production_day is None:
        cur = current_shift(db, at)
        if cur:
            return cur
        # Outside every shift window (only possible with a calendar that has
        # gaps). Report the whole production day rather than nothing.
        today = (at or datetime.now().astimezone()).date()
        return {"shift_id": None, "code": "ALL", "name": "the production day",
                "production_day": today.isoformat(),
                "starts_at": datetime.combine(today, time(0, 0)).isoformat(),
                "ends_at": datetime.combine(today + timedelta(days=1), time(0, 0)).isoformat(),
                "crosses_midnight": False}

    r = db.execute(text("""
        SELECT shift_id, code, name, start_time, end_time, crosses_midnight,
               planned_hours
          FROM shift_calendar WHERE shift_id = :s
    """), {"s": shift_id}).mappings().first()
    if not r:
        raise BoardError([f"no such shift: {shift_id}"], status=404)

    begins = datetime.combine(production_day, r["start_time"]).astimezone()
    ends = begins + _length(r["start_time"], r["end_time"], r["crosses_midnight"])
    return {"shift_id": r["shift_id"], "code": r["code"], "name": r["name"],
            "production_day": production_day.isoformat(),
            "starts_at": begins.isoformat(), "ends_at": ends.isoformat(),
            "crosses_midnight": r["crosses_midnight"]}


# ── the board ────────────────────────────────────────────────────────────────

def board(db: Session, *, plant_id: int | None = None,
          shift_id: int | None = None, production_day: date | None = None,
          only_attention: bool = False) -> dict[str, Any]:
    """Every active machine in one shift, with whatever is known about it."""
    win = shift_window(db, shift_id=shift_id, production_day=production_day)

    rows = db.execute(text("""
        WITH win AS (
            SELECT CAST(:frm AS timestamptz) AS frm, CAST(:to AS timestamptz) AS tto
        )
        SELECT a.asset_id, a.fleet_code, a.current_reading, a.reading_uom,
               at.asset_type_id, at.name AS asset_type_name,
               a.plant_id, p.name AS plant_name,

               -- The open availability window IS the current state. There is a
               -- partial unique index making sure there is only ever one.
               ae.state        AS machine_state,
               ae.reason       AS machine_state_reason,
               ae.started_at   AS machine_state_since,
               ae.recorded_by  AS machine_state_by,

               -- Does this machine have a published checklist at all? A
               -- machine with none cannot be handed over, and reading that as
               -- "nobody filled it in" would blame the wrong person.
               EXISTS (SELECT 1 FROM hoto_checklist_template t
                        WHERE t.asset_type_id = a.asset_type_id
                          AND t.status = 'ACTIVE') AS has_checklist,

               -- The handover in THIS window, newest first if there are several.
               hs.session_id, hs.session_ref, hs.session_type, hs.status AS session_status,
               hs.captured_at, hs.received_at, hs.captured_offline,
               hs.operator_emp_id, hs.meter_reading, hs.blocked_reason,
               COALESCE(pt.display_name, pt.legal_name) AS operator_name,

               -- And the last one ever, so a machine with none in this window
               -- can still say when it was last handed over rather than just
               -- being blank.
               (SELECT max(x.captured_at) FROM hoto_session x
                 WHERE x.asset_id = a.asset_id) AS last_handover_ever,

               (SELECT count(*) FROM hoto_defect d
                 WHERE d.asset_id = a.asset_id
                   AND d.state IN ('RAISED','ACKNOWLEDGED','RECTIFIED')) AS open_defects,
               (SELECT count(*) FROM hoto_defect d
                 WHERE d.asset_id = a.asset_id AND d.blocks_operation
                   AND d.state IN ('RAISED','ACKNOWLEDGED','RECTIFIED')) AS blocking_defects,
               (SELECT count(*) FROM hoto_defect d
                 WHERE d.asset_id = a.asset_id AND d.severity IN ('HIGH','CRITICAL')
                   AND d.state IN ('RAISED','ACKNOWLEDGED','RECTIFIED')) AS serious_defects,
               (SELECT count(*) FROM hoto_defect d
                 WHERE d.asset_id = a.asset_id AND d.state = 'RECTIFIED') AS awaiting_verification,
               -- NOT max(severity). Severity is text, so max() orders it
               -- alphabetically and MEDIUM beats CRITICAL -- which would have
               -- this board calling a locked machine merely restricted.
               (SELECT d.severity FROM hoto_defect d
                 WHERE d.asset_id = a.asset_id
                   AND d.state IN ('RAISED','ACKNOWLEDGED','RECTIFIED')
                 ORDER BY CASE d.severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3
                                          WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC
                 LIMIT 1) AS worst_open_severity

          FROM asset a
          JOIN asset_type at ON at.asset_type_id = a.asset_type_id
          LEFT JOIN plant p  ON p.plant_id = a.plant_id
          LEFT JOIN availability_event ae
                 ON ae.asset_id = a.asset_id AND ae.ended_at IS NULL
          LEFT JOIN LATERAL (
              SELECT s.* FROM hoto_session s, win
               WHERE s.asset_id = a.asset_id
                 AND s.captured_at >= win.frm AND s.captured_at < win.tto
               ORDER BY s.captured_at DESC LIMIT 1
          ) hs ON true
          LEFT JOIN operator o ON o.operator_id = hs.operator_id
          LEFT JOIN party pt   ON pt.party_id = o.party_id
         WHERE a.status = 'ACTIVE'
           AND (CAST(:plant AS bigint) IS NULL OR a.plant_id = CAST(:plant AS bigint))
         ORDER BY a.fleet_code
    """), {"frm": win["starts_at"], "to": win["ends_at"], "plant": plant_id}).mappings().all()

    out = []
    for r in rows:
        d = dict(r)
        for k in ("current_reading", "meter_reading"):
            if d.get(k) is not None:
                d[k] = float(d[k])

        state = d["machine_state"] or "AVAILABLE"
        d["machine_state"] = state

        if d["session_id"]:
            d["handover"] = "captured"
        elif not d["has_checklist"]:
            d["handover"] = "no_checklist"
        elif state in OFF_WORK:
            d["handover"] = "not_expected"
        else:
            d["handover"] = "not_captured"

        # What the open defects say the state OUGHT to be. The difference
        # between this and the actual state is the whole point of the board:
        # it is either a supervisor's deliberate call or somebody forgot.
        d["implied_state"] = SEVERITY_STATE.get(d["worst_open_severity"] or "", "AVAILABLE")
        # The machine is working more freely than its own open defects allow.
        # Either a supervisor decided that deliberately, or somebody forgot --
        # and which of those it is, is the question the board exists to put.
        d["understated"] = (WORK_PERMITTED[state]
                            > WORK_PERMITTED[d["implied_state"]])
        d["needs_attention"] = bool(
            d["blocking_defects"] or d["understated"]
            or d["handover"] == "not_captured"
            or d["awaiting_verification"]
            or (d["session_status"] == "BLOCKED"))
        out.append(d)

    if only_attention:
        out = [r for r in out if r["needs_attention"]]

    counts: dict[str, int] = {}
    for r in out:
        counts[r["handover"]] = counts.get(r["handover"], 0) + 1
        counts[f"state_{r['machine_state']}"] = counts.get(f"state_{r['machine_state']}", 0) + 1

    return {
        "shift": win,
        "machines": out,
        "count": len(out),
        "needs_attention": sum(1 for r in out if r["needs_attention"]),
        "tally": counts,
        # Said out loud rather than computed into a percentage. See the note at
        # the top of this file.
        "compliance_note": (
            "Machines are counted as captured, not captured, not expected (already "
            "off work) or without a published checklist. What a missing handover "
            "counts as is not yet agreed, so no percentage is published."),
    }


def recent_days(db: Session, *, days: int = 7,
                shift_code: str | None = None) -> list[dict[str, Any]]:
    """How many handovers were filed on each of the last few production days.

    ── WHY THE BOARD NEEDS THIS ─────────────────────────────────────────────
    The board can say "61 machines, nobody filled it in" and a reader has no
    way to judge it. Is that today's failure, or has it read 61 all week? The
    two call for completely different actions -- one is a shift to chase, the
    other is a rollout that never happened -- and the board gave no way to
    tell them apart. The first instinct on seeing an unjudgeable number is to
    disbelieve the screen.

    Counted on the production day the handover recorded for itself, not on the
    wall-clock date it arrived: a night shift crossing midnight belongs to the
    day it was worked, and a tablet that synced the next morning must not move
    it. Both have been stored since migration 113.
    """
    rows = db.execute(text("""
        SELECT s.production_day::date AS day,
               count(*) FILTER (WHERE s.status <> 'REJECTED') AS filed,
               count(DISTINCT s.asset_id) FILTER (WHERE s.status <> 'REJECTED')
                 AS machines,
               count(*) FILTER (WHERE s.status = 'BLOCKED') AS blocked
          FROM hoto_session s
         WHERE s.production_day IS NOT NULL
           AND s.production_day > (CURRENT_DATE - CAST(:d AS int))
           AND (CAST(:sc AS text) IS NULL OR s.shift_code = CAST(:sc AS text))
         GROUP BY 1 ORDER BY 1
    """), {"d": days, "sc": shift_code}).mappings().all()

    by_day = {r["day"].isoformat(): r for r in rows}
    today = datetime.now().astimezone().date()
    out = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        r = by_day.get(d)
        # A day with no handovers is a zero, not a gap. Leaving it out would
        # draw a flat line through the very days worth noticing.
        out.append({"day": d,
                    "filed": int(r["filed"]) if r else 0,
                    "machines": int(r["machines"]) if r else 0,
                    "blocked": int(r["blocked"]) if r else 0})
    return out


# ── changing a machine's state ───────────────────────────────────────────────

def decide(db: Session, asset_id: int, state: str, actor: str, *,
           reason: str | None = None, may_override: bool = False,
           shift_instance_id: int | None = None) -> dict[str, Any]:
    """A supervisor's call on one machine.

    THE ONE RULE. Stopping a machine, or sending it to the workshop, needs
    nothing but the capture permission -- a supervisor who thinks a machine
    should stop may always stop it, and a system that argued with him would be
    worked around within a week.

    Putting it back to work more freely than its open defects allow is an
    override: it
    needs `hoto.override` and a written reason, and it is recorded as an
    override rather than as a normal release. That is the mechanism. WHO holds
    `hoto.override` is deliberately not decided here -- it is question 1 of the
    three still open in docs/hoto-scope.md section 9, and today the permission
    sits only with the superadmins because the platform grants every new
    permission to them.
    """
    if state not in WORK_PERMITTED:
        raise BoardError(
            [f"{state} is not a machine state. One of: "
             + ", ".join(sorted(WORK_PERMITTED))], status=422)

    asset = db.execute(text("""
        SELECT a.asset_id, a.fleet_code FROM asset a WHERE a.asset_id = :a
    """), {"a": asset_id}).mappings().first()
    if not asset:
        raise BoardError([f"no such machine: {asset_id}"], status=404)

    worst = db.execute(text("""
        SELECT severity FROM hoto_defect
         WHERE asset_id = :a AND state IN ('RAISED','ACKNOWLEDGED','RECTIFIED')
         ORDER BY CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3
                                WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC
         LIMIT 1
    """), {"a": asset_id}).scalar()
    implied = SEVERITY_STATE.get(worst or "", "AVAILABLE")

    overriding = WORK_PERMITTED[state] > WORK_PERMITTED[implied]
    if overriding:
        blocking = db.execute(text("""
            SELECT d.defect_ref, d.item_label, d.severity, d.state
              FROM hoto_defect d
             WHERE d.asset_id = :a AND d.severity IN ('HIGH','CRITICAL')
               AND d.state IN ('RAISED','ACKNOWLEDGED','RECTIFIED')
             ORDER BY d.raised_at
        """), {"a": asset_id}).mappings().all()
        held_by = ", ".join(f"{b['defect_ref']} ({b['item_label']}, {b['state'].lower()})"
                            for b in blocking)
        if not may_override:
            raise BoardError(
                [f"{asset['fleet_code']} should be {implied} while "
                 f"{held_by} is open. Releasing it anyway needs the HOTO "
                 f"override permission."], status=403)
        if not (reason or "").strip():
            raise BoardError(
                ["say why the machine is being released with "
                 f"{held_by} still open -- an override with no reason is "
                 "indistinguishable from a mistake"])

    note = (reason or "").strip() or f"set to {state} by {actor}"
    if overriding:
        note = f"OVERRIDE: {note}"

    moved = set_state(db, asset_id, state, reason=note, actor=actor,
                      shift_instance_id=shift_instance_id)
    if moved is None:
        db.commit()
        return {"asset_id": asset_id, "fleet_code": asset["fleet_code"],
                "state": state, "changed": False, "override": False,
                "message": f"{asset['fleet_code']} is already {state}."}

    if overriding:
        # Recorded where the mine's own exception queue will find it, not only
        # in this table's history -- an override is the kind of thing somebody
        # should be told about rather than have to go looking for.
        _log_override(db, asset_id, asset["fleet_code"], state, implied, actor, note)

    db.commit()
    logger.info("board: %s -> %s by %s%s", asset["fleet_code"], state, actor,
                " (OVERRIDE)" if overriding else "")
    return {"asset_id": asset_id, "fleet_code": asset["fleet_code"],
            "state": state, "changed": True, "override": overriding,
            "from": moved["from"], "implied_state": implied, "reason": note}


def _log_override(db: Session, asset_id: int, fleet_code: str, state: str,
                  implied: str, actor: str, note: str) -> None:
    try:
        # Same shape the capture path uses for HOTO_VERDICT_DRIFT. No
        # dedupe_key: two overrides on the same machine are two decisions, and
        # collapsing them would hide the second one.
        db.execute(text("""
            INSERT INTO ops_exception
                (kind, severity, asset_id, detail, owner_role, status, raised_by)
            VALUES ('HOTO_STATE_OVERRIDE', 'HIGH', :a, :d,
                    'SUPERVISOR', 'OPEN', :by)
        """), {"a": asset_id, "by": actor,
               "d": (f"{fleet_code} set to {state} although its open defects "
                     f"imply {implied}. {note}")})
    except Exception:                                        # noqa: BLE001
        # An override that happened must not be undone because the notice about
        # it could not be written. The availability_event row is the record;
        # this is the notification.
        logger.exception("could not raise the override exception for %s", fleet_code)
        db.rollback()


def history(db: Session, asset_id: int, limit: int = 40) -> list[dict[str, Any]]:
    """How this machine's state has moved, newest first."""
    rows = db.execute(text("""
        SELECT availability_event_id, state, reason, started_at, ended_at,
               source, recorded_by, released_by
          FROM availability_event
         WHERE asset_id = :a
         ORDER BY started_at DESC
         LIMIT :lim
    """), {"a": asset_id, "lim": min(limit, 200)}).mappings().all()
    return [dict(r) for r in rows]
