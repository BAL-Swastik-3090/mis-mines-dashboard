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


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


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
    for r in mine_rows:
        q = _f(r.qty)
        by_grade[r.Grade] = by_grade.get(r.Grade, 0.0) + q
        by_bucket[r.Bucket] = by_bucket.get(r.Bucket, 0.0) + q

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
        SELECT Bucket, SUM(Qty) AS qty
        FROM   {TABLE}
        WHERE  Stock_Date = :d AND Bucket NOT IN ({_MINE_IN})
        GROUP  BY Bucket
    """), {"d": snap}).fetchall()
    loc = {r.Bucket: _f(r.qty) for r in loc_rows}

    bal        = loc.get("BAL_PLANT", 0.0)
    suk        = loc.get("SUK_PLANT", 0.0)
    lg_for_cob = loc.get("LG_FOR_COB", 0.0)
    grand      = mines + bal + suk + lg_for_cob

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
    }
