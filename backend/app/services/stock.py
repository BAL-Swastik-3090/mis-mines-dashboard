"""
Mines stock position — from `mines_stock_entry`, filled in on the dashboard.

Replaces the IMOS table `mines_stock`, which in turn replaced the SAP
`mm_mb52_inventory_new` feed that nobody maintained.

── ONE FACT TABLE, NO SECTIONS ──────────────────────────────────────────────
The IMOS table stored the shape of its own data-entry form: a Section letter, a
Row_Label, and grade columns whose meaning changed depending on which section
the row belonged to. HG_QTY meant mine stock in section B and nothing at all in
section C, where BAL_QTY and SUK_QTY carried the figures instead.

`mines_stock_entry` stores the fact rather than the form:

    on this Stock_Date, of this Grade, in this Bucket, there is this Qty.

Seven buckets. Four are positions at the mine, by clearance status, and sum to
Total Stock; three are stock held elsewhere:

    MINE_PERMISSION_IN_HAND     BAL_PLANT
    MINE_AWAITING_PERMISSION    SUK_PLANT
    MINE_AWAITING_VERIFICATION  LG_FOR_COB   (Low Grade only)
    MINE_AWAITING_STACKING

── NOTHING TOTAL IS STORED ──────────────────────────────────────────────────
Total Stock, the grade split, the location figures and the grand total are all
SUMs over that table. The IMOS table stored its totals and they drifted: its
Total Stock row disagreed with the sum of its own four status rows on 2 of 22
dates — by +46 MT on 17 August and by 2,841 MT on 18 August. There is now
nowhere for a total to be stored, so there is nothing for it to disagree with.

"Mines" in All Locations is not a separate figure either: it is the mine
buckets, which is the same SUM as Total Stock. Verified against the IMOS screen
for 24-09-2026, where the same 1,120 MG and 300 COB appear in both halves.
"""
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import text

TABLE = "mines_stock_entry"

# The four positions at the mine. Their sum is Total Stock, and the same rows
# read per grade give the grade split — two views of one set of facts, so they
# cannot disagree.
MINE_BUCKETS = [
    ("MINE_PERMISSION_IN_HAND",    "Permission in Hand"),
    ("MINE_AWAITING_PERMISSION",   "Awaiting Permission"),
    ("MINE_AWAITING_VERIFICATION", "Awaiting Verification"),
    ("MINE_AWAITING_STACKING",     "Awaiting Stacking"),
]
STATUS_ROWS = [label for _b, label in MINE_BUCKETS]

# Grades in display order, with the label shown under Mines.
GRADE_COLUMNS = [
    ("HG",  "High Grade"),
    ("MG",  "Medium Grade"),
    ("LG",  "Low Grade"),
    ("COB", "COB / COB Mix Grade"),
]

_MINE_IN = ", ".join(f"'{b}'" for b, _ in MINE_BUCKETS)

# ── The two tables the page shows, side by side ──────────────────────────────
# Both are the same grade x bucket grid read along different axes: clearance
# status down the rows and grade across, then grade down and location across.
# They are built from ONE query for that reason — a mine total that appeared in
# both and disagreed would be the exact failure the fact table was built to
# make impossible.
#
# The two grade orders differ, and deliberately: the mine's own sheet lists
# HG/MG/COB/LG in the clearance table and HG/MG/LG/COB in the location table.
# Matching it means a reader can lay the two side by side without re-reading
# the headers.
CLEARANCE_GRADES = ["HG", "MG", "COB", "LG"]
LOCATION_GRADES = ["HG", "MG", "LG", "COB"]

# Row 6 of the sheet: the sum of the four below it, never stored.
CLEARANCE_ROWS = [("TOTAL", "Total Stock", None)] + [
    (b.replace("MINE_", ""), label, b) for b, label in MINE_BUCKETS
]

LOCATION_COLUMNS = [
    ("mines",      "Mines (Ore)",            None),          # the mine buckets
    ("bal_plant",  "BAL Plant (Ore & Briq)", "BAL_PLANT"),
    ("suk_plant",  "Suk Plant (Ore & Briq)", "SUK_PLANT"),
    ("lg_for_cob", "LG for COB",             "LG_FOR_COB"),
]

GRADE_SHORT = {"HG": "HG", "MG": "MG", "LG": "LG", "COB": "COB"}
GRADE_LABEL = dict(GRADE_COLUMNS)
UOM = "MT"


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _clearance_head() -> list[dict]:
    return [{"key": g, "label": GRADE_SHORT[g]} for g in CLEARANCE_GRADES]


def _location_head() -> list[dict]:
    return [{"key": k, "label": lbl} for k, lbl, _b in LOCATION_COLUMNS]


def _clearance_table(cell) -> list[dict]:
    """Clearance status down, grade across. Row 6 is the sum of rows 7-10."""
    out = []
    for key, label, bucket in CLEARANCE_ROWS:
        buckets = [b for b, _ in MINE_BUCKETS] if bucket is None else [bucket]
        by_grade = {g: round(sum(cell(g, b) for b in buckets), 2)
                    for g in CLEARANCE_GRADES}
        out.append({
            "key": key, "label": label, "uom": UOM,
            "by_grade": by_grade,
            "total": round(sum(by_grade.values()), 2),
            "is_total": bucket is None,
        })
    return out


