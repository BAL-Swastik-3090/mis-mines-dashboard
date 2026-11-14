"""The mine's daily dewatering sheet: one day in, the chain kept straight.

THE SHEET IS THE SPECIFICATION -- "Daily Dashboard Dewatering", the October
2026 columns, which the mine confirmed as the correct form. Twenty-one figures
are typed; six fall out of them and are computed BY THE DATABASE, as generated
columns, so a stored row cannot disagree with its own inputs through any route.
This module never writes them.

── THE ONE THING THIS MODULE IS ACTUALLY FOR ───────────────────────────────
Opening stock is yesterday's closing stock. That single line is why daily
dewatering cannot be a form that writes one row and stops: correcting the pump
hours for the 3rd moves the closing stock of the 3rd, which is the opening
stock of the 4th, which moves the 4th's closing, and so on to the last day
entered. The arithmetic within a day belongs to the database; the arithmetic
BETWEEN days belongs here, and is the whole job.

Every day the chain moves is rewritten and logged as CHAINED, so a figure that
changed without anybody touching it can be traced to the edit that moved it.

── A BREAK IN THE CHAIN IS REPORTED, NOT PAPERED OVER ──────────────────────
The mine's own history has one: 15 October 2026 was left half-entered, with an
opening stock and a seepage figure but no pump hours, and its closing stock
stored as 0. Re-chaining from a day like that would carry the nought forward
into every day after it. So a day whose closing stock cannot be computed stops
the chain, and the caller is told where it stopped rather than being handed a
silently wrong series.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

TABLE = "minehub.dewatering_daily_data"
LOG = "minehub.dewatering_history_log"

#: How far forward a single edit may re-chain. A correction to a day last year
#: would otherwise rewrite every day since, in one transaction, and log each
#: one. Beyond this the caller is told to re-chain explicitly rather than
#: having it happen as a side effect of a small edit.
MAX_CHAIN_DAYS = 400


class DewateringError(ValueError):
    """The day could not be saved, with every problem rather than the first."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("; ".join(problems))


# ── The sheet, field by field ────────────────────────────────────────────────
# ORDER IS THE SHEET'S ORDER, because the entry screen is read beside the
# spreadsheet it replaces and a reordered form is a form people mis-key.
# `kind` says who owns the value: INPUT is typed, DERIVED is the database's
# and is never written from here.
INPUT, DERIVED = "input", "derived"
NUMBER, TEXT = "number", "text"

#: (field, label, uom, section, kind, value type)
FIELDS: list[tuple[str, str, str, str, str, str]] = [
    ("rainfall_mm", "Rain fall in mm", "mm", "water", INPUT, NUMBER),
    ("pump_capacity_m3_hr", "Adjusted Pump Capacity", "M3/Hr", "water", INPUT, NUMBER),
    ("opening_stock_m3", "Opening Stock as on Date", "M3", "water", INPUT, NUMBER),
    ("seepage_m3", "Add Day Water Seepage", "M3", "water", INPUT, NUMBER),
    # TYPED, NOT DERIVED, and the sheet is why. "Add Day Rain Water" is a
    # literal on 209 of the mine's 407 days and a formula on 198: on more
    # than half of them the water is the reading and the millimetres are
    # the back-calculation. Generating it got 1-4 October 2025 wrong, where
    # the mine typed 10/3 mm against a round 1,000 M3 -- see migration 108.
    # save_day still fills it from rainfall x factor when the caller sends
    # rainfall and no water, so the form behaves as it always has.
    ("rain_water_m3", "Add Day Rain Water", "M3", "water", INPUT, NUMBER),
    ("plan_pump_hr", "PLAN Pump Running 450 kw & 425 hp pump", "Hr", "water", INPUT, NUMBER),
    ("plan_disposal_m3", "PLAN Disposal", "M3", "water", DERIVED, NUMBER),
    ("actual_pump_hr", "ACTUAL Pump Running 450 kw & 425 hp pump", "Hr", "water", INPUT, NUMBER),
    ("actual_disposal_m3", "ACTUAL Disposal", "M3", "water", DERIVED, NUMBER),
    ("variance_m3", "Variance", "M3", "water", DERIVED, NUMBER),
    ("closing_stock_m3", "Day Closing Stock", "M3", "water", DERIVED, NUMBER),
    ("plan_compliance_pct", "Plan Compliance", "%", "water", DERIVED, NUMBER),
    ("west_water_level_mrl", "Present Water level - West Dewatering (Middle pond JSL Side)", "Mrl", "levels", INPUT, NUMBER),
    ("west_silt_level_mrl", "Present Mud/Silt level - West middle (JSL Side) Dewatering pond", "Mrl", "levels", INPUT, NUMBER),
    ("east_water_level_mrl", "Present Water level - East Dewatering Middle pond (Imfa Side)", "Mrl", "levels", INPUT, NUMBER),
    ("east_silt_level_mrl", "Present Mud/Silt level - East middle (Imfa Side) Dewatering pond", "Mrl", "levels", INPUT, NUMBER),
    ("dewatering_reason", "Reason for Variances in Dewatering", "", "levels", INPUT, TEXT),
    ("slurry_pump_east_1_hr", "Slurry Pump-1 (East Side - 40HP GOODWIN)", "Hrs", "slurry", INPUT, NUMBER),
    # Labelled "Slurry Pump (East)-2" until 12 November 2026, when the mine
    # said the second slurry pump is on the WEST side, not the east -- which
    # their own master workbook had said all along, on the row headed
    # "Slurry Pump (Weast)-1". The column was renamed to match in migration
    # 107; the figures under it did not move, because they were already this
    # pump's. See that migration for the day-by-day check against the sheet.
    ("slurry_pump_west_1_hr", "Slurry Pump (West)-1", "Hrs", "slurry", INPUT, NUMBER),
    ("east_pit_water_level_mrl", "Water Level (East Pit Imfa side)", "Mrl", "slurry", INPUT, NUMBER),
    ("slurry_challenges", "Challenges in SLURRY discharge by SLURRY PUMP", "", "slurry", INPUT, TEXT),
    ("eddy_a_shift_min", "EDDY PUMP Operation - A shift", "Mins", "silt", INPUT, NUMBER),
    ("eddy_b_shift_min", "EDDY PUMP Operation - B shift", "Mins", "silt", INPUT, NUMBER),
    ("eddy_day_min", "EDDY PUMP Operation - Day", "Mins", "silt", INPUT, NUMBER),
    ("eddy_discharge_m3", "Total Discharge by EDDY", "M3", "silt", INPUT, NUMBER),
    ("total_slurry_discharge_m3", "Total Slurry Discharge", "M3", "silt", INPUT, NUMBER),
    ("eddy_challenges", "Challenges in SLURRY discharge by EDDY PUMP", "", "silt", INPUT, TEXT),
]

