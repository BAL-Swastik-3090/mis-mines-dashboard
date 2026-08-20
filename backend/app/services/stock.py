"""
Mines stock position — sourced from IMOS data entry, table `mines_stock`.

Replaces the previous SAP `mm_mb52_inventory_new` source, which was not being
maintained (the section had been hidden for that reason).

The table is a snapshot per Stock_Date, holding two sections whose COLUMNS MEAN
DIFFERENT THINGS. This is the single most important thing to know about it:

  Section B — mine stock by clearance status.
      Row_Label = status (Total Stock, Permission in Hand, Awaiting Permission,
                  Awaiting Verification, Awaiting Stacking)
      Value     = HG_QTY + MG_QTY + COB_QTY + LG_QTY + LG_FOR_COB_QTY

  Section C — stock by location, one row per grade.
      Row_Label = grade (High Grade, Medium Grade, Low Grade, COB / COB Mix Grade)
      Mines     = the grade column matching the row (High Grade -> HG_QTY, etc.)
      BAL_QTY / SUK_QTY / LG_FOR_COB_QTY = the other locations

Section A does not exist in the table and is not rendered.

The two sections do NOT reconcile with each other and are not meant to: B is
mine-side stock grouped by clearance status, C is stock across physical
locations including the plants. They are returned as separate blocks so the UI
never presents one as a breakdown of the other.
"""
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import text

SECTION_STATUS   = "B"
SECTION_LOCATION = "C"

# Section B statuses, in form order. 'Total Stock' is deliberately absent: the
# stored row is unreliable (it reads 0 while the four statuses carry 1,436 MT on
# 20 Aug, and on 17 Aug it held figures that were not their sum), so the total is
# computed from the four statuses instead. Excluding it here also means the total
# cannot double-count if that row is ever filled in.
STATUS_ROWS = [
    "Permission in Hand",
    "Awaiting Permission",
    "Awaiting Verification",
    "Awaiting Stacking",
]

# Section C grades, in form order, each mapped to the column holding its
# mine-side quantity.
GRADE_ROWS = [
    ("High Grade",          "HG_QTY",  "HG"),
    ("Medium Grade",        "MG_QTY",  "MG"),
    ("Low Grade",           "LG_QTY",  "LG"),
    ("COB / COB Mix Grade", "COB_QTY", "COB"),
]

# Row total for a Section B status. LG_FOR_COB_QTY is included per the mine's
# definition; it is always 0 on Section B rows today, but including it means the
# figure stays correct if that changes.
_STATUS_TOTAL = ("COALESCE(HG_QTY,0) + COALESCE(MG_QTY,0) + COALESCE(COB_QTY,0) "
                 "+ COALESCE(LG_QTY,0) + COALESCE(LG_FOR_COB_QTY,0)")


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _resolve_snapshot_date(db: Session, as_on: date | None) -> date | None:
    """Latest Stock_Date on or before `as_on`.

    Entry is not daily — the table currently holds 17, 18 and 20 Aug — so an
    exact-date match would render an empty panel on any day nobody filed. Falling
    back to the most recent earlier snapshot is what the mine means by "stock as
    on"; the date is returned so the page states which snapshot it is showing.
    """
    if as_on is None:
        return db.execute(text("SELECT MAX(Stock_Date) FROM mines_stock")).scalar()
    return db.execute(text(
        "SELECT MAX(Stock_Date) FROM mines_stock WHERE Stock_Date <= :d"
    ), {"d": as_on}).scalar()


def get_stock_position(db: Session, as_on: date | None = None) -> dict:
    snap = _resolve_snapshot_date(db, as_on)

    if snap is None:
        return {
            "snapshot_date": None, "requested_date": as_on, "days_stale": None,
            "is_stale": False, "has_data": False,
            "total_mines_stock": 0.0, "total_stock": 0.0,
            "grades": [], "statuses": [],
            "locations": {"mines": 0.0, "bal_plant": 0.0, "suk_plant": 0.0,
                          "lg_for_cob": 0.0, "total": 0.0},
        }

    # ── Section C — locations and grade-wise mine stock ───────────────────────
    loc = db.execute(text("""
        SELECT COALESCE(SUM(HG_QTY), 0)         AS hg,
               COALESCE(SUM(MG_QTY), 0)         AS mg,
               COALESCE(SUM(COB_QTY), 0)        AS cob,
               COALESCE(SUM(LG_QTY), 0)         AS lg,
               COALESCE(SUM(BAL_QTY), 0)        AS bal,
               COALESCE(SUM(SUK_QTY), 0)        AS suk,
               COALESCE(SUM(LG_FOR_COB_QTY), 0) AS lg_for_cob
        FROM   mines_stock
        WHERE  Stock_Date = :d AND Section = :sec
    """), {"d": snap, "sec": SECTION_LOCATION}).fetchone()

    mines      = _f(loc.hg) + _f(loc.mg) + _f(loc.cob) + _f(loc.lg)
    bal        = _f(loc.bal)
    suk        = _f(loc.suk)
    lg_for_cob = _f(loc.lg_for_cob)
    grand      = mines + bal + suk + lg_for_cob

    # Grade-wise mine stock — each row's own grade column. Rows are emitted for
    # all four grades whether or not they carry stock, so a grade never silently
    # appears or vanishes between snapshots.
    grade_map = {
        r.lbl: r for r in db.execute(text(f"""
            SELECT Row_Label AS lbl,
                   COALESCE(HG_QTY,0)  AS HG_QTY,
                   COALESCE(MG_QTY,0)  AS MG_QTY,
                   COALESCE(LG_QTY,0)  AS LG_QTY,
                   COALESCE(COB_QTY,0) AS COB_QTY,
                   COALESCE(BAL_QTY,0) AS bal,
                   COALESCE(SUK_QTY,0) AS suk,
                   COALESCE(LG_FOR_COB_QTY,0) AS lg_for_cob
            FROM   mines_stock
            WHERE  Stock_Date = :d AND Section = :sec
        """), {"d": snap, "sec": SECTION_LOCATION}).fetchall()
    }
    grades = []
    for label, col, key in GRADE_ROWS:
        row = grade_map.get(label)
        m   = _f(getattr(row, col)) if row is not None else 0.0
        b   = _f(row.bal)        if row is not None else 0.0
        s   = _f(row.suk)        if row is not None else 0.0
        l4c = _f(row.lg_for_cob) if row is not None else 0.0
        grades.append({
            "grade_key":   key,
            "grade_label": label,
            "mines":       round(m, 2),
            "bal_plant":   round(b, 2),
            "suk_plant":   round(s, 2),
            "lg_for_cob":  round(l4c, 2),
            "total":       round(m + b + s + l4c, 2),
        })

    # ── Section B — clearance status ──────────────────────────────────────────
    status_map = {
        r.lbl: _f(r.qty) for r in db.execute(text(f"""
            SELECT Row_Label AS lbl, {_STATUS_TOTAL} AS qty
            FROM   mines_stock
            WHERE  Stock_Date = :d AND Section = :sec
        """), {"d": snap, "sec": SECTION_STATUS}).fetchall()
    }
    statuses    = [{"label": s, "qty": round(status_map.get(s, 0.0), 2)} for s in STATUS_ROWS]
    total_stock = round(sum(status_map.get(s, 0.0) for s in STATUS_ROWS), 2)

    days_stale = (as_on - snap).days if as_on else 0

    return {
        "snapshot_date":     snap,
        "requested_date":    as_on,
        "days_stale":        days_stale,
        "is_stale":          days_stale > 0,
        "has_data":          True,
        "total_mines_stock": round(mines, 2),
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
