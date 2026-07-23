"""
Production service — all DB query logic for Ore, OB, COB KPIs.
Queries are raw SQL via SQLAlchemy text() for performance & clarity.
"""
from datetime import date, timedelta
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import text


# ── Material number constants (pp_production.MATERIAL_NO) ─────
ORE_LG_NO = "000000000025000003"    # LOW GRADE ORE(-40%CR2O3)
ORE_MG_NO = "000000000025000001"    # 40-52% CHROME ORE
ORE_HG_NO = "000000000025000002"    # +52% CHROME ORE
OB_NO     = "000000000016000009"    # OVERBURDEN
# COB matched by MATERIAL_DESC (no MATERIAL_NO change requested)
COB_MATERIAL = "CONCENTRATE WITH STD MOISTURE"
PLANT_MINES  = "1200"
PLANT_COBP   = "1210"


def _f(v) -> float | None:
    """Convert Decimal/None to float safely."""
    return float(v) if v is not None else None


def _date_spine(from_date: date, to_date: date) -> list:
    """All dates from from_date to to_date inclusive."""
    n = (to_date - from_date).days + 1
    return [from_date + timedelta(days=i) for i in range(n)]


def _pct(actual, plan) -> float | None:
    if actual is None or plan is None or plan == 0:
        return None
    return round(float(actual) / float(plan) * 100, 1)


# ── 1. Daily actuals from pp_production ──────────────────────
def get_daily_actuals(db: Session, from_date: date, to_date: date) -> list[dict]:
    """
    Returns one row per POSTING_DATE with:
    ore_lg, ore_mg, ore_hg, ore_total, ob_qty, cob_qty
    """
    sql = text("""
        SELECT
            POSTING_DATE                                                     AS dt,
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO = :lg       THEN QUANTITY ELSE 0 END) AS ore_lg,
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO = :mg       THEN QUANTITY ELSE 0 END) AS ore_mg,
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO = :hg       THEN QUANTITY ELSE 0 END) AS ore_hg,
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO IN (:lg, :mg, :hg)
                                                  THEN QUANTITY ELSE 0 END) AS ore_total,
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO = :ob       THEN QUANTITY ELSE 0 END) AS ob_qty,
            SUM(CASE WHEN PLANT = :plant_cobp
                      AND MATERIAL_DESC = :cob    THEN QUANTITY ELSE 0 END) AS cob_qty
        FROM pp_production
        WHERE POSTING_DATE BETWEEN :from_date AND :to_date
          AND PLANT IN (:plant_mines, :plant_cobp)
        GROUP BY POSTING_DATE
        ORDER BY POSTING_DATE
    """)
    rows = db.execute(sql, {
        "plant_mines": PLANT_MINES,
        "plant_cobp":  PLANT_COBP,
        "lg": ORE_LG_NO, "mg": ORE_MG_NO, "hg": ORE_HG_NO,
        "ob": OB_NO, "cob": COB_MATERIAL,
        "from_date": from_date, "to_date": to_date,
    }).fetchall()
    return [dict(r._mapping) for r in rows]


# ── 2. Daily plan from mines_daily_excavation_plan ───────────
def get_daily_ore_ob_plan(db: Session, from_date: date, to_date: date) -> list[dict]:
    """
    Returns one row per Prod_date with ore_plan, ob_plan, hg_plan, mg_plan, lg_plan.
    NOTE: Plan is stored per Shift × Location — SUM groups to daily total.
    OB_QTY_Cum is VARCHAR so CAST to DECIMAL.
    """
    sql = text("""
        SELECT
            Prod_date                                    AS dt,
            SUM(ORE_QTY)                                 AS ore_plan,
            MAX(CAST(OB_QTY_Cum AS DECIMAL(13,3)))       AS ob_plan,
            SUM(HG_QTY)                                  AS hg_plan,
            SUM(MG_QTY)                                  AS mg_plan,
            SUM(LG_QTY)                                  AS lg_plan
        FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :from_date AND :to_date
        GROUP BY Prod_date
        ORDER BY Prod_date
    """)
    rows = db.execute(sql, {"from_date": from_date, "to_date": to_date}).fetchall()
    return [dict(r._mapping) for r in rows]


# ── 3. Daily COB plan from mines_cobp_plan ───────────────────
def get_daily_cob_plan(db: Session, from_date: date, to_date: date) -> list[dict]:
    sql = text("""
        SELECT
            Plan_date           AS dt,
            Concentrate_qty     AS cob_plan,
            Feed_qty            AS feed_plan,
            Tailings_qty        AS tailings_plan,
            Feed_grade_Cr2O3    AS feed_cr2o3_plan,
            Concentrate_grade_Cr2O3 AS conc_cr2o3_plan
        FROM mines_cobp_plan
        WHERE Plan_date BETWEEN :from_date AND :to_date
        ORDER BY Plan_date
    """)
    rows = db.execute(sql, {"from_date": from_date, "to_date": to_date}).fetchall()
    return [dict(r._mapping) for r in rows]


