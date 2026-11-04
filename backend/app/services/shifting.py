"""Shifting: the monthly plan off a spreadsheet, and the day's actual typed in.

Three movements the mine plans and reports daily, all in CuM -- LG Shifting,
Tailings Shifting and Other Rehandling. The plan arrives as one Excel a month,
a row per day and a column per material; the actual is typed a day at a time
against it.

── CODES, NOT THE WORDS ON THE SPREADSHEET ─────────────────────────────────
The upload file heads its column "Tailings Shifting" and the mine's entry form
says "Tailing Shifting"; "Other Rehandling" against "Rehandling (others)".
Keying either table on a spelling means plan and actual never join. So the key
is a code, the heading is matched to it when the file is read, and the label is
a display concern that lives in one place.

── BOTH TABLES ARE IN POSTGRES, AND NOTHING JOINS THEM TO SAP ──────────────
minehub.shifting_plan and minehub.shifting_actual, beside desilting_plan and
oee_equip_exc_plan, because they are the mine's own data entered through this
application. No figure here comes from the SAP feed.

── EVERY EDIT IS KEPT ──────────────────────────────────────────────────────
The actual is editable and a changed plan is re-uploaded, which are the same
requirement: the table holds today's answer, and _hist holds what it replaced,
with BOTH values. A timestamp alone says a figure changed on the 14th without
saying what it changed from, which is the only question an audit trail is ever
asked. A save that changes nothing writes no history and no revision.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from io import BytesIO
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ── The three materials ──────────────────────────────────────────────────────
LG, TAILINGS, REHANDLING = "LG", "TAILINGS", "REHANDLING"
MATERIALS = (LG, TAILINGS, REHANDLING)

#: What each code is called on screen, in the order the mine's form lists them.
LABELS: dict[str, str] = {
    LG: "LG Shifting",
    TAILINGS: "Tailing Shifting",
    REHANDLING: "Rehandling (others)",
}

#: Spreadsheet headings mapped to codes. Matched lower-cased with runs of
#: whitespace collapsed, so "Tailings  Shifting" and "TAILINGS SHIFTING" both
#: land on the same code. Several spellings per code on purpose: the file the
#: mine sent says "Tailings Shifting" and "Other Rehandling", the form says
#: "Tailing Shifting" and "Rehandling (others)", and a sheet saved by somebody
#: else will say a third thing. A heading that matches none of these is
#: reported by name rather than guessed at.
_HEADINGS: dict[str, str] = {
    "lg shifting": LG,
    "lg": LG,
    "tailings shifting": TAILINGS,
    "tailing shifting": TAILINGS,
    "tailings": TAILINGS,
    "tailing": TAILINGS,
    "other rehandling": REHANDLING,
    "rehandling (others)": REHANDLING,
    "rehandling(others)": REHANDLING,
    "rehandling others": REHANDLING,
    "rehandling": REHANDLING,
}

UNIT = "CuM"

#: How far down to look for the header. The mine's file has it at B3, behind
#: two empty rows and an empty column; a sheet with a title block above the
#: table would push it further.
_HEADER_SCAN_ROWS = 25

#: Guard against a workbook that is not one. 8 MB is far above a month of
#: thirty rows and far below anything that would trouble the server.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


class SheetError(ValueError):
    """The workbook could not be read as a month of shifting plan.

    Carries EVERY problem found rather than the first, so somebody fixing a
    spreadsheet fixes it once instead of discovering the faults one upload at
    a time.
    """

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("; ".join(problems))


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(d: date) -> date:
    """The last day of d's month, via the first of the next one."""
    m = month_start(d)
    nxt = (m.replace(year=m.year + 1, month=1) if m.month == 12
           else m.replace(month=m.month + 1))
    return nxt - timedelta(days=1)


# ── Reading ──────────────────────────────────────────────────────────────────
def read_range(db: Session, frm: date, to: date,
               table: str = "shifting_plan") -> list[dict[str, Any]]:
    """Every stored row in the window, oldest first. Plan or actual."""
    col = "plan_date" if table == "shifting_plan" else "actual_date"
    rows = db.execute(text(f"""
        SELECT {col} AS d, material, qty_cum, revision,
               entry_id, entry_date, updated_id, updated_date
        FROM   minehub.{table}
        WHERE  {col} BETWEEN :frm AND :to
        ORDER  BY {col}, material
    """), {"frm": frm, "to": to}).fetchall()
    return [{"date": r.d.isoformat(), "material": r.material,
             "label": LABELS.get(r.material, r.material),
             "qty_cum": float(r.qty_cum), "revision": r.revision,
             "entry_id": r.entry_id,
             "entry_date": r.entry_date.isoformat() if r.entry_date else None,
             "updated_id": r.updated_id,
             "updated_date": r.updated_date.isoformat() if r.updated_date else None}
            for r in rows]


