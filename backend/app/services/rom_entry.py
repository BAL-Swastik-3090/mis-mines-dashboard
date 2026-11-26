"""The day-wise ROM analysis: what was dug, from where, and how it assayed.

One row is one SAMPLE — a shift, a location, the tonnage that came off it and
the assay of that tonnage. A day is several of them. The mine's workbook has
been kept this way since April 2024; this is the same sheet with the
arithmetic taken out of it and the spellings pinned down.

── NOTHING THAT CAN BE COMPUTED IS STORED ──────────────────────────────────
Three of the workbook's columns are arithmetic over the others, and all three
are computed here instead:

    TOTAL QTY      Σ of the day's sample tonnages
    WET & AVG.     tonnage-weighted mean of the day's assays
    RATIO(Cr/Fe)   (Cr2O3 × 0.6843) ÷ (FeO × 0.7773)

The ratio is worth spelling out. That formula reproduces 2,093 of the
workbook's 2,138 rows to within 0.02 — the 45 it does not are typing slips,
one reading 2.79 where the chemistry gives 1.86. Computing it does not merely
save a keystroke; it removes a class of error the sheet has been carrying for
two years.

The factors are the mass fractions: Cr in Cr2O3 is 2×51.996 ÷ 151.99, and Fe
in FeO is 55.845 ÷ 71.844. They are constants of chemistry, not settings, so
they are compiled in rather than put in a table somebody has to maintain.

── TWO HALVES, TWO OWNERS ──────────────────────────────────────────────────
Production files the day and submits. Geology then fills the block half — the
bench level and what the block model says that ground holds — and submits.
One person holding both permissions does the lot in one pass; the split is
about what each permission authorises, not about how many people there are.

A production save NEVER writes the block columns and a block save never
writes the production ones. That is not politeness: the two carry separate
rom_entry_id/rom_entry_date and block_entry_id/block_entry_date, and a save
that quietly rewrote the other half would make
those two fields a lie.

── WHY A DAY SAVE WILL NOT DELETE A ROW GEOLOGY HAS FILLED ─────────────────
Saving a day replaces that day's rows with the ones submitted, so a line
removed on screen is removed in the database. But a row with a block model
against it is somebody else's work as well, and dropping it by leaving it out
of a list would destroy that silently. Such a row has to be removed on
purpose, through the delete endpoint, which is its own permission.

── NOTHING BEFORE NOVEMBER 2026 HAS A BLOCK MODEL ──────────────────────────
Stated by the mine. So a blank block half on an older row is correct and must
never be read as missing data or filled with a guess.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

# Mass fraction of Cr in Cr2O3, and of Fe in FeO.
CR_IN_CR2O3 = 0.6843
FE_IN_FEO = 0.7773

SHIFTS = ("A", "B", "C")

# What a production save is allowed to write. The block columns are not here,
# and that is the enforcement, not a comment about intent.
# moisture_source is in here because it is AUDITED, not because the form
# sends it -- the form cannot. Migration 134 ties a moisture to where it came
# from, and a seeded 'SAP ROM1 DAY' figure that the mine later overtypes has
# to become 'MEASURED' in the same breath. That flip is a provenance change
# and belongs in the log beside the figure that caused it.
ROM_FIELDS = ("shift", "location_id", "trips", "qty_mt",
              "moisture_pct", "moisture_source", "cr2o3_pct", "feo_pct")
BLOCK_FIELDS = ("block_mrl", "block_cr2o3_pct")


def ratio(cr2o3: float | None, feo: float | None) -> float | None:
    """Cr/Fe. None when either side is missing or FeO is nought.

    A zero FeO is not a very high ratio, it is a reading nobody took — the
    workbook has rows of all-zeros for days the mine did not run.
    """
    if cr2o3 is None or feo is None or feo <= 0:
        return None
    return round((float(cr2o3) * CR_IN_CR2O3) / (float(feo) * FE_IN_FEO), 3)


def _wavg(rows: list[dict], field: str, weight: str = "qty_mt") -> float | None:
    """Tonnage-weighted mean, or None when nothing carries the figure.

    Rows missing the value are left out of BOTH sides of the division. The
    alternative — counting their tonnage in the denominator — would drag the
    average towards nought in proportion to how much was not measured, which
    reads as a poor grade rather than as a partial one.
    """
    num = den = 0.0
    for r in rows:
        v, w = r.get(field), r.get(weight)
        if v is None or w is None:
            continue
        num += float(v) * float(w)
        den += float(w)
    return round(num / den, 3) if den > 0 else None


# ── reading ─────────────────────────────────────────────────────────────────

_SELECT = """
    SELECT e.rom_id, e.on_date, e.shift, e.location_id, l.name AS location,
           l.is_active AS location_active,
           e.trips, e.qty_mt, e.moisture_pct, e.moisture_source,
           e.cr2o3_pct, e.feo_pct,
           e.block_mrl, e.block_cr2o3_pct,
           e.block_entry_id, e.block_entry_date,
           e.rom_entry_id, e.rom_entry_date, e.updated_at, e.updated_by
      FROM minehub.mines_rom_entry e
      JOIN minehub.mines_rom_location l ON l.location_id = e.location_id