# ── 4. Merged day-wise data (actuals + plans joined on date) ──
def _get_silt_daywise(db: Session, from_date: date, to_date: date) -> dict:
    """De-silting actuals from mines_day_wise_excavation (Variant='4', Qty is VARCHAR)."""
    sql = text("""
        SELECT Prod_date AS dt,
               ROUND(SUM(CAST(Qty AS DECIMAL(13,3))), 2) AS silt_qty
        FROM mines_day_wise_excavation
        WHERE Variant = '4'
          AND Prod_date BETWEEN :from_date AND :to_date
        GROUP BY Prod_date
        ORDER BY Prod_date
    """)
    rows = db.execute(sql, {"from_date": from_date, "to_date": to_date}).fetchall()
    return {r.dt: float(r.silt_qty) for r in rows if r.silt_qty}


def get_production_daywise(db: Session, from_date: date, to_date: date) -> list[dict]:
    """
    Outer join actuals + plans + de-silting on date.
    Returns unified rows for charts and the day-wise summary table.
    """
    actuals   = {r["dt"]: r for r in get_daily_actuals(db, from_date, to_date)}
    ore_plan  = {r["dt"]: r for r in get_daily_ore_ob_plan(db, from_date, to_date)}
    cob_plan  = {r["dt"]: r for r in get_daily_cob_plan(db, from_date, to_date)}
    silt_data = _get_silt_daywise(db, from_date, to_date)

    all_dates = _date_spine(from_date, to_date)

    rows = []
    for dt in all_dates:
        a  = actuals.get(dt, {})
        op = ore_plan.get(dt, {})
        cp = cob_plan.get(dt, {})
        rows.append({
            "date":        dt,
            "ore_actual":  _f(a.get("ore_total")),
            "ore_plan":    _f(op.get("ore_plan")),
            "ore_hg":      _f(a.get("ore_hg")),
            "ore_mg":      _f(a.get("ore_mg")),
            "ore_lg":      _f(a.get("ore_lg")),
            "ob_actual":   _f(a.get("ob_qty")),
            "ob_plan":     _f(op.get("ob_plan")),
            "cob_actual":  _f(a.get("cob_qty")),
            "cob_plan":    _f(cp.get("cob_plan")),
            "hg_plan":     _f(op.get("hg_plan")),
            "mg_plan":     _f(op.get("mg_plan")),
            "lg_plan":     _f(op.get("lg_plan")),
            "silt_actual": silt_data.get(dt),   # None when no silt on that day
            "silt_plan":   None,                 # No plan table for de-silting
        })
    return rows


# ── 5. MTD totals ─────────────────────────────────────────────
def get_mtd_totals(db: Session, from_date: date, to_date: date) -> dict:
    sql_actual = text("""
        SELECT
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO IN (:lg, :mg, :hg)  THEN QUANTITY ELSE 0 END) AS ore_mtd,
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO = :ob               THEN QUANTITY ELSE 0 END) AS ob_mtd,
            SUM(CASE WHEN PLANT = :plant_cobp
                      AND MATERIAL_DESC = :cob            THEN QUANTITY ELSE 0 END) AS cob_mtd,
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO = :hg               THEN QUANTITY ELSE 0 END) AS hg_mtd,
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO = :mg               THEN QUANTITY ELSE 0 END) AS mg_mtd,
            SUM(CASE WHEN PLANT = :plant_mines
                      AND MATERIAL_NO = :lg               THEN QUANTITY ELSE 0 END) AS lg_mtd
        FROM pp_production
        WHERE POSTING_DATE BETWEEN :from_date AND :to_date
          AND PLANT IN (:plant_mines, :plant_cobp)
    """)
    ar = db.execute(sql_actual, {
        "plant_mines": PLANT_MINES, "plant_cobp": PLANT_COBP,
        "lg": ORE_LG_NO, "mg": ORE_MG_NO, "hg": ORE_HG_NO,
        "ob": OB_NO, "cob": COB_MATERIAL,
        "from_date": from_date, "to_date": to_date,
    }).fetchone()

    sql_plan = text("""
        SELECT
            SUM(ORE_QTY)                            AS ore_plan,
            MAX(CAST(OB_QTY_Cum AS DECIMAL(13,3)))  AS ob_plan,
            SUM(HG_QTY)                             AS hg_plan,
            SUM(MG_QTY)                             AS mg_plan,
            SUM(LG_QTY)                             AS lg_plan
        FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :from_date AND :to_date
    """)
    pr = db.execute(sql_plan, {"from_date": from_date, "to_date": to_date}).fetchone()

    sql_cob_plan = text("""
        SELECT SUM(Concentrate_qty) AS cob_plan
        FROM mines_cobp_plan
        WHERE Plan_date BETWEEN :from_date AND :to_date
    """)
    cr = db.execute(sql_cob_plan, {"from_date": from_date, "to_date": to_date}).fetchone()

    # _f() can return None when SQL SUM returns NULL (empty date range).
    # Use "or 0.0" to ensure every MTD field is always a float.
    return {
        "ore_actual": _f(ar.ore_mtd)  or 0.0,
        "ore_plan":   _f(pr.ore_plan) or 0.0,
        "ob_actual":  _f(ar.ob_mtd)   or 0.0,
        "ob_plan":    _f(pr.ob_plan)  or 0.0,
        "cob_actual": _f(ar.cob_mtd)  or 0.0,
        "cob_plan":   _f(cr.cob_plan) or 0.0,
        "hg_actual":  _f(ar.hg_mtd)   or 0.0,
        "mg_actual":  _f(ar.mg_mtd)   or 0.0,
        "lg_actual":  _f(ar.lg_mtd)   or 0.0,
    }


