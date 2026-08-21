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

  Section C — stock held at the plants, one row per grade.
      BAL_QTY / SUK_QTY / LG_FOR_COB_QTY

Mine-side stock comes from SECTION B, not Section C. Both the headline Total
Stock and the Mines location figure are the same quantity — the four clearance
status rows summed across HG, MG, LG and COB — so they are computed once and
reported in both places rather than derived twice.

The grade split shown under Mines is that same Section B block read down its
columns instead of across its rows, which is why the four grades sum back to
Total Stock exactly.

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

# Row total for a Section B status: the four grades only. LG_FOR_COB_QTY is
# deliberately NOT added here — it is a Section C plant column, and the mine's
# definition of a status row is HG + MG + LG + COB.
_STATUS_TOTAL = ("COALESCE(HG_QTY,0) + COALESCE(MG_QTY,0) "
                 "+ COALESCE(LG_QTY,0) + COALESCE(COB_QTY,0)")

# Grade columns, in display order, with the label shown under Mines.
GRADE_COLUMNS = [
    ("HG",  "HG_QTY",  "High Grade"),
    ("MG",  "MG_QTY",  "Medium Grade"),
    ("LG",  "LG_QTY",  "Low Grade"),
    ("COB", "COB_QTY", "COB / COB Mix Grade"),
]


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
            "total_stock": 0.0,
            "grades": [], "statuses": [],
            "locations": {"mines": 0.0, "bal_plant": 0.0, "suk_plant": 0.0,
                          "lg_for_cob": 0.0, "total": 0.0},
        }

    # ── Section B — mine stock, by status across and by grade down ────────────
    grade_sel = ", ".join(f"COALESCE(SUM(`{col}`),0) AS g_{key.lower()}"
                          for key, col, _ in GRADE_COLUMNS)
    ph = ", ".join(f":s{i}" for i in range(len(STATUS_ROWS)))
    params = {"d": snap, "sec": SECTION_STATUS}
    for i, st in enumerate(STATUS_ROWS):
        params[f"s{i}"] = st

    # Read down the columns for the grade split. Restricted to the four status
    # rows — the same scope the row totals use — so the grade split and the
    # status totals are two views of one block and must agree.
    gr = db.execute(text(f"""
        SELECT {grade_sel}
        FROM   mines_stock
        WHERE  Stock_Date = :d AND Section = :sec AND Row_Label IN ({ph})
    """), params).fetchone()

    grades = [{
        "grade_key":   key,
        "grade_label": label,
        "mines":       round(_f(getattr(gr, f"g_{key.lower()}")) if gr else 0.0, 2),
    } for key, _col, label in GRADE_COLUMNS]

    # Read across the rows for the per-status totals.
    status_map = {
        r.lbl: _f(r.qty) for r in db.execute(text(f"""
            SELECT Row_Label AS lbl, {_STATUS_TOTAL} AS qty
            FROM   mines_stock
            WHERE  Stock_Date = :d AND Section = :sec
        """), {"d": snap, "sec": SECTION_STATUS}).fetchall()
    }
    statuses = [{"label": st, "qty": round(status_map.get(st, 0.0), 2)} for st in STATUS_ROWS]

    # Total Stock and the Mines location are the same quantity by definition.
    total_stock = round(sum(status_map.get(st, 0.0) for st in STATUS_ROWS), 2)
    mines       = total_stock

    # ── Section C — stock held at the plants ──────────────────────────────────
    loc = db.execute(text("""
        SELECT COALESCE(SUM(BAL_QTY), 0)        AS bal,
               COALESCE(SUM(SUK_QTY), 0)        AS suk,
               COALESCE(SUM(LG_FOR_COB_QTY), 0) AS lg_for_cob
        FROM   mines_stock
        WHERE  Stock_Date = :d AND Section = :sec
    """), {"d": snap, "sec": SECTION_LOCATION}).fetchone()

    bal        = _f(loc.bal) if loc else 0.0
    suk        = _f(loc.suk) if loc else 0.0
    lg_for_cob = _f(loc.lg_for_cob) if loc else 0.0
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
