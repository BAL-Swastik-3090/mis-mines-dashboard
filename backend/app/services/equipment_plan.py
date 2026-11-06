"""The excavator fleet, and the month's ORE/OB assignment for each machine.

WHAT THIS REPLACES. Two hardcoded lists in services/lcm.py said which machines
dug ore and which dug overburden. They decided which machine's lost hours land
in which bucket, and therefore both multiplying factors, every head in the loss
matrix, and the controllable/non-controllable split of the rupee value. The
mine now states that assignment itself, once a month.

── THE PLAN IS IN POSTGRES AND THE HOURS ARE IN MYSQL ──────────────────────
Both tables live in minehub on Postgres, because they are the mine's own data
entered through this application. The hours they are applied to live in
balcorpdb (mines_tipper_details) and in SAP. THE TWO CANNOT BE JOINED IN SQL,
so resolve() returns a plain {machine: 'ORE'|'OB'} map and lcm.py does the
matching in Python -- the same shape, and for the same reason, as
desilting_plan.plan_for().

── EVERY ACTIVE MACHINE GETS AN ANSWER ─────────────────────────────────────
resolve() never returns a fleet machine with no bucket if that machine has ever
been assigned. Three cases, handled by one query:

    assigned    the month has a row for it                 -> use it
    carried     the month has no row, an earlier one does  -> use the latest
    unassigned  no row has ever existed for it             -> named, not hidden

The middle case is what the mine asked for: a month nobody entered falls back
to the last one that was, with the page saying so. The third case is a machine
added to the fleet after the plan was saved, and there is nothing to fall back
to -- so it is returned by name, the LCM excludes it, and the page states the
exclusion with its hours. An exclusion with a number against it is recoverable;
a silent one is not.

── THE PLAN IS EDITABLE, AND NOTHING IS LOST ───────────────────────────────
A month can be submitted again as often as the mine needs: machines get
reassigned mid-month, and a plan that could only be entered once would simply
be entered wrong. Every submission is diffed against what is stored, and each
ADD, CHANGE and REMOVE is written to oee_equip_exc_plan_hist with BOTH the old
and the new material. The plan table keeps exactly one current row per machine
per month -- the constraint the whole LCM rests on -- and the past lives in the
history table where no reader of the plan can trip over it.

That matters because the LCM is published. Without the trail, an ore/OB split
signed off on the 10th and corrected on the 20th leaves no way to explain the
first figure from the database, and the two readings look like a bug.

── WHY THE RESOLUTION IS PER MACHINE, NOT PER MONTH ────────────────────────
Falling back a whole month at a time would have been simpler and is wrong in a
way that is hard to see: a month WITH a plan that happens to be missing one
machine would never fall back at all, because the month exists. Resolving each
machine against its own latest assignment handles the missing month and the
missing machine with one rule, and DISTINCT ON does it in a single statement.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import equipment_settings as eqs

logger = logging.getLogger(__name__)

ORE, OB = "ORE", "OB"
MATERIAL_TYPES = (ORE, OB)

OWN, HIRED = "OWN", "HIRED"
ACTIVE, INACTIVE = "ACTIVE", "INACTIVE"


def month_start(d: date) -> date:
    """The first of d's month -- the only value plan_month ever holds."""
    return d.replace(day=1)