SECTIONS = [("water", "Water Management"), ("levels", "Pond Levels"),
            ("slurry", "Slurry"), ("silt", "Silt / EDDY")]

INPUT_FIELDS = [f for f, *_ in FIELDS if _[3] == INPUT]
DERIVED_FIELDS = [f for f, *_ in FIELDS if _[3] == DERIVED]
TEXT_FIELDS = {f for f, *_ in FIELDS if _[4] == TEXT}
NUMBER_FIELDS = {f for f, *_ in FIELDS if _[4] == NUMBER and _[3] == INPUT}

#: Typed, but not offered on the form: it is the mine's own constant and only
#: changes when the mine says the conversion changed. Carried per day so a
#: past day keeps the factor it was filed under.
RAIN_FACTOR = "rain_factor_m3_per_mm"

#: Negative is meaningless for these; a level reading can be negative (the
#: mine's own sheet has -3.5 Mrl) and so can a stock after an over-pump.
NON_NEGATIVE = {"rainfall_mm", "pump_capacity_m3_hr", "seepage_m3",
                "rain_water_m3",
                "plan_pump_hr", "actual_pump_hr", "slurry_pump_east_1_hr",
                "slurry_pump_west_1_hr", "eddy_a_shift_min",
                "eddy_b_shift_min", "eddy_day_min", "eddy_discharge_m3",
                "total_slurry_discharge_m3"}

_ALL = [f for f, *_ in FIELDS] + [RAIN_FACTOR]
_SELECT = ", ".join(["data_date", *_ALL, "revision", "entry_id", "entry_date",
                     "updated_id", "updated_date"])


def meta() -> list[dict[str, Any]]:
    """The sheet's shape, for a screen that must not hardcode it."""
    return [{"field": f, "label": lbl, "uom": uom, "section": sec,
             "kind": kind, "type": vtype}
            for f, lbl, uom, sec, kind, vtype in FIELDS]


def _row(r) -> dict[str, Any]:
    out: dict[str, Any] = {"date": r.data_date.isoformat()}
    for f in _ALL:
        v = getattr(r, f)
        if isinstance(v, Decimal):
            out[f] = float(v)
        elif isinstance(v, (date,)):
            out[f] = v.isoformat()
        else:
            out[f] = v
    out["revision"] = r.revision
    out["entry_id"] = r.entry_id
    out["entry_date"] = r.entry_date.isoformat() if r.entry_date else None
    out["updated_id"] = r.updated_id
    out["updated_date"] = r.updated_date.isoformat() if r.updated_date else None
    return out


