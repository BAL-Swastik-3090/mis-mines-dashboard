"""
OB Excavation service — dynamic vendor detection.
BAL OWN = Agency='3' (always).
Vendors = all other non-empty agencies with OB data in the date range.
Qty and OB_QTY_Cum are VARCHAR — always CAST to DECIMAL.
"""
from datetime import date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text


def _date_spine(from_date: date, to_date: date) -> list:
    n = (to_date - from_date).days + 1
    return [from_date + timedelta(days=i) for i in range(n)]

BAL_AGENCY = "3"


def _get_bal_and_plan(db: Session, from_date: date, to_date: date):
    """Returns BAL actuals + OB plan merged by date."""
    sql_bal = text("""
        SELECT Prod_date AS dt,
               ROUND(SUM(CAST(Qty AS DECIMAL(13,3))), 2) AS qty
        FROM mines_day_wise_excavation
        WHERE Variant = '3' AND Agency = :bal AND Prod_date BETWEEN :f AND :t
        GROUP BY Prod_date ORDER BY Prod_date
    """)
    sql_plan = text("""
        SELECT Prod_date AS dt,
               ROUND(MAX(CAST(OB_QTY_Cum AS DECIMAL(13,3))), 2) AS ob_plan
        FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :f AND :t
        GROUP BY Prod_date ORDER BY Prod_date
    """)
    bal_map  = {r.dt: float(r.qty or 0)
                for r in db.execute(sql_bal,  {"bal": BAL_AGENCY, "f": from_date, "t": to_date}).fetchall()}
    plan_map = {r.dt: float(r.ob_plan or 0)
                for r in db.execute(sql_plan, {"f": from_date, "t": to_date}).fetchall()}

    all_dates = _date_spine(from_date, to_date)
    rows = [{"date": dt, "bal_actual": bal_map.get(dt), "ob_plan": plan_map.get(dt)}
            for dt in all_dates]

    mtd_bal  = sum(bal_map.values())
    mtd_plan = sum(plan_map.values())
    bal_pct  = round(mtd_bal / mtd_plan * 100, 1) if mtd_plan else None

    return rows, round(mtd_bal, 2), round(mtd_plan, 2), bal_pct


def _get_vendors(db: Session, from_date: date, to_date: date) -> list[dict]:
    """
    Dynamically finds all non-BAL agencies with OB data in the period.
    Returns one dict per agency with daily rows and MTD total.
    Sorted by MTD actual descending.
    """
    # All non-BAL daily actuals in one query
    sql = text("""
        SELECT e.Prod_date AS dt,
               e.Agency    AS agency_id,
               COALESCE(a.Agency_Desc, e.Agency) AS agency_desc,
               ROUND(SUM(CAST(e.Qty AS DECIMAL(13,3))), 2) AS qty
        FROM mines_day_wise_excavation e
        LEFT JOIN mines_agency_master a ON e.Agency = a.Agency_Id
        WHERE e.Variant = '3'
          AND TRIM(e.Agency)  != :bal
          AND TRIM(e.Agency)  != ''
          AND e.Prod_date BETWEEN :f AND :t
        GROUP BY e.Prod_date, e.Agency, a.Agency_Desc
        ORDER BY e.Prod_date, e.Agency
    """)
    rows = db.execute(sql, {"bal": BAL_AGENCY, "f": from_date, "t": to_date}).fetchall()

    # Group by agency
    agency_map: dict[str, dict] = {}
    for r in rows:
        aid = r.agency_id
        if aid not in agency_map:
            agency_map[aid] = {
                "agency_id":   aid,
                "agency_desc": (r.agency_desc or aid).strip(),
                "daily":       {},    # date → qty
                "mtd_actual":  0.0,
            }
        qty = float(r.qty or 0)
        agency_map[aid]["daily"][r.dt] = agency_map[aid]["daily"].get(r.dt, 0) + qty
        agency_map[aid]["mtd_actual"] += qty

    # Build vendor list sorted by MTD descending
    spine = _date_spine(from_date, to_date)
    result = []
    for v in sorted(agency_map.values(), key=lambda x: -x["mtd_actual"]):
        result.append({
            "agency_id":   v["agency_id"],
            "agency_desc": v["agency_desc"],
            "mtd_actual":  round(v["mtd_actual"], 2),
            "rows":        [{"date": dt, "actual": v["daily"].get(dt)} for dt in spine],
        })
    return result


def get_ob_summary(db: Session, from_date: date, to_date: date) -> dict:
    rows, mtd_bal, mtd_plan, bal_pct = _get_bal_and_plan(db, from_date, to_date)
    vendors = _get_vendors(db, from_date, to_date)

    return {
        "from_date":      from_date,
        "to_date":        to_date,
        "rows":           rows,
        "mtd_bal_actual": mtd_bal,
        "mtd_ob_plan":    mtd_plan,
        "mtd_bal_pct":    bal_pct,
        "vendors":        vendors,
        "vendor_names":   [v["agency_desc"] for v in vendors],
    }