# ── The fleet ────────────────────────────────────────────────────────────────
def fleet(db: Session, include_inactive: bool = False,
          on_date: date | None = None) -> list[dict[str, Any]]:
    """Every EXCAVATOR in the master, as it stood on `on_date`, active first.

    Ordered own-before-hired and then by name, which is the order the OEE
    table and the entry screen both read in.

    TWO THINGS CHANGED UNDER THIS FUNCTION ON 6 NOVEMBER 2026, and both would
    be silent failures if they were not handled here.

    Status is no longer a column on the master: it is a dated decision on
    oee_equip_status, so which machines are in service depends on WHEN you
    ask. Unasked, this asks about today, which is what the entry screen means.

    And the master is no longer excavators only -- it now carries the 37
    tippers as well, because the Equipment Status Selector covers the whole
    fleet. The excavation plan is about excavators, so the class filter is
    not a tidy-up: without it the plan screen would offer a MAN tipper an
    ORE/OB assignment, and resolve() would hand lcm.py thirty-seven machines
    whose hours it has no way to bucket.

    AND IT STILL WORKS BEFORE THE MIGRATION HAS RUN. On 6 November 2026 the
    two were applied the other way round -- the schema went to the live
    database before the code shipped -- and the deployed code, which still
    selected `status` off the master, failed on this screen until the
    database was put back. Deploying the code first would fail the same way
    from the other side, so neither order is allowed to break it: if
    oee_equip_status is not there yet, this reads the master the way it read
    it before, and the screen keeps working until the migration lands.
    """
    if db.execute(text(
            "SELECT to_regclass('minehub.oee_equip_status')")).scalar() is None:
        # PRE-MIGRATION. Asked about explicitly rather than caught as an
        # error, because a failed statement poisons the transaction and the
        # fallback query would then fail too, for a different reason.
        logger.warning("oee_equip_status is absent -- reading the fleet the "
                       "pre-migration way. Apply migration 100.")
        legacy = db.execute(text(f"""
            SELECT id, equipment_name, category, status
            FROM   minehub.oee_equip_master
            {'' if include_inactive else "WHERE status = 'ACTIVE'"}
            ORDER  BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
                      CASE WHEN category = 'OWN' THEN 0 ELSE 1 END,
                      equipment_name
        """)).fetchall()
        return [{"id": r.id, "equipment_name": r.equipment_name,
                 "category": r.category, "status": r.status} for r in legacy]

    rows = eqs.resolve(db, on_date or date.today(), klass=eqs.EXCAVATOR,
                       active_only=not include_inactive)
    rows.sort(key=lambda r: (0 if r["status"] == "ACTIVE" else 1,
                             0 if r["category"] == "OWN" else 1,
                             r["equipment_name"]))
    return [{"id": r["id"], "equipment_name": r["equipment_name"],
             "category": r["category"], "status": r["status"]} for r in rows]


# ── The month ────────────────────────────────────────────────────────────────
def read_month(db: Session, month: date) -> list[dict[str, Any]]:
    """Exactly what is stored for this month. No fallback, no fleet join.

    Used by the entry screen to show what was actually saved, which must be
    distinguishable from what resolve() would carry forward -- otherwise
    opening the screen on an unentered month would look like the month was
    already entered.
    """
    rows = db.execute(text("""
        SELECT equipment_name, material_type, entry_id, entry_date, revision
        FROM   minehub.oee_equip_exc_plan
        WHERE  plan_month = :m
        ORDER  BY equipment_name
    """), {"m": month_start(month)}).fetchall()
    return [{"equipment_name": r.equipment_name,
             "material_type": r.material_type,
             "entry_id": r.entry_id,
             "entry_date": r.entry_date.isoformat() if r.entry_date else None,
             "revision": r.revision}
            for r in rows]


def resolve(db: Session, month: date) -> dict[str, Any]:
    """The assignment in force for every active machine in this month.

    Returns the map lcm.py needs, plus everything the page must say about how
    it was arrived at. Nothing here is silent: if a figure came from an earlier
    month, the month it came from is in the result.
    """
    m = month_start(month)
    # The fleet as it stood at the START of the month being resolved, not as
    # it stands today. A machine retired in November must still appear in
    # October's plan, or October's LCM loses its hours.
    machines = fleet(db, on_date=m)
    names = [x["equipment_name"] for x in machines]

    # ONE STATEMENT FOR ALL THREE CASES. DISTINCT ON keeps the first row per
    # machine under the ORDER BY, so ordering by plan_month DESC yields each
    # machine's most recent assignment at or before this month.
    rows = db.execute(text("""
        SELECT DISTINCT ON (equipment_name)
               equipment_name, material_type, plan_month
        FROM   minehub.oee_equip_exc_plan
        WHERE  plan_month <= :m
        ORDER  BY equipment_name, plan_month DESC
    """), {"m": m}).fetchall()
    latest = {r.equipment_name: (r.material_type, r.plan_month) for r in rows}

    assignments: dict[str, str] = {}
    carried: list[dict[str, Any]] = []
    unassigned: list[str] = []
    for name in names:
        hit = latest.get(name)
        if hit is None:
            unassigned.append(name)
            continue
        material, src = hit
        assignments[name] = material
        if src != m:
            carried.append({"equipment_name": name, "material_type": material,
                            "from_month": src.isoformat()})

    # Whether the month itself was ever entered, which is a different question
    # from whether every machine has an answer. A month entered but missing one
    # machine is NOT "not entered" -- the banner must not say it was.
    entered = db.execute(text(
        "SELECT count(*) FROM minehub.oee_equip_exc_plan WHERE plan_month = :m"
    ), {"m": m}).scalar() or 0

    carried_from = max((c["from_month"] for c in carried), default=None)
    return {
        "month": m.isoformat(),
        "assignments": assignments,
        "ore": sorted(n for n, v in assignments.items() if v == ORE),
        "ob":  sorted(n for n, v in assignments.items() if v == OB),
        "month_entered": entered > 0,
        "rows_entered": int(entered),
        "carried": carried,
        "carried_from": carried_from,
        "unassigned": unassigned,
        "fleet_size": len(names),
    }


