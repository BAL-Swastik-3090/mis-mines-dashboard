"""The ROM stack: what the mine built out of its ROM, and the number it ships under.

A STACK IS A PARENT, ITS LINES ARE CHILDREN. One stack is several lines, and a
line is "this much of that ROM sample went into this stack" -- a SHARE of a
sample, not the sample. The mine's workbook proves it has to be: 3 November
carries a 27-trip sample of which nineteen trips went into one stack and the
rest into another.

A stack also spans days, and out of order -- stack 414 carries 31 October, 1
and 2 November -- which is why the stack has a creation date of its own and
every line keeps its own production date.

── NOTHING THAT CAN BE COMPUTED IS STORED ──────────────────────────────────
The workbook's WET AVG line is a weighted mean of the lines beneath it and is
typed by hand. THIRTEEN of its seventy-four do not reproduce from their own
lines; the other sixty-one are exact. So the method is right and those
thirteen are typing drift, and computing the line removes the whole class of
error rather than carrying it forward. Same for the Cr/Fe ratio, for the
reason services/rom_entry.py gives.

THE WEIGHT IS TONNAGE, NOT TRIPS. The workbook weights by trips, which assumes
every trip is the same size, and they are not -- its own stacks run from 6.7
to 12.2 MT a trip. The mine dropped trips from this form, so the weight is the
quantity that actually went in.

── THE NUMBER, AND WHY IT IS SEVEN CHARACTERS AND NOT TEN ──────────────────
A stack despatches under a SAP batch, and that batch is the only link between
what the mine stacked and what SAP shipped. All 855 batches ever despatched to
BAL are exactly ten characters: a month letter, a TWO-digit year, then seven
digits that are stack-specific.

Those seven cannot be derived. Both the ...1300 form and the ...300 form run
side by side every month and both are the mine's own -- November 2026 has
K261300414 and K263004121, and the workbook carries 414 and 4121 against them.

What IS reliable is the letter, the year and the LAST FOUR DIGITS: across all
855 batches, no two different batches share those three. So the key is

    month letter || two-digit year || four-digit tail      e.g.  K260414

and despatch is matched on `left(batch,3) || right(batch,4) = stack_key`.
A PLAIN EQUALITY JOIN ON BATCH RETURNS NOTHING, which is the one thing a
reader of this file has to know. The real ten-character batch is stored in
despatch_batch once SAP has posted it, and the match above is what finds it.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.rom_entry import ratio

# THE SIX THE MINE NAMED (24 Nov 2026). Shifting material is a shift value
# rather than a flag beside A/B/C because that is how their sheet reads and
# how they asked for the dropdown. The workbook spells these fourteen ways --
# 'A(Shifting material)', '(A) shifting material', 'B shifting', 'A+B', 'CON'
# and two blanks -- and this list is what stops that.
SHIFTS: tuple[str, ...] = (
    "A", "B", "C",
    "A(Shifting material)",
    "B(Shifting material)",
    "C(Shifting material)",
)

# The three that exist on the day-wise ROM analysis, and so the three a
# production date and shift can fetch anything for. The other three are typed.
ROM_SHIFTS = ("A", "B", "C")

# What a line save is allowed to write, and therefore what the audit log
# compares. stack_id and entry_id are not figures and are not in here.
LINE_FIELDS = ("rom_id", "on_date", "shift", "location_id",
               "block_mrl", "block_cr2o3_pct",
               "cr2o3_pct", "feo_pct", "moisture_pct", "qty_mt")
STACK_FIELDS = ("created_on", "stack_no", "despatch_batch", "note")


def is_shifting(shift: str) -> bool:
    """Shifting material has no ROM sample behind it and never can have.

    The table enforces this too -- see migration 135's
    chk_mines_rom_stack_line_shifting_has_no_sample. Checked in both places
    because the screen needs to know before it offers to fetch anything, and
    the table needs to know because the screen is not the only way in.
    """
    return "Shifting" in shift


def stack_key(created_on: date, stack_no: str) -> str:
    """month letter + two-digit year + four-digit tail.

    THE SAME EXPRESSION THE DATABASE GENERATES, in Python, so the screen can
    show the number before the row exists. The column is GENERATED ALWAYS, so
    this is never written -- if the two ever disagreed the database's answer
    is the real one, and the test in the rehearsal harness is what keeps them
    from disagreeing.

    A=Jan ... L=Dec. Two digits of year, NOT three: 2026 is 26. A three-digit
    "260" reading looks right on one family of batches and breaks on the rest,
    and in 2030 it would collide head-on with the ...300 form.
    """
    return (chr(64 + created_on.month)
            + f"{created_on.year % 100:02d}"
            + pad_no(stack_no))


def pad_no(raw: str | int) -> str:
    """The tail, four digits, zero-padded.

    NOT COSMETIC. The workbook writes 414 where the batch ends 0414; typed raw
    those are different strings and the despatch link silently finds nothing.
    """
    return f"{str(raw).strip():0>4}"


# ── reading ─────────────────────────────────────────────────────────────────

_STACK_SELECT = """
    SELECT s.stack_id, s.created_on, s.stack_no, s.stack_key,
           s.despatch_batch, s.note,
           s.entry_id, s.entry_date, s.updated_at, s.updated_by
      FROM minehub.mines_rom_stack s