def plan_for(db: Session, frm: date, to: date) -> dict[tuple[date, str], float]:
    """{(day, material): CuM} for the window -- what the actual is read against."""
    rows = db.execute(text("""
        SELECT plan_date, material, qty_cum
        FROM   minehub.shifting_plan
        WHERE  plan_date BETWEEN :frm AND :to
    """), {"frm": frm, "to": to}).fetchall()
    return {(r.plan_date, r.material): float(r.qty_cum) for r in rows}


def day(db: Session, d: date) -> list[dict[str, Any]]:
    """One day as the entry form shows it: three rows, plan beside actual.

    ALWAYS THREE ROWS, in the form's own order, whether or not anything is
    stored. A material missing from the result would quietly drop off the
    screen and never be entered.
    """
    plan = {m: q for (dd, m), q in plan_for(db, d, d).items() if dd == d}
    act = {r["material"]: r for r in read_range(db, d, d, "shifting_actual")}
    out = []
    for code in MATERIALS:
        a = act.get(code)
        out.append({
            "material": code,
            "label": LABELS[code],
            "unit": UNIT,
            "plan_cum": plan.get(code),
            "actual_cum": a["qty_cum"] if a else None,
            "revision": a["revision"] if a else None,
            "entry_id": a["entry_id"] if a else None,
            "entry_date": a["entry_date"] if a else None,
            "updated_id": a["updated_id"] if a else None,
            "updated_date": a["updated_date"] if a else None,
        })
    return out


def totals_detached(frm: date, to: date, rd: date) -> dict[str, dict] | None:
    """Plan and actual per material, for the period and for one day in it.

    WHY A SESSION OF ITS OWN. These two tables are in minehub on Postgres and
    the Executive Summary is built entirely on MySQL, so threading a second
    session down to it would touch the router, the service and every test that
    builds the service by hand. Same argument, and same shape, as
    desilting_plan.plan_for() and equipment_plan.resolve_detached().

    WHY IT SWALLOWS THE ERROR BUT RETURNS None. Postgres here is reached over
    the VPN and is not always up. An unreachable table is NOT an empty one:
    empty means the mine has not entered a figure, cold means nobody knows.
    Returning None rather than a dict of zeros keeps those apart, and the page
    reports the second as a blank rather than as a day with no work.

    Returns {material: {td_plan, td_actual, mtd_plan, mtd_actual}}.
    """
    try:
        from app.minehub_db import SessionLocal
        if SessionLocal is None:
            return None
        pg = SessionLocal()
    except Exception:                                   # noqa: BLE001
        return None
    try:
        out = {m: {"td_plan": None, "td_actual": None,
                   "mtd_plan": None, "mtd_actual": None} for m in MATERIALS}
        for table, col, key in (("shifting_plan", "plan_date", "plan"),
                                ("shifting_actual", "actual_date", "actual")):
            rows = pg.execute(text(f"""
                SELECT material,
                       COALESCE(SUM(CASE WHEN {col} = :rd THEN qty_cum END), NULL) AS td,
                       SUM(qty_cum) AS mtd
                FROM   minehub.{table}
                WHERE  {col} BETWEEN :frm AND :to
                GROUP  BY material
            """), {"frm": frm, "to": to, "rd": rd}).fetchall()
            for r in rows:
                if r.material not in out:
                    continue
                out[r.material][f"td_{key}"] = (
                    float(r.td) if r.td is not None else None)
                out[r.material][f"mtd_{key}"] = (
                    float(r.mtd) if r.mtd is not None else None)
        return out
    except Exception:                                   # noqa: BLE001
        logger.info("shifting figures unavailable", exc_info=False)
        return None
    finally:
        try:
            pg.close()
        except Exception:                               # noqa: BLE001
            pass


def month_revision(db: Session, frm: date, to: date, table: str) -> int:
    """How many times this window has been written. 0 = never."""
    col = "plan_date" if table == "shifting_plan" else "actual_date"
    return int(db.execute(text(f"""
        SELECT COALESCE(MAX(revision), 0) FROM minehub.{table}
        WHERE  {col} BETWEEN :frm AND :to
    """), {"frm": frm, "to": to}).scalar() or 0)