def resolve_detached(month: date) -> dict[str, Any] | None:
    """resolve() on a session of its own, and never raising.

    WHY NOT A SECOND DEPENDENCY ON EVERY ROUTE. The plan is in Postgres and the
    LCM is built entirely on MySQL, so threading a second session down to it
    would touch the router, the service and every test that builds the service
    by hand -- the same argument as desilting_plan.plan_for().

    WHY IT SWALLOWS THE ERROR BUT RETURNS None. Postgres here is reached over
    the VPN and is not always up. An unreachable plan is NOT the same as an
    empty one: an empty plan means the mine has not assigned its machines, and
    a cold database means nobody knows. Returning None rather than {} keeps
    those two apart, and the LCM reports the second as a failure to read the
    plan instead of as a mine that never made one.
    """
    try:
        from app.minehub_db import SessionLocal
        if SessionLocal is None:
            return None
        pg = SessionLocal()
    except Exception:                                   # noqa: BLE001
        return None
    try:
        return resolve(pg, month)
    except Exception:                                   # noqa: BLE001
        logger.info("equipment excavation plan unavailable", exc_info=False)
        return None
    finally:
        try:
            pg.close()
        except Exception:                               # noqa: BLE001
            pass


# ── Writing ──────────────────────────────────────────────────────────────────
class PlanError(ValueError):
    """The month could not be saved, with every problem found rather than the
    first -- so somebody correcting an entry corrects it once."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("; ".join(problems))


def month_revision(db: Session, month: date) -> int:
    """How many times this month's plan has been submitted. 0 = never."""
    return int(db.execute(text("""
        SELECT COALESCE(MAX(revision), 0)
        FROM   minehub.oee_equip_exc_plan
        WHERE  plan_month = :m
    """), {"m": month_start(month)}).scalar() or 0)


def history(db: Session, month: date | None = None,
            equipment_name: str | None = None,
            limit: int = 200) -> list[dict[str, Any]]:
    """Every edit, newest first, for one month or one machine.

    Both filters are optional and combine, so this answers "what has been
    changed in this month's plan" and "when did this machine move between ore
    and overburden" from the same query.
    """
    where = ["1 = 1"]
    params: dict[str, Any] = {"lim": max(1, min(limit, 1000))}
    if month is not None:
        where.append("plan_month = :m")
        params["m"] = month_start(month)
    if equipment_name:
        where.append("equipment_name = :n")
        params["n"] = equipment_name
    rows = db.execute(text(f"""
        SELECT plan_month, equipment_name, action,
               old_material, new_material, revision, entry_id, entry_date
        FROM   minehub.oee_equip_exc_plan_hist
        WHERE  {' AND '.join(where)}
        ORDER  BY entry_date DESC, equipment_name
        LIMIT  :lim
    """), params).fetchall()
    return [{"plan_month": r.plan_month.isoformat(),
             "equipment_name": r.equipment_name,
             "action": r.action,
             "old_material": r.old_material,
             "new_material": r.new_material,
             "revision": r.revision,
             "entry_id": r.entry_id,
             "entry_date": r.entry_date.isoformat() if r.entry_date else None}
            for r in rows]