"""


def _row(r: Any) -> dict:
    d = dict(r)
    for k in ("trips", "qty_mt", "moisture_pct", "cr2o3_pct", "feo_pct",
              "block_cr2o3_pct"):
        d[k] = float(d[k]) if d[k] is not None else None
    # block_mrl stays a STRING. It is a bench level, and a bench level is
    # sometimes a span ("80-82") that no float can carry.
    d["on_date"] = d["on_date"].isoformat()
    d["ratio"] = ratio(d["cr2o3_pct"], d["feo_pct"])
    # The gap the block model exists to show: what the ground was expected to
    # hold against what came off it. None rather than zero when either side is
    # absent -- "no difference" and "nothing to compare" are different answers.
    d["block_variance"] = (round(d["cr2o3_pct"] - d["block_cr2o3_pct"], 3)
                           if d["cr2o3_pct"] is not None
                           and d["block_cr2o3_pct"] is not None else None)
    d["awaiting_block"] = d["block_cr2o3_pct"] is None
    return d


def day_rows(pg: Session, on_date: date) -> list[dict]:
    """One day's samples, in the order they are entered on the sheet."""
    return [_row(r) for r in pg.execute(
        text(_SELECT + " WHERE e.on_date = :d ORDER BY e.shift, e.rom_id"),
        {"d": on_date}).mappings()]


def summarise(rows: list[dict]) -> dict:
    """A day's totals — the sheet's TOTAL QTY and WET & AVG. line."""
    qty = sum(r["qty_mt"] or 0.0 for r in rows)
    trips = sum(r["trips"] or 0.0 for r in rows if r["trips"] is not None)
    cr = _wavg(rows, "cr2o3_pct")
    fe = _wavg(rows, "feo_pct")
    block = _wavg(rows, "block_cr2o3_pct")
    return {
        "samples": len(rows),
        "trips": round(trips, 2) if trips else None,
        "qty_mt": round(qty, 3),
        "moisture_pct": _wavg(rows, "moisture_pct"),
        "cr2o3_pct": cr,
        "feo_pct": fe,
        # From the weighted assays, NOT a weighted mean of the rows' own
        # ratios. A mean of ratios is not the ratio of the means, and the
        # workbook's own WET & AVG. line takes it this way.
        "ratio": ratio(cr, fe),
        "block_cr2o3_pct": block,
        "block_variance": (round(cr - block, 3)
                           if cr is not None and block is not None else None),
        "awaiting_block": sum(1 for r in rows if r["awaiting_block"]),
    }


def range_days(pg: Session, frm: date, to: date) -> list[dict]:
    """Every day in the window that has samples, newest first."""
    rows = [_row(r) for r in pg.execute(
        text(_SELECT + " WHERE e.on_date BETWEEN :f AND :t"
                       " ORDER BY e.on_date DESC, e.shift, e.rom_id"),
        {"f": frm, "t": to}).mappings()]
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["on_date"], []).append(r)
    return [{"date": d, "rows": rs, "summary": summarise(rs)}
            for d, rs in out.items()]


def pending_block(pg: Session, limit: int = 200) -> list[dict]:
    """The geology queue: samples with no block model, oldest first.

    Oldest first on purpose. A queue that shows the newest work at the top is
    a queue whose bottom never gets done.
    """
    return [_row(r) for r in pg.execute(
        text(_SELECT + " WHERE e.block_cr2o3_pct IS NULL"
                       " ORDER BY e.on_date, e.shift, e.rom_id LIMIT :n"),
        {"n": limit}).mappings()]


