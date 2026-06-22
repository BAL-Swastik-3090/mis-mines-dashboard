"""
Despatch service.

Plan source  : mines_despatch_plan
Actual source: zsd_outbound_despatch  JOIN  sd_outbound_delivery

Hybrid logic for actuals:
  - Synced entries  : joined to sd_outbound_delivery AND SHIP_PARTY_NAME = 'Balasore Alloys Limited'
  - Unsynced entries: no join match yet (sd_outbound_delivery refreshes end-of-day)
                      but TRANSPORTER = 'SHREE GANESH LOGISTICS' confirms mines→BAL origin
"""
from datetime import date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text


def _f(v) -> float:
    return float(v or 0)


def _date_spine(from_date: date, to_date: date) -> list:
    n = (to_date - from_date).days + 1
    return [from_date + timedelta(days=i) for i in range(n)]


# ── Plan queries ──────────────────────────────────────────────

def get_plan_summary(db: Session, from_date: date, to_date: date) -> dict:
    sql = text("""
        SELECT
            COALESCE(SUM(Grand_Total_Qty), 0) AS total_plan,
            COALESCE(SUM(Bal_Total_Qty),   0) AS bal_plan,
            COALESCE(SUM(Suk_Total_Qty),   0) AS suk_plan
        FROM mines_despatch_plan
        WHERE Plan_date BETWEEN :f AND :t
    """)
    row = db.execute(sql, {"f": from_date, "t": to_date}).fetchone()
    return {
        "mtd_total_plan": _f(row.total_plan),
        "mtd_bal_plan":   _f(row.bal_plan),
        "mtd_suk_plan":   _f(row.suk_plan),
    }


def get_td_plan(db: Session, td_date: date) -> dict:
    sql = text("""
        SELECT
            COALESCE(SUM(Grand_Total_Qty), 0) AS total_plan,
            COALESCE(SUM(Bal_Total_Qty),   0) AS bal_plan,
            COALESCE(SUM(Suk_Total_Qty),   0) AS suk_plan
        FROM mines_despatch_plan
        WHERE Plan_date = :d
    """)
    row = db.execute(sql, {"d": td_date}).fetchone()
    total = _f(row.total_plan)
    if total > 0:
        return {
            "td_total_plan": total,
            "td_bal_plan":   _f(row.bal_plan),
            "td_suk_plan":   _f(row.suk_plan),
        }
    return {"td_total_plan": None, "td_bal_plan": None, "td_suk_plan": None}


# ── Actual queries (hybrid: synced + unsynced) ────────────────

_ACTUAL_SQL = """
    SELECT
        DATE(z.GATEINDATE)                                                      AS dt,
        COALESCE(SUM(z.NETWEIGHT), 0)                                           AS total_actual,
        COALESCE(SUM(CASE WHEN s.SHIP_PARTY_NAME = 'Balasore Alloys Limited'
                          THEN z.NETWEIGHT ELSE 0 END), 0)                      AS bal_actual,
        COALESCE(SUM(CASE WHEN s.DELIVERY_NO IS NULL
                           AND z.TRANSPORTER = 'SHREE GANESH LOGISTICS'
                          THEN z.NETWEIGHT ELSE 0 END), 0)                      AS suk_actual,
        COUNT(CASE WHEN s.DELIVERY_NO IS NULL THEN 1 END)                       AS unsynced_count
    FROM (
        SELECT DELIVERYNO,
               MAX(GATEINDATE)  AS GATEINDATE,
               MAX(NETWEIGHT)   AS NETWEIGHT,
               MAX(TRANSPORTER) AS TRANSPORTER
        FROM zsd_outbound_despatch
        WHERE DATE(GATEINDATE) BETWEEN :f AND :t
        GROUP BY DELIVERYNO
    ) z
    LEFT JOIN sd_outbound_delivery s
           ON CONCAT('0', z.DELIVERYNO) = s.DELIVERY_NO
    WHERE (
        (s.DELIVERY_NO IS NOT NULL AND s.SHIP_PARTY_NAME = 'Balasore Alloys Limited')
     OR (s.DELIVERY_NO IS NULL     AND z.TRANSPORTER     = 'SHREE GANESH LOGISTICS')
    )
    GROUP BY DATE(z.GATEINDATE)
    ORDER BY dt
"""


