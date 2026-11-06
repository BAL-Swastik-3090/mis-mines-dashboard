"""The loss heads' owners and classifications, as chosen on a date.

THE LCM KAM SELECTOR. Until 6 November 2026 four maps in services/lcm.py
decided the Loss Description, the Loss Type, the KAM and the node of the KAM
Wise Loss Tree that each loss head rolls up to. All four were keyed on the
source column name, all four needed a deployment to change, and all four
belonged to the mine rather than to the code.

── THE SAME DATE RULE AS THE FLEET ──────────────────────────────────────────
A decision is a row carrying the date it takes effect. The settings in force
on a date are the row with the greatest `effective_from` on or before it, and
before the first row the FIRST row applies -- see equipment_settings for the
full argument. The seed is dated 2026-10-01 because that is the month the mine
named; the months already reported do not move when October is edited.

── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
It does not decide WHICH loss heads exist. That stays dynamic, read from the
columns of mines_tipper_details, so a loss reason the mine starts recording
still reaches the matrix -- as Unclassified, at the bottom, until somebody
classifies it here. A fixed list would drop it silently and the matrix would
quietly stop footing, which is the one thing it must never do.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Same shape as equipment_settings._RESOLVE, and for the same reason: rows on
# or before the date first, the latest of those, otherwise the earliest of all.
_RESOLVE_HEADS = """
    SELECT DISTINCT ON (column_name)
           column_name, label, loss_type, kam_name, role_code,
           sl_order, is_active, effective_from, revision
    FROM   minehub.lcm_loss_head_setting
    ORDER  BY column_name,
              (effective_from <= :on_date) DESC,
              CASE WHEN effective_from <= :on_date
                   THEN effective_from END DESC,
              effective_from ASC
