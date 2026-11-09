"""Defects, and what a failed check does to a machine.

── THE ESCALATION RULES ─────────────────────────────────────────────────────
Severity comes from the checklist item (migration 105), so the mine tunes it in
the admin panel rather than asking for a release. What each severity *does* is
here:

    LOW        recorded. Somebody is told.
    MEDIUM     a defect is raised and owned.
    HIGH       the machine is RESTRICTED -- limited operation, acknowledged.
    CRITICAL   the machine is LOCKED and does not go to work.

The state change is the part people underestimate. A defect that raises a
ticket and leaves the machine running is a ticket; a defect that stops the
machine is a control. Only HIGH and CRITICAL move the machine, because a mine
that locks a machine over a dim cabin light stops using the system by Friday.

── WHY A DEFECT IS RAISED BY THE SERVER, NOT THE DEVICE ─────────────────────
The device decides whether an ANSWER is adverse -- it must, because it has to
tell the operator at the machine. Whether that adverse answer is a NEW defect
or the fourth sighting of one raised last Tuesday depends on what else is open
across every device and every shift, which no single tablet knows. So the
device reports findings and the server decides what they mean.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# What each severity does to the machine. Absent means: record it, move nothing.
SEVERITY_STATE = {"HIGH": "RESTRICTED", "CRITICAL": "LOCKED"}
OPEN_STATES = ("RAISED", "ACKNOWLEDGED", "RECTIFIED", "VERIFIED")

ALLOWED = {
    "RAISED":       {"ACKNOWLEDGED", "CANCELLED"},
    "ACKNOWLEDGED": {"RECTIFIED", "CANCELLED"},
    # A repair that failed its check goes BACK, and that is worth seeing.
    "RECTIFIED":    {"VERIFIED", "ACKNOWLEDGED", "CANCELLED"},
    "VERIFIED":     {"CLOSED", "ACKNOWLEDGED"},
    "CLOSED":       set(),
    "CANCELLED":    set(),
}


class DefectError(ValueError):
    def __init__(self, problems: list[str], status: int = 422):
        self.problems = problems
        self.status = status
        super().__init__("; ".join(problems))


# ── raising ──────────────────────────────────────────────────────────────────

def raise_from_session(db: Session, session_id: int, actor: str) -> dict[str, Any]:
    """Turn a session's adverse answers into defects, and move the machine.

    Called from the capture path. Idempotent by construction: a second run
    finds the open defect and adds a sighting rather than a duplicate, and the
    unique index behind that is enforced by the database, not by this function
    remembering to check.
    """
    sess = db.execute(text("""
        SELECT session_id, asset_id, shift_instance_id, operator_id, status
          FROM hoto_session WHERE session_id = :s
    """), {"s": session_id}).mappings().first()
    if not sess:
        raise DefectError([f"no such handover: {session_id}"], status=404)

    adverse = db.execute(text("""
        SELECT r.response_id, r.item_id, r.item_label, r.answer, r.numeric_value,
               r.severity, r.remark, i.is_critical
          FROM hoto_response r
          LEFT JOIN hoto_checklist_item i ON i.item_id = r.item_id
         WHERE r.session_id = :s
           AND (r.answer IN ('NOT_OK', 'CAUTION') OR r.in_range = false)
    """), {"s": session_id}).mappings().all()

    raised, sighted = [], []
    worst = None

    for a in adverse:
        sev = a["severity"] or "MEDIUM"
        if worst is None or _rank(sev) > _rank(worst):
            worst = sev

        existing = db.execute(text("""
            SELECT defect_id FROM hoto_defect
             WHERE asset_id = :a AND item_id = :i AND state = ANY(:open)
        """), {"a": sess["asset_id"], "i": a["item_id"],
               "open": list(OPEN_STATES)}).scalar()

        if existing:
            # The fourth sighting of a known defect, not a fourth defect.
            db.execute(text("""
                INSERT INTO hoto_defect_sighting
                    (defect_id, session_id, response_id, observed_by, answer,
                     numeric_value, remark)
                VALUES (:d, :s, :r, :by, :ans, :num, :rem)
                ON CONFLICT (defect_id, response_id) DO NOTHING
            """), {"d": existing, "s": session_id, "r": a["response_id"],
                   "by": actor, "ans": a["answer"], "num": a["numeric_value"],
                   "rem": a["remark"]})
            sighted.append({"defect_id": existing, "item": a["item_label"]})
            continue

        did = db.execute(text("""
            INSERT INTO hoto_defect
                (asset_id, raised_session_id, raised_response_id, item_id, item_label,
                 severity, description, blocks_operation, owner_role, raised_by)
            VALUES (:a, :s, :r, :i, :lbl, :sev, :desc, :blocks, 'MAINTENANCE', :by)
            RETURNING defect_id
        """), {"a": sess["asset_id"], "s": session_id, "r": a["response_id"],
               "i": a["item_id"], "lbl": a["item_label"], "sev": sev,
               "desc": a["remark"] or f"{a['item_label']} reported "
                                      f"{(a['answer'] or 'out of range').replace('_', ' ').lower()}",
               # Only a critical item holds the machine. A HIGH restricts it;
               # the machine still works, under acknowledgement.
               "blocks": bool(a["is_critical"]), "by": actor}).scalar()
        db.execute(text("""
            UPDATE hoto_defect SET defect_ref = 'DEF-' || LPAD(CAST(:d AS text), 7, '0')
             WHERE defect_id = :d
        """), {"d": did})
        db.execute(text("""
            INSERT INTO hoto_defect_event (defect_id, from_state, to_state, actor, note)
            VALUES (:d, NULL, 'RAISED', :by, :n)
        """), {"d": did, "by": actor,
               "n": f"From handover {session_id}, {a['item_label']}"})
        db.execute(text("""
            INSERT INTO hoto_defect_sighting
                (defect_id, session_id, response_id, observed_by, answer, numeric_value, remark)
            VALUES (:d, :s, :r, :by, :ans, :num, :rem)
            ON CONFLICT DO NOTHING
        """), {"d": did, "s": session_id, "r": a["response_id"], "by": actor,
               "ans": a["answer"], "num": a["numeric_value"], "rem": a["remark"]})
        raised.append({"defect_id": did, "item": a["item_label"], "severity": sev})

    moved = None
    if worst and worst in SEVERITY_STATE:
        moved = set_state(db, sess["asset_id"], SEVERITY_STATE[worst],
                          reason=f"{worst} defect from handover {session_id}",
                          actor=actor, shift_instance_id=sess["shift_instance_id"])

    return {"raised": raised, "sighted": sighted,
            "worst_severity": worst, "state_change": moved}


def _rank(s: str) -> int:
    return {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}.get(s, 0)


# ── the machine's state ──────────────────────────────────────────────────────

def current_state(db: Session, asset_id: int) -> dict[str, Any] | None:
    """The open availability window, which is the current state."""
    row = db.execute(text("""
        SELECT availability_event_id, state, reason, started_at, source, recorded_by
          FROM availability_event
         WHERE asset_id = :a AND ended_at IS NULL
         ORDER BY started_at DESC LIMIT 1
    """), {"a": asset_id}).mappings().first()
    return dict(row) if row else None


def set_state(db: Session, asset_id: int, state: str, *, reason: str, actor: str,
              shift_instance_id: int | None = None) -> dict[str, Any] | None:
    """Close the open window and open a new one.

    A NO-OP IF THE MACHINE IS ALREADY THERE. Re-locking a locked machine every
    time another handover finds the same fault would bury the moment it was
    first locked under forty identical rows, and that moment is the one
    somebody will want.
    """
    now = current_state(db, asset_id)
    if now and now["state"] == state:
        return None

    if now:
        db.execute(text("""
            UPDATE availability_event SET ended_at = now(), released_by = :by
             WHERE availability_event_id = :id
        """), {"id": now["availability_event_id"], "by": actor})

    db.execute(text("""
        INSERT INTO availability_event
            (asset_id, state, reason, started_at, shift_instance_id, source, recorded_by)
        VALUES (:a, :s, :r, now(), :si, 'HOTO', :by)
    """), {"a": asset_id, "s": state, "r": reason, "si": shift_instance_id, "by": actor})

    logger.info("asset %s %s -> %s (%s)", asset_id,
                now["state"] if now else "none", state, reason)
    return {"from": now["state"] if now else None, "to": state, "reason": reason}


# ── the workshop's queue ─────────────────────────────────────────────────────

def queue(db: Session, *, asset_id: int | None = None, state: str | None = None,
          severity: str | None = None, open_only: bool = True,
          limit: int = 200) -> list[dict[str, Any]]:
    rows = db.execute(text("""
        SELECT d.defect_id, d.defect_ref, d.state, d.severity, d.blocks_operation,
               d.item_label, d.description, d.owner_role,
               d.raised_by, d.raised_at, d.acknowledged_at,
               d.rectified_by, d.rectified_at, d.rectification_note,
               d.verified_by, d.verified_at, d.closed_at, d.cancel_reason,
               a.asset_id, a.fleet_code, at.name AS asset_type_name,
               -- How long it has been open. The number the morning meeting
               -- asks for, and the reason repeat reports are sightings rather
               -- than new defects.
               EXTRACT(DAY FROM now() - d.raised_at)::int AS age_days,
               (SELECT count(*) FROM hoto_defect_sighting s WHERE s.defect_id = d.defect_id) AS sightings,
               (SELECT max(s.observed_at) FROM hoto_defect_sighting s
                 WHERE s.defect_id = d.defect_id) AS last_seen_at,
               (SELECT ae.state FROM availability_event ae
                 WHERE ae.asset_id = d.asset_id AND ae.ended_at IS NULL
                 ORDER BY ae.started_at DESC LIMIT 1) AS machine_state
          FROM hoto_defect d
          JOIN asset a       ON a.asset_id = d.asset_id
          JOIN asset_type at ON at.asset_type_id = a.asset_type_id
         WHERE (NOT :open_only OR d.state = ANY(:open))
           AND (CAST(:asset AS bigint) IS NULL OR d.asset_id = CAST(:asset AS bigint))
           AND (CAST(:state AS text)   IS NULL OR d.state    = CAST(:state AS text))
           AND (CAST(:sev   AS text)   IS NULL OR d.severity = CAST(:sev AS text))
         ORDER BY d.blocks_operation DESC,
                  CASE d.severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3
                                  WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC,
                  d.raised_at
         LIMIT :lim
    """), {"open_only": open_only, "open": list(OPEN_STATES), "asset": asset_id,
           "state": state, "sev": severity, "lim": min(limit, 1000)}).mappings().all()
    return [dict(r) for r in rows]


def detail(db: Session, defect_id: int) -> dict[str, Any] | None:
    head = db.execute(text("""
        SELECT d.*, a.fleet_code, at.name AS asset_type_name
          FROM hoto_defect d
          JOIN asset a ON a.asset_id = d.asset_id
          JOIN asset_type at ON at.asset_type_id = a.asset_type_id
         WHERE d.defect_id = :d
    """), {"d": defect_id}).mappings().first()
    if not head:
        return None
    out = dict(head)
    out["sightings"] = [dict(r) for r in db.execute(text("""
        SELECT s.sighting_id, s.observed_by, s.observed_at, s.answer,
               s.numeric_value, s.remark, hs.session_ref
          FROM hoto_defect_sighting s
          LEFT JOIN hoto_session hs ON hs.session_id = s.session_id
         WHERE s.defect_id = :d ORDER BY s.observed_at
    """), {"d": defect_id}).mappings().all()]
    out["events"] = [dict(r) for r in db.execute(text("""
        SELECT from_state, to_state, actor, at, note FROM hoto_defect_event
         WHERE defect_id = :d ORDER BY at
    """), {"d": defect_id}).mappings().all()]
    return out


def transition(db: Session, defect_id: int, to_state: str, actor: str,
               *, note: str | None = None) -> dict[str, Any]:
    """Move a defect along, and release the machine when it is genuinely fixed.

    The database refuses a fitter verifying his own repair (migration 108). This
    refuses the moves that make no sense in order, and says which ones would.
    """
    d = db.execute(text("""
        SELECT defect_id, asset_id, state, severity, blocks_operation,
               rectified_by, item_label
          FROM hoto_defect WHERE defect_id = :d
    """), {"d": defect_id}).mappings().first()
    if not d:
        raise DefectError([f"no such defect: {defect_id}"], status=404)

    if to_state not in ALLOWED.get(d["state"], set()):
        allowed = ", ".join(sorted(ALLOWED.get(d["state"], set()))) or "nothing"
        raise DefectError(
            [f"a {d['state']} defect cannot become {to_state}. From here: {allowed}."],
            status=409)

    if to_state == "VERIFIED" and d["rectified_by"] == actor:
        raise DefectError(
            ["you repaired this, so you cannot be the one who verifies it — "
             "verification has to be independent or it is not verification"],
            status=409)
    if to_state == "CANCELLED" and not (note or "").strip():
        raise DefectError(["say why it is being cancelled"])
    if to_state == "RECTIFIED" and not (note or "").strip():
        raise DefectError(["say what was done"])

    cols = {
        "ACKNOWLEDGED": "state=:st, acknowledged_by=:by, acknowledged_at=now()",
        "RECTIFIED":    "state=:st, rectified_by=:by, rectified_at=now(), rectification_note=:note",
        "VERIFIED":     "state=:st, verified_by=:by, verified_at=now()",
        "CLOSED":       "state=:st, closed_by=:by, closed_at=now()",
        "CANCELLED":    "state=:st, cancel_reason=:note",
    }[to_state]

    # Going back to ACKNOWLEDGED means the repair failed its check. Clear the
    # rectification so the next verification is of the NEXT repair, not a
    # timestamp left over from the one that did not work.
    if to_state == "ACKNOWLEDGED" and d["state"] in ("RECTIFIED", "VERIFIED"):
        cols = ("state=:st, acknowledged_by=:by, acknowledged_at=now(), "
                "rectified_by=NULL, rectified_at=NULL, rectification_note=NULL, "
                "verified_by=NULL, verified_at=NULL")

    db.execute(text(f"UPDATE hoto_defect SET {cols}, updated_at=now() WHERE defect_id=:d"),
               {"d": defect_id, "st": to_state, "by": actor, "note": note})
    db.execute(text("""
        INSERT INTO hoto_defect_event (defect_id, from_state, to_state, actor, note)
        VALUES (:d, :frm, :to, :by, :n)
    """), {"d": defect_id, "frm": d["state"], "to": to_state, "by": actor, "n": note})

    # ── releasing the machine ────────────────────────────────────────────────
    # Only when nothing blocking is still open. A machine with two critical
    # defects does not come back on the first repair, and this is where that
    # would otherwise be got wrong.
    released = None
    if to_state in ("VERIFIED", "CLOSED", "CANCELLED"):
        still_blocked = db.execute(text("""
            SELECT count(*) FROM hoto_defect
             WHERE asset_id = :a AND blocks_operation
               AND state IN ('RAISED', 'ACKNOWLEDGED', 'RECTIFIED')
        """), {"a": d["asset_id"]}).scalar()
        if not still_blocked:
            released = set_state(db, d["asset_id"], "AVAILABLE",
                                 reason=f"{d['item_label']} verified ({defect_id})",
                                 actor=actor)

    db.commit()
    return {"defect_id": defect_id, "from": d["state"], "to": to_state,
            "machine_released": released}