# ── Reading ──────────────────────────────────────────────────────────────────
def read_day(db: Session, d: date) -> dict[str, Any] | None:
    r = db.execute(text(f"SELECT {_SELECT} FROM {TABLE} WHERE data_date = :d"),
                   {"d": d}).fetchone()
    return _row(r) if r else None


def read_range(db: Session, frm: date, to: date) -> list[dict[str, Any]]:
    rows = db.execute(text(
        f"SELECT {_SELECT} FROM {TABLE} "
        "WHERE data_date BETWEEN :frm AND :to ORDER BY data_date"),
        {"frm": frm, "to": to}).fetchall()
    return [_row(r) for r in rows]


def previous_closing(db: Session, d: date) -> dict[str, Any] | None:
    """The latest stored day BEFORE d, for the opening stock it hands forward.

    The nearest earlier day, not d-1: the mine misses days, and refusing to
    pre-fill because yesterday is absent would leave the person typing a figure
    the application already knows.
    """
    r = db.execute(text(
        f"SELECT data_date, closing_stock_m3 FROM {TABLE} "
        "WHERE data_date < :d ORDER BY data_date DESC LIMIT 1"),
        {"d": d}).fetchone()
    if not r:
        return None
    return {"date": r.data_date.isoformat(),
            "closing_stock_m3": (float(r.closing_stock_m3)
                                 if r.closing_stock_m3 is not None else None)}


def day_form(db: Session, d: date) -> dict[str, Any]:
    """Everything the entry screen needs for one day."""
    stored = read_day(db, d)
    prev = previous_closing(db, d)
    return {
        "date": d.isoformat(),
        "entered": stored is not None,
        "revision": stored["revision"] if stored else 0,
        "stored": stored,
        # What opening stock WOULD be pre-filled with, and where it came from,
        # so the screen can say "carried from 3 Nov" rather than showing a
        # number from nowhere.
        "suggested_opening": (prev or {}).get("closing_stock_m3"),
        "suggested_opening_from": (prev or {}).get("date"),
        "rain_factor": float(stored[RAIN_FACTOR]) if stored else 280.0,
        "fields": meta(),
        "sections": [{"key": k, "label": lbl} for k, lbl in SECTIONS],
    }


def history(db: Session, frm: date | None = None, to: date | None = None,
            field: str | None = None, limit: int = 300) -> list[dict[str, Any]]:
    where = ["1 = 1"]
    params: dict[str, Any] = {"lim": max(1, min(limit, 2000))}
    if frm and to:
        where.append("data_date BETWEEN :frm AND :to")
        params["frm"], params["to"] = frm, to
    if field:
        where.append("field = :f")
        params["f"] = field
    rows = db.execute(text(f"""
        SELECT data_date, field, action, old_value, new_value,
               revision, entry_id, entry_date
        FROM   {LOG}
        WHERE  {' AND '.join(where)}
        ORDER  BY entry_date DESC, data_date, id
        LIMIT  :lim
    """), params).fetchall()
    labels = {f: lbl for f, lbl, *_ in FIELDS}
    return [{"date": r.data_date.isoformat(), "field": r.field,
             "label": labels.get(r.field, r.field), "action": r.action,
             "old_value": r.old_value, "new_value": r.new_value,
             "revision": r.revision, "entry_id": r.entry_id,
             "entry_date": r.entry_date.isoformat() if r.entry_date else None}
            for r in rows]


# ── Writing ──────────────────────────────────────────────────────────────────
def _num(v: Any, field: str, problems: list[str]) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        d = Decimal(str(v))
    except (InvalidOperation, ValueError):
        problems.append(f"{field}: {v!r} is not a number")
        return None
    if field in NON_NEGATIVE and d < 0:
        problems.append(f"{field}: cannot be negative")
        return None
    return d


