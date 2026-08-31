"""
COB Plant Analysis service.
Sources:
  - pp_production          → feed / COB / tailings quantities (MT)
  - pp_quality_inspection  → input & output Cr₂O₃ %
  - mines_cobp_sample_analysis → tailings Cr₂O₃ % (shift-level, VARCHAR)
  - mines_cobp_plan        → all plan values
"""
from datetime import date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text

# Feed is a goods ISSUE (261) and the outputs are RECEIPTS (101/531); both are
# net of their reversals. Previously these filtered to the receipt/issue type
# but never subtracted the correction, so Aug 2026 tailings read 2,484 MT
# against 2,360. See sap_movement.
from app.services.sap_movement import PRODUCTION_QTY, CONSUMPTION_QTY


# ── COB plant constants ───────────────────────────────────────
# The COB plant is SAP plant 1210. Quality rows for the same material also
# exist under plant 1200 (mines ROM sampling) at a materially different grade,
# so the plant filter is required — without it the mines stream contaminates
# the feed-grade average.
PLANT_COB = "1210"

# Match on MATERIAL_NO, not the description: material numbers are stable keys,
# whereas SHORT_TEXT / MATERIAL_DESC can be edited in SAP and would silently
# stop matching.
MAT_LG_ORE      = "000000000025000003"  # LOW GRADE ORE(-40%CR2O3)      → feed  (input)
MAT_CONCENTRATE = "000000000030000001"  # CONCENTRATE WITH STD MOISTURE → COB   (output)


def _date_spine(from_date: date, to_date: date) -> list:
    n = (to_date - from_date).days + 1
    return [from_date + timedelta(days=i) for i in range(n)]


def _f(v):
    return float(v) if v is not None else None


def _pct(a, b):
    if a is not None and b:   # allow a=0 (genuine zero production → 0%)
        return round(a / b * 100, 2)
    return None


def _avg(vals):
    clean = [v for v in vals if v is not None]
    return round(sum(clean) / len(clean), 3) if clean else None


# ── 1. Actuals from pp_production ─────────────────────────────
def _get_actuals(db: Session, from_date: date, to_date: date) -> dict:
    sql = text(f"""
        SELECT
            POSTING_DATE AS dt,
            SUM(CASE WHEN MATERIAL_DESC = 'LOW GRADE ORE(-40%CR2O3)'      THEN ({CONSUMPTION_QTY}) ELSE 0 END) AS feed_actual,
            SUM(CASE WHEN MATERIAL_DESC = 'CONCENTRATE WITH STD MOISTURE' THEN ({PRODUCTION_QTY})  ELSE 0 END) AS cob_actual,
            SUM(CASE WHEN MATERIAL_DESC = 'TAILINGS (+10% CR2O3)'         THEN ({PRODUCTION_QTY})  ELSE 0 END) AS tailings_actual
        FROM pp_production
        WHERE PLANT = '1210'
          AND POSTING_DATE BETWEEN :from_date AND :to_date
        GROUP BY POSTING_DATE
        ORDER BY POSTING_DATE
    """)
    rows = db.execute(sql, {"from_date": from_date, "to_date": to_date}).fetchall()
    return {r.dt: dict(r._mapping) for r in rows}


# ── 2. Quality from pp_quality_inspection ─────────────────────
def _get_quality(db: Session, from_date: date, to_date: date) -> dict:
    """Input (feed) and output (concentrate) Cr₂O₃ % per day.

    Scoped to plant 1210 and keyed on MATERIAL_NO — see the constants above.
    Dated on QLT_START_DATE (identical to POSTING_DATE across every row in the
    table, and the column the plant reports against).
    """
    sql = text("""
        SELECT
            QLT_START_DATE AS dt,
            ROUND(AVG(CASE WHEN MATERIAL_NO = :mat_lg   THEN RESULT END), 3) AS input_cr2o3,
            ROUND(AVG(CASE WHEN MATERIAL_NO = :mat_conc THEN RESULT END), 3) AS output_cr2o3
        FROM pp_quality_inspection
        WHERE SHORT_TEXT_INS_CHAR = 'Cr2O3'
          AND PLANT       = :plant
          AND MATERIAL_NO IN (:mat_lg, :mat_conc)
          AND QLT_START_DATE BETWEEN :from_date AND :to_date
        GROUP BY QLT_START_DATE
        ORDER BY QLT_START_DATE
    """)
    rows = db.execute(sql, {
        "plant":     PLANT_COB,
        "mat_lg":    MAT_LG_ORE,
        "mat_conc":  MAT_CONCENTRATE,
        "from_date": from_date,
        "to_date":   to_date,
    }).fetchall()
    return {r.dt: dict(r._mapping) for r in rows}


# ── 3. Tailings Cr₂O₃ from mines_cobp_sample_analysis ────────
def _get_tailings_cr(db: Session, from_date: date, to_date: date) -> dict:
    # Cr2O3 is VARCHAR — cast after filtering out empty strings only;
    # genuine '0' readings are included (excluding them biases the average upward)
    sql = text("""
        SELECT
            Prod_date AS dt,
            ROUND(AVG(
                CASE
                    WHEN TRIM(Cr2O3) != ''
                    THEN CAST(Cr2O3 AS DECIMAL(8,3))
                END
            ), 3) AS tailings_cr2o3
        FROM mines_cobp_sample_analysis
        WHERE Sampling_Type = 'C.tailing'
          AND Prod_date BETWEEN :from_date AND :to_date
        GROUP BY Prod_date
        ORDER BY Prod_date
    """)
    rows = db.execute(sql, {"from_date": from_date, "to_date": to_date}).fetchall()
    return {r.dt: dict(r._mapping) for r in rows}