def _location_table(cell) -> list[dict]:
    """Grade down, location across, with a column and a row of totals.

    "Mines (Ore)" is not a stored figure — it is the four mine buckets for that
    grade, which is the same arithmetic as the clearance table's Total Stock
    column. One grid read twice, so the two tables cannot disagree.
    """
    mine_buckets = [b for b, _ in MINE_BUCKETS]
    rows = []
    for g in LOCATION_GRADES:
        cells = {}
        for key, _lbl, bucket in LOCATION_COLUMNS:
            cells[key] = round(
                sum(cell(g, b) for b in mine_buckets) if bucket is None
                else cell(g, bucket), 2)
        rows.append({
            "key": g, "label": GRADE_LABEL[g], "uom": UOM,
            "cells": cells,
            "total": round(sum(cells.values()), 2),
            "is_total": False,
        })
    foot = {k: round(sum(r["cells"][k] for r in rows), 2)
            for k, _lbl, _b in LOCATION_COLUMNS}
    rows.append({
        "key": "TOTAL", "label": "Total Stock at Diff. Location", "uom": UOM,
        "cells": foot,
        "total": round(sum(foot.values()), 2),
        "is_total": True,
    })
    return rows


def _resolve_snapshot_date(db: Session, as_on: date | None) -> date | None:
    """Latest Stock_Date on or before `as_on`.

    Entry is not daily, so an exact-date match would render an empty panel on
    any day nobody filed. Falling back to the most recent earlier snapshot is
    what the mine means by "stock as on"; the date is returned so the page
    states which snapshot it is showing.
    """
    if as_on is None:
        return db.execute(text(f"SELECT MAX(Stock_Date) FROM {TABLE}")).scalar()
    return db.execute(text(
        f"SELECT MAX(Stock_Date) FROM {TABLE} WHERE Stock_Date <= :d"
    ), {"d": as_on}).scalar()


def get_stock_position(db: Session, as_on: date | None = None) -> dict:
    snap = _resolve_snapshot_date(db, as_on)

    if snap is None:
        return {
            "snapshot_date": None, "requested_date": as_on, "days_stale": None,
            "is_stale": False, "has_data": False,
            "total_stock": 0.0,
            "grades": [], "statuses": [],
            "locations": {"mines": 0.0, "bal_plant": 0.0, "suk_plant": 0.0,
                          "lg_for_cob": 0.0, "total": 0.0},
            "clearance": {"grades": _clearance_head(), "rows": []},
            "location_grid": {"columns": _location_head(), "rows": []},
        }

    # ── everything at the mine, per grade and per status ─────────────────────
    # One query answers both: the grade split is this grouped by Grade, the
    # status rows are this grouped by Bucket. Reading them from one result
    # rather than two queries is also what guarantees they agree.
    mine_rows = db.execute(text(f"""
        SELECT Grade, Bucket, SUM(Qty) AS qty
        FROM   {TABLE}
        WHERE  Stock_Date = :d AND Bucket IN ({_MINE_IN})
        GROUP  BY Grade, Bucket
    """), {"d": snap}).fetchall()

    by_grade: dict[str, float] = {}
    by_bucket: dict[str, float] = {}
    # The full grid, which both side-by-side tables are read out of.
    grid: dict[tuple[str, str], float] = {}
    for r in mine_rows:
        q = _f(r.qty)
        by_grade[r.Grade] = by_grade.get(r.Grade, 0.0) + q
        by_bucket[r.Bucket] = by_bucket.get(r.Bucket, 0.0) + q
        grid[(r.Grade, r.Bucket)] = grid.get((r.Grade, r.Bucket), 0.0) + q

    grades = [{
        "grade_key":   key,
        "grade_label": label,
        "mines":       round(by_grade.get(key, 0.0), 2),
    } for key, label in GRADE_COLUMNS]

    statuses = [{
        "label": label,
        "qty":   round(by_bucket.get(bucket, 0.0), 2),
    } for bucket, label in MINE_BUCKETS]

    # Total Stock and the Mines location are the same quantity by definition,
    # so they are summed once and reported in both places.
    total_stock = round(sum(by_bucket.values()), 2)
    mines = total_stock

    # ── stock held elsewhere ─────────────────────────────────────────────────
    loc_rows = db.execute(text(f"""
        SELECT Grade, Bucket, SUM(Qty) AS qty
        FROM   {TABLE}
        WHERE  Stock_Date = :d AND Bucket NOT IN ({_MINE_IN})
        GROUP  BY Grade, Bucket
    """), {"d": snap}).fetchall()
    loc: dict[str, float] = {}
    for r in loc_rows:
        q = _f(r.qty)
        loc[r.Bucket] = loc.get(r.Bucket, 0.0) + q
        grid[(r.Grade, r.Bucket)] = grid.get((r.Grade, r.Bucket), 0.0) + q

    bal        = loc.get("BAL_PLANT", 0.0)
    suk        = loc.get("SUK_PLANT", 0.0)
    lg_for_cob = loc.get("LG_FOR_COB", 0.0)
    grand      = mines + bal + suk + lg_for_cob

    def cell(grade: str, bucket: str) -> float:
        return grid.get((grade, bucket), 0.0)

    days_stale = (as_on - snap).days if as_on else 0

    return {
        "snapshot_date":     snap,
        "requested_date":    as_on,
        "days_stale":        days_stale,
        "is_stale":          days_stale > 0,
        "has_data":          True,
        "total_stock":       total_stock,
        "grades":            grades,
        "statuses":          statuses,
        "locations": {
            "mines":      round(mines, 2),
            "bal_plant":  round(bal, 2),
            "suk_plant":  round(suk, 2),
            "lg_for_cob": round(lg_for_cob, 2),
            "total":      round(grand, 2),
        },
        # The two tables shown side by side. Same grid, read along two axes.
        "clearance": {
            "grades": _clearance_head(),
            "rows":   _clearance_table(cell),
        },
        "location_grid": {
            "columns": _location_head(),
            "rows":    _location_table(cell),
        },
    }