def _clean(values: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Coerce what the screen sent into what the columns hold.

    A FIELD LEFT OUT IS LEFT ALONE; a field sent as null is CLEARED. The two
    are different edits and the screen means different things by them, so the
    payload is read as "these fields, these values" rather than as a whole row.
    """
    problems: list[str] = []
    out: dict[str, Any] = {}
    unknown = sorted(set(values) - set(INPUT_FIELDS) - {RAIN_FACTOR})
    if unknown:
        problems.append("not fields on this sheet: " + ", ".join(unknown))
    for f, v in values.items():
        if f in unknown:
            continue
        if f in TEXT_FIELDS:
            s = None if v is None else str(v).strip()
            out[f] = s or None
        else:
            out[f] = _num(v, f, problems)
    return out, problems


def _as_text(v: Any) -> str | None:
    """How a value is written into the log. Numbers normalised so 8 and 8.00
    do not read as a change when nothing moved."""
    if v is None:
        return None
    if isinstance(v, Decimal):
        return format(v.normalize(), "f")
    if isinstance(v, float):
        return format(Decimal(str(v)).normalize(), "f")
    return str(v)


def _log(db: Session, d: date, field: str, action: str,
         old: Any, new: Any, revision: int, actor: str) -> None:
    o, n = _as_text(old), _as_text(new)
    if o == n:
        return
    db.execute(text(f"""
        INSERT INTO {LOG} (data_date, field, action, old_value, new_value,
                           revision, entry_id)
        VALUES (:d, :f, :a, :o, :n, :r, :by)
    """), {"d": d, "f": field, "a": action, "o": o, "n": n,
           "r": revision, "by": actor})


def _next_revision(db: Session, d: date) -> int:
    r = db.execute(text(f"SELECT revision FROM {TABLE} WHERE data_date = :d"),
                   {"d": d}).scalar()
    return (r or 0) + 1


def _rechain(db: Session, after: date, revision: int,
             actor: str) -> dict[str, Any]:
    """Carry a changed closing stock forward through the days that follow.

    WHY THIS EXISTS AT ALL: opening stock is the previous day's closing, so an
    edit to one day is an edit to every day after it. Leaving them alone would
    show a series that does not add up down its own column.

    IT STOPS AT A BREAK, AND SAYS WHERE. A day whose closing stock is NULL --
    15 October 2026 is the mine's own example, left with no pump hours -- has
    nothing to hand forward, and guessing would push a wrong opening into every
    later day. The run stops there and the day is named.

    IT ALSO STOPS WHEN NOTHING MOVES. Once a day's opening stock already equals
    what it should be, every later day is already right, so there is nothing
    further to do.
    """
    changed: list[str] = []
    stopped_at: str | None = None

    cur = db.execute(text(
        f"SELECT data_date, closing_stock_m3 FROM {TABLE} WHERE data_date = :d"),
        {"d": after}).fetchone()
    if cur is None:
        return {"chained": [], "stopped_at": None}
    carry = cur.closing_stock_m3

    rows = db.execute(text(
        f"SELECT data_date, opening_stock_m3, closing_stock_m3 FROM {TABLE} "
        "WHERE data_date > :d ORDER BY data_date LIMIT :lim"),
        {"d": after, "lim": MAX_CHAIN_DAYS}).fetchall()

    for r in rows:
        if carry is None:
            stopped_at = r.data_date.isoformat()
            break
        if r.opening_stock_m3 is not None and \
           Decimal(r.opening_stock_m3) == Decimal(carry):
            break                     # already correct; so is everything after
        _log(db, r.data_date, "opening_stock_m3", "CHAINED",
             r.opening_stock_m3, carry, revision, actor)
        db.execute(text(
            f"UPDATE {TABLE} SET opening_stock_m3 = :v, revision = :r, "
            "updated_id = :by, updated_date = now() WHERE data_date = :d"),
            {"v": carry, "r": revision, "by": actor, "d": r.data_date})
        changed.append(r.data_date.isoformat())
        carry = db.execute(text(
            f"SELECT closing_stock_m3 FROM {TABLE} WHERE data_date = :d"),
            {"d": r.data_date}).scalar()

    return {"chained": changed, "stopped_at": stopped_at}


# The five inputs the generated closing stock is computed from. Any one of
# them left blank makes closing_stock_m3 NULL, and a day with no closing
# stock hands nothing on to the day after it.
_CLOSING_INPUTS = {
    "opening_stock_m3":    "opening stock",
    "seepage_m3":          "seepage",
    "rainfall_mm":         "rainfall",
    "actual_pump_hr":      "actual pump hours",
    "pump_capacity_m3_hr": "pump capacity",
}


def missing_for_closing(row: dict[str, Any] | None) -> list[str]:
    """Which inputs a day is short of, named as the form names them.

    Empty when the closing stock resolves. The point is to say WHICH figure
    is missing: the chain banner used to assume pump hours and capacity, and
    the day that actually broke the Executive Summary on 6 November was short
    of rainfall, which that wording would have sent somebody looking past.
    """
    if row is None or row.get("closing_stock_m3") is not None:
        return []
    return [label for field, label in _CLOSING_INPUTS.items() if row.get(field) is None]


def save_day(db: Session, d: date, values: dict[str, Any],
             actor: str, rechain: bool = True) -> dict[str, Any]:
    """Store or edit one day, then carry the change forward.

    THE DERIVED COLUMNS ARE NEVER WRITTEN. They are generated by the database
    from the inputs in the same row, so there is no code path -- here or
    anywhere -- that can store a disposal figure disagreeing with the hours
    and capacity it came from.

    A SAVE THAT CHANGES NOTHING IS NOT A REVISION: no log rows, no revision
    bump, no re-chain. Pressing Save twice is not an edit.
    """
    if not actor:
        raise DewateringError(["no employee id on the request"])
    clean, problems = _clean(values)
    if problems:
        raise DewateringError(problems)

    before = read_day(db, d)
    revision = _next_revision(db, d)

    # RAIN WATER FOLLOWS RAINFALL UNLESS IT IS STATED. It was a generated
    # column until migration 108 and the screen still presents it that way:
    # type the millimetres and the water appears. What changed is that the
    # mine can now type the water itself -- which is what its own sheet does
    # on more than half its days -- and an explicit figure is never
    # overwritten by this. An explicit null is a deliberate clearing and is
    # also left alone; only a caller that says nothing at all gets the fill.
    if "rainfall_mm" in clean and "rain_water_m3" not in values:
        mm = clean["rainfall_mm"]
        if mm is None:
            clean["rain_water_m3"] = None
        else:
            factor = clean.get(RAIN_FACTOR)
            if factor is None and before is not None:
                factor = before.get(RAIN_FACTOR)
            if factor is None:
                factor = Decimal("280")
            clean["rain_water_m3"] = Decimal(str(mm)) * Decimal(str(factor))

    if before is None:
        # CHECKED BEFORE THE AUTO-FILL BELOW, not after. The fill supplies an
        # opening stock the caller did not send, which would make an empty
        # submission look like a day worth storing and leave a row carrying
        # nothing but a number carried from somewhere else.
        if not clean:
            raise DewateringError(["nothing was entered for this day"])

        # OPENING STOCK IS A RULE OF THE SYSTEM, NOT OF THE SCREEN. The form
        # pre-fills it, but the form is not the only way a day can arrive, and
        # a day created without it stores a NULL opening -- which makes the
        # closing stock NULL too, and breaks the chain for every day after.
        # Absent means "use the rule"; an explicit null means the caller
        # deliberately wants it blank, and is left alone.
        if "opening_stock_m3" not in values:
            prev = previous_closing(db, d)
            if prev and prev["closing_stock_m3"] is not None:
                clean["opening_stock_m3"] = Decimal(str(prev["closing_stock_m3"]))
        cols = [f for f in clean]
        db.execute(text(f"""
            INSERT INTO {TABLE} (data_date, {', '.join(cols)}, entry_id)
            VALUES (:d, {', '.join(':' + c for c in cols)}, :by)
        """), {"d": d, "by": actor, **clean})
        for f, v in clean.items():
            if v is not None:
                _log(db, d, f, "ADDED", None, v, revision, actor)
        action = "created"
    else:
        moved = {f: v for f, v in clean.items()
                 if _as_text(v) != _as_text(before.get(f))}
        if not moved:
            db.commit()
            return {"date": d.isoformat(), "action": "unchanged",
                    "revision": before["revision"], "revised": False,
                    "fields_changed": 0, "chained": [], "stopped_at": None}
        sets = ", ".join(f"{f} = :{f}" for f in moved)
        db.execute(text(
            f"UPDATE {TABLE} SET {sets}, revision = :__r, updated_id = :__by, "
            "updated_date = now() WHERE data_date = :__d"),
            {"__r": revision, "__by": actor, "__d": d, **moved})
        for f, v in moved.items():
            old = before.get(f)
            act = ("ADDED" if old is None else
                   "REMOVED" if v is None else "CHANGED")
            _log(db, d, f, act, old, v, revision, actor)
        action = "updated"

    chain = {"chained": [], "stopped_at": None}
    if rechain:
        chain = _rechain(db, d, revision, actor)

    db.commit()
    after = read_day(db, d)
    return {
        "date": d.isoformat(),
        "action": action,
        "revision": revision,
        "revised": revision > 1,
        "fields_changed": len(clean) if before is None else len(
            {f for f in clean if _as_text(clean[f]) != _as_text(before.get(f))}),
        "chained": chain["chained"],
        "stopped_at": chain["stopped_at"],
        # What this day itself is short of, if anything. stopped_at only ever
        # describes days AFTER this one, so saving the latest day -- the
        # ordinary case -- warned about nothing even when the day just stored
        # could not resolve its own closing stock. That is what happened on
        # 6 November: saved, accepted, and silently unusable.
        "closing_unresolved": missing_for_closing(after),
        "stored": after,
    }


# ── The Executive Summary's dewatering block ─────────────────────────────────
#
# WHY A SESSION OF ITS OWN. This table is in minehub on Postgres and the
# Executive Summary is built entirely on MySQL, so threading a second session
# down to it would touch the router, the service and every test that builds
# the service by hand. Same argument, and the same shape, as
# shifting.totals_detached and equipment_plan.resolve_detached.
#
# WHY IT RETURNS None RATHER THAN ZEROS WHEN IT CANNOT READ. Postgres here is
# reached over the VPN and is not always up. A mine that disposed of no water
# and a database nobody can reach look identical once both are written as 0,
# and only one of them is a fact about the mine.
#
# ── THE WINDOW IT REPORTS IS NOT THE WINDOW IT IS ASKED FOR ────────────────
# The mine files dewatering in arrears and sometimes stops for a fortnight. A
# month-to-date total over a window whose last eighteen days are empty is not
# a month-to-date total: it is thirteen days presented as thirty-one, and
# every rate derived from it -- average pumping, days to clear -- is wrong by
# the ratio of the two. So the totals cover the ENTERED days only, the window
# that was actually asked for is reported beside them, and the gap between
# them is named so the screen can say so before any figure is read.
def summary_detached(frm: date, to: date, rd: date) -> dict[str, Any] | None:
    """Dewatering for the Executive Summary: a day, a period, and the gap.

    `frm`..`to` is the month-to-date window and `rd` the reported day.
    Returns None when the platform database cannot be reached.
    """
    try:
        from app.minehub_db import SessionLocal
        if SessionLocal is None:
            return None
        pg = SessionLocal()
    except Exception:                                       # noqa: BLE001
        logger.warning("minehub unavailable for the dewatering block",
                       exc_info=True)
        return None
    try:
        return _summary(pg, frm, to, rd)
    except Exception:                                       # noqa: BLE001
        logger.warning("dewatering block could not be built", exc_info=True)
        return None
    finally:
        pg.close()


def _fl(v) -> float | None:
    return float(v) if v is not None else None


def _blk(key: str, label: str, uom: str, plan: float | None,
         actual: float | None, dp: int = 0, no_plan: bool = False,
         inverse: bool = False, overdraw: float = 0.0) -> dict[str, Any]:
    """One line of the block. `no_plan` means a plan will never exist for this
    measure -- inflow is seepage and weather, so that blank is permanent and
    not a plan somebody has yet to file.

    `inverse` marks the one measure where BEATING the plan means coming in
    BELOW it: closing stock. Reporting 128% there the way disposal reports
    95.6% would colour a sump sitting two thousand cubic metres above plan as
    an overachievement, so the percentage carries a different meaning -- the
    VARIANCE against plan, signed, with below-plan the good direction -- and
    this flag is what tells the page to read it that way."""
    if inverse:
        pct = (None if (plan is None or plan <= 0 or actual is None)
               else round((actual - plan) / plan * 100, 1))
    else:
        pct = (None if (no_plan or not plan or actual is None)
               else round(actual / plan * 100, 1))
    return {"key": key, "label": label, "uom": uom, "dp": dp,
            "plan": None if plan is None else round(plan, dp),
            "actual": None if actual is None else round(actual, dp),
            "pct": pct,
            "no_plan": no_plan, "inverse": inverse,
            # Water the plan asked for that was never in the sump. Non-zero
            # only on closing stock, and only when the plan out-ran the
            # inflow -- the plan figure beside it is then a floor, not a
            # forecast, and the page has to be able to say so.
            "overdraw": round(overdraw) if overdraw else 0}


def _day_plan_closing(r, inflow: float) -> tuple[float, float] | None:
    """One day's planned closing stock, and the water the plan could not have
    pumped -- on that day's own opening and that day's own plan disposal.
    Without either figure there is no benchmark, and a blank says so.

    FLOORED AT EMPTY, for the reason in _plan_chain: a sump holds no negative
    water, so a plan asking for more than is there leaves it empty and the
    remainder is over-draw, not stock.
    """
    if r.opening_stock_m3 is None or r.plan_disposal_m3 is None:
        return None
    want = float(r.opening_stock_m3) + inflow - float(r.plan_disposal_m3)
    return (want, 0.0) if want >= 0 else (0.0, -want)


def _plan_chain(rows) -> dict[str, Any]:
    """Where the plan would have left the sump, chained day by day.

        plan closing(d) = MAX(0, plan opening(d) + inflow(d) - plan disposal(d))
        plan opening(d+1) = plan closing(d)

    THE FLOOR IS THE WHOLE POINT, and its absence was a real defect. The
    period used to be computed in one line -- first opening + total inflow -
    total plan disposal -- which is the same as chaining forward ONLY while
    the sump never empties. Once the plan asks for more water than is in it,
    that line keeps subtracting water that does not exist and reports a
    NEGATIVE STOCK. November 2026 read -3,728 M3: the plan emptied the sump on
    the 7th and went on pumping air for three more days.

    It was not a one-off. Over the 406 days entered, the plan runs the sump
    dry in NINE of fourteen months -- and in three of those (Jan, Jun and Oct
    2026) the old figure came out POSITIVE anyway, because later rain refilled
    the arithmetic. Those were the dangerous ones: a negative number at least
    announces itself.

    The two outputs decompose the old figure exactly, in every month:

        old figure = plan closing - over-draw

    so nothing is lost. The single number is split into the two facts it was
    conflating: where the plan would have left the sump, and how much water it
    asked for that was never there.

    THE INFLOW IS THE ACTUAL INFLOW, unchanged and deliberately so -- seepage
    is measured and rain is weather, neither was ever planned, and holding the
    plan to a dry month it did not get would flatter it.
    """
    opening = _fl(rows[0].opening_stock_m3)
    if opening is None:
        return {"closing": None, "overdraw": 0.0, "dry_from": None,
                "dry_days": 0}

    stock, overdraw, dry_from, dry_days = opening, 0.0, None, 0
    for r in rows:
        inflow = (_fl(r.seepage_m3) or 0.0) + (_fl(r.rain_water_m3) or 0.0)
        # A day with no plan filed cannot move the plan's stock. The water
        # still arrives, which is what the mine's own sheet does.
        plan_disp = _fl(r.plan_disposal_m3) or 0.0
        want = stock + inflow - plan_disp
        if want < 0:
            overdraw += -want
            dry_days += 1
            if dry_from is None:
                dry_from = r.data_date
            want = 0.0
        stock = want
    return {"closing": stock, "overdraw": overdraw,
            "dry_from": dry_from, "dry_days": dry_days}


def _summary(pg: Session, frm: date, to: date, rd: date) -> dict[str, Any]:
    # A DAY COUNTS AS ENTERED WHEN IT CARRIES PUMP HOURS, not when a row
    # exists. A row holding nothing but a rainfall reading -- which the mine
    # does file on its own -- has no disposal, no closing stock and nothing
    # this block reports, and counting it would overstate completeness and
    # understate every per-day rate derived from it.
    rows = pg.execute(text(f"""
        SELECT data_date, opening_stock_m3, closing_stock_m3,
               seepage_m3, rain_water_m3,
               plan_pump_hr, actual_pump_hr,
               plan_disposal_m3, actual_disposal_m3,
               pump_capacity_m3_hr
        FROM   {TABLE}
        WHERE  data_date BETWEEN :frm AND :to
          AND  actual_pump_hr IS NOT NULL
        ORDER  BY data_date
    """), {"frm": frm, "to": to}).fetchall()

    window_days = (to - frm).days + 1
    if not rows:
        return {"available": True, "entered": 0, "window_days": window_days,
                "data_to": None, "gap_from": frm.isoformat(),
                "gap_to": to.isoformat(), "td": None, "mtd": None,
                "kpi": None, "status": "critical"}

    def s(attr: str) -> float:
        return float(sum(getattr(r, attr) or 0 for r in rows))

    first, last = rows[0], rows[-1]
    entered = len(rows)
    data_to = last.data_date

    disp_plan, disp_act = s("plan_disposal_m3"), s("actual_disposal_m3")
    hr_plan, hr_act = s("plan_pump_hr"), s("actual_pump_hr")
    inflow = s("seepage_m3") + s("rain_water_m3")
    opening = _fl(first.opening_stock_m3)
    closing = _fl(last.closing_stock_m3)

    # WHERE THE SUMP WOULD STAND HAD THE PLAN BEEN PUMPED -- the mine's own
    # balance, chained day by day and floored at empty. See _plan_chain for
    # why the floor is there and what it fixed.
    chain = _plan_chain(rows)
    plan_closing = chain["closing"]
    plan_overdraw = chain["overdraw"]

    def pct(a: float | None, p: float | None) -> float | None:
        # Both halves or no percentage, the rule this page already applies to
        # de-silting: a plan with nothing against it yet is not 0%.
        if not p or a is None:
            return None
        return round(a / p * 100, 1)

    # THE DAY COLUMN HOLDS THE REPORTED DAY ONLY IF IT WAS ENTERED. Falling
    # back to the latest entered day would put figures under a heading naming
    # a different date; `data_to` says when the data actually stops, and the
    # day column shows dashes rather than somebody else's day.
    td_row = next((r for r in rows if r.data_date == rd), None)

    def day_rows(r) -> list[dict[str, Any]]:
        if r is None:
            return []
        inf = (_fl(r.seepage_m3) or 0) + (_fl(r.rain_water_m3) or 0)
        pc = _day_plan_closing(r, inf)
        return [
            _blk("disposal", "Water Disposal", "M³",
                 _fl(r.plan_disposal_m3), _fl(r.actual_disposal_m3)),
            _blk("pump_hr", "Pump Run Hours", "Hr",
                 _fl(r.plan_pump_hr), _fl(r.actual_pump_hr), dp=1),
            # No plan exists for inflow and none ever will -- seepage is
            # measured and rain is weather. That blank is permanent, which is
            # not the same as a plan nobody has filed yet.
            _blk("inflow", "Seepage + Rain Inflow", "M³", None, inf,
                 no_plan=True),
            _blk("stock", "Sump Closing Stock", "M³",
                 (pc or (None, 0.0))[0], _fl(r.closing_stock_m3),
                 inverse=True, overdraw=(pc or (None, 0.0))[1]),
        ]

    mtd_rows = [
        _blk("disposal", "Water Disposal", "M³", disp_plan, disp_act),
        _blk("pump_hr", "Pump Run Hours", "Hr", hr_plan, hr_act, dp=1),
        _blk("inflow", "Seepage + Rain Inflow", "M³", None, inflow,
             no_plan=True),
        # Both figures run from the FIRST entered day's opening to the LAST
        # entered day's closing, so the row spans the days that exist rather
        # than the days that do not.
        _blk("stock", "Sump Closing Stock", "M³", plan_closing, closing,
             inverse=True, overdraw=plan_overdraw),
    ]

    # ── the six figures across the top ───────────────────────────────────
    # Every rate is per ENTERED day, for the reason in the block comment.
    avg_hr = round(hr_act / entered, 1)
    avg_plan_hr = round(hr_plan / entered, 1)

    # What the pumps must run each day simply to stand still: the water
    # arriving, at the rate it is pumped out. A day below this line is a day
    # the sump rose, whatever the plan compliance says.
    cap = _fl(last.pump_capacity_m3_hr)
    offset_hr = round(inflow / entered / cap, 1) if cap else None

    drawdown = (round((opening - closing) / entered, 1)
                if (opening is not None and closing is not None) else None)
    # Only a sump that is actually FALLING has a date it empties. A rising one
    # never clears, and dividing by a negative drawdown would print a
    # reassuring negative number of days.
    days_to_clear = (round(closing / drawdown, 1)
                     if (drawdown and drawdown > 0 and closing) else None)
    completeness = round(entered / window_days * 100, 1)

    # THE BADGE IS ABOUT THE DATA, NOT THE PUMPING. A month 90% achieved on a
    # third of its days is not a 90% month, and how much of it is missing is
    # the first thing a reader has to know before quoting any of it.
    status = ("ok" if completeness >= 90
              else "watch" if completeness >= 60 else "critical")

    gap_from = data_to + timedelta(days=1) if data_to < to else None

    return {
        "available": True,
        "entered": entered,
        "window_days": window_days,
        "data_to": data_to.isoformat(),
        "gap_from": gap_from.isoformat() if gap_from else None,
        "gap_to": to.isoformat() if gap_from else None,
        "td": {"date": rd.isoformat(), "entered": td_row is not None,
               "rows": day_rows(td_row)},
        "mtd": {"from": first.data_date.isoformat(),
                "to": data_to.isoformat(), "rows": mtd_rows},
        "kpi": {
            "disposal_actual": round(disp_act),
            "disposal_plan": round(disp_plan),
            "disposal_pct": pct(disp_act, disp_plan),
            "pump_actual_hr": round(hr_act, 1),
            "pump_plan_hr": round(hr_plan, 1),
            "pump_pct": pct(hr_act, hr_plan),
            "avg_pump_hr": avg_hr,
            "avg_plan_hr": avg_plan_hr,
            "offset_hr": offset_hr,
            "opening_stock": opening,
            "closing_stock": closing,
            "plan_closing_stock": (round(plan_closing)
                                   if plan_closing is not None else None),
            # How far the plan out-ran the water, and from when. Zero and null
            # in a month the plan fitted -- which is most of the KPI's job
            # here: it is silent unless there is something to say.
            "plan_overdraw": round(plan_overdraw) if plan_overdraw else 0,
            "plan_dry_from": (chain["dry_from"].isoformat()
                              if chain["dry_from"] else None),
            "plan_dry_days": chain["dry_days"],
            # BOTH ENDS, NOT JUST THE OPENING. closing is NULL whenever a
            # day is short of a figure the balance needs -- rainfall left
            # blank makes rain_water_m3 NULL, and the generated closing stock
            # with it. Guarded on `opening` alone this reached a None minus a
            # float and raised; the caller catches that and returns the whole
            # dewatering block as None, so one blank cell on one day blanked
            # the sump, the disposal, the pump hours and the Executive
            # Summary's dewatering KPI together. drawdown and days_to_clear
            # above already test both ends; this is the same test.
            #
            # FOUND TWICE, INDEPENDENTLY -- here on 6 November and again on
            # the 13th, when a day filed with pump hours but no rainfall hit
            # it. The second finding came off a branch forked before the
            # first fix, which is what a long-lived fork from 398c54a costs.
            "stock_change_pct": (round((closing - opening) / opening * 100, 1)
                                 if opening and closing is not None else None),
            "net_drawdown": drawdown,
            "days_to_clear": days_to_clear,
            "completeness_pct": completeness,
        },
        "status": status,
    }