# ── 4. Plan from mines_cobp_plan ──────────────────────────────
def _get_plan(db: Session, from_date: date, to_date: date) -> dict:
    sql = text("""
        SELECT
            Plan_date                   AS dt,
            Feed_qty                    AS feed_plan,
            Concentrate_qty             AS cob_plan,
            Tailings_qty                AS tailings_plan,
            Weight_recovery             AS yield_plan,
            Planned_running_hr          AS running_hr_plan,
            Feed_grade_Cr2O3            AS input_cr2o3_plan,
            Concentrate_grade_Cr2O3     AS output_cr2o3_plan,
            Tailings_grade_Cr2O3        AS tailings_cr2o3_plan
        FROM mines_cobp_plan
        WHERE Plan_date BETWEEN :from_date AND :to_date
        ORDER BY Plan_date
    """)
    rows = db.execute(sql, {"from_date": from_date, "to_date": to_date}).fetchall()
    return {r.dt: dict(r._mapping) for r in rows}


# ── 5. Main aggregation ───────────────────────────────────────
def get_cob_summary(db: Session, from_date: date, to_date: date) -> dict:
    actuals    = _get_actuals(db, from_date, to_date)
    quality    = _get_quality(db, from_date, to_date)
    tailings_q = _get_tailings_cr(db, from_date, to_date)
    plan       = _get_plan(db, from_date, to_date)

    all_dates = _date_spine(from_date, to_date)

    rows = []
    for dt in all_dates:
        a  = actuals.get(dt, {})
        q  = quality.get(dt, {})
        tc = tailings_q.get(dt, {})
        p  = plan.get(dt, {})

        feed     = _f(a.get("feed_actual"))
        cob      = _f(a.get("cob_actual"))
        tailings = _f(a.get("tailings_actual"))

        rows.append({
            "date":             dt,
            "feed_actual":      feed,
            "cob_actual":       cob,
            "tailings_actual":  tailings,
            "yield_pct":        _pct(cob,  feed),
            "io_ratio":         round(feed / cob, 3) if (feed is not None and cob) else None,
            "input_cr2o3":      _f(q.get("input_cr2o3")),
            "output_cr2o3":     _f(q.get("output_cr2o3")),
            "tailings_cr2o3":   _f(tc.get("tailings_cr2o3")),
            "feed_plan":        _f(p.get("feed_plan")),
            "cob_plan":         _f(p.get("cob_plan")),
            "tailings_plan":    _f(p.get("tailings_plan")),
            "yield_plan":       _f(p.get("yield_plan")),
            "running_hr_plan":  _f(p.get("running_hr_plan")),
            "input_cr2o3_plan": _f(p.get("input_cr2o3_plan")),
            "output_cr2o3_plan":_f(p.get("output_cr2o3_plan")),
        })

    # ── MTD quantities ────────────────────────────────────────
    mtd_feed     = sum(r["feed_actual"]    or 0 for r in rows)
    mtd_cob      = sum(r["cob_actual"]     or 0 for r in rows)
    mtd_tailings = sum(r["tailings_actual"] or 0 for r in rows)
    mtd_feed_p   = sum(r["feed_plan"]      or 0 for r in rows)
    mtd_cob_p    = sum(r["cob_plan"]       or 0 for r in rows)
    mtd_tail_p   = sum(r["tailings_plan"]  or 0 for r in rows)

    # ── MTD derived ───────────────────────────────────────────
    mtd_yield     = _pct(mtd_cob,  mtd_feed)
    mtd_yield_p   = _pct(mtd_cob_p, mtd_feed_p)
    mtd_io        = round(mtd_feed / mtd_cob, 3) if mtd_cob else None

    # ── Quality averages (exclude nulls) ──────────────────────
    avg_in_cr   = _avg([r["input_cr2o3"]    for r in rows])
    avg_out_cr  = _avg([r["output_cr2o3"]   for r in rows])
    avg_tail_cr = _avg([r["tailings_cr2o3"] for r in rows])

    return {
        "from_date":           from_date,
        "to_date":             to_date,
        "rows":                rows,
        "mtd_feed_actual":     round(mtd_feed, 2),
        "mtd_feed_plan":       round(mtd_feed_p, 2),
        "mtd_cob_actual":      round(mtd_cob, 2),
        "mtd_cob_plan":        round(mtd_cob_p, 2),
        "mtd_tailings_actual": round(mtd_tailings, 2),
        "mtd_tailings_plan":   round(mtd_tail_p, 2),
        "mtd_yield_pct":       mtd_yield,
        "mtd_yield_plan":      mtd_yield_p,
        "mtd_io_ratio":        mtd_io,
        "avg_input_cr2o3":     avg_in_cr,
        "avg_output_cr2o3":    avg_out_cr,
        "avg_tailings_cr2o3":  avg_tail_cr,
    }
