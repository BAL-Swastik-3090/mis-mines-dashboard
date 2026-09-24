"""Can this machine start work, with this person, right now — and if not, why.

Readiness is never stored. It is recomputed from what is on file every time it
is asked, because the alternative is a screen that says BLOCKED about a licence
renewed an hour ago, or READY about a machine that broke down at lunch. A stored
flag is only ever as fresh as the last thing that remembered to update it.

Every answer carries its reasons. "Not available" tells a supervisor nothing
they can act on at half past five in the morning; "operator absent, three
eligible operators present, HOTO not started" tells them exactly what to do
next. So each check returns what it found rather than a boolean, and the caller
decides what to show.

Blockers stop work. Warnings do not, but somebody should know: a profile that
has not been approved, an assessment at level 1, a document nobody has verified.
The difference is deliberate — a mine that blocks on everything gets an override
culture, and an override culture is worse than a warning nobody reads.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

# Machine states that stop work outright. Everything else is a note.
BLOCKING_MACHINE_STATES = {
    "BREAKDOWN", "MAINTENANCE", "INSPECTION_HOLD", "COMPLIANCE_HOLD", "PLANNED_DOWN",
}
WARNING_MACHINE_STATES = {"FUEL_REQUIRED", "LOCATION_RESTRICTED"}

# Operator states, likewise.
BLOCKING_OPERATOR_STATES = {"ABSENT", "LEAVE", "MEDICAL_HOLD", "SUSPENDED"}
WARNING_OPERATOR_STATES = {"TRAINING"}


@dataclass
class Readiness:
    """What was found, in the words a supervisor would use."""
    status: str                                   # READY / READY_WITH_WARNING / BLOCKED
    blockers: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    facts: dict = field(default_factory=dict)     # the state each part was in

    def as_dict(self) -> dict:
        return {"status": self.status, "blockers": self.blockers,
                "warnings": self.warnings, "facts": self.facts}


def _settle(blockers: list[str], warnings: list[str]) -> str:
    if blockers:
        return "BLOCKED"
    return "READY_WITH_WARNING" if warnings else "READY"


def machine_state(db: Session, asset_id: int) -> dict:
    """What the machine is doing, and what is holding it.

    Live state comes from three places that disagree often enough to matter: the
    register (is it even active), the open availability events (has somebody
    declared it broken), and the deployment table (is anyone running it). Where
    they disagree, the register's own facts win and the disagreement becomes an
    exception rather than being resolved silently.
    """
    row = db.execute(text("""
        SELECT a.asset_id, a.fleet_code, a.nickname, a.status, a.approval_status,
               a.asset_type_id, t.name AS asset_type, a.current_reading, a.reading_uom
        FROM asset a LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        WHERE a.asset_id = :id
    """), {"id": asset_id}).mappings().first()
    if not row:
        return {"found": False}

    holds = db.execute(text("""
        SELECT availability_event_id, state, reason, started_at, source
        FROM availability_event
        WHERE asset_id = :id AND ended_at IS NULL
        ORDER BY started_at DESC
    """), {"id": asset_id}).mappings().all()

    live = db.execute(text("""
        SELECT d.deployment_id, d.deployment_ref, d.status, d.started_at,
               d.operator_id, p.display_name AS operator_name
        FROM deployment d
        LEFT JOIN operator o ON o.operator_id = d.operator_id
        LEFT JOIN party p    ON p.party_id = o.party_id
        WHERE d.asset_id = :id AND d.status IN ('READY', 'RUNNING', 'PAUSED')
        LIMIT 1
    """), {"id": asset_id}).mappings().first()

    expiring = db.execute(text("""
        SELECT alert_type, days_left, severity FROM asset_alert
        WHERE asset_id = :id AND severity = 'EXPIRED'
    """), {"id": asset_id}).mappings().all()

    pending_hoto = db.execute(text("""
        SELECT hoto_id, hoto_ref, status FROM hoto
        WHERE asset_id = :id AND status IN ('PENDING', 'BLOCKED')
        ORDER BY created_at DESC LIMIT 1
    """), {"id": asset_id}).mappings().first()

    # The single word for the fleet board, in the order that matters: what stops
    # work first is what the machine is.
    hold_states = [h["state"] for h in holds]
    if row["status"] in ("DISPOSED", "INACTIVE"):
        state = "DECOMMISSIONED"
    elif any(s in BLOCKING_MACHINE_STATES for s in hold_states):
        state = next(s for s in hold_states if s in BLOCKING_MACHINE_STATES)
    elif live and live["status"] == "RUNNING":
        state = "RUNNING"
    elif live:
        state = "ASSIGNED"
    elif pending_hoto:
        state = "AWAITING_HOTO"
    elif any(s in WARNING_MACHINE_STATES for s in hold_states):
        state = next(s for s in hold_states if s in WARNING_MACHINE_STATES)
    else:
        state = "AVAILABLE"

    return {
        "found": True, "asset_id": row["asset_id"], "fleet_code": row["fleet_code"],
        "nickname": row["nickname"], "asset_type": row["asset_type"],
        "asset_type_id": row["asset_type_id"], "register_status": row["status"],
        "approval_status": row["approval_status"], "state": state,
        "holds": [dict(h) for h in holds],
        "expired_documents": [dict(e) for e in expiring],
        "deployment": dict(live) if live else None,
        "open_hoto": dict(pending_hoto) if pending_hoto else None,
        "reading": float(row["current_reading"]) if row["current_reading"] is not None else None,
        "reading_uom": row["reading_uom"],
    }


def operator_state(db: Session, operator_id: int) -> dict:
    """Whether the person is here, and whether they are already committed."""
    row = db.execute(text("""
        SELECT o.operator_id, o.operator_ref, o.profile_status, o.approval_status,
               p.display_name, o.designation
        FROM operator o JOIN party p ON p.party_id = o.party_id
        WHERE o.operator_id = :id
    """), {"id": operator_id}).mappings().first()
    if not row:
        return {"found": False}

    holds = db.execute(text("""
        SELECT availability_event_id, state, reason, started_at, source
        FROM availability_event WHERE operator_id = :id AND ended_at IS NULL
        ORDER BY started_at DESC
    """), {"id": operator_id}).mappings().all()

    live = db.execute(text("""
        SELECT d.deployment_id, d.deployment_ref, d.status, a.fleet_code
        FROM deployment d JOIN asset a ON a.asset_id = d.asset_id
        WHERE d.operator_id = :id AND d.status IN ('READY', 'RUNNING', 'PAUSED')
        LIMIT 1
    """), {"id": operator_id}).mappings().first()

    hold_states = [h["state"] for h in holds]
    if row["profile_status"] != "ACTIVE":
        state = row["profile_status"]
    elif any(s in BLOCKING_OPERATOR_STATES for s in hold_states):
        state = next(s for s in hold_states if s in BLOCKING_OPERATOR_STATES)
    elif live:
        state = "OPERATING" if live["status"] == "RUNNING" else "ASSIGNED"
    elif any(s in WARNING_OPERATOR_STATES for s in hold_states):
        state = next(s for s in hold_states if s in WARNING_OPERATOR_STATES)
    elif any(s == "PRESENT" for s in hold_states):
        state = "PRESENT"
    else:
        # Nothing has said they are here, and nothing has said they are not.
        # That is its own answer: never assume presence from silence.
        state = "ATTENDANCE_PENDING"

    return {
        "found": True, "operator_id": row["operator_id"], "operator_ref": row["operator_ref"],
        "name": row["display_name"], "designation": row["designation"],
        "profile_status": row["profile_status"], "approval_status": row["approval_status"],
        "state": state, "holds": [dict(h) for h in holds],
        "deployment": dict(live) if live else None,
    }


def eligibility(db: Session, operator_id: int, asset_id: int) -> Readiness:
    """The person's side: may they run this machine at all.

    Documents, competency and authorisation — the questions that would be asked
    after an incident, asked before one instead.
    """
    blockers: list[str] = []
    warnings: list[str] = []

    op = operator_state(db, operator_id)
    machine = machine_state(db, asset_id)
    if not op["found"]:
        return Readiness("BLOCKED", ["Operator not found"], [], {})
    if not machine["found"]:
        return Readiness("BLOCKED", ["Machine not found"], [], {})

    if op["approval_status"] != "APPROVED":
        warnings.append("Operator profile has not been approved")

    # Leave that was approved weeks ago blocks today just as firmly as a
    # supervisor marking somebody absent this morning, and it is the one the
    # supervisor has forgotten by now — which is exactly why it is checked here
    # rather than left to whoever remembers the register.
    granted = db.execute(text("""
        SELECT lr.leave_ref, lr.to_date, lt.name AS type_name
        FROM leave_request lr
        JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
        WHERE lr.operator_id = :id AND lr.status = 'APPROVED'
          AND lt.blocks_deployment
          AND CURRENT_DATE BETWEEN lr.from_date AND lr.to_date
        LIMIT 1
    """), {"id": operator_id}).mappings().first()
    if granted:
        blockers.append(
            f"On approved {granted['type_name'].lower()} until "
            f"{granted['to_date']:%d %b} ({granted['leave_ref']})")

    docs = db.execute(text("""
        SELECT record_type, valid_upto, verification_status FROM operator_record
        WHERE operator_id = :id AND status = 'ACTIVE'
          AND record_type IN ('LICENCE', 'MEDICAL', 'AUTHORISATION')
    """), {"id": operator_id}).mappings().all()

    today = date.today()
    for kind, label in (("LICENCE", "licence"), ("MEDICAL", "medical fitness")):
        held = [d for d in docs if d["record_type"] == kind]
        if not held:
            blockers.append(f"No {label} on file")
        elif all(d["valid_upto"] and d["valid_upto"] < today for d in held):
            blockers.append(f"{label.capitalize()} expired")
        elif all(d["verification_status"] != "VERIFIED" for d in held):
            warnings.append(f"{label.capitalize()} has not been verified")

    comp = db.execute(text("""
        -- Cleared on this machine, or cleared on its class.
        --
        -- The class row was the only one read, and the asset_id column was
        -- filtered out entirely — so a man assessed on one particular
        -- excavator counted for nothing and the register held a fact the
        -- platform refused to use. A mine does clear somebody on one machine
        -- and not its sister; that is what the column is for.
        --
        -- The machine's own row wins where both exist, which is why it sorts
        -- first: it is the more specific statement about the same man.
        SELECT level, valid_upto, next_assessment_due, rating
          FROM operator_competency
         WHERE operator_id = :o AND dimension = 'OVERALL' AND status = 'ACTIVE'
           AND (asset_id = :a OR (asset_id IS NULL AND asset_type_id = :t))
         ORDER BY asset_id NULLS LAST
         LIMIT 1
    """), {"o": operator_id, "t": machine["asset_type_id"],
           "a": machine["asset_id"]}).mappings().first()

    if not comp or (comp["level"] or 0) == 0:
        blockers.append(f"Not assessed on {machine['asset_type'] or 'this class'}")
    elif comp["level"] == 1:
        warnings.append("Assessed at level 1 — assisted operation only")
    if comp and comp["valid_upto"] and comp["valid_upto"] < today:
        blockers.append("Competency assessment has lapsed")
    if comp and comp["next_assessment_due"] and comp["next_assessment_due"] < today:
        warnings.append(f"Reassessment overdue by {(today - comp['next_assessment_due']).days} days")

    return Readiness(_settle(blockers, warnings), blockers, warnings,
                     {"operator": op, "machine": machine,
                      "level": comp["level"] if comp else 0,
                      "rating": comp["rating"] if comp else None})


def deployment_readiness(db: Session, asset_id: int, operator_id: int | None,
                         shift_instance_id: int | None = None) -> Readiness:
    """The whole question: can this machine start work with this person, now.

    Machine availability is not deployment readiness — the specification is
    right to insist on the distinction. A machine can be perfectly available and
    still undeployable because nobody is cleared to sit in it.
    """
    blockers: list[str] = []
    warnings: list[str] = []

    machine = machine_state(db, asset_id)
    if not machine["found"]:
        return Readiness("BLOCKED", ["Machine not found"], [], {})

    if machine["register_status"] in ("DISPOSED", "INACTIVE"):
        blockers.append(f"Machine is {machine['register_status'].lower()} on the register")
    if machine["approval_status"] != "APPROVED":
        warnings.append("Machine registration has not been approved")

    for hold in machine["holds"]:
        if hold["state"] in BLOCKING_MACHINE_STATES:
            blockers.append(f"{hold['state'].replace('_', ' ').capitalize()}"
                            + (f" — {hold['reason']}" if hold["reason"] else ""))
        elif hold["state"] in WARNING_MACHINE_STATES:
            warnings.append(hold["state"].replace("_", " ").capitalize())

    for doc in machine["expired_documents"]:
        blockers.append(f"{doc['alert_type']} expired {-doc['days_left']} days ago")

    if machine["deployment"] and machine["deployment"].get("operator_id") not in (None, operator_id):
        blockers.append(f"Already deployed to {machine['deployment']['operator_name']}"
                        f" ({machine['deployment']['deployment_ref']})")

    if machine["open_hoto"] and machine["open_hoto"]["status"] == "BLOCKED":
        blockers.append(f"Handover {machine['open_hoto']['hoto_ref']} is blocked")
    elif machine["open_hoto"]:
        warnings.append(f"Handover {machine['open_hoto']['hoto_ref']} is not finished")

    facts: dict = {"machine": machine}

    if operator_id is None:
        blockers.append("No operator")
        facts["operator"] = None
        return Readiness("BLOCKED", blockers, warnings, facts)

    op = operator_state(db, operator_id)
    facts["operator"] = op
    if not op["found"]:
        return Readiness("BLOCKED", blockers + ["Operator not found"], warnings, facts)

    if op["state"] in BLOCKING_OPERATOR_STATES:
        blockers.append(f"Operator {op['state'].replace('_', ' ').lower()}")
    elif op["state"] == "ATTENDANCE_PENDING":
        # Silence is not presence. Say so, rather than assuming either way.
        warnings.append("Attendance not recorded for this operator")
    elif op["state"] in WARNING_OPERATOR_STATES:
        warnings.append(f"Operator in {op['state'].lower()}")

    if op["deployment"] and op["deployment"].get("fleet_code") != machine["fleet_code"]:
        blockers.append(f"Operator is already on {op['deployment']['fleet_code']}"
                        f" ({op['deployment']['deployment_ref']})")

    elig = eligibility(db, operator_id, asset_id)
    blockers += elig.blockers
    warnings += elig.warnings
    facts["level"] = elig.facts.get("level")
    facts["rating"] = elig.facts.get("rating")

    if shift_instance_id:
        shift = db.execute(text(
            "SELECT status, production_day FROM shift_instance WHERE shift_instance_id = :s"
        ), {"s": shift_instance_id}).mappings().first()
        if not shift:
            blockers.append("Shift not found")
        elif shift["status"] == "CLOSED":
            blockers.append("That shift is closed")
        elif shift["status"] == "CANCELLED":
            blockers.append("That shift was cancelled")
        elif shift["status"] == "PLANNED":
            warnings.append("Shift has not been opened yet")
        facts["shift"] = dict(shift) if shift else None

    return Readiness(_settle(blockers, warnings), blockers, warnings, facts)


def fleet_readiness(db: Session, plant_id: int | None = None) -> list[dict]:
    """The whole fleet's state and readiness, in a fixed number of queries.

    The per-machine functions above are right for one machine and wrong for
    thirty: each does half a dozen round trips, and over a tunnel to another
    site that is six hundred round trips for one screen — which is exactly how
    this timed out at sixty seconds and took every other request down with it,
    since they all queue behind the same worker.

    So the fleet screen asks five questions about all the machines at once and
    assembles the answers here. The reasoning is identical to
    deployment_readiness — deliberately, because two functions that decide
    readiness differently would be worse than a slow one.
    """
    where = "(CAST(:plant AS bigint) IS NULL OR a.plant_id = CAST(:plant AS bigint))"
    params = {"plant": plant_id}

    machines = db.execute(text(f"""
        SELECT a.asset_id, a.asset_ref, a.fleet_code, a.nickname, a.status AS register_status,
               a.approval_status, a.asset_type_id, t.name AS asset_type,
               a.current_reading, a.reading_uom, pl.name AS plant
        FROM asset a
        LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        LEFT JOIN plant pl     ON pl.plant_id = a.plant_id
        WHERE {where} AND COALESCE(a.status, 'ACTIVE') <> 'DISPOSED'
        ORDER BY a.fleet_code
    """), params).mappings().all()
    if not machines:
        return []

    holds: dict[int, list[dict]] = {}
    for row in db.execute(text("""
        SELECT availability_event_id, asset_id, state, reason, started_at, source
        FROM availability_event WHERE asset_id IS NOT NULL AND ended_at IS NULL
        ORDER BY started_at DESC
    """)).mappings():
        holds.setdefault(row["asset_id"], []).append(dict(row))

    expired: dict[int, list[dict]] = {}
    for row in db.execute(text("""
        SELECT asset_id, alert_type, days_left FROM asset_alert WHERE severity = 'EXPIRED'
    """)).mappings():
        expired.setdefault(row["asset_id"], []).append(dict(row))

    live: dict[int, dict] = {}
    for row in db.execute(text("""
        SELECT d.deployment_id, d.deployment_ref, d.status, d.started_at, d.asset_id,
               d.operator_id, p.display_name AS operator_name, o.approval_status AS operator_approval
        FROM deployment d
        LEFT JOIN operator o ON o.operator_id = d.operator_id
        LEFT JOIN party p    ON p.party_id = o.party_id
        WHERE d.status IN ('READY', 'RUNNING', 'PAUSED')
    """)).mappings():
        live[row["asset_id"]] = dict(row)

    open_hoto: dict[int, dict] = {}
    for row in db.execute(text("""
        SELECT DISTINCT ON (asset_id) asset_id, hoto_id, hoto_ref, status
        FROM hoto WHERE status IN ('PENDING', 'BLOCKED')
        ORDER BY asset_id, created_at DESC
    """)).mappings():
        open_hoto[row["asset_id"]] = dict(row)

    # Everything about the operators who are currently on a machine, in one go.
    operator_ids = [d["operator_id"] for d in live.values() if d["operator_id"]]
    op_holds: dict[int, list[str]] = {}
    op_docs: dict[int, dict] = {}
    op_comp: dict[tuple[int, int], dict] = {}
    op_leave: dict[int, dict] = {}
    if operator_ids:
        # Somebody on approved leave who is still shown on a machine is worth
        # surfacing loudly: either the leave was granted after the deployment
        # and nobody released it, or the person came in anyway. Both are things
        # the shift board should say out loud rather than average away.
        for row in db.execute(text("""
            SELECT lr.operator_id, lr.leave_ref, lr.to_date, lt.name AS type_name
            FROM leave_request lr
            JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
            WHERE lr.operator_id = ANY(:ids) AND lr.status = 'APPROVED'
              AND lt.blocks_deployment
              AND CURRENT_DATE BETWEEN lr.from_date AND lr.to_date
        """), {"ids": operator_ids}).mappings():
            op_leave[row["operator_id"]] = dict(row)

        for row in db.execute(text("""
            SELECT operator_id, state FROM availability_event
            WHERE operator_id = ANY(:ids) AND ended_at IS NULL
        """), {"ids": operator_ids}).mappings():
            op_holds.setdefault(row["operator_id"], []).append(row["state"])

        for row in db.execute(text("""
            SELECT operator_id, record_type,
                   bool_or(valid_upto IS NULL OR valid_upto >= CURRENT_DATE) AS current,
                   bool_or(verification_status = 'VERIFIED')                 AS verified
            FROM operator_record
            WHERE operator_id = ANY(:ids) AND status = 'ACTIVE'
              AND record_type IN ('LICENCE', 'MEDICAL')
            GROUP BY operator_id, record_type
        """), {"ids": operator_ids}).mappings():
            op_docs.setdefault(row["operator_id"], {})[row["record_type"]] = dict(row)

        # Both kinds, keyed so a machine-specific clearance can be found by the
        # machine and a class one by the class. The bulk path used to drop the
        # machine rows exactly as the single path did, so the two agreed with
        # each other and both were wrong.
        for row in db.execute(text("""
            SELECT operator_id, asset_type_id, asset_id, level, valid_upto,
                   next_assessment_due
            FROM operator_competency
            WHERE operator_id = ANY(:ids) AND dimension = 'OVERALL'
              AND status = 'ACTIVE'
        """), {"ids": operator_ids}).mappings():
            if row["asset_id"]:
                op_comp[(row["operator_id"], "asset", row["asset_id"])] = dict(row)
            else:
                op_comp[(row["operator_id"], "type", row["asset_type_id"])] = dict(row)

    today = date.today()
    out: list[dict] = []

    for m in machines:
        asset_id = m["asset_id"]
        machine_holds = holds.get(asset_id, [])
        hold_states = [h["state"] for h in machine_holds]
        deployment = live.get(asset_id)
        hoto = open_hoto.get(asset_id)
        docs_expired = expired.get(asset_id, [])

        if m["register_status"] in ("DISPOSED", "INACTIVE"):
            state = "DECOMMISSIONED"
        elif any(s in BLOCKING_MACHINE_STATES for s in hold_states):
            state = next(s for s in hold_states if s in BLOCKING_MACHINE_STATES)
        elif deployment and deployment["status"] == "RUNNING":
            state = "RUNNING"
        elif deployment:
            state = "ASSIGNED"
        elif hoto:
            state = "AWAITING_HOTO"
        elif any(s in WARNING_MACHINE_STATES for s in hold_states):
            state = next(s for s in hold_states if s in WARNING_MACHINE_STATES)
        else:
            state = "AVAILABLE"

        blockers: list[str] = []
        warnings: list[str] = []

        if m["register_status"] in ("DISPOSED", "INACTIVE"):
            blockers.append(f"Machine is {m['register_status'].lower()} on the register")
        if m["approval_status"] != "APPROVED":
            warnings.append("Machine registration has not been approved")
        for h in machine_holds:
            if h["state"] in BLOCKING_MACHINE_STATES:
                blockers.append(h["state"].replace("_", " ").capitalize()
                                + (f" — {h['reason']}" if h["reason"] else ""))
            elif h["state"] in WARNING_MACHINE_STATES:
                warnings.append(h["state"].replace("_", " ").capitalize())
        for d in docs_expired:
            blockers.append(f"{d['alert_type']} expired {-d['days_left']} days ago")
        if hoto and hoto["status"] == "BLOCKED":
            blockers.append(f"Handover {hoto['hoto_ref']} is blocked")
        elif hoto:
            warnings.append(f"Handover {hoto['hoto_ref']} is not finished")

        operator_id = deployment["operator_id"] if deployment else None
        if not operator_id:
            blockers.append("No operator")
        else:
            if deployment["operator_approval"] != "APPROVED":
                warnings.append("Operator profile has not been approved")
            states = op_holds.get(operator_id, [])
            granted = op_leave.get(operator_id)
            if granted:
                blockers.append(
                    f"Operator on approved {granted['type_name'].lower()} "
                    f"until {granted['to_date']:%d %b} ({granted['leave_ref']})")
            blocking = next((s for s in states if s in BLOCKING_OPERATOR_STATES), None)
            if blocking:
                blockers.append(f"Operator {blocking.replace('_', ' ').lower()}")
            elif "PRESENT" not in states:
                warnings.append("Attendance not recorded for this operator")

            docs = op_docs.get(operator_id, {})
            for kind, label in (("LICENCE", "licence"), ("MEDICAL", "medical fitness")):
                held = docs.get(kind)
                if not held:
                    blockers.append(f"No {label} on file")
                elif not held["current"]:
                    blockers.append(f"{label.capitalize()} expired")
                elif not held["verified"]:
                    warnings.append(f"{label.capitalize()} has not been verified")

            # The machine's own clearance first; its class as the fallback.
            comp = (op_comp.get((operator_id, "asset", m["asset_id"]))
                    or op_comp.get((operator_id, "type", m["asset_type_id"])))
            if not comp or (comp["level"] or 0) == 0:
                blockers.append(f"Not assessed on {m['asset_type'] or 'this class'}")
            elif comp["level"] == 1:
                warnings.append("Assessed at level 1 — assisted operation only")
            if comp and comp["valid_upto"] and comp["valid_upto"] < today:
                blockers.append("Competency assessment has lapsed")
            if comp and comp["next_assessment_due"] and comp["next_assessment_due"] < today:
                warnings.append(
                    f"Reassessment overdue by {(today - comp['next_assessment_due']).days} days")

        out.append({
            **dict(m), "state": state, "holds": machine_holds,
            "expired_documents": docs_expired,
            "operator": deployment["operator_name"] if deployment else None,
            "operator_id": operator_id,
            "deployment_ref": deployment["deployment_ref"] if deployment else None,
            "deployment_status": deployment["status"] if deployment else None,
            "deployment_id": deployment["deployment_id"] if deployment else None,
            "open_hoto": hoto,
            "readiness": _settle(blockers, warnings),
            "blockers": blockers, "warnings": warnings,
        })

    return out


def candidates_for(db: Session, asset_id: int, limit: int = 10) -> list[dict]:
    """Who could run this machine instead — best first.

    Suggested, never chosen: the system knows who is qualified, the supervisor
    knows who is standing in front of them. Ordered by competency then by how
    recently they operated the class, because the person who ran one last week
    needs less watching than the one who ran one last year.
    """
    machine = machine_state(db, asset_id)
    if not machine["found"] or not machine["asset_type_id"]:
        return []

    rows = db.execute(text("""
        SELECT o.operator_id, o.operator_ref, p.display_name, o.designation,
               c.level, c.rating, c.next_assessment_due,
               (SELECT max(d.started_at) FROM deployment d
                 JOIN asset a2 ON a2.asset_id = d.asset_id
                WHERE d.operator_id = o.operator_id
                  AND a2.asset_type_id = :t)                        AS last_operated,
               EXISTS (SELECT 1 FROM availability_event ae
                        WHERE ae.operator_id = o.operator_id AND ae.ended_at IS NULL
                          AND ae.state IN ('ABSENT','LEAVE','MEDICAL_HOLD','SUSPENDED')) AS unavailable,
               EXISTS (SELECT 1 FROM deployment d2
                        WHERE d2.operator_id = o.operator_id
                          AND d2.status IN ('READY','RUNNING','PAUSED'))                 AS committed
        FROM operator o
        JOIN party p ON p.party_id = o.party_id
        JOIN operator_competency c ON c.operator_id = o.operator_id
         AND c.asset_type_id = :t AND c.dimension = 'OVERALL' AND c.asset_id IS NULL
        WHERE o.profile_status = 'ACTIVE' AND COALESCE(c.level, 0) >= 2
        ORDER BY c.level DESC, c.rating DESC NULLS LAST, last_operated DESC NULLS LAST
        LIMIT :lim
    """), {"t": machine["asset_type_id"], "lim": limit}).mappings().all()

    out = []
    for r in rows:
        check = deployment_readiness(db, asset_id, r["operator_id"])
        out.append({**dict(r), "readiness": check.status,
                    "blockers": check.blockers, "warnings": check.warnings})
    # Those who can actually take it, first.
    out.sort(key=lambda x: (x["readiness"] != "READY", x["readiness"] != "READY_WITH_WARNING"))
    return out
