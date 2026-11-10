"""The fleet, and the settings in force for it on a date.

THE EQUIPMENT STATUS SELECTOR. Until 6 November 2026 the roster lived in two
Python lists -- `EXCAVATORS` in services/oee.py and `OLD_TIPPERS` /
`NEW_TIPPER_IDEAL` in services/tipper_oee.py -- and changing a machine's ideal
capacity, or moving one between the old and new fleet, meant a deployment.
Those decisions are the mine's, and they now live in minehub.oee_equip_status.

── WHAT A DATE RESOLVES TO ──────────────────────────────────────────────────
Each decision is a row carrying the date it takes effect. The settings in
force on a date are the row with the greatest `effective_from` on or before
it. A choice holds until a later one supersedes it, which is the rule the mine
asked for: set it once, and it applies until it is changed.

BEFORE THE FIRST ROW, THE FIRST ROW APPLIES. The seed is dated 2026-10-01
because that is the month the mine named, but those settings did not begin in
October -- they are what the matrix and the OEE tables have used all along.
Without this fallback every window before October would resolve to an empty
fleet and report nothing, which would be a far larger lie than the one the
fallback tells. From the next change onward the dates are real.

── ONE DATE FOR A RANGE ─────────────────────────────────────────────────────
A window is resolved on the day it STARTS, matching the excavation plan beside
it (`lcm._resolve_plan`). A range that crosses a change is therefore answered
by the settings in force when it opened, rather than by a blend of two. The
alternative -- splitting the window and summing -- would make Ideal CuM a sum
over sub-periods, and the mine reads these tables against a monthly plan that
has no finer grain than a month in the first place.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

EXCAVATOR, TIPPER = "EXCAVATOR", "TIPPER"
OLD, NEW = "OLD", "NEW"
ACTIVE, INACTIVE = "ACTIVE", "INACTIVE"

#: Every column the two OEE services need, in one read.
_COLUMNS = """
    m.id, m.equipment_name, m.category, m.equipment_class,
    m.name_shift_log, m.legacy_code, m.sap_equipment_no,
    m.sap_desc_tech_object, m.engine_source, m.bd_source, m.sl_order,
    s.effective_from, s.status, s.generation, s.ideal_cum_per_hr,
    s.ideal_trip_fixed, s.trips_per_engine_hour, s.revision
"""

# THE RESOLUTION RULE, IN ONE ORDER BY.
#
#   1. rows effective on or before the date sort first;
#   2. among those, the latest wins;
#   3. if there are none, the earliest row of all wins.
#
# Expressed as an ORDER BY rather than two queries so that DISTINCT ON picks a
# machine's version in a single pass, and so the rule cannot be stated
# differently in two places.
_RESOLVE = f"""
    SELECT DISTINCT ON (m.equipment_name) {_COLUMNS}
    FROM   minehub.oee_equip_master m
    JOIN   minehub.oee_equip_status s USING (equipment_name)
    -- CAST, because an untyped bind on both sides of an OR gives Postgres
    -- nothing to infer the parameter's type from and it refuses the statement.
    WHERE  (CAST(:klass AS varchar) IS NULL
            OR m.equipment_class = CAST(:klass AS varchar))
    ORDER  BY m.equipment_name,
              (s.effective_from <= :on_date) DESC,
              CASE WHEN s.effective_from <= :on_date
                   THEN s.effective_from END DESC,
              s.effective_from ASC