def history(db: Session, frm: date | None = None, to: date | None = None,
            material: str | None = None, which: str = "plan",
            limit: int = 300) -> list[dict[str, Any]]:
    """Every change, newest first, for a window or one material."""
    table = f"shifting_{'plan' if which == 'plan' else 'actual'}_hist"
    col = "plan_date" if which == "plan" else "actual_date"
    where = ["1 = 1"]
    params: dict[str, Any] = {"lim": max(1, min(limit, 2000))}
    if frm and to:
        where.append(f"{col} BETWEEN :frm AND :to")
        params["frm"], params["to"] = frm, to
    if material:
        where.append("material = :m")
        params["m"] = material
    rows = db.execute(text(f"""
        SELECT {col} AS d, material, action, old_qty_cum, new_qty_cum,
               revision, entry_id, entry_date
        FROM   minehub.{table}
        WHERE  {' AND '.join(where)}
        ORDER  BY entry_date DESC, {col}, material
        LIMIT  :lim
    """), params).fetchall()
    return [{"date": r.d.isoformat(), "material": r.material,
             "label": LABELS.get(r.material, r.material),
             "action": r.action,
             "old_qty_cum": float(r.old_qty_cum) if r.old_qty_cum is not None else None,
             "new_qty_cum": float(r.new_qty_cum) if r.new_qty_cum is not None else None,
             "revision": r.revision, "entry_id": r.entry_id,
             "entry_date": r.entry_date.isoformat() if r.entry_date else None}
            for r in rows]


# ── Writing, shared by both tables ───────────────────────────────────────────
def _apply(db: Session, table: str, col: str, want: dict[tuple[date, str], float],
           frm: date, to: date, actor: str) -> dict[str, Any]:
    """Make the window hold exactly `want`, recording every change.

    ONE ROUTINE FOR BOTH TABLES because it is one rule: a re-uploaded plan and
    an edited actual are the same operation against the same shape. Writing it
    twice is how the two drift.

    THE PATH EACH ROW TAKES IS ITS OWN:

        unchanged  LEFT ALONE, keeping the entry_date that says when the
                   figure was first given rather than when somebody last
                   pressed Save over an unrelated row
        added      inserted, recorded ADDED
        changed    updated in place, recorded CHANGED with BOTH values, and
                   updated_id / updated_date set -- the original entry_date
                   is never overwritten
        removed    deleted, recorded REMOVED with the value it had

    A WRITE THAT CHANGES NOTHING IS NOT A REVISION: re-uploading the same file
    writes no history and leaves every revision number where it was.
    """
    hist = f"{table}_hist"
    before = {(date.fromisoformat(r["date"]), r["material"]): r["qty_cum"]
              for r in read_range(db, frm, to, table)}

    added = sorted(k for k in want if k not in before)
    changed = sorted(k for k in want
                     if k in before and not _same(before[k], want[k]))
    removed = sorted(k for k in before if k not in want)

    if not (added or changed or removed):
        return {"rows": len(want), "added": 0, "changed": 0, "removed": 0,
                "revision": month_revision(db, frm, to, table), "revised": False}

    revision = month_revision(db, frm, to, table) + 1

    def audit(d: date, m: str, action: str,
              old: float | None, new: float | None) -> None:
        db.execute(text(f"""
            INSERT INTO minehub.{hist}
                   ({col}, material, action, old_qty_cum, new_qty_cum,
                    revision, entry_id)
            VALUES (:d, :m, :a, :o, :n, :r, :by)
        """), {"d": d, "m": m, "a": action, "o": old, "n": new,
               "r": revision, "by": actor})

    for d, m in added:
        db.execute(text(f"""
            INSERT INTO minehub.{table} ({col}, material, qty_cum, revision, entry_id)
            VALUES (:d, :m, :q, :r, :by)
        """), {"d": d, "m": m, "q": want[(d, m)], "r": revision, "by": actor})
        audit(d, m, "ADDED", None, want[(d, m)])

    for d, m in changed:
        db.execute(text(f"""
            UPDATE minehub.{table}
            SET    qty_cum = :q, revision = :r,
                   updated_id = :by, updated_date = now()
            WHERE  {col} = :d AND material = :m
        """), {"d": d, "m": m, "q": want[(d, m)], "r": revision, "by": actor})
        audit(d, m, "CHANGED", before[(d, m)], want[(d, m)])

    for d, m in removed:
        db.execute(text(f"DELETE FROM minehub.{table} WHERE {col} = :d AND material = :m"),
                   {"d": d, "m": m})
        audit(d, m, "REMOVED", before[(d, m)], None)

    db.commit()
    return {"rows": len(want), "added": len(added), "changed": len(changed),
            "removed": len(removed), "revision": revision, "revised": revision > 1}