def save_month(db: Session, month: date, assignments: dict[str, str],
               actor: str) -> dict[str, Any]:
    """Store or revise the month. The plan is editable; nothing is lost.

    EVERY ACTIVE MACHINE OR NOTHING. A partial save is refused, because a
    machine missing from the plan is the one case that quietly changes the
    answer: its hours leave the denominator, every multiplying factor rises,
    and each head's share of the loss moves with nothing on the page to show
    it. The total never moves -- it is fixed by the deviation -- so there is no
    symptom to notice. The constraint is here rather than in the UI because the
    UI is not the only way a row can arrive.

    THE MONTH IS REPLACED, NOT MERGED. A machine stored for this month and
    absent from the submission is removed, so a correction that moves a machine
    out of the fleet's plan actually removes it rather than leaving the old row
    behind to be read as current.

    ── WHY THIS IS A DIFF AND NO LONGER DELETE-THEN-INSERT ──────────────────
    It used to clear the month and write it again. That made every save look
    identical whether one machine had been reassigned or none had, and the
    previous answer simply ceased to exist -- so an LCM published on the 10th
    could not be explained from the database on the 20th. Now each machine
    takes the path its own change deserves:

        unchanged   LEFT ALONE, keeping the entry_date that says when that
                    assignment was actually decided, rather than when somebody
                    last pressed Save over an unrelated row
        added       inserted, and recorded as ADDED
        changed     updated in place, and recorded as CHANGED with BOTH values
        removed     deleted from the plan, and recorded as REMOVED with the
                    value it had

    A SAVE THAT CHANGES NOTHING IS NOT A REVISION. Pressing Save twice writes
    no history and does not advance the revision number, because an audit trail
    that fills with non-events is one nobody reads.
    """
    m = month_start(month)
    active = {x["equipment_name"] for x in fleet(db)}

    problems: list[str] = []
    unknown = sorted(set(assignments) - active)
    if unknown:
        problems.append(
            "not active machines in the equipment master: " + ", ".join(unknown))
    missing = sorted(active - set(assignments))
    if missing:
        problems.append(
            "every active machine needs ORE or OB; missing: " + ", ".join(missing))
    bad = sorted(n for n, v in assignments.items() if v not in MATERIAL_TYPES)
    if bad:
        problems.append("material type must be ORE or OB: " + ", ".join(bad))
    if not actor:
        problems.append("no employee id on the request")
    if problems:
        raise PlanError(problems)

    before = {r["equipment_name"]: r["material_type"] for r in read_month(db, m)}
    after = assignments

    added   = sorted(n for n in after if n not in before)
    changed = sorted(n for n in after if n in before and before[n] != after[n])
    removed = sorted(n for n in before if n not in after)

    if not (added or changed or removed):
        return {"month": m.isoformat(), "stored": len(after),
                "added": [], "changed": [], "removed": [],
                "revision": month_revision(db, m), "revised": False}

    revision = month_revision(db, m) + 1

    def audit(name: str, action: str, old: str | None, new: str | None) -> None:
        db.execute(text("""
            INSERT INTO minehub.oee_equip_exc_plan_hist
                   (plan_month, equipment_name, action,
                    old_material, new_material, revision, entry_id)
            VALUES (:m, :n, :a, :o, :w, :r, :by)
        """), {"m": m, "n": name, "a": action, "o": old, "w": new,
               "r": revision, "by": actor})

    for name in added:
        db.execute(text("""
            INSERT INTO minehub.oee_equip_exc_plan
                   (plan_month, equipment_name, material_type, entry_id, revision)
            VALUES (:m, :n, :t, :by, :r)
        """), {"m": m, "n": name, "t": after[name], "by": actor, "r": revision})
        audit(name, "ADDED", None, after[name])

    for name in changed:
        db.execute(text("""
            UPDATE minehub.oee_equip_exc_plan
            SET    material_type = :t, entry_id = :by,
                   entry_date = now(), revision = :r
            WHERE  plan_month = :m AND equipment_name = :n
        """), {"m": m, "n": name, "t": after[name], "by": actor, "r": revision})
        audit(name, "CHANGED", before[name], after[name])

    for name in removed:
        db.execute(text("""
            DELETE FROM minehub.oee_equip_exc_plan
            WHERE  plan_month = :m AND equipment_name = :n
        """), {"m": m, "n": name})
        audit(name, "REMOVED", before[name], None)

    db.commit()

    return {
        "month": m.isoformat(),
        "stored": len(after),
        "added":   added,
        "changed": changed,
        "removed": removed,
        "revision": revision,
        "revised": revision > 1,
    }