"""


def _row(r) -> dict[str, Any]:
    return {
        "id":                   r.id,
        "equipment_name":       r.equipment_name,
        "category":             r.category,
        "equipment_class":      r.equipment_class,
        "name_shift_log":       r.name_shift_log or r.equipment_name,
        "legacy_code":          r.legacy_code,
        "sap_equipment_no":     r.sap_equipment_no,
        "sap_desc_tech_object": r.sap_desc_tech_object,
        "engine_source":        r.engine_source,
        "bd_source":            r.bd_source,
        "sl_order":             r.sl_order,
        "effective_from":       r.effective_from,
        "status":               r.status,
        "generation":           r.generation,
        "ideal_cum_per_hr":     float(r.ideal_cum_per_hr) if r.ideal_cum_per_hr is not None else None,
        "ideal_trip_fixed":     int(r.ideal_trip_fixed) if r.ideal_trip_fixed is not None else None,
        "trips_per_engine_hour": float(r.trips_per_engine_hour) if r.trips_per_engine_hour is not None else None,
        "revision":             r.revision,
    }


def resolve(db: Session, on_date: date,
            klass: str | None = None,
            active_only: bool = True) -> list[dict[str, Any]]:
    """The fleet as it stood on `on_date`, in the mine's own order."""
    rows = [_row(r) for r in db.execute(
        text(_RESOLVE), {"on_date": on_date, "klass": klass}).fetchall()]
    if active_only:
        rows = [r for r in rows if r["status"] == ACTIVE]
    rows.sort(key=lambda r: (r["sl_order"] if r["sl_order"] is not None else 9_999,
                             r["equipment_name"]))
    return rows


def resolve_detached(on_date: date, klass: str | None = None,
                     active_only: bool = True) -> list[dict[str, Any]] | None:
    """`resolve` on its own minehub session.

    The OEE services are handed a balcorpdb session, so they cannot query
    minehub with it. None means the platform database could not be reached --
    the callers treat that as 'fall back to what is compiled in' rather than
    as an empty fleet, because an empty fleet renders four blank tables.
    """
    try:
        from app.minehub_db import SessionLocal
        if SessionLocal is None:
            return None
        pg = SessionLocal()
    except Exception:                                       # noqa: BLE001
        logger.warning("minehub unavailable for the fleet", exc_info=True)
        return None
    try:
        return resolve(pg, on_date, klass, active_only)
    except Exception:                                       # noqa: BLE001
        logger.warning("the fleet could not be resolved", exc_info=True)
        return None
    finally:
        pg.close()


# ── The shapes the two OEE services already speak ────────────────────────────
# Returned in the exact form each service's hardcoded list had, so wiring them
# up is a change of SOURCE and not a change of SHAPE. A refactor that also
# reshuffles keys cannot be proven by comparing its output.

def excavators(on_date: date) -> list[dict[str, Any]] | None:
    """The `EXCAVATORS` list of services/oee.py, from the table.

    `bd_source` comes back lowercase, and 'imos' rather than 'SHIFT_LOG',
    because that is the vocabulary oee.py branches on. Translating here keeps
    the translation in one line instead of scattering it through the caller.
    """
    rows = resolve_detached(on_date, EXCAVATOR)
    if rows is None:
        return None
    return [{"name":       r["equipment_name"],
             "code":       r["legacy_code"],
             "sap_eq":     r["sap_equipment_no"],
             "ideal_cap":  r["ideal_cum_per_hr"],
             "bd_source":  "sap" if r["bd_source"] == "SAP" else "imos",
             "hired":      r["category"] == "HIRED",
             "generation": r["generation"].lower()}
            for r in rows]


def tippers(on_date: date) -> dict[str, Any] | None:
    """The tipper roster split the way services/tipper_oee.py reads it."""
    rows = resolve_detached(on_date, TIPPER)
    if rows is None:
        return None
    old = [r for r in rows if r["generation"] == OLD]
    new = [r for r in rows if r["generation"] == NEW]
    # BOTH MAPS COVER BOTH GENERATIONS. Until 7 November 2026 the old fleet
    # was measured by a rate and the new one by a fixed figure, so each map
    # held only the trucks it applied to. They are measured the same way now,
    # and a truck may carry either, so the caller is handed both for everyone
    # and picks per machine rather than per generation.
    return {
        "old":   tuple(r["equipment_name"] for r in old),
        "new":   tuple(r["equipment_name"] for r in new),
        #: Trips a truck should turn per engine-hour. The mine's own 1.50 on
        #: every row, and editable per machine.
        "rate":  {r["equipment_name"]: r["trips_per_engine_hour"] for r in rows},
        #: A target that does NOT scale with the window, for a truck the mine
        #: genuinely measures that way. Used only where no rate is set.
        "fixed": {r["equipment_name"]: r["ideal_trip_fixed"] for r in rows},
        "log_name": {r["equipment_name"]: r["name_shift_log"] for r in rows},
        "sap_name": {r["equipment_name"]: r["sap_desc_tech_object"] for r in rows},
    }


