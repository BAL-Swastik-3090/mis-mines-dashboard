"""Putting the right people on the right machines, and showing the working.

At five in the morning a supervisor has thirty machines, ninety names and
twenty minutes. What actually happens is that the same eight operators go on
the same eight machines because everybody remembers who runs the PC-300, and
the twenty-third excavator gets whoever is standing nearest. That is not
incompetence — it is what a human can do with that many combinations before the
shift starts.

This proposes a full allocation instead, and says why for every line of it.

IT PROPOSES. IT DOES NOT DECIDE. Every suggestion comes with its reasoning
written out, and nothing is written to the deployment table until somebody
accepts it. The supervisor knows that Sahoo's wife is in hospital and that the
loader has been making a noise since Tuesday; the database does not. A system
that allocates silently is one that gets overridden silently, and then nobody
knows what the plan was.

HOW IT CHOOSES. Machines are filled most-constrained-first: the machine only
two people in the mine can legally run is allocated before the tipper forty
people can run, because doing it the other way round is how the scarce operator
ends up on the tipper and the excavator stands idle. Within that, each pairing
scores on:

    competency level     assessed 1 to 5, and below 2 is not a candidate at all
    expertise rating     the five-star judgement, which separates two level-3s
    this exact machine   a machine-level assessment beats a class-level one
    recency              somebody who ran this class last week needs less watching
    fairness             the person deployed least this week goes first

Fairness is in there deliberately. Score on skill alone and the best operator
draws every difficult machine every day, which is how a mine burns out four
people and never develops the rest.

WHAT STOPS A PAIRING OUTRIGHT. Not rostered today. On approved leave. Already
on a machine. No licence or medical on file, or either expired. Never assessed
on the class. These are the same rules the shift board enforces when a human
deploys by hand — deliberately the same, because an engine that could propose
something the board would then refuse is an engine nobody uses twice.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import readiness, roster

# Below this, the class has not been signed off at all. Level 1 is assisted
# operation: proposable, but it comes with the warning attached.
MIN_LEVEL = 2

# How much each consideration is worth. Skill dominates, and the rest break
# ties between people who are all qualified — which is the honest shape of the
# decision, rather than a formula that lets three small factors outvote
# competence.
W_LEVEL, W_RATING, W_MACHINE, W_RECENCY, W_FAIRNESS = 100, 20, 45, 15, 25

# Deployments older than this say nothing useful about who is fresh on a class.
RECENCY_DAYS = 90
FAIRNESS_DAYS = 7

# Machine states the engine will fill. Anything else is broken, held, already
# crewed or out of the register, and proposing an operator for it would be
# proposing that somebody stand next to it.
FILLABLE = {"AVAILABLE", "IDLE", "FUEL_REQUIRED", "LOCATION_RESTRICTED"}


def _bulk(db: Session, operator_ids: list[int]) -> dict:
    """Everything the scoring needs about these people, in four queries."""
    if not operator_ids:
        return {"people": {}, "docs": {}, "comp": {}, "machine_comp": {},
                "last": {}, "load": {}, "busy": set()}

    people = {r["operator_id"]: dict(r) for r in db.execute(text("""
        SELECT o.operator_id, o.operator_ref, o.designation, o.approval_status,
               o.org_unit_id, p.display_name
        FROM operator o JOIN party p ON p.party_id = o.party_id
        WHERE o.operator_id = ANY(:ids) AND o.profile_status = 'ACTIVE'
    """), {"ids": operator_ids}).mappings()}

    docs: dict[int, dict] = {}
    for r in db.execute(text("""
        SELECT operator_id, record_type,
               bool_or(valid_upto IS NULL OR valid_upto >= CURRENT_DATE) AS current,
               bool_or(verification_status = 'VERIFIED')                 AS verified
        FROM operator_record
        WHERE operator_id = ANY(:ids) AND status = 'ACTIVE'
          AND record_type IN ('LICENCE', 'MEDICAL')
        GROUP BY operator_id, record_type
    """), {"ids": operator_ids}).mappings():
        docs.setdefault(r["operator_id"], {})[r["record_type"]] = dict(r)

    comp: dict[tuple[int, int], dict] = {}
    machine_comp: dict[tuple[int, int], dict] = {}
    for r in db.execute(text("""
        SELECT operator_id, asset_type_id, asset_id, level, rating,
               valid_upto, next_assessment_due
        FROM operator_competency
        WHERE operator_id = ANY(:ids) AND dimension = 'OVERALL' AND status = 'ACTIVE'
    """), {"ids": operator_ids}).mappings():
        if r["asset_id"]:
            machine_comp[(r["operator_id"], r["asset_id"])] = dict(r)
        elif r["asset_type_id"]:
            comp[(r["operator_id"], r["asset_type_id"])] = dict(r)

    last: dict[tuple[int, int], date] = {}
    load: dict[int, int] = {}
    busy: set[int] = set()
    for r in db.execute(text("""
        SELECT d.operator_id, a.asset_type_id,
               max(d.started_at)::date                                       AS last_on,
               count(*) FILTER (WHERE d.started_at >= now() - make_interval(days => :fair))
                                                                             AS recent,
               bool_or(d.status IN ('READY', 'RUNNING', 'PAUSED'))           AS live
        FROM deployment d
        JOIN asset a ON a.asset_id = d.asset_id
        WHERE d.operator_id = ANY(:ids)
          AND (d.started_at >= now() - make_interval(days => :window)
               OR d.status IN ('READY', 'RUNNING', 'PAUSED'))
        GROUP BY d.operator_id, a.asset_type_id
    """), {"ids": operator_ids, "window": RECENCY_DAYS, "fair": FAIRNESS_DAYS}).mappings():
        if r["asset_type_id"]:
            last[(r["operator_id"], r["asset_type_id"])] = r["last_on"]
        load[r["operator_id"]] = load.get(r["operator_id"], 0) + int(r["recent"] or 0)
        if r["live"]:
            busy.add(r["operator_id"])

    return {"people": people, "docs": docs, "comp": comp,
            "machine_comp": machine_comp, "last": last, "load": load, "busy": busy}


def _score(operator_id: int, machine: dict, data: dict, today: date,
           busiest: int) -> dict | None:
    """One pairing, scored and explained — or None when it is not allowed.

    The reasons come back as sentences rather than numbers, because a score of
    137 tells a supervisor nothing and "level 4, ran one nine days ago, lightest
    load this week" tells them everything they need to agree or disagree.
    """
    type_id = machine["asset_type_id"]
    comp = data["comp"].get((operator_id, type_id))
    machine_level = data["machine_comp"].get((operator_id, machine["asset_id"]))
    level = (machine_level or comp or {}).get("level") or 0

    if not comp and not machine_level:
        return None                      # never assessed on this class
    if level < 1:
        return None

    blockers: list[str] = []
    warnings: list[str] = []
    reasons: list[str] = []

    docs = data["docs"].get(operator_id, {})
    for kind, label in (("LICENCE", "licence"), ("MEDICAL", "medical fitness")):
        held = docs.get(kind)
        if not held:
            blockers.append(f"No {label} on file")
        elif not held["current"]:
            blockers.append(f"{label.capitalize()} has expired")
        elif not held["verified"]:
            warnings.append(f"{label.capitalize()} has not been verified")

    source = machine_level or comp
    if source.get("valid_upto") and source["valid_upto"] < today:
        blockers.append("Competency assessment has lapsed")
    if source.get("next_assessment_due") and source["next_assessment_due"] < today:
        warnings.append("Reassessment is overdue")
    if level == 1:
        warnings.append("Level 1 — assisted operation only, needs supervision")
    if (data["people"].get(operator_id) or {}).get("approval_status") != "APPROVED":
        warnings.append("Profile has not been approved")

    if blockers:
        return {"operator_id": operator_id, "allowed": False,
                "blockers": blockers, "warnings": warnings, "score": 0}

    score = level * W_LEVEL
    reasons.append(f"Level {level} on {machine['asset_type'] or 'this class'}")

    rating = source.get("rating")
    if rating:
        score += int(rating) * W_RATING
        reasons.append(f"{rating} of 5 for expertise")

    if machine_level:
        score += W_MACHINE
        reasons.append(f"Assessed on {machine['fleet_code']} itself, not just the class")

    seen = data["last"].get((operator_id, type_id))
    if seen:
        days = (today - seen).days
        # Full marks for last week, tailing off to nothing at ninety days.
        score += int(W_RECENCY * max(0, (RECENCY_DAYS - days)) / RECENCY_DAYS)
        reasons.append(f"Last ran one {days} days ago" if days else "Ran one today")
    else:
        warnings.append("Has not operated this class recently")

    load = data["load"].get(operator_id, 0)
    if busiest:
        score += int(W_FAIRNESS * (busiest - load) / busiest)
    if load == 0:
        reasons.append("Not deployed at all this week")
    elif busiest and load < busiest / 2:
        reasons.append(f"Lighter load this week ({load} shifts)")

    return {"operator_id": operator_id, "allowed": True, "score": score,
            "level": level, "rating": rating, "reasons": reasons,
            "warnings": warnings, "blockers": []}


def propose(db: Session, shift_instance_id: int,
            include_running: bool = False) -> dict:
    """A full allocation for one shift, with the reasoning attached.

    Returns the pairings it would make, the machines it could not fill and
    exactly what stopped each one, and the people it did not use — because a
    plan that only shows its successes hides the thing the supervisor most
    needs to act on, which is the machine nobody in the mine can legally run.
    """
    shift = db.execute(text("""
        SELECT si.shift_instance_id, si.production_day, si.plant_id, si.status,
               sc.code AS shift_code, sc.name AS shift_name,
               pl.name AS plant_name
        FROM shift_instance si
        JOIN shift_calendar sc ON sc.shift_id = si.shift_id
        LEFT JOIN plant pl ON pl.plant_id = si.plant_id
        WHERE si.shift_instance_id = :id
    """), {"id": shift_instance_id}).mappings().first()
    if not shift:
        return {"found": False}

    day = shift["production_day"]
    today = date.today()

    fleet = readiness.fleet_readiness(db, shift["plant_id"])
    machines = [m for m in fleet
                if m["state"] in FILLABLE
                and m["asset_type_id"]
                and (include_running or not m["deployment_id"])]

    # Machines that are held or broken, kept so the screen can say why the
    # fleet is smaller than the fleet.
    withheld = [{"asset_id": m["asset_id"], "fleet_code": m["fleet_code"],
                 "asset_type": m["asset_type"], "state": m["state"],
                 "why": m["blockers"][0] if m["blockers"] else m["state"]}
                for m in fleet
                if m["state"] not in FILLABLE and m["state"] != "DECOMMISSIONED"]

    on_duty = roster.rostered_for(db, day, shift["shift_code"], shift["plant_id"])
    blocked_leave = roster.leave_blocking(db, day)
    candidate_ids = [o for o in on_duty if o not in blocked_leave]

    data = _bulk(db, candidate_ids)
    busiest = max(data["load"].values(), default=0)

    # Everybody already on a machine is out, without being a mystery: the
    # screen says "already on EXC-04" rather than dropping them silently.
    available = [o for o in candidate_ids
                 if o in data["people"] and o not in data["busy"]]

    # Score every allowed pairing once. Thirty machines by ninety people is two
    # and a half thousand pairings, which is nothing in memory and would have
    # been two and a half thousand queries done the obvious way.
    options: dict[int, list[dict]] = {}
    for m in machines:
        scored = []
        for operator_id in available:
            pairing = _score(operator_id, m, data, today, busiest)
            if pairing and pairing["allowed"] and pairing.get("level", 0) >= 1:
                scored.append(pairing)
        scored.sort(key=lambda x: (-x["score"], len(x["warnings"])))
        options[m["asset_id"]] = scored

    # Most-constrained-first. The machine with three possible operators is
    # filled before the one with forty, otherwise the three get used up
    # elsewhere and it stands idle for a reason that was entirely avoidable.
    order = sorted(machines, key=lambda m: (len(options[m["asset_id"]]),
                                            -(m.get("current_reading") or 0)))

    taken: set[int] = set()
    proposals: list[dict] = []
    unfilled: list[dict] = []

    for m in order:
        pick = next((c for c in options[m["asset_id"]]
                     if c["operator_id"] not in taken), None)
        if not pick:
            pool = options[m["asset_id"]]
            unfilled.append({
                "asset_id": m["asset_id"], "fleet_code": m["fleet_code"],
                "asset_ref": m["asset_ref"], "asset_type": m["asset_type"],
                "state": m["state"],
                "why": ("Nobody rostered today is assessed on this class"
                        if not pool
                        else f"All {len(pool)} qualified operators on duty are already allocated"),
                "qualified_on_duty": len(pool),
            })
            continue

        taken.add(pick["operator_id"])
        person = data["people"][pick["operator_id"]]
        alternatives = [
            {"operator_id": c["operator_id"],
             "display_name": data["people"][c["operator_id"]]["display_name"],
             "score": c["score"], "level": c["level"],
             "taken": c["operator_id"] in taken}
            for c in options[m["asset_id"]][:4]
            if c["operator_id"] != pick["operator_id"]
        ]
        proposals.append({
            "asset_id": m["asset_id"], "fleet_code": m["fleet_code"],
            "asset_ref": m["asset_ref"], "asset_type": m["asset_type"],
            "asset_type_id": m["asset_type_id"], "machine_state": m["state"],
            "operator_id": pick["operator_id"],
            "operator_ref": person["operator_ref"],
            "display_name": person["display_name"],
            "designation": person["designation"],
            "score": pick["score"], "level": pick["level"], "rating": pick["rating"],
            "reasons": pick["reasons"], "warnings": pick["warnings"],
            "confidence": ("high" if pick["score"] >= 400 and not pick["warnings"]
                           else "low" if pick["score"] < 220 or len(pick["warnings"]) > 1
                           else "fair"),
            "alternatives": alternatives,
        })

    idle = [{"operator_id": o, "display_name": data["people"][o]["display_name"],
             "operator_ref": data["people"][o]["operator_ref"],
             "designation": data["people"][o]["designation"],
             "classes": len({t for (op, t) in data["comp"] if op == o}),
             "why": "On duty, qualified, and no machine left needing them"}
            for o in available if o not in taken]

    already = [{"operator_id": o,
                "display_name": (data["people"].get(o) or {}).get("display_name"),
                "why": "Already on a machine"}
               for o in candidate_ids if o in data["busy"]]

    return {
        "found": True,
        "shift": dict(shift),
        "generated_for": day.isoformat(),
        "proposals": sorted(proposals, key=lambda p: p["fleet_code"] or ""),
        "unfilled": unfilled,
        "idle_operators": idle,
        "already_deployed": already,
        "withheld_machines": withheld,
        "on_leave": len(blocked_leave),
        "summary": {
            "machines_needing_an_operator": len(machines),
            "proposed": len(proposals),
            "could_not_fill": len(unfilled),
            "operators_on_duty": len(on_duty),
            "operators_available": len(available),
            "operators_unused": len(idle),
            "machines_held": len(withheld),
            "coverage_pct": round(100 * len(proposals) / len(machines), 1) if machines else 0.0,
        },
    }