def get_actuals_daywise(db: Session, from_date: date, to_date: date) -> dict:
    """Returns dict keyed by date with per-day actual breakdown."""
    rows = db.execute(text(_ACTUAL_SQL), {"f": from_date, "t": to_date}).fetchall()
    return {
        r.dt: {
            "total_actual":   float(r.total_actual),
            "bal_actual":     float(r.bal_actual),
            "suk_actual":     float(r.suk_actual),
            "unsynced_count": int(r.unsynced_count),
        }
        for r in rows
    }


def get_actuals_summary(db: Session, from_date: date, to_date: date) -> dict:
    """MTD or single-day actual totals."""
    sql = text("""
        SELECT
            COALESCE(SUM(z.NETWEIGHT), 0)                                       AS total_actual,
            COALESCE(SUM(CASE WHEN s.SHIP_PARTY_NAME = 'Balasore Alloys Limited'
                              THEN z.NETWEIGHT ELSE 0 END), 0)                  AS bal_actual,
            COALESCE(SUM(CASE WHEN s.DELIVERY_NO IS NULL
                               AND z.TRANSPORTER = 'SHREE GANESH LOGISTICS'
                              THEN z.NETWEIGHT ELSE 0 END), 0)                  AS suk_actual,
            COUNT(CASE WHEN s.DELIVERY_NO IS NULL THEN 1 END)                   AS unsynced_count
        FROM (
            SELECT DELIVERYNO,
                   MAX(GATEINDATE)  AS GATEINDATE,
                   MAX(NETWEIGHT)   AS NETWEIGHT,
                   MAX(TRANSPORTER) AS TRANSPORTER
            FROM zsd_outbound_despatch
            WHERE DATE(GATEINDATE) BETWEEN :f AND :t
            GROUP BY DELIVERYNO
        ) z
        LEFT JOIN sd_outbound_delivery s
               ON CONCAT('0', z.DELIVERYNO) = s.DELIVERY_NO
        WHERE (
            (s.DELIVERY_NO IS NOT NULL AND s.SHIP_PARTY_NAME = 'Balasore Alloys Limited')
         OR (s.DELIVERY_NO IS NULL     AND z.TRANSPORTER     = 'SHREE GANESH LOGISTICS')
        )
    """)
    row = db.execute(sql, {"f": from_date, "t": to_date}).fetchone()
    if not row or float(row.total_actual or 0) == 0:
        return {
            "total_actual": None, "bal_actual": None,
            "suk_actual": None, "unsynced_count": 0,
        }
    return {
        "total_actual":   float(row.total_actual),
        "bal_actual":     float(row.bal_actual),
        "suk_actual":     float(row.suk_actual),
        "unsynced_count": int(row.unsynced_count),
    }


# ── Combined daywise (plan + actual) ──────────────────────────

def get_daywise(db: Session, from_date: date, to_date: date) -> list[dict]:
    plan_sql = text("""
        SELECT
            Plan_date       AS dt,
            Grand_Total_Qty AS total_plan,
            Bal_Total_Qty   AS bal_plan,
            Suk_Total_Qty   AS suk_plan
        FROM mines_despatch_plan
        WHERE Plan_date BETWEEN :f AND :t
        ORDER BY Plan_date
    """)
    plan_rows    = db.execute(plan_sql, {"f": from_date, "t": to_date}).fetchall()
    plan_by_date = {r.dt: r for r in plan_rows}
    actual_by_date = get_actuals_daywise(db, from_date, to_date)

    result = []
    for dt in _date_spine(from_date, to_date):
        p = plan_by_date.get(dt)
        a = actual_by_date.get(dt)
        result.append({
            "date":           dt,
            "total_plan":     _f(p.total_plan) if p else 0.0,
            "bal_plan":       _f(p.bal_plan)   if p else 0.0,
            "suk_plan":       _f(p.suk_plan)   if p else 0.0,
            "total_actual":   a["total_actual"]   if a else None,
            "bal_actual":     a["bal_actual"]     if a else None,
            "suk_actual":     a["suk_actual"]     if a else None,
            "unsynced_count": a["unsynced_count"] if a else 0,
        })
    return result