# ── 6. Today's single-day actuals ────────────────────────────
def get_today_actuals(db: Session, today: date) -> dict:
    rows = get_daily_actuals(db, today, today)
    if not rows:
        return {"ore_total": 0, "ob_qty": 0, "cob_qty": 0,
                "ore_hg": 0, "ore_mg": 0, "ore_lg": 0}
    return rows[0]


def get_today_plan(db: Session, today: date) -> dict:
    op_rows = get_daily_ore_ob_plan(db, today, today)
    cp_rows = get_daily_cob_plan(db, today, today)
    op = op_rows[0] if op_rows else {}
    cp = cp_rows[0] if cp_rows else {}
    return {
        "ore_plan": _f(op.get("ore_plan")),
        "ob_plan":  _f(op.get("ob_plan")),
        "cob_plan": _f(cp.get("cob_plan")),
    }


# ── 7. Re-handling excavation daywise ────────────────────────
def get_rehandling_daywise(db: Session, from_date: date, to_date: date) -> list[dict]:
    """
    Day-wise total excavation from pp_prod_order_confirmation (MINE_EXV work center).
    Deduplicates on (ORDER_NO, CONFIRM_COUNTER, POSTING_DATE) before summing ACTIVITY_CONF_1.
    Returns a full date-spine — dates with no data get total_m3=None.
    """
    sql = text("""
        SELECT POSTING_DATE AS dt, SUM(ACTIVITY_CONF_1) AS total_m3
        FROM (
            SELECT DISTINCT ORDER_NO, CONFIRM_COUNTER, POSTING_DATE, ACTIVITY_CONF_1
            FROM pp_prod_order_confirmation
            WHERE PLANT      = :plant
              AND WORK_CENTER = :work_center
              AND POSTING_DATE BETWEEN :from_date AND :to_date
        ) dedup
        GROUP BY POSTING_DATE
        ORDER BY POSTING_DATE
    """)
    rows = db.execute(sql, {
        "plant":       PLANT_MINES,
        "work_center": "MINE_EXV",
        "from_date":   from_date,
        "to_date":     to_date,
    }).fetchall()
    by_date = {r.dt: float(r.total_m3) for r in rows if r.total_m3 is not None}

    return [
        {"date": dt, "total_m3": by_date.get(dt)}
        for dt in _date_spine(from_date, to_date)
    ]


def get_rehandling_mtd(db: Session, from_date: date, to_date: date) -> float:
    """MTD total excavation re-handling in M3 (deduplicated)."""
    sql = text("""
        SELECT SUM(ACTIVITY_CONF_1) AS total_m3
        FROM (
            SELECT DISTINCT ORDER_NO, CONFIRM_COUNTER, POSTING_DATE, ACTIVITY_CONF_1
            FROM pp_prod_order_confirmation
            WHERE PLANT      = :plant
              AND WORK_CENTER = :work_center
              AND POSTING_DATE BETWEEN :from_date AND :to_date
        ) dedup
    """)
    row = db.execute(sql, {
        "plant":       PLANT_MINES,
        "work_center": "MINE_EXV",
        "from_date":   from_date,
        "to_date":     to_date,
    }).fetchone()
    return float(row.total_m3) if row and row.total_m3 is not None else 0.0


# ── 8. De-silting actuals ─────────────────────────────────────
# Source: mines_day_wise_excavation WHERE Variant='4' (SILT)
# Note: Qty stored as VARCHAR — must CAST. No plan table exists.
def get_desilt_actual(db: Session, from_date: date, to_date: date) -> float | None:
    sql = text("""
        SELECT ROUND(SUM(CAST(Qty AS DECIMAL(13,3))), 2) AS silt_qty
        FROM mines_day_wise_excavation
        WHERE Variant = '4'
          AND Prod_date BETWEEN :from_date AND :to_date
    """)
    row = db.execute(sql, {"from_date": from_date, "to_date": to_date}).fetchone()
    val = float(row.silt_qty) if row and row.silt_qty is not None else None
    return val if val and val > 0 else None