def mrls(pg: Session, limit: int = 60) -> list[str]:
    """Every mRL already filed against a sample, commonest first.

    WHY THE FORM OFFERS THESE. The mRL became free text on 26 November 2026
    (migration 136), and free text is how a list of twenty benches turns into
    eighty spellings of them -- which is exactly what happened to the location
    column before it was given a table of its own. There is no table to give
    this one: a bench is not a thing the mine maintains a register of, it is
    whatever the survey said. So the list is derived from what has been typed,
    and offering it is the cheapest way to make the second person to file
    '80-82' pick the first person's spelling of it.

    COMMONEST FIRST, NOT ALPHABETICAL. The point of the list is the one or two
    benches being worked this month; sorting by name buries them under every
    bench ever recorded. The count is not shown -- it would read as a figure
    about the bench rather than about the list.

    BOTH TABLES, because a stack line can carry an mRL that no surviving
    sample does: the sample it was built from may since have been corrected or
    removed, and the spelling on the stack is still one somebody chose.
    """
    return [r[0] for r in pg.execute(text("""
        SELECT mrl, count(*) AS n FROM (
            SELECT block_mrl AS mrl FROM minehub.mines_rom_entry
             WHERE block_mrl IS NOT NULL
            UNION ALL
            SELECT block_mrl FROM minehub.mines_rom_stack_line
             WHERE block_mrl IS NOT NULL
        ) t
         GROUP BY mrl
         ORDER BY n DESC, mrl
         LIMIT :lim
    """), {"lim": limit}).all()]


def locations(pg: Session, include_inactive: bool = False) -> list[dict]:
    """The dropdown. Inactive locations are still returned for reading history.

    `in_use` is what the screen needs to decide whether deactivating is the
    only safe option -- a location nothing cites could be renamed freely, one
    with samples behind it cannot be made to mean something else.
    """
    clause = "" if include_inactive else " WHERE l.is_active"
    return [{
        "location_id": r["location_id"], "name": r["name"],
        "is_active": r["is_active"], "note": r["note"],
        "in_use": int(r["in_use"]),
    } for r in pg.execute(text(f"""
        SELECT l.location_id, l.name, l.is_active, l.note,
               (SELECT count(*) FROM minehub.mines_rom_entry e
                 WHERE e.location_id = l.location_id) AS in_use
          FROM minehub.mines_rom_location l{clause}
         ORDER BY l.is_active DESC, l.name
    """)).mappings()]


# ── writing ─────────────────────────────────────────────────────────────────

def log(pg: Session, rom_id: int, on_date: date, action: str, part: str,
        old: dict | None, new: dict | None, actor: str) -> None:
    """One line of the audit trail. Called by the router inside its own
    transaction, never on its own — a log row that commits while the change it
    describes rolls back is worse than no log at all."""
    pg.execute(text("""
        INSERT INTO minehub.mines_rom_entry_log
               (rom_id, on_date, action, part, old_values, new_values, changed_by)
        VALUES (:id, :d, :a, :p,
                CAST(:old AS jsonb), CAST(:new AS jsonb), :by)
    """), {"id": rom_id, "d": on_date, "a": action, "p": part,
           "old": _json(old), "new": _json(new), "by": actor})


# WHAT COMES BACK FROM POSTGRES IS Decimal, NOT float, and Decimal is not an
# instance of int or float. Every numeric comparison and conversion below has
# to say so explicitly, or a figure read from the database never looks equal to
# the same figure typed into the form.
NUMERIC = (int, float, Decimal)


def _num(v: Any) -> Any:
    """Decimal -> float for JSON. Left alone otherwise."""
    if isinstance(v, bool) or not isinstance(v, NUMERIC):
        return v
    return float(v)


def _json(d: dict | None) -> str | None:
    if d is None:
        return None
    return json.dumps({k: _num(v) for k, v in d.items()}, default=str)


def changed(old: dict, new: dict, fields: tuple[str, ...]) -> bool:
    """Did anything actually move? A re-save that changes nothing is not a
    correction, and an audit trail full of them is one nobody reads."""
    for f in fields:
        a, b = old.get(f), new.get(f)
        if a is None or b is None:
            if a is not b and not (a is None and b is None):
                return True
            continue
        # NOT `a != b`. Decimal('22.270') != 22.27 is TRUE in Python: the
        # Decimal is compared against the float's exact binary value,
        # 22.2700000000000004..., and they genuinely differ. Comparing as
        # floats is what makes "the figure that is already stored" and "the
        # figure that was just typed" the same number. Every re-save looked
        # like a correction until this was fixed, and the audit trail filled
        # with changes that never happened.
        if (isinstance(a, NUMERIC) and isinstance(b, NUMERIC)
                and not isinstance(a, bool) and not isinstance(b, bool)):
            if abs(float(a) - float(b)) > 1e-9:
                return True
        elif a != b:
            return True
    return False