# ── Writing ──────────────────────────────────────────────────────────────────
class SettingsError(ValueError):
    """Something the mine asked for that the table will not hold."""


#: The fields the selector can set. Everything else about a machine is a fact
#: about the asset, lives on the master, and is not dated.
SETTABLE = ("status", "generation", "ideal_cum_per_hr", "ideal_trip_fixed",
            "trips_per_engine_hour")


def _as_text(v) -> str | None:
    return None if v is None else str(v)


def save(db: Session, effective_from: date,
         changes: dict[str, dict[str, Any]], actor: str) -> dict[str, Any]:
    """Record the mine's decisions, effective from a date.

    `changes` is {equipment_name: {field: value}}, carrying only what the user
    moved on the screen.

    A VERSION IS A WHOLE SETTING, NOT A DELTA. The resolver reads ONE row per
    machine, so a row holding only the field that changed would silently null
    the others. Each machine therefore starts from the settings already in
    force on `effective_from` and has the change applied on top. It also means
    saving twice on one date UPDATES that date's row rather than adding a
    second one the resolver has no way to order against.
    """
    if not changes:
        return {"effective_from": effective_from.isoformat(),
                "written": [], "fields": 0}

    current = {r["equipment_name"]: r
               for r in resolve(db, effective_from, active_only=False)}
    klass = {r.equipment_name: r.equipment_class for r in db.execute(text(
        "SELECT equipment_name, equipment_class FROM minehub.oee_equip_master"))}

    written: list[dict[str, Any]] = []
    fields = 0

    for name, wanted in changes.items():
        if name not in klass:
            raise SettingsError(f"{name} is not in the fleet")
        bad = set(wanted) - set(SETTABLE)
        if bad:
            raise SettingsError(f"{name}: {', '.join(sorted(bad))} "
                                "cannot be set on this screen")

        base = current.get(name, {})
        row = {f: base.get(f) for f in SETTABLE}
        row.update(wanted)

        # A machine carries the figures its CLASS is measured in and no
        # others. Generation no longer decides anything here: since
        # 7 November 2026 both tipper fleets use trips per engine-hour, and a
        # truck on a flat target is a per-machine choice rather than a
        # property of being new. Cleared before the checks below so the user
        # is told what is missing rather than what is left over.
        if klass[name] == TIPPER:
            row["ideal_cum_per_hr"] = None
            # Setting one clears the other: the table allows a tipper either
            # a rate or a fixed target, never both, so whichever the user
            # just supplied is the one that survives.
            if "trips_per_engine_hour" in wanted and row["trips_per_engine_hour"]:
                row["ideal_trip_fixed"] = None
            elif "ideal_trip_fixed" in wanted and row["ideal_trip_fixed"]:
                row["trips_per_engine_hour"] = None
            elif row["trips_per_engine_hour"] and row["ideal_trip_fixed"]:
                # Neither was touched and the row somehow holds both -- the
                # rate wins, because it is the one that scales with the
                # window the figure is read over.
                row["ideal_trip_fixed"] = None
        else:
            row["ideal_trip_fixed"] = None
            row["trips_per_engine_hour"] = None

        # The table refuses these too. Doing it here as well means the user is
        # told which machine and which figure, rather than a constraint name.
        if row["status"] == ACTIVE:
            if klass[name] == EXCAVATOR and row["ideal_cum_per_hr"] is None:
                raise SettingsError(
                    f"{name} cannot be active without an ideal CuM/hr")
            if klass[name] == TIPPER and row["generation"] == NEW \
                    and row["ideal_trip_fixed"] is None:
                raise SettingsError(
                    f"{name} cannot be active without a fixed ideal trip")
            if klass[name] == TIPPER and row["generation"] == OLD \
                    and row["trips_per_engine_hour"] is None:
                raise SettingsError(
                    f"{name} cannot be active without a trips-per-hour rate")

        existing = db.execute(text(
            "SELECT * FROM minehub.oee_equip_status "
            "WHERE equipment_name = :n AND effective_from = :d"),
            {"n": name, "d": effective_from}).mappings().first()

        was_of = (lambda f: _as_text(existing[f])) if existing \
            else (lambda f: _as_text(base.get(f)))
        moved = {f: (was_of(f), _as_text(row[f]))
                 for f in SETTABLE if was_of(f) != _as_text(row[f])}
        if not moved:
            continue

        rev = (existing["revision"] + 1) if existing else 1
        params = {"n": name, "k": klass[name], "d": effective_from,
                  "rev": rev, "actor": actor,
                  **{f: row[f] for f in SETTABLE}}
        if existing:
            db.execute(text("""
                UPDATE minehub.oee_equip_status
                SET    status = :status, generation = :generation,
                       ideal_cum_per_hr = :ideal_cum_per_hr,
                       ideal_trip_fixed = :ideal_trip_fixed,
                       trips_per_engine_hour = :trips_per_engine_hour,
                       entry_id = :actor, entry_date = now(), revision = :rev
                WHERE  equipment_name = :n AND effective_from = :d
            """), params)
        else:
            db.execute(text("""
                INSERT INTO minehub.oee_equip_status
                    (equipment_name, equipment_class, effective_from, status,
                     generation, ideal_cum_per_hr, ideal_trip_fixed,
                     trips_per_engine_hour, entry_id, revision)
                VALUES (:n, :k, :d, :status, :generation, :ideal_cum_per_hr,
                        :ideal_trip_fixed, :trips_per_engine_hour, :actor, :rev)
            """), params)

        for f, (was, now_) in moved.items():
            db.execute(text("""
                INSERT INTO minehub.oee_equip_status_hist
                    (equipment_name, effective_from, action, field,
                     old_value, new_value, revision, entry_id)
                VALUES (:n, :d, :action, :f, :old, :new, :rev, :actor)
            """), {"n": name, "d": effective_from, "f": f,
                   "action": "CHANGED" if existing else "ADDED",
                   "old": was if existing else None, "new": now_,
                   "rev": rev, "actor": actor})
            fields += 1

        written.append({"equipment_name": name,
                        "action": "CHANGED" if existing else "ADDED",
                        "revision": rev, "fields": sorted(moved)})

    db.commit()
    return {"effective_from": effective_from.isoformat(),
            "written": written, "fields": fields}