def _same(a: float, b: float) -> bool:
    """Equal at the precision the column stores, so a float that round-trips
    as 116.66666666666667 against 116.6667 is not reported as a change."""
    return round(float(a), 4) == round(float(b), 4)


def save_actual(db: Session, d: date, qty: dict[str, float | None],
                actor: str) -> dict[str, Any]:
    """Store or edit one day's actuals.

    A MATERIAL LEFT BLANK IS NOT ZERO, and is not stored: the mine reports
    three movements and a day may genuinely have had none of one of them, but
    "nothing was entered" and "nothing was moved" are different statements and
    only the second is a figure. A material previously stored and now blanked
    is removed, and the removal is recorded with the value it had.
    """
    if not actor:
        raise SheetError(["no employee id on the request"])
    bad = sorted(m for m in qty if m not in MATERIALS)
    if bad:
        raise SheetError(["not a shifting material: " + ", ".join(bad)])
    neg = sorted(m for m, v in qty.items() if v is not None and float(v) < 0)
    if neg:
        raise SheetError(["a quantity cannot be negative: " + ", ".join(neg)])

    want = {(d, m): float(v) for m, v in qty.items() if v is not None}
    return _apply(db, "shifting_actual", "actual_date", want, d, d, actor)


# ── The plan workbook ────────────────────────────────────────────────────────
def _as_date(v: Any) -> date | None:
    """A cell read as a date, or None.

    Excel hands back a datetime for a date-formatted cell. A hand-typed date
    arrives as text and is accepted day-first or ISO, never month-first:
    03/04/2026 is ambiguous and guessing wrong moves a plan by a month with
    nothing on screen to show it. Same rule as the de-silting upload.
    """
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%b-%Y", "%d %b %Y"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
    return None


def _as_qty(v: Any) -> float | None:
    if isinstance(v, bool):              # bool is an int in Python, not a figure
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip().replace(",", "")
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _norm(s: str) -> str:
    return " ".join(str(s).strip().lower().split())


def _find_header(ws) -> tuple[int, int, dict[str, int]]:
    """(header row, date column, {material code: column}), all 1-based.

    FOUND BY LOOKING FOR THE WORD "Date", not assumed to be A1: the mine's
    sheet puts its header at B3, behind two empty rows and an empty column.
    Hard-coding A1 would read the header as a day and fail on the real file.

    Every heading to the right of Date is matched to a material code. A
    heading that matches none is NAMED in the error rather than skipped --
    a column silently ignored is a plan silently half-loaded.
    """
    for r in range(1, min(ws.max_row, _HEADER_SCAN_ROWS) + 1):
        for c in range(1, ws.max_column + 1):
            v = ws.cell(row=r, column=c).value
            if not (isinstance(v, str) and _norm(v) == "date"):
                continue
            cols: dict[str, int] = {}
            unknown: list[str] = []
            for c2 in range(c + 1, ws.max_column + 1):
                h = ws.cell(row=r, column=c2).value
                if not (isinstance(h, str) and h.strip()):
                    continue
                code = _HEADINGS.get(_norm(h))
                if code is None:
                    unknown.append(str(h).strip())
                elif code not in cols:
                    cols[code] = c2
            missing = [m for m in MATERIALS if m not in cols]
            if missing or unknown:
                problems = []
                if missing:
                    problems.append(
                        "the sheet has no column for "
                        + ", ".join(LABELS[m] for m in missing))
                if unknown:
                    problems.append(
                        "these headings were not recognised: "
                        + ", ".join(unknown))
                raise SheetError(problems)
            return r, c, cols
    raise SheetError([
        f'No "Date" column was found in the first {_HEADER_SCAN_ROWS} rows. '
        'Expected a header row with "Date", "LG Shifting", '
        '"Tailings Shifting" and "Other Rehandling".'])


