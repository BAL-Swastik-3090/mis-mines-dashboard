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
           sl_order, is_active, action_text, owning_function,
           effective_from, revision
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
        # The mine's standing remedy for this head, and who carries it out.
        # NULL is a real answer -- 'other' is a catch-all and is given none.
        "action_text":     r.action_text,
        "owning_function": r.owning_function,
        "effective_from": r.effective_from,
        "revision":       r.revision,
    } for r in db.execute(text(_RESOLVE_HEADS), {"on_date": on_date})}


# NOT the same rule as the loss heads, and the difference matters.
#
# Elsewhere -- the fleet, the loss heads -- a date before the first row falls
# back to the EARLIEST row, because those tables are seeded and a setting must
# exist for every date. This one is an override on top of a derivation, so
# there is somewhere better to fall back to: the heads themselves.
#
# Reaching forward would be actively wrong here. The mine overrides Head Human
# Resource from 1 November; with the usual rule that single row is also the
# earliest, so September and October would silently start naming November's
# owner -- rewriting two months already reported. Only rows on or before the
# date are considered; before the first override, the node derives.
_RESOLVE_ROLES = """
    SELECT DISTINCT ON (s.role_code)
           s.role_code, s.owner_kam, s.title, s.effective_from, s.revision
    FROM   minehub.lcm_role_setting s
    WHERE  s.effective_from <= :on_date
    ORDER  BY s.role_code, s.effective_from DESC
"""


def roles(db: Session, on_date: date | None = None,
          heads: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """The nodes of the KAM Wise Loss Tree, left to right, as of a date.

    THE CARD FOLLOWS THE KAM SELECTOR. The owner of a node is taken from the
    loss heads underneath it: the KAM holding the most of them. The mine moved
    four Human Resource heads to a new KAM on 1 November; the matrix followed
    and the tree did not, because its names came from lcm_role_master.owner_kam
    -- a fixed column nothing in the application could write. Now there is one
    place to change a name and both follow it.

    MEASURED, NOT ASSUMED. Plurality reproduces every name the tree showed
    before this changed, in both months, with no tie anywhere:

        Mines Operation  Rana Vikash Singh 14
        Engineering      Amarendra Sarangi 3, Praspero Sahoo 2, K L Das 1
        Human Resource   Gurpreet Singh 4 / Dr. Pabitra Parida 4 (Nov),
                         Maheswar Mohanty 1

    A TIE IS NOT BROKEN BY GUESSING. Two KAMs level on head count means the
    mine has not said who runs the node, and picking one alphabetically would
    put a name on a reported figure for no reason. The registry's name stands
    until somebody sets the node explicitly.

    AN EXPLICIT DECISION ALWAYS WINS. lcm_role_setting (migration 104) is an
    override for what the heads cannot answer: a department head who owns no
    loss head personally, Chief of Mines and Head COB which have no heads
    under them at all, a tie, or a post recorded as vacant. It is dated like
    everything else, so overriding November leaves October as reported.

    `owner_source` says which of the three answered -- selected, derived or
    default -- so the screen can show it rather than implying every name was
    chosen by hand. `heads` lets a caller that has already resolved them pass
    them in instead of paying for the query twice.
    """
    # parent_role_code arrives with migration 105. Asked for rather than
    # assumed, so the application renders on a database that has not had it
    # yet -- the same rule the fleet and the role settings follow.
    has_parent = db.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = 'minehub' AND table_name = 'lcm_role_master' "
        "  AND column_name = 'parent_role_code'")).scalar() is not None
    cols = ("role_code, title, owner_kam, sl_order"
            + (", parent_role_code" if has_parent else ""))

    master: dict[str, dict[str, Any]] = {
        r.role_code: {"role_code": r.role_code, "title": r.title,
                      "owner_kam": r.owner_kam, "sl_order": r.sl_order,
                      # Who this head reports to. RECORDED, NEVER SUMMED --
                      # the tree draws every node on one line and each carries
                      # only its own heads, so adding through this would
                      # count Electrical's loss inside Engineering's too.
                      "parent_role_code": (getattr(r, "parent_role_code", None)
                                           if has_parent else None),
                      "owner_source": "default", "owner_heads": 0,
                      "node_heads": 0, "owner_tied": False,
                      "effective_from": None, "revision": None}
        for r in db.execute(text(
            f"SELECT {cols} FROM minehub.lcm_role_master ORDER BY sl_order"))}

    # ── 1. Derived from the loss heads in force on the day ──────────────────
    if heads is None:
        heads = resolve(db, on_date or date.today())
    tally: dict[str, dict[str, int]] = {}
    for h in heads.values():
        # A head hidden from the matrix does not vote for who runs the node.
        if h.get("is_active") is False:
            continue
        code, kam = h.get("role_code"), h.get("kam_name")
        if code and kam:
            tally.setdefault(code, {})
            tally[code][kam] = tally[code].get(kam, 0) + 1

    for code, counts in tally.items():
        node = master.get(code)
        if node is None:
            continue
        top = max(counts.values())
        tied = [k for k, v in counts.items() if v == top]
        node["node_heads"] = sum(counts.values())
        if len(tied) > 1:
            node["owner_tied"] = True       # the registry's name stands
            continue
        node["owner_kam"] = tied[0]
        node["owner_heads"] = top
        node["owner_source"] = "derived"

    # ── 2. An explicit dated decision, which beats the derivation ───────────
    if db.execute(text("SELECT to_regclass('minehub.lcm_role_setting')")).scalar() is None:
        logger.info("lcm_role_setting is absent -- node owners come from the "
                    "loss heads alone; apply migration 104 to allow overrides")
        return list(master.values())

    for r in db.execute(text(_RESOLVE_ROLES), {"on_date": on_date or date.today()}):
        node = master.get(r.role_code)
        if node is None:            # a node removed from the registry but
            continue                # still carrying dated decisions
        node["owner_kam"] = r.owner_kam
        if r.title:
            node["title"] = r.title
        node["owner_source"] = "selected"
        node["effective_from"] = r.effective_from
        node["revision"] = r.revision
    return list(master.values())