def history(db: Session, equipment_name: str | None = None,
            limit: int = 200) -> list[dict[str, Any]]:
    """Every change ever made, newest first."""
    where = "WHERE equipment_name = :n" if equipment_name else ""
    return [{"equipment_name": r.equipment_name,
             "effective_from": r.effective_from.isoformat(),
             "action": r.action, "field": r.field,
             "old_value": r.old_value, "new_value": r.new_value,
             "revision": r.revision, "entry_id": r.entry_id,
             "entry_date": r.entry_date.isoformat()}
            for r in db.execute(text(
                f"SELECT * FROM minehub.oee_equip_status_hist {where} "
                "ORDER BY entry_date DESC, id DESC LIMIT :lim"),
                {"n": equipment_name, "lim": limit})]


def versions(db: Session, equipment_name: str) -> list[dict[str, Any]]:
    """Every dated version of one machine, so the screen can show when each
    choice started rather than only the one in force."""
    def f(v):
        return float(v) if v is not None else None

    return [{"effective_from": r.effective_from.isoformat(),
             "status": r.status, "generation": r.generation,
             "ideal_cum_per_hr": f(r.ideal_cum_per_hr),
             "ideal_trip_fixed": r.ideal_trip_fixed,
             "trips_per_engine_hour": f(r.trips_per_engine_hour),
             "revision": r.revision, "entry_id": r.entry_id,
             "entry_date": r.entry_date.isoformat()}
            for r in db.execute(text(
                "SELECT * FROM minehub.oee_equip_status "
                "WHERE equipment_name = :n ORDER BY effective_from DESC"),
                {"n": equipment_name})]