def parse(payload: bytes, year: int, month: int) -> dict[str, Any]:
    """Read a workbook as one month of day-wise plan. Touches no database.

    THE MONTH IS THE USER'S, NOT THE FILE'S. The screen asks which month is
    being uploaded before the file is chosen, and a date outside it is an
    error rather than something to accommodate -- a sheet quietly carrying
    October while November was selected is the failure this exists to catch.

    A TOTAL ROW IS SKIPPED, NOT LOADED. The mine's file ends with "Total" in
    the Date column against the month's sums; read as data it would become a
    thirty-first day carrying thirty times the figure.
    """
    if not payload:
        raise SheetError(["The file is empty."])
    if len(payload) > MAX_UPLOAD_BYTES:
        raise SheetError(["The file is larger than 8 MB; that is not a plan "
                          "sheet."])
    try:
        from openpyxl import load_workbook
        wb = load_workbook(BytesIO(payload), data_only=True, read_only=True)
    except SheetError:
        raise
    except Exception as exc:                                # noqa: BLE001
        raise SheetError([f"The file could not be opened as a workbook: {exc}"])

    try:
        ws = wb.worksheets[0]
        hdr, dcol, cols = _find_header(ws)

        want_from = date(year, month, 1)
        want_to = month_end(want_from)

        rows: dict[tuple[date, str], float] = {}
        problems: list[str] = []
        skipped_total = 0
        seen: set[date] = set()
        outside: list[str] = []

        for r in range(hdr + 1, ws.max_row + 1):
            raw = ws.cell(row=r, column=dcol).value
            if raw is None or (isinstance(raw, str) and not raw.strip()):
                continue
            # The sheet's own footer. Named rather than guessed from position:
            # a file with two blank rows before it would defeat "last row".
            if isinstance(raw, str) and _norm(raw) in ("total", "grand total",
                                                       "sum", "month total"):
                skipped_total += 1
                continue
            d = _as_date(raw)
            if d is None:
                problems.append(f"row {r}: {raw!r} is not a date")
                continue
            if not (want_from <= d <= want_to):
                outside.append(f"row {r}: {d.isoformat()}")
                continue
            if d in seen:
                problems.append(f"row {r}: {d.isoformat()} appears more than once")
                continue
            seen.add(d)
            for code, c in cols.items():
                q = _as_qty(ws.cell(row=r, column=c).value)
                if q is None:
                    continue              # blank = no plan, NOT a plan of zero
                if q < 0:
                    problems.append(
                        f"row {r}: {LABELS[code]} is negative ({q})")
                    continue
                rows[(d, code)] = q

        if outside:
            problems.append(
                f"{len(outside)} row(s) fall outside "
                f"{want_from:%B %Y}: " + ", ".join(outside[:5])
                + (" …" if len(outside) > 5 else ""))
        if not rows and not problems:
            problems.append("The sheet carries no plan figures for "
                            f"{want_from:%B %Y}.")
        if problems:
            raise SheetError(problems)
    finally:
        try:
            wb.close()
        except Exception:                                   # noqa: BLE001
            pass

    totals = {m: round(sum(q for (_, c), q in rows.items() if c == m), 3)
              for m in MATERIALS}
    return {
        "year": year, "month": month,
        "from_date": want_from.isoformat(), "to_date": want_to.isoformat(),
        "header_row": hdr,
        "days": len(seen),
        "rows": rows,
        "totals": totals,
        "skipped_total_rows": skipped_total,
    }


def diff(db: Session, parsed: dict[str, Any]) -> dict[str, Any]:
    """What committing this workbook would change. Writes nothing.

    The screen shows this before anything is stored, because a re-upload
    REPLACES the month: somebody about to overwrite thirty days of plan should
    see how many of them move, and by how much, first.
    """
    frm = date.fromisoformat(parsed["from_date"])
    to = date.fromisoformat(parsed["to_date"])
    before = {(date.fromisoformat(r["date"]), r["material"]): r["qty_cum"]
              for r in read_range(db, frm, to, "shifting_plan")}
    want = parsed["rows"]

    added = [k for k in want if k not in before]
    changed = [(k, before[k], want[k]) for k in want
               if k in before and not _same(before[k], want[k])]
    removed = [k for k in before if k not in want]
    return {
        "month_entered": bool(before),
        "revision": month_revision(db, frm, to, "shifting_plan"),
        "added": len(added),
        "changed": len(changed),
        "removed": len(removed),
        "unchanged": len(want) - len(added) - len(changed),
        # A handful of examples, not the whole month: enough to recognise a
        # file uploaded against the wrong month, which is what this is for.
        "samples": [{"date": k[0].isoformat(), "material": k[1],
                     "label": LABELS[k[1]], "old": o, "new": n}
                    for k, o, n in changed[:8]],
    }


def replace_month(db: Session, parsed: dict[str, Any], actor: str) -> dict[str, Any]:
    """Store the month, replacing whatever was there, and keep what it replaced."""
    if not actor:
        raise SheetError(["no employee id on the request"])
    frm = date.fromisoformat(parsed["from_date"])
    to = date.fromisoformat(parsed["to_date"])
    out = _apply(db, "shifting_plan", "plan_date", parsed["rows"], frm, to, actor)
    return {**out, "year": parsed["year"], "month": parsed["month"],
            "from_date": parsed["from_date"], "to_date": parsed["to_date"],
            "totals": parsed["totals"]}
