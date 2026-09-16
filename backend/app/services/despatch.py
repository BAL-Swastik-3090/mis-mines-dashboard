"""
Despatch service.

Plan source  : mines_despatch_plan
Actual source: zsd_outbound_despatch  (single table, refreshed every 15 min)

BAL vs SUK classification via CUSTOMERNO:
  CUSTOMERNO = 'BAL'       → Balasore Alloys Plant
  CUSTOMERNO = 'JABAMOYEE' → Sukinda Plant

Mines despatch is TRANSPORTER = 'SHREE GANESH LOGISTICS' only. Confirmed by the
mine on 2026-09-03: Ganesh is the despatch haulier, and the other carriers on
this table are not despatch at all.

The data agrees, and the real distinction is the product form rather than the
carrier. May-Sep:

    SHREE GANESH LOGISTICS   5,433 rows   0 bagged   avg 11.79 MT   batch on every row
    ODISHA LOGISTIC             99 rows  95 bagged   avg 24.85 MT   16 with no batch
    OMM GOODS CARRIER            8 rows   8 bagged   avg 26.25 MT
    ODISHA LOGOSTIC              1 row    1 bagged   avg 20.00 MT

The bag profile is exact — 25 bags to 25.002 MT, 1.000 MT per bag, so jumbo bags.
Of 104 bagged loads across 5 POs, NOT ONE has a row in pp_quality_inspection at
any plant: that material is never assayed, so it could never carry a grade.

This filter was briefly removed on 2026-09-03 while plan was added, on the theory
that mines_despatch_plan covers all despatch and both sides needed the same
scope. That was wrong. The plan carries MG/LG/COB — bulk ore and concentrate —
which is exactly what Ganesh hauls, so plan and actual already agree in scope.
Restored the same day.

IDENTIFIED BY WEIGHBRIDGE *OR* TRANSPORTER, not by transporter alone.

TRANSPORTER is free text and is typed at the gate. On 2026-09-14 eight genuine
mines trips were entered as "SHREE GANESH TRPT" (7) and "SHREE GANESH" (1), and
an exact-match filter dropped all of them: 94.09 MT, 13.5% of that day. The lab
had assayed the same eight loads to the kilogram - PO 6100000227 / batch
I263004319, 8 lots, 94.09 MT, Cr2O3 41.36% - so the tonnage was real and graded
and the dashboard simply could not see it.

WEIGHBRIDGE is picked from a list rather than typed, and WEIGH BRIDGE - 4 is used
by BAL and JABAMOYEE alone: across 2026 no other customer and no other carrier
appears on it, so it can never admit a foreign row. It is NOT sufficient on its
own though. It is BLANK on 17 genuine Ganesh trips (212.16 MT, one per day from
March to September), and mines despatch ran over WEIGH BRIDGE - 8 for the whole
of 1-12 March (33 trips, 339 MT) before moving to WB-4.

Each clause covers the other's failure mode - the weighbridge catches a mistyped
transporter, the transporter catches a blank or changed weighbridge. Measured
over 2026, mines customers:

    TRANSPORTER = 'SHREE GANESH LOGISTICS'   8,845 trips   104,330.91 MT
    WEIGHBRIDGE = 'WEIGH BRIDGE - 4'         8,803 trips   103,884.49 MT  (-446)
    either of the two                        8,854 trips   104,435.72 MT

The OR adds exactly 9 trips / 104.81 MT over the old filter - the 8 typos on
14 Sep plus one "SHREE GANESH LOGISTIC" on 8 Mar. Nothing else changes.

A bag-count test was considered instead and rejected: 4 non-bagged ODISHA
LOGISTIC trips (100.1 MT, 25 Jun, no batch) would be wrongly admitted by it. The
OR excludes them correctly - they crossed WEIGH BRIDGE - 6.
"""

# COALESCE, not a bare comparison: WEIGHBRIDGE is NULL on 18 rows. On the include
# side that is harmless, but despatch_grade uses NOT of this predicate to build
# its excluded-movements report, and NOT (NULL OR FALSE) is NULL - a row with no
# weighbridge and a non-Ganesh carrier would vanish from both sides. Coalescing
# keeps the predicate two-valued so the two stay exact complements.
# The predicate every mines-despatch query must use, here and in despatch_grade
# and insights, so the four can never drift apart. Bound rather than inlined so
# the LIKE wildcard is never at the mercy of the driver's paramstyle escaping.
MINES_HAULIER_SQL = "(COALESCE(WEIGHBRIDGE, '') = :wb OR COALESCE(TRANSPORTER, '') LIKE :hauler)"
MINES_HAULIER_PARAMS = {"wb": "WEIGH BRIDGE - 4", "hauler": "SHREE GANESH%"}
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