"""

_LINE_SELECT = """
    SELECT n.line_id, n.stack_id, n.rom_id, n.on_date, n.shift,
           n.location_id, l.name AS location,
           n.block_mrl, n.block_cr2o3_pct,
           n.cr2o3_pct, n.feo_pct, n.moisture_pct, n.qty_mt, n.amended
      FROM minehub.mines_rom_stack_line n
      LEFT JOIN minehub.mines_rom_location l ON l.location_id = n.location_id
"""


def _line(r: Any) -> dict:
    d = dict(r)
    for k in ("block_cr2o3_pct", "cr2o3_pct", "feo_pct", "moisture_pct",
              "qty_mt"):
        d[k] = float(d[k]) if d[k] is not None else None
    # block_mrl stays a STRING -- a bench level is sometimes a span ("80-82")
    # that no float can carry. Same rule as the ROM entry.
    d["on_date"] = d["on_date"].isoformat()
    d["ratio"] = ratio(d["cr2o3_pct"], d["feo_pct"])
    d["is_shifting"] = is_shifting(d["shift"])
    return d


def _stack(r: Any) -> dict:
    d = dict(r)
    d["created_on"] = d["created_on"].isoformat()
    # CHARACTER(4) comes back space-padded on some drivers. The key is
    # generated from the stored value and is correct either way, but the tail
    # is shown on screen beside it and ' 414' would read as a different number.
    d["stack_no"] = str(d["stack_no"]).strip()
    for k in ("entry_date", "updated_at"):
        d[k] = d[k].isoformat() if d[k] is not None else None
    return d


def summarise(lines: list[dict]) -> dict:
    """The stack's WET AVG line, computed from its own lines.

    Weighted by qty_mt. A line missing a figure is left out of BOTH sides of
    the division: counting its tonnage in the denominator would drag the mean
    towards nought in proportion to how much was never measured, which reads
    as a poor grade rather than as a partial one.
    """
    qty = sum(ln["qty_mt"] or 0.0 for ln in lines)

    def w(field: str) -> float | None:
        num = den = 0.0
        for ln in lines:
            v, q = ln.get(field), ln.get("qty_mt")
            if v is None or q is None:
                continue
            num += float(v) * float(q)
            den += float(q)
        return round(num / den, 3) if den > 0 else None

    cr, fe = w("cr2o3_pct"), w("feo_pct")
    return {
        "lines": len(lines),
        "qty_mt": round(qty, 3),
        "cr2o3_pct": cr,
        "feo_pct": fe,
        "moisture_pct": w("moisture_pct"),
        # From the weighted assays, NOT a weighted mean of the lines' own
        # ratios. A mean of ratios is not the ratio of the means, and the
        # workbook's own WET AVG line takes it this way.
        "ratio": ratio(cr, fe),
        "block_cr2o3_pct": w("block_cr2o3_pct"),
        "shifting_lines": sum(1 for ln in lines if ln["is_shifting"]),
        "amended_lines": sum(1 for ln in lines if ln["amended"]),
    }


def lines_of(pg: Session, stack_id: int) -> list[dict]:
    return [_line(r) for r in pg.execute(
        text(_LINE_SELECT + " WHERE n.stack_id = :s"
                            " ORDER BY n.on_date, n.shift, n.line_id"),
        {"s": stack_id}).mappings()]


def find_stack(pg: Session, created_on: date, stack_no: str) -> dict | None:
    """One stack by the two things the user types. None if it is not built yet.

    BY THE KEY, not by the pair. They determine each other, but the key is
    what carries the unique index and what despatch is matched on, so looking
    it up any other way would be a second route to the same row that could
    one day disagree with the first.
    """
    r = pg.execute(text(_STACK_SELECT + " WHERE s.stack_key = :k"),
                   {"k": stack_key(created_on, stack_no)}).mappings().first()
    return _stack(r) if r else None


def range_stacks(pg: Session, frm: date, to: date) -> list[dict]:
    """Every stack created in the window, newest first, with its lines.

    ONE QUERY FOR THE LINES, not one per stack. A month is about thirty
    stacks and four lines each; asking thirty times is thirty round trips to
    build one screen.
    """
    stacks = [_stack(r) for r in pg.execute(
        text(_STACK_SELECT + " WHERE s.created_on BETWEEN :f AND :t"
                             " ORDER BY s.created_on DESC, s.stack_no DESC"),
        {"f": frm, "t": to}).mappings()]
    if not stacks:
        return []
    ids = [s["stack_id"] for s in stacks]
    by_stack: dict[int, list[dict]] = {}
    for r in pg.execute(
            text(_LINE_SELECT + " WHERE n.stack_id = ANY(:ids)"
                                " ORDER BY n.on_date, n.shift, n.line_id"),
            {"ids": ids}).mappings():
        by_stack.setdefault(r["stack_id"], []).append(_line(r))
    for s in stacks:
        s["lines"] = by_stack.get(s["stack_id"], [])
        s["summary"] = summarise(s["lines"])
    return stacks


def available_samples(pg: Session, on_date: date, shift: str) -> list[dict]:
    """The ROM samples a production date and shift offers, and what is left of each.

    `stacked_mt` is how much of the sample is already in stacks -- all of
    them, not just this one -- and `remaining_mt` is what the ROM entry
    recorded less that. A SAMPLE IS APPORTIONED ACROSS STACKS, so offering it
    again is correct; offering it without saying how much has already gone is
    how it gets counted twice.

    Nothing is refused on the strength of this. The mine's own tonnage and the
    sum of its shares are two separate measurements and are allowed to differ;
    the screen says so and lets a person decide, because a form that blocks on
    an arithmetic it cannot be sure of is a form people stop using.
    """
    if shift not in ROM_SHIFTS:
        # Shifting material was never filed as a sample, so there is nothing
        # to fetch. Returning empty rather than raising: the screen asks this
        # question every time the shift changes, and an error for the normal
        # case would be noise.
        return []
    rows = pg.execute(text("""
        SELECT e.rom_id, e.on_date, e.shift, e.location_id, l.name AS location,
               e.qty_mt, e.moisture_pct, e.cr2o3_pct, e.feo_pct,
               e.block_mrl, e.block_cr2o3_pct,
               COALESCE((SELECT SUM(n.qty_mt)
                           FROM minehub.mines_rom_stack_line n
                          WHERE n.rom_id = e.rom_id), 0) AS stacked_mt
          FROM minehub.mines_rom_entry e
          JOIN minehub.mines_rom_location l ON l.location_id = e.location_id
         WHERE e.on_date = :d AND e.shift = :s
         ORDER BY e.rom_id
    """), {"d": on_date, "s": shift}).mappings()

    out = []
    for r in rows:
        d = dict(r)
        for k in ("qty_mt", "moisture_pct", "cr2o3_pct", "feo_pct",
                  "block_cr2o3_pct", "stacked_mt"):
            d[k] = float(d[k]) if d[k] is not None else None
        d["on_date"] = d["on_date"].isoformat()
        d["ratio"] = ratio(d["cr2o3_pct"], d["feo_pct"])
        d["remaining_mt"] = round((d["qty_mt"] or 0.0) - (d["stacked_mt"] or 0.0), 3)
        out.append(d)
    return out


# ── the despatch side ───────────────────────────────────────────────────────

def despatch_for(pg: Session, keys: list[str]) -> dict[str, dict]:
    """What SAP shipped under each stack key: {key: {batch, trips, qty_mt}}.

    THE MATCH IS ON A COMPUTED KEY, NOT ON BATCH. The stored key is seven
    characters and a batch is ten; the four digits between them vary per stack
    and cannot be derived. So the batch is reduced to the same seven -- its
    first three characters and its last four -- and compared with that. This
    is unique across all 855 batches ever despatched; see the module docstring.

    CUSTOMERNO = 'BAL' IS NOT OPTIONAL, for the reason services/quality_e2e.py
    gives at length: one stack ships to Balasore and to Jabamoyee on the same
    day under the same batch, and the two consignments are different ore.

    A stack with nothing here has not shipped yet, which is the normal state
    of a stack that was built this week -- not a fault and not a gap to chase.
    """
    if not keys:
        return {}
    rows = pg.execute(text("""
        SELECT left(batch, 3) || right(batch, 4) AS k,
               min(batch)                        AS batch,
               count(*)                          AS trips,
               SUM(CAST(NULLIF(TRIM(netweight), '') AS numeric(14,3))) AS qty_mt,
               min(gateindate)                   AS first_out,
               max(gateindate)                   AS last_out
          FROM sap_odata_api.zsd_outbound_despatch
         WHERE customerno = 'BAL'
           AND batch IS NOT NULL AND batch <> ''
           AND left(batch, 3) || right(batch, 4) = ANY(:keys)
         GROUP BY 1
    """), {"keys": keys}).mappings()
    return {r["k"]: {
        "batch": r["batch"],
        "trips": int(r["trips"]),
        "qty_mt": float(r["qty_mt"]) if r["qty_mt"] is not None else None,
        "first_out": r["first_out"].isoformat() if r["first_out"] else None,
        "last_out": r["last_out"].isoformat() if r["last_out"] else None,
    } for r in rows}


# ── the audit trail ─────────────────────────────────────────────────────────

# _json and changed come from the ROM entry service rather than being written
# again here. They are not incidental helpers: changed() carries the Decimal
# rule that stops every re-save looking like a correction (Decimal('22.270')
# != 22.27 is TRUE in Python), and _json carries the Decimal-to-float
# coercion the log depends on. A second copy would be a second place for that
# rule to be got wrong, and the first time they drifted the audit trail would
# fill with changes that never happened -- which is the exact bug that
# comment in rom_entry.py was written about.
from app.services.rom_entry import _json, changed  # noqa: E402  (see above)

__all__ = ["SHIFTS", "ROM_SHIFTS", "LINE_FIELDS", "STACK_FIELDS",
           "is_shifting", "stack_key", "pad_no", "summarise", "lines_of",
           "find_stack", "range_stacks", "available_samples", "despatch_for",
           "log", "changed"]


def log(pg: Session, stack_id: int, key: str, action: str, part: str,
        old: dict | None, new: dict | None, actor: str) -> None:
    """One line of the audit trail.

    Called by the router inside its own transaction, never on its own -- a log
    row that commits while the change it describes rolls back is worse than no
    log at all.

    THE KEY IS COPIED IN, not joined. A deleted stack is the single most
    important thing in this table, and after the delete there is no row left
    to join to for the number it was known by.
    """
    pg.execute(text("""
        INSERT INTO minehub.mines_rom_stack_log
               (stack_id, stack_key, action, part, old_values, new_values,
                changed_by)
        VALUES (:id, :k, :a, :p,
                CAST(:old AS jsonb), CAST(:new AS jsonb), :by)
    """), {"id": stack_id, "k": key, "a": action, "p": part,
           "old": _json(old), "new": _json(new), "by": actor})