"""


def resolve(db: Session, on_date: date) -> dict[str, dict[str, Any]]:
    """Every loss head that has ever been classified, keyed on its column."""
    return {r.column_name: {
        "column_name":    r.column_name,
        "label":          r.label,
        "loss_type":      r.loss_type,
        "kam_name":       r.kam_name,
        "role_code":      r.role_code,
        "sl_order":       r.sl_order,
        "is_active":      r.is_active,
        "effective_from": r.effective_from,
        "revision":       r.revision,
    } for r in db.execute(text(_RESOLVE_HEADS), {"on_date": on_date})}


def roles(db: Session) -> list[dict[str, Any]]:
    """The nodes of the KAM Wise Loss Tree, left to right."""
    return [{"role_code": r.role_code, "title": r.title,
             "owner_kam": r.owner_kam, "sl_order": r.sl_order}
            for r in db.execute(text(
                "SELECT role_code, title, owner_kam, sl_order "
                "FROM minehub.lcm_role_master ORDER BY sl_order"))]


def kams(db: Session, active_only: bool = True) -> list[dict[str, Any]]:
    """The people a loss head can be assigned to."""
    return [{"kam_name": r.kam_name, "emp_id": r.emp_id,
             "status": r.status, "sl_order": r.sl_order}
            for r in db.execute(text(
                "SELECT kam_name, emp_id, status, sl_order "
                "FROM minehub.lcm_kam_master "
                + ("WHERE status = 'ACTIVE' " if active_only else "")
                + "ORDER BY COALESCE(sl_order, 9999), kam_name"))]


def resolve_detached(on_date: date) -> dict[str, Any] | None:
    """Heads, roles and KAMs on a minehub session of its own.

    The LCM is built entirely on balcorpdb, so it cannot read minehub with the
    session it is handed. None means the platform database could not be
    reached; the caller then falls back to the maps compiled into lcm.py
    rather than reporting a matrix with no owners on it.
    """
    try:
        from app.minehub_db import SessionLocal
        if SessionLocal is None:
            return None
        pg = SessionLocal()
    except Exception:                                       # noqa: BLE001
        logger.warning("minehub unavailable for the loss heads", exc_info=True)
        return None
    try:
        return {"heads": resolve(pg, on_date),
                "roles": roles(pg),
                "kams":  kams(pg)}
    except Exception:                                       # noqa: BLE001
        logger.warning("loss head settings could not be read", exc_info=True)
        return None
    finally:
        pg.close()


# ── Writing ──────────────────────────────────────────────────────────────────
class SettingsError(ValueError):
    """Something the mine asked for that the table will not hold."""


#: What the selector can set on a loss head.
SETTABLE = ("label", "loss_type", "kam_name", "role_code", "sl_order",
            "is_active")

LOSS_TYPES = ("Controllable", "Non Controllable", "Unclassified")


def _as_text(v) -> str | None:
    return None if v is None else str(v)


def save(db: Session, effective_from: date,
         changes: dict[str, dict[str, Any]], actor: str) -> dict[str, Any]:
    """Record who owns which loss head, effective from a date.

    `changes` is {column_name: {field: value}}.

    A VERSION IS A WHOLE SETTING, NOT A DELTA -- same rule as the fleet, and
    for the same reason: the resolver reads one row per head, so a row holding
    only the field that moved would null the rest. Each head starts from what
    is already in force on the date and has the change applied on top.

    A head that has never been classified is accepted: it arrives from the
    source table as Unclassified and this is where it stops being so.
    """
    if not changes:
        return {"effective_from": effective_from.isoformat(),
                "written": [], "fields": 0}

    current = resolve(db, effective_from)
    known_kams = {r["kam_name"] for r in kams(db, active_only=False)}
    known_roles = {r["role_code"] for r in roles(db)}

    written: list[dict[str, Any]] = []
    fields = 0

    for col, wanted in changes.items():
        bad = set(wanted) - set(SETTABLE)
        if bad:
            raise SettingsError(f"{col}: {', '.join(sorted(bad))} "
                                "cannot be set on this screen")

        base = current.get(col, {})
        row = {f: base.get(f) for f in SETTABLE}
        row.update(wanted)

        if not (row.get("label") or "").strip():
            raise SettingsError(f"{col} must keep a loss description")
        if row["loss_type"] not in LOSS_TYPES:
            raise SettingsError(
                f"{col}: {row['loss_type']!r} is not a loss type")
        # A name or a node that is not on the master would be refused by the
        # foreign key; saying which one here is more use than a constraint.
        if row["kam_name"] is not None and row["kam_name"] not in known_kams:
            raise SettingsError(f"{col}: {row['kam_name']} is not a KAM")
        if row["role_code"] is not None and row["role_code"] not in known_roles:
            raise SettingsError(f"{col}: {row['role_code']} is not a node of "
                                "the loss tree")
        if row["is_active"] is None:
            row["is_active"] = True

        existing = db.execute(text(
            "SELECT * FROM minehub.lcm_loss_head_setting "
            "WHERE column_name = :c AND effective_from = :d"),
            {"c": col, "d": effective_from}).mappings().first()

        was_of = (lambda f: _as_text(existing[f])) if existing \
            else (lambda f: _as_text(base.get(f)))
        moved = {f: (was_of(f), _as_text(row[f]))
                 for f in SETTABLE if was_of(f) != _as_text(row[f])}
        if not moved:
            continue

        rev = (existing["revision"] + 1) if existing else 1
        params = {"c": col, "d": effective_from, "rev": rev, "actor": actor,
                  **{f: row[f] for f in SETTABLE}}
        if existing:
            db.execute(text("""
                UPDATE minehub.lcm_loss_head_setting
                SET    label = :label, loss_type = :loss_type,
                       kam_name = :kam_name, role_code = :role_code,
                       sl_order = :sl_order, is_active = :is_active,
                       entry_id = :actor, entry_date = now(), revision = :rev
                WHERE  column_name = :c AND effective_from = :d
            """), params)
        else:
            db.execute(text("""
                INSERT INTO minehub.lcm_loss_head_setting
                    (column_name, effective_from, label, loss_type, kam_name,
                     role_code, sl_order, is_active, entry_id, revision)
                VALUES (:c, :d, :label, :loss_type, :kam_name, :role_code,
                        :sl_order, :is_active, :actor, :rev)
            """), params)

        for f, (was, now_) in moved.items():
            db.execute(text("""
                INSERT INTO minehub.lcm_loss_head_hist
                    (column_name, effective_from, action, field,
                     old_value, new_value, revision, entry_id)
                VALUES (:c, :d, :action, :f, :old, :new, :rev, :actor)
            """), {"c": col, "d": effective_from, "f": f,
                   "action": "CHANGED" if existing else "ADDED",
                   "old": was if existing else None, "new": now_,
                   "rev": rev, "actor": actor})
            fields += 1

        written.append({"column_name": col,
                        "action": "CHANGED" if existing else "ADDED",
                        "revision": rev, "fields": sorted(moved)})

    db.commit()
    return {"effective_from": effective_from.isoformat(),
            "written": written, "fields": fields}


def history(db: Session, column_name: str | None = None,
            limit: int = 200) -> list[dict[str, Any]]:
    """Every change ever made to a loss head, newest first."""
    where = "WHERE column_name = :c" if column_name else ""
    return [{"column_name": r.column_name,
             "effective_from": r.effective_from.isoformat(),
             "action": r.action, "field": r.field,
             "old_value": r.old_value, "new_value": r.new_value,
             "revision": r.revision, "entry_id": r.entry_id,
             "entry_date": r.entry_date.isoformat()}
            for r in db.execute(text(
                f"SELECT * FROM minehub.lcm_loss_head_hist {where} "
                "ORDER BY entry_date DESC, id DESC LIMIT :lim"),
                {"c": column_name, "lim": limit})]


def versions(db: Session, column_name: str) -> list[dict[str, Any]]:
    """Every dated version of one loss head."""
    return [{"effective_from": r.effective_from.isoformat(),
             "label": r.label, "loss_type": r.loss_type,
             "kam_name": r.kam_name, "role_code": r.role_code,
             "sl_order": r.sl_order, "is_active": r.is_active,
             "revision": r.revision, "entry_id": r.entry_id,
             "entry_date": r.entry_date.isoformat()}
            for r in db.execute(text(
                "SELECT * FROM minehub.lcm_loss_head_setting "
                "WHERE column_name = :c ORDER BY effective_from DESC"),
                {"c": column_name})]