# ── Actual queries (single table: zsd_outbound_despatch) ─────

_ACTUAL_SQL = """
    SELECT
        DATE(z.GATEINDATE)                                                          AS dt,
        COALESCE(SUM(CASE WHEN z.CUSTOMERNO = 'BAL'       THEN z.NETWEIGHT END), 0) AS bal_actual,
        COALESCE(SUM(CASE WHEN z.CUSTOMERNO = 'JABAMOYEE' THEN z.NETWEIGHT END), 0) AS suk_actual,
        COALESCE(SUM(z.NETWEIGHT), 0)                                               AS total_actual
    FROM (
        SELECT DELIVERYNO,
               MAX(CUSTOMERNO)  AS CUSTOMERNO,
               MAX(GATEINDATE)  AS GATEINDATE,
               MAX(NETWEIGHT)   AS NETWEIGHT
        FROM zsd_outbound_despatch
        WHERE DATE(GATEINDATE) BETWEEN :f AND :t
          AND CUSTOMERNO IN ('BAL', 'JABAMOYEE')
          AND (COALESCE(WEIGHBRIDGE, '') = :wb OR COALESCE(TRANSPORTER, '') LIKE :hauler)
        GROUP BY DELIVERYNO
    ) z
    GROUP BY DATE(z.GATEINDATE)
    ORDER BY dt
"""


def get_actuals_daywise(db: Session, from_date: date, to_date: date) -> dict:
    """Returns dict keyed by date with per-day actual breakdown."""
    rows = db.execute(
        text(_ACTUAL_SQL),
        {"f": from_date, "t": to_date, **MINES_HAULIER_PARAMS},
    ).fetchall()
    return {
        r.dt: {
            "total_actual":   float(r.total_actual),
            "bal_actual":     float(r.bal_actual),
            "suk_actual":     float(r.suk_actual),
            "unsynced_count": 0,
        }
        for r in rows
    }


def get_actuals_summary(db: Session, from_date: date, to_date: date) -> dict:
    """MTD or single-day actual totals."""
    sql = text("""
        SELECT
            COALESCE(SUM(CASE WHEN z.CUSTOMERNO = 'BAL'       THEN z.NETWEIGHT END), 0) AS bal_actual,
            COALESCE(SUM(CASE WHEN z.CUSTOMERNO = 'JABAMOYEE' THEN z.NETWEIGHT END), 0) AS suk_actual,
            COALESCE(SUM(z.NETWEIGHT), 0)                                               AS total_actual
        FROM (
            SELECT DELIVERYNO,
                   MAX(CUSTOMERNO) AS CUSTOMERNO,
                   MAX(NETWEIGHT)  AS NETWEIGHT
            FROM zsd_outbound_despatch
            WHERE DATE(GATEINDATE) BETWEEN :f AND :t
              AND CUSTOMERNO IN ('BAL', 'JABAMOYEE')
              AND (COALESCE(WEIGHBRIDGE, '') = :wb OR COALESCE(TRANSPORTER, '') LIKE :hauler)
            GROUP BY DELIVERYNO
        ) z
    """)
    row = db.execute(
        sql, {"f": from_date, "t": to_date, **MINES_HAULIER_PARAMS}
    ).fetchone()
    if not row or float(row.total_actual or 0) == 0:
        return {
            "total_actual": None, "bal_actual": None,
            "suk_actual": None,   "unsynced_count": 0,
        }
    return {
        "total_actual":   float(row.total_actual),
        "bal_actual":     float(row.bal_actual),
        "suk_actual":     float(row.suk_actual),
        "unsynced_count": 0,
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
    plan_rows      = db.execute(plan_sql, {"f": from_date, "t": to_date}).fetchall()
    plan_by_date   = {r.dt: r for r in plan_rows}
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
            "unsynced_count": 0,
        })
    return result