def kams(db: Session, active_only: bool = True) -> list[dict[str, Any]]:
    """The people a loss head can be assigned to.

    Designation and department come from SAP on every read, not from a copy
    taken when the person was added -- a copied designation is wrong from the
    first promotion and nothing on the screen would say so. A LEFT JOIN, so a
    name with no employee id yet still appears: the eight seeded ones are
    precisely those, and hiding them would hide the thing to fix.

    `in_sap` tells the screen which is which, so an unlinked name can be
    marked rather than silently looking the same as a linked one.
    """
    return [{"kam_name": r.kam_name, "emp_id": r.emp_id,
             "status": r.status, "sl_order": r.sl_order,
             "sap_name": r.sap_name, "designation": r.designation,
             "department": r.department,
             "in_sap": r.emp_id is not None and r.sap_name is not None}
            for r in db.execute(text(
                "SELECT k.kam_name, k.emp_id, k.status, k.sl_order, "
                "       e.empname AS sap_name, e.empdesg AS designation, "
                "       e.empdept AS department "
                "FROM   minehub.lcm_kam_master k "
                f"LEFT   JOIN {EMP_TBL} e ON e.empid = k.emp_id "
                + ("WHERE k.status = 'ACTIVE' " if active_only else "")
                + "ORDER BY COALESCE(k.sl_order, 9999), k.kam_name"))]


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
        resolved = resolve(pg, on_date)
        return {"heads": resolved,
                # Built from THOSE heads, not from a second query, so the card
                # on a node can never name somebody the rows under it do not.
                "roles": roles(pg, on_date, resolved),
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


# ── The tree's node owners ───────────────────────────────────────────────────
#: What the selector can set on a node of the KAM Wise Loss Tree. The node
#: itself -- which roles exist and their order -- is not editable here: adding
#: or removing a node re-shapes the tree and re-buckets every loss head under
#: it, which is a migration, not a setting.
ROLE_SETTABLE = ("owner_kam", "title")


def save_roles(db: Session, effective_from: date,
               changes: dict[str, dict[str, Any]], actor: str) -> dict[str, Any]:
    """Record who owns each node of the loss tree, effective from a date.

    `changes` is {role_code: {field: value}}.

    SAME RULES AS THE LOSS HEADS, deliberately -- the two are edited on one
    screen and saved with one date, and a reader should not have to learn two
    sets of behaviour. A version is a whole setting rather than a delta; each
    node starts from what is in force on that date and has the change applied
    on top; a decision already recorded for that date is revised in place and
    its revision number goes up; and nothing is written when nothing moved.

    A VACANT POST IS A REAL ANSWER. owner_kam may be set to None: a node whose
    head has left and has not been replaced should read as vacant, not as the
    last person to hold it.
    """
    if not changes:
        return {"effective_from": effective_from.isoformat(),
                "written": [], "fields": 0}

    if db.execute(text("SELECT to_regclass('minehub.lcm_role_setting')")).scalar() is None:
        raise SettingsError(
            "The tree's node owners cannot be changed yet -- migration 104 "
            "has not been applied to this database.")

    current = {r["role_code"]: r for r in roles(db, effective_from)}
    known_kams = {r["kam_name"] for r in kams(db, active_only=False)}

    written: list[dict[str, Any]] = []
    fields = 0

    for code, wanted in changes.items():
        bad = set(wanted) - set(ROLE_SETTABLE)
        if bad:
            raise SettingsError(f"{code}: {', '.join(sorted(bad))} "
                                "cannot be set on this screen")
        if code not in current:
            raise SettingsError(f"{code} is not a node of the loss tree")

        base = current[code]
        row = {f: base.get(f) for f in ROLE_SETTABLE}
        row.update(wanted)

        # A name the mine has not added would be refused by the foreign key;
        # saying which one here is more use than a constraint violation.
        if row["owner_kam"] is not None and row["owner_kam"] not in known_kams:
            raise SettingsError(
                f"{base['title']}: {row['owner_kam']} is not on the KAM list. "
                "Add them with Add KAM first, so the tree names somebody SAP "
                "knows.")
        if row["title"] is not None and not str(row["title"]).strip():
            raise SettingsError(f"{code} must keep a title")

        existing = db.execute(text(
            "SELECT owner_kam, title, revision FROM minehub.lcm_role_setting "
            "WHERE role_code = :c AND effective_from = :d"),
            {"c": code, "d": effective_from}).mappings().first()

        was_of = (lambda f: _as_text(existing[f])) if existing \
            else (lambda f: _as_text(base.get(f)))
        moved = {f: (was_of(f), _as_text(row[f]))
                 for f in ROLE_SETTABLE if was_of(f) != _as_text(row[f])}
        if not moved:
            continue

        rev = (existing["revision"] + 1) if existing else 1
        params = {"c": code, "d": effective_from, "rev": rev, "actor": actor,
                  **{f: row[f] for f in ROLE_SETTABLE}}
        if existing:
            db.execute(text("""
                UPDATE minehub.lcm_role_setting
                SET    owner_kam = :owner_kam, title = :title,
                       entry_id = :actor, entry_date = now(), revision = :rev
                WHERE  role_code = :c AND effective_from = :d
            """), params)
        else:
            db.execute(text("""
                INSERT INTO minehub.lcm_role_setting
                    (role_code, effective_from, owner_kam, title,
                     entry_id, revision)
                VALUES (:c, :d, :owner_kam, :title, :actor, :rev)
            """), params)

        for f, (was, now_) in moved.items():
            db.execute(text("""
                INSERT INTO minehub.lcm_role_hist
                    (role_code, effective_from, action, field,
                     old_value, new_value, revision, entry_id)
                VALUES (:c, :d, :action, :f, :old, :new, :rev, :actor)
            """), {"c": code, "d": effective_from, "f": f,
                   "action": "CHANGED" if existing else "ADDED",
                   "old": was if existing else None, "new": now_,
                   "rev": rev, "actor": actor})
            fields += 1

        written.append({"role_code": code,
                        "action": "CHANGED" if existing else "ADDED",
                        "revision": rev, "fields": sorted(moved)})

    db.commit()
    return {"effective_from": effective_from.isoformat(),
            "written": written, "fields": fields}


def role_history(db: Session, role_code: str | None = None,
                 limit: int = 200) -> list[dict[str, Any]]:
    """Every change ever made to a node owner, newest first."""
    if db.execute(text("SELECT to_regclass('minehub.lcm_role_hist')")).scalar() is None:
        return []
    where = "WHERE role_code = :c" if role_code else ""
    rows = db.execute(text(f"""
        SELECT role_code, effective_from, action, field, old_value, new_value,
               revision, entry_id, entry_date
        FROM   minehub.lcm_role_hist {where}
        ORDER  BY entry_date DESC, id DESC
        LIMIT  :lim
    """), {"c": role_code, "lim": limit} if role_code else {"lim": limit})
    return [dict(r) for r in rows.mappings()]


def role_versions(db: Session, role_code: str) -> list[dict[str, Any]]:
    """Every dated decision for one node, newest first."""
    if db.execute(text("SELECT to_regclass('minehub.lcm_role_setting')")).scalar() is None:
        return []
    rows = db.execute(text("""
        SELECT role_code, effective_from, owner_kam, title, revision,
               entry_id, entry_date
        FROM   minehub.lcm_role_setting
        WHERE  role_code = :c
        ORDER  BY effective_from DESC
    """), {"c": role_code})
    return [dict(r) for r in rows.mappings()]


# ── The people, and where they come from ─────────────────────────────────────
# A KAM is an employee SAP knows, picked from the register rather than typed.
# Both schemas are in corpappdb, so designation and department are read LIVE
# rather than copied: a copied designation is wrong from the first promotion
# and nothing on the screen would say so.
EMP_TBL = "sap_odata_api.sap_employee_details"


def search_employees(db: Session, q: str, limit: int = 25) -> list[dict[str, Any]]:
    """The employee picker behind "Add KAM".

    ILIKE, not LIKE: Postgres is case-sensitive where MySQL is not, and a
    LIKE here would quietly match nothing typed in the wrong case -- the
    picker would simply look empty rather than wrong.

    WITHDRAWN EMPLOYEES ARE EXCLUDED. 369 of the 1,328 rows are leavers, and
    offering them would let a loss head be assigned to somebody who left the
    company. An existing KAM who later leaves is NOT removed -- their past
    assignments must keep naming them -- which is what `status` on the master
    is for.

    `already` says the person is on the KAM list, so the screen can show them
    greyed rather than letting somebody add a duplicate and find out from a
    constraint.
    """
    term = (q or "").strip()
    if len(term) < 2:
        return []
    rows = db.execute(text(f"""
        SELECT e.empid       AS emp_id,
               e.empname     AS name,
               e.empdesg     AS designation,
               e.empdept     AS department,
               e.location    AS location,
               (k.emp_id IS NOT NULL) AS already,
               k.kam_name    AS kam_name
        FROM   {EMP_TBL} e
        LEFT   JOIN minehub.lcm_kam_master k ON k.emp_id = e.empid
        WHERE  (e.empid ILIKE :like OR e.empname ILIKE :like)
          AND  (e.status IS NULL OR e.status <> 'Withdrawn')
        ORDER  BY e.empname
        LIMIT  :lim
    """), {"like": f"%{term}%", "lim": limit}).mappings().all()
    return [dict(r) for r in rows]


def employee(db: Session, emp_id: str) -> dict[str, Any] | None:
    """One employee, or None. Used to validate what the picker sent back."""
    r = db.execute(text(f"""
        SELECT empid AS emp_id, empname AS name, empdesg AS designation,
               empdept AS department, status
        FROM   {EMP_TBL} WHERE empid = :e
    """), {"e": (emp_id or "").strip()}).mappings().first()
    return dict(r) if r else None


def _display_name(sap_name: str) -> str:
    """SAP shouts; the matrix does not.

    'RANA VIKASH KUMAR SINGH' on a row beside 'Gurpreet Singh' reads as two
    different kinds of thing. This is a STARTING POINT the user can edit
    before saving -- the mine's own short forms ('K L Das') are not derivable
    from the register and should not be guessed at.
    """
    small = {"kumar", "kr", "ran", "de", "da", "van"}
    out = []
    for w in (sap_name or "").split():
        lw = w.lower()
        out.append(w.upper() if len(w) <= 2 and w.isalpha() and w.isupper()
                   else (lw if lw in small and out else lw.capitalize()))
    return " ".join(out).strip()


def add_kam(db: Session, emp_id: str, kam_name: str | None,
            actor: str) -> dict[str, Any]:
    """Put an employee on the KAM list.

    The employee id is the identity; kam_name is the DISPLAY name and the key
    the dated loss-head settings point at. Both are stored: the first so the
    same person cannot be added twice under two spellings, the second so the
    matrix can go on saying what the mine calls them.
    """
    emp = employee(db, emp_id)
    if emp is None:
        raise SettingsError(f"{emp_id} is not an employee id SAP knows.")
    if (emp.get("status") or "") == "Withdrawn":
        raise SettingsError(
            f"{emp['name']} ({emp_id}) has left the company and cannot be "
            "given a loss head.")

    name = (kam_name or "").strip() or _display_name(emp["name"])

    held = db.execute(text(
        "SELECT kam_name, emp_id FROM minehub.lcm_kam_master "
        "WHERE emp_id = :e OR upper(kam_name) = upper(:n)"),
        {"e": emp["emp_id"], "n": name}).mappings().all()
    for h in held:
        if h["emp_id"] == emp["emp_id"]:
            raise SettingsError(
                f"{emp['name']} is already on the list as \"{h['kam_name']}\".")
        raise SettingsError(
            f"\"{h['kam_name']}\" is already on the list. Use a name that "
            "tells the two apart, or link the existing one to this employee.")

    nxt = db.execute(text(
        "SELECT coalesce(max(sl_order), 0) + 1 FROM minehub.lcm_kam_master")).scalar()
    db.execute(text("""
        INSERT INTO minehub.lcm_kam_master
            (kam_name, emp_id, status, sl_order, entry_id)
        VALUES (:n, :e, 'ACTIVE', :sl, :actor)
    """), {"n": name, "e": emp["emp_id"], "sl": nxt, "actor": actor})
    db.commit()
    return {"kam_name": name, "emp_id": emp["emp_id"],
            "name": emp["name"], "designation": emp.get("designation"),
            "department": emp.get("department"), "sl_order": nxt}


def link_kam(db: Session, kam_name: str, emp_id: str | None = None,
             status: str | None = None, *, actor: str) -> dict[str, Any]:
    """Attach an employee to a name already on the list, or retire it.

    THE NAME IS NOT CHANGED HERE, deliberately. kam_name is what every dated
    loss-head version points at; replacing it would orphan them, and the eight
    seeded names are exactly the ones that need an employee attached. A
    genuine rename is a cascade on the foreign key and a different job.

    Retiring is `status`, never a delete: a person who leaves must still be
    named by the months they owned.
    """
    cur = db.execute(text(
        "SELECT kam_name, emp_id, status FROM minehub.lcm_kam_master "
        "WHERE kam_name = :n"), {"n": kam_name}).mappings().first()
    if cur is None:
        raise SettingsError(f"\"{kam_name}\" is not on the KAM list.")

    sets, params = [], {"n": kam_name, "actor": actor}
    if emp_id is not None:
        emp = employee(db, emp_id)
        if emp is None:
            raise SettingsError(f"{emp_id} is not an employee id SAP knows.")
        clash = db.execute(text(
            "SELECT kam_name FROM minehub.lcm_kam_master "
            "WHERE emp_id = :e AND kam_name <> :n"),
            {"e": emp["emp_id"], "n": kam_name}).scalar()
        if clash:
            raise SettingsError(
                f"{emp['name']} is already on the list as \"{clash}\".")
        sets.append("emp_id = :e")
        params["e"] = emp["emp_id"]
    if status is not None:
        if status not in ("ACTIVE", "INACTIVE"):
            raise SettingsError(f"{status!r} is not a status.")
        sets.append("status = :st")
        params["st"] = status
    if not sets:
        return {"kam_name": kam_name, "changed": []}

    db.execute(text(
        f"UPDATE minehub.lcm_kam_master SET {', '.join(sets)}, "
        "entry_id = :actor, entry_date = now() WHERE kam_name = :n"), params)
    db.commit()
    return {"kam_name": kam_name,
            "changed": [s.split(" =")[0] for s in sets]}
