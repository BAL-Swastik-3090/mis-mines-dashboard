"""
Insights service.

Two responsibilities:
  1. compute_reality_check()  — pure SQL math, no LLM, fast.
  2. generate_insights()      — fetches data, calls LiteLLM Claude, returns narrative.

Enhancements active:
  #2  Exception alerting — CRITICAL/ON TRACK opening in narrative
  #3  Rolling 7-day consecutive trend — called out explicitly
  #4  Cost context — BD hours → lost ore MT in equipment section
  #5  Revenue projection — Rs/MT × despatch volume
  #6  Scheduled digest — cached result served until next refresh
  #1  Today vs Yesterday comparison (shift proxy)
"""
from datetime import date, datetime, timedelta
import calendar
import re
import json
from sqlalchemy.orm import Session
from sqlalchemy import text

# Production figures are net of SAP reversal documents — see sap_movement.
from app.services.sap_movement import PRODUCTION_QTY, CONSUMPTION_QTY
from openai import AsyncOpenAI

from ..config import get_settings
from ..schemas.insights import RealityCheckRow, RealityCheckResponse, InsightsResponse


# ── Configurable constants ──────────────────────────────────────
_ORE_PRICE_PER_MT: float    = 4200.0    # Rs/MT Chrome Ore — update to current price
_FLEET_CAP_MT_PER_HR: float = 150.0    # benchmark excavator ore output per hour (BD loss calc)

# ── In-memory insights cache (date string → serialized response) ─
_insights_cache: dict[str, dict] = {}


# ── helpers ────────────────────────────────────────────────────

def _f(v) -> float:
    return float(v or 0)


def _verdict(uplift: float | None) -> str:
    if uplift is None:
        return "NO_DATA"
    if uplift <= 1.5:
        return "ACHIEVABLE"
    if uplift <= 3.5:
        return "STRETCH"
    return "NOT_FEASIBLE"


def _month_bounds(ref: date) -> tuple[date, date]:
    """Return (first_day, last_day) of ref's month."""
    first = ref.replace(day=1)
    last  = ref.replace(day=calendar.monthrange(ref.year, ref.month)[1])
    return first, last


# ── plan queries ───────────────────────────────────────────────

def _latest_plan_month(db: Session) -> tuple[date, date]:
    """Return (first, last) of the most recent month that has excavation plan data."""
    row = db.execute(text(
        "SELECT MAX(Prod_date) AS mx FROM mines_daily_excavation_plan"
    )).fetchone()
    if not row or not row.mx:
        today = date.today()
        return today.replace(day=1), today
    latest: date = row.mx
    first = latest.replace(day=1)
    last  = latest.replace(day=calendar.monthrange(latest.year, latest.month)[1])
    return first, last


# OB volume is entered in the Remarks column, by the mine's convention — this
# is deliberate, not a data-entry error. Tonnage is a tonnes column and OB is
# measured in cubic metres, so every OB row in mines_monthly_excavation_plan
# carries Tonnage = 0 (all 30 rows across all nine months) and the CuM figure
# goes into Remarks, in whatever format the entry clerk used that month:
#
#     '38097 CUM'  '23134 cum'  '4238cum'  '21,638'  '36712'  '14248 Cubic Meter'
#
# OB is therefore parsed out of Remarks. This regex takes the leading number,
# tolerating thousands separators and any trailing unit text; it handles all 30
# rows present. Because the field is free text, a row whose Remarks does not
# start with a number is counted as unparsed and reported rather than silently
# treated as zero — that is the one failure mode this convention exposes.
_OB_REMARK_NUM = re.compile(r"^\s*([\d,]+(?:\.\d+)?)")


def _parse_ob_remark(remark: str | None) -> float | None:
    if not remark:
        return None
    m = _OB_REMARK_NUM.match(remark)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def _ore_ob_full_month_plan(db: Session, first: date, last: date) -> dict:
    """Full-month ore and OB plan from mines_monthly_excavation_plan.

    This is the mine's monthly target, entered once per month, and is the right
    denominator for a month-end feasibility view. The daily table
    (mines_daily_excavation_plan) is populated day by day as the month runs, so
    summing it mid-month yields an elapsed-days figure, not a full-month plan —
    for 1-18 Aug it held only 17 of 31 days and understated the month by ~82%.
    The daily table remains the correct source anywhere the question is
    "plan for these specific dates" (day-wise charts, LCM); it is only wrong as
    a month-end target.

    Falls back to the daily table if the month has no monthly-plan row yet, and
    reports which source was used so the caller can label it.
    """
    month = first.strftime("%Y-%m")

    ore_row = db.execute(text("""
        SELECT COALESCE(SUM(Tonnage), 0) AS ore_plan
        FROM   mines_monthly_excavation_plan
        WHERE  Prod_Month = :m AND Mode = 'ORE'
    """), {"m": month}).fetchone()

    ob_rows = db.execute(text("""
        SELECT Remarks AS rmk
        FROM   mines_monthly_excavation_plan
        WHERE  Prod_Month = :m AND Mode = 'OB'
    """), {"m": month}).fetchall()

    ore = _f(ore_row.ore_plan) if ore_row else 0.0
    parsed = [_parse_ob_remark(r.rmk) for r in ob_rows]
    ob = sum(v for v in parsed if v is not None)
    ob_unparsed = sum(1 for v in parsed if v is None)

    if ore <= 0 and ob <= 0:
        # No monthly plan filed for this month — fall back so the panel still
        # shows something, but say so rather than implying a full-month figure.
        row = db.execute(text("""
            SELECT COALESCE(SUM(ORE_QTY), 0)                                     AS ore_plan,
                   COALESCE(SUM(CAST(NULLIF(OB_QTY_Cum,'') AS DECIMAL(16,3))), 0) AS ob_plan
            FROM   mines_daily_excavation_plan
            WHERE  Prod_date BETWEEN :f AND :t
        """), {"f": first, "t": last}).fetchone()
        return {"ore": _f(row.ore_plan), "ob": _f(row.ob_plan),
                "source": "daily_elapsed", "ob_unparsed": 0}

    return {"ore": ore, "ob": ob, "source": "monthly", "ob_unparsed": ob_unparsed}


def _cob_full_month_plan(db: Session, first: date, last: date) -> float:
    row = db.execute(text("""
        SELECT COALESCE(SUM(Concentrate_qty), 0) AS cob_plan
        FROM   mines_cobp_plan
        WHERE  Plan_date BETWEEN :f AND :t
    """), {"f": first, "t": last}).fetchone()
    return _f(row.cob_plan)


def _despatch_full_month_plan(db: Session, first: date, last: date) -> float:
    row = db.execute(text("""
        SELECT COALESCE(SUM(Grand_Total_Qty), 0) AS d_plan
        FROM   mines_despatch_plan
        WHERE  Plan_date BETWEEN :f AND :t
    """), {"f": first, "t": last}).fetchone()
    return _f(row.d_plan)


# ── actual queries ─────────────────────────────────────────────

def _production_mtd(db: Session, from_date: date, to_date: date) -> dict:
    row = db.execute(text(f"""
        SELECT
            -- Match on MATERIAL_NO, not MATERIAL_DESC. The description list
            -- carried '40-52%        CHROME ORE' with eight spaces while the
            -- data holds '40-52% CHROME ORE' with one, so every MG posting was
            -- silently dropped: 6,210 of 9,304 MT for 1-18 Aug, 67% of the ore
            -- actual. Codes are stable, descriptions are not, and Production
            -- and LCM already key on the codes.
            SUM(CASE WHEN PLANT='1200' AND MATERIAL_NO IN (
                    '000000000025000001',
                    '000000000025000002',
                    '000000000025000003')  THEN ({PRODUCTION_QTY}) ELSE 0 END) AS ore,
            SUM(CASE WHEN PLANT='1200' AND MATERIAL_DESC='OVERBURDEN'
                                           THEN ({PRODUCTION_QTY}) ELSE 0 END) AS ob,
            SUM(CASE WHEN PLANT='1210' AND MATERIAL_DESC='CONCENTRATE WITH STD MOISTURE'
                                           THEN ({PRODUCTION_QTY}) ELSE 0 END) AS cob
        FROM pp_production
        WHERE POSTING_DATE BETWEEN :f AND :t
    """), {"f": from_date, "t": to_date}).fetchone()
    return {
        "ore": _f(row.ore),
        "ob":  _f(row.ob),
        "cob": _f(row.cob),
    }


def _despatch_mtd_actual(db: Session, from_date: date, to_date: date) -> float | None:
    """MTD despatch actual from zsd_outbound_despatch via CUSTOMERNO.

    Filter must match despatch.py's get_actuals_summary() exactly (same
    TRANSPORTER restriction) so Reality Check / AI Insights agree with the
    Despatch dashboard section's own numbers.
    """
    try:
        row = db.execute(text("""
            SELECT COALESCE(SUM(z.NETWEIGHT), 0) AS actual
            FROM (
                SELECT DELIVERYNO, MAX(NETWEIGHT) AS NETWEIGHT
                FROM   zsd_outbound_despatch
                WHERE  DATE(GATEINDATE) BETWEEN :f AND :t
                  AND  CUSTOMERNO IN ('BAL', 'JABAMOYEE')
                  AND  TRANSPORTER = 'SHREE GANESH LOGISTICS'
                GROUP  BY DELIVERYNO
            ) z
        """), {"f": from_date, "t": to_date}).fetchone()
        val = _f(row.actual) if row else None
        return val if val and val > 0 else None
    except Exception:
        return None


def _dewatering_mtd(db: Session, from_date: date, to_date: date) -> dict:
    row = db.execute(text("""
        SELECT
            COALESCE(SUM(CASE WHEN kpi_id=33 THEN calculation_value END), 0) AS disp_plan,
            COALESCE(SUM(CASE WHEN kpi_id=35 THEN calculation_value END), 0) AS disp_act,
            COALESCE(SUM(CASE WHEN kpi_id=34 THEN calculation_value END), 0) AS pump_act,
            COALESCE(SUM(CASE WHEN kpi_id=32 THEN calculation_value END), 0) AS pump_plan
        FROM mines_dewatering_daily_data
        WHERE date BETWEEN :f AND :t
    """), {"f": from_date, "t": to_date}).fetchone()
    return {
        "disp_plan": _f(row.disp_plan),
        "disp_act":  _f(row.disp_act),
        "pump_plan": _f(row.pump_plan),
        "pump_act":  _f(row.pump_act),
    }


def _dewatering_daily_rows(db: Session, from_date: date, to_date: date) -> list[dict]:
    rows = db.execute(text("""
        SELECT d.date,
            MAX(CASE WHEN d.kpi_id=35 THEN d.calculation_value END) AS disp_act,
            MAX(CASE WHEN d.kpi_id=33 THEN d.calculation_value END) AS disp_plan,
            MAX(CASE WHEN d.kpi_id=37 THEN d.calculation_value END) AS closing_stock,
            MAX(CASE WHEN d.kpi_id=34 THEN d.calculation_value END) AS pump_act
        FROM mines_dewatering_daily_data d
        WHERE d.date BETWEEN :f AND :t
        GROUP BY d.date
        ORDER BY d.date DESC
        LIMIT 10
    """), {"f": from_date, "t": to_date}).fetchall()
    return [
        {
            "date":          str(r.date),
            "disp_act":      round(_f(r.disp_act)),
            "disp_plan":     round(_f(r.disp_plan)),
            "closing_stock": round(_f(r.closing_stock)),
            "pump_act":      round(_f(r.pump_act), 1),
        }
        for r in rows
    ]


# ── public: reality check (no LLM) ────────────────────────────

def compute_reality_check(
    db: Session, from_date: date, to_date: date
) -> RealityCheckResponse:
    first, last  = _month_bounds(to_date)
    total_days   = (last - first).days + 1
    elapsed      = (to_date - first).days + 1
    remaining    = (last - to_date).days
    cycle_pct    = round(elapsed / total_days * 100, 1)

    plans         = _ore_ob_full_month_plan(db, first, last)
    actuals       = _production_mtd(db, from_date, to_date)
    dew_full      = _dewatering_mtd(db, first, last)        # full month bounds — plan column
    dew           = _dewatering_mtd(db, from_date, to_date) # MTD range — actual column

    cob_plan      = _cob_full_month_plan(db, first, last)
    desp_plan     = _despatch_full_month_plan(db, first, last)
    desp_act      = _despatch_mtd_actual(db, from_date, to_date)

    plan_month_label = first.strftime("%b %Y")
    # Ore/OB now come from the monthly plan. If that month has not been filed
    # yet we fall back to summing the daily table, which mid-month covers only
    # elapsed days — flag it so the panel does not present a partial figure as
    # a full-month target.
    plan_fallback    = plans.get("source") == "daily_elapsed"

    def make_row(kpi, unit, plan, actual) -> RealityCheckRow:
        if actual is None:
            return RealityCheckRow(
                kpi=kpi, unit=unit, plan=plan, actual=0,
                gap=plan, run_rate_per_day=None,
                required_per_day=None, uplift=None, verdict="NO_DATA",
            )
        gap = round(plan - actual, 1)
        rr  = round(actual / elapsed, 1) if elapsed > 0 else None

        # Already achieved — gap is zero or negative
        if gap <= 0:
            return RealityCheckRow(
                kpi=kpi, unit=unit, plan=round(plan, 0), actual=round(actual, 0),
                gap=gap, run_rate_per_day=rr,
                required_per_day=0.0, uplift=0.0, verdict="ACHIEVABLE",
            )

        req    = round(gap / remaining, 1) if remaining > 0 else None
        uplift = round(req / rr, 2)        if (rr and rr > 0 and req is not None) else None
        return RealityCheckRow(
            kpi=kpi, unit=unit, plan=round(plan, 0), actual=round(actual, 0),
            gap=gap, run_rate_per_day=rr,
            required_per_day=req if req and req > 0 else 0.0,
            uplift=uplift, verdict=_verdict(uplift),
        )

    rows = [
        make_row("Ore Production",   "MT",  plans["ore"],   actuals["ore"]),
        make_row("OB Excavation",    "CuM", plans["ob"],    actuals["ob"]),
        make_row("COB Production",   "MT",  cob_plan,       actuals["cob"]),
        make_row("Despatch",         "MT",  desp_plan,      desp_act),
        make_row("Water Disposal",   "M³",  dew_full["disp_plan"], dew["disp_act"]),
    ]

    return RealityCheckResponse(
        as_on=to_date, from_date=from_date, to_date=to_date,
        month_end=last, days_elapsed=elapsed,
        days_remaining=remaining, cycle_pct=cycle_pct,
        plan_month=plan_month_label, plan_fallback=plan_fallback,
        rows=rows,
    )


# ── daily production trend ────────────────────────────────────

def _production_daily_rows(db: Session, from_date: date, to_date: date) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT
            POSTING_DATE                                                          AS dt,
            -- Keyed on MATERIAL_NO, not MATERIAL_DESC. The description list here
            -- still carried '40-52%' + eight spaces + 'CHROME ORE' against
            -- the data's single space, so every MG posting was dropped from this
            -- trend: 11,520 of 19,982 MT for Aug 2026. The MTD query above was
            -- fixed for this earlier; this one was missed.
            SUM(CASE WHEN PLANT='1200' AND MATERIAL_NO IN (
                    '000000000025000001',
                    '000000000025000002',
                    '000000000025000003')      THEN ({PRODUCTION_QTY}) ELSE 0 END)  AS ore,
            SUM(CASE WHEN PLANT='1200' AND MATERIAL_DESC='OVERBURDEN'
                                               THEN ({PRODUCTION_QTY}) ELSE 0 END)  AS ob,
            SUM(CASE WHEN PLANT='1210' AND MATERIAL_DESC='CONCENTRATE WITH STD MOISTURE'
                                               THEN ({PRODUCTION_QTY}) ELSE 0 END)  AS cob
        FROM pp_production
        WHERE POSTING_DATE BETWEEN :f AND :t
        GROUP BY POSTING_DATE
        ORDER BY POSTING_DATE DESC
        LIMIT 12
    """), {"f": from_date, "t": to_date}).fetchall()
    return [
        {
            "date": str(r.dt),
            "ore":  round(_f(r.ore)),
            "ob":   round(_f(r.ob)),
            "cob":  round(_f(r.cob)),
        }
        for r in rows
    ]


def _equipment_summary(db: Session, from_date: date, to_date: date) -> dict:
    """Excavator fleet BD hours, active count, and estimated lost ore MT."""
    try:
        days = (to_date - from_date).days + 1
        period_hrs = days * 24.0
        total_excavators = 7

        bd_row = db.execute(text("""
            SELECT ROUND(SUM(BREAKDOWN_DURAION) / 3600.0, 1) AS total_bd_hrs,
                   COUNT(*) AS bd_events
            FROM zpm_iw29_notifications
            WHERE MAINTENANCE_PLANT = '1200'
              AND MAIN_WORK_CENTER  = 'MINEAUTO'
              AND NOTIFICATION_TYPE = 'M2'
              AND MALFUNCTION_START BETWEEN :f AND :t
              AND BREAKDOWN_DURAION IS NOT NULL
              AND BREAKDOWN_DURAION > 0
        """), {"f": from_date, "t": to_date}).fetchone()

        total_bd_hrs = float(bd_row.total_bd_hrs or 0)
        bd_events    = int(bd_row.bd_events or 0)
        fleet_avail  = round(max(0.0, (1 - total_bd_hrs / (total_excavators * period_hrs)) * 100), 1)

        # Enhancement #4: cost context — BD hours → estimated lost ore MT
        lost_ore_mt = round(total_bd_hrs * _FLEET_CAP_MT_PER_HR)

        sensor_row = db.execute(text("""
            SELECT COUNT(DISTINCT vehicle_desc) AS active
            FROM mines_technoton_rest_equipment_utilization
            WHERE report_date >= :f AND report_date < :t_next
              AND vehicle_desc LIKE '%Z AXIS%'
              AND TIME_TO_SEC(engine_hours) / 3600.0 > 0
        """), {"f": from_date, "t_next": to_date + timedelta(days=1)}).fetchone()
        active_count = int(sensor_row.active or 0) if sensor_row else 0

        return {
            "total":           total_excavators,
            "active":          active_count,
            "bd_hrs":          total_bd_hrs,
            "bd_events":       bd_events,
            "fleet_avail_pct": fleet_avail,
            "lost_ore_mt":     lost_ore_mt,
        }
    except Exception:
        return {}


def _cob_quality_mtd(db: Session, from_date: date, to_date: date) -> dict:
    """MTD COB plant quality — Cr₂O₃ input/output grades and yield."""
    try:
        q_row = db.execute(text("""
            SELECT
                ROUND(AVG(CASE WHEN SHORT_TEXT = 'LOW GRADE ORE(-40%CR2O3)'
                               THEN RESULT END), 2) AS input_cr2o3,
                ROUND(AVG(CASE WHEN SHORT_TEXT = 'CONCENTRATE WITH STD MOISTURE'
                               THEN RESULT END), 2) AS output_cr2o3
            FROM pp_quality_inspection
            WHERE SHORT_TEXT_INS_CHAR = 'Cr2O3'
              AND SHORT_TEXT IN ('LOW GRADE ORE(-40%CR2O3)', 'CONCENTRATE WITH STD MOISTURE')
              AND POSTING_DATE BETWEEN :f AND :t
        """), {"f": from_date, "t": to_date}).fetchone()

        p_row = db.execute(text(f"""
            SELECT
                SUM(CASE WHEN MATERIAL_DESC = 'LOW GRADE ORE(-40%CR2O3)'
                          THEN ({CONSUMPTION_QTY}) ELSE 0 END) AS feed,
                SUM(CASE WHEN MATERIAL_DESC = 'CONCENTRATE WITH STD MOISTURE'
                          THEN ({PRODUCTION_QTY}) ELSE 0 END) AS cob
            FROM pp_production
            WHERE PLANT = '1210'
              AND POSTING_DATE BETWEEN :f AND :t
        """), {"f": from_date, "t": to_date}).fetchone()

        feed = float(p_row.feed or 0)
        cob  = float(p_row.cob or 0)
        return {
            "input_cr2o3":  float(q_row.input_cr2o3  or 0) if q_row else None,
            "output_cr2o3": float(q_row.output_cr2o3 or 0) if q_row else None,
            "yield_pct":    round(cob / feed * 100, 2) if feed > 0 else None,
            "io_ratio":     round(feed / cob, 3) if cob > 0 else None,
            "feed_mt":      round(feed),
            "cob_mt":       round(cob),
        }
    except Exception:
        return {}


def _stock_snapshot(db: Session) -> dict:
    """Current ore + COB stock by grade, from the Stock section's own source.

    Was reading SAP mm_mb52_inventory_new. The Stock section moved to IMOS entry
    (`mines_stock`), so this now delegates to the same service rather than
    querying a second source — otherwise the digest and the Stock panel would
    quote different stock figures on the same screen.

    Grades follow mines_stock: HG, MG, LG, COB. There is no LUMP row in the new
    source, so LUMP is no longer reported.
    """
    try:
        from app.services.stock import get_stock_position
        pos = get_stock_position(db, None)      # latest snapshot
        if not pos.get("has_data"):
            return {}
        result = {g["grade_key"]: g["mines"] for g in pos["grades"]}
        result["total"] = round(sum(result.values()), 2)
        return result
    except Exception:
        return {}


def _despatch_split_mtd(db: Session, from_date: date, to_date: date) -> dict:
    """MTD despatch BAL vs SUK split via CUSTOMERNO.

    Filter must match despatch.py's get_actuals_summary() exactly (same
    TRANSPORTER restriction) so Reality Check / AI Insights agree with the
    Despatch dashboard section's own numbers.
    """
    try:
        row = db.execute(text("""
            SELECT
                COALESCE(SUM(CASE WHEN z.CUSTOMERNO = 'BAL'       THEN z.NETWEIGHT END), 0) AS bal,
                COALESCE(SUM(CASE WHEN z.CUSTOMERNO = 'JABAMOYEE' THEN z.NETWEIGHT END), 0) AS suk,
                COALESCE(SUM(z.NETWEIGHT), 0)                                               AS total
            FROM (
                SELECT DELIVERYNO,
                       MAX(CUSTOMERNO) AS CUSTOMERNO,
                       MAX(NETWEIGHT)  AS NETWEIGHT
                FROM zsd_outbound_despatch
                WHERE DATE(GATEINDATE) BETWEEN :f AND :t
                  AND CUSTOMERNO IN ('BAL', 'JABAMOYEE')
                  AND TRANSPORTER = 'SHREE GANESH LOGISTICS'
                GROUP BY DELIVERYNO
            ) z
        """), {"f": from_date, "t": to_date}).fetchone()
        return {
            "bal":   round(float(row.bal   or 0), 1),
            "suk":   round(float(row.suk   or 0), 1),
            "total": round(float(row.total or 0), 1),
        }
    except Exception:
        return {}


# ── Enhancement #3: 7-day consecutive trend analysis ──────────

def _build_trend_signal(prod_rows: list[dict]) -> str:
    """
    Analyse up to 7 days of production (newest-first) for consecutive trends.
    Returns a multi-line trend summary for ore, OB, and COB.
    """
    if not prod_rows:
        return "Insufficient data for trend analysis."

    def _streak(values: list[int]) -> str:
        if len(values) < 2:
            return "single day"
        dirs = [
            "up"   if values[i] > values[i - 1] else
            "down" if values[i] < values[i - 1] else "flat"
            for i in range(1, len(values))
        ]
        if all(d == "up"   for d in dirs): return f"UP {len(dirs)} consecutive days"
        if all(d == "down" for d in dirs): return f"DOWN {len(dirs)} consecutive days"
        last2 = dirs[-2:] if len(dirs) >= 2 else dirs
        if all(d == "up"   for d in last2): return "recovering (up last 2 days)"
        if all(d == "down" for d in last2): return "declining (down last 2 days)"
        return "mixed"

    window   = prod_rows[:7]              # newest first
    ore_vals = [p["ore"] for p in reversed(window)]   # oldest→newest for streak calc
    ob_vals  = [p["ob"]  for p in reversed(window)]
    cob_vals = [p["cob"] for p in reversed(window)]

    ore_seq = " → ".join(str(v) for v in ore_vals)
    return "\n".join([
        f"Ore: {_streak(ore_vals)} — sequence: {ore_seq} MT",
        f"OB:  {_streak(ob_vals)}",
        f"COB: {_streak(cob_vals)}",
    ])


# ── Enhancement #1: Today vs Yesterday daily comparison ────────

def _shift_comparison(prod_rows: list[dict]) -> dict:
    """
    Compare today's and yesterday's production.
    pp_production only has POSTING_DATE (no shift timestamp), so daily totals
    are used as the best available proxy for shift-level performance.
    """
    if len(prod_rows) < 2:
        return {}
    today_row     = prod_rows[0]
    yesterday_row = prod_rows[1]
    return {
        "today_date":     today_row["date"],
        "yesterday_date": yesterday_row["date"],
        "today_ore":      today_row["ore"],
        "yesterday_ore":  yesterday_row["ore"],
        "today_ob":       today_row["ob"],
        "yesterday_ob":   yesterday_row["ob"],
        "today_cob":      today_row["cob"],
        "yesterday_cob":  yesterday_row["cob"],
        "ore_delta":      today_row["ore"] - yesterday_row["ore"],
        "ob_delta":       today_row["ob"]  - yesterday_row["ob"],
        "cob_delta":      today_row["cob"] - yesterday_row["cob"],
    }


# ── Enhancement #5: Revenue projection ────────────────────────

def _revenue_projection(
    desp_split: dict, desp_plan_mt: float, elapsed: int, total_days: int
) -> dict:
    """Project month-end despatch revenue at _ORE_PRICE_PER_MT."""
    mtd_total = desp_split.get("total", 0)
    if elapsed <= 0 or mtd_total <= 0:
        return {}
    daily_run_rate  = mtd_total / elapsed
    projected_total = round(daily_run_rate * total_days, 1)
    plan_rev_cr     = round(desp_plan_mt   * _ORE_PRICE_PER_MT / 1e7, 2)
    proj_rev_cr     = round(projected_total * _ORE_PRICE_PER_MT / 1e7, 2)
    mtd_rev_cr      = round(mtd_total      * _ORE_PRICE_PER_MT / 1e7, 2)
    return {
        "price_per_mt":     _ORE_PRICE_PER_MT,
        "mtd_revenue_cr":   mtd_rev_cr,
        "projected_mt":     projected_total,
        "projected_rev_cr": proj_rev_cr,
        "plan_rev_cr":      plan_rev_cr,
        "gap_vs_plan_cr":   round(plan_rev_cr - proj_rev_cr, 2),
        "gap_vs_plan_mt":   round(desp_plan_mt - projected_total, 1),
    }


# ── Enhancement #6: Cache helpers ─────────────────────────────

def get_cached_insights(cache_key: str) -> dict | None:
    """Try Redis first, fall back to in-memory cache."""
    try:
        import redis as redis_lib
        settings = get_settings()
        r = redis_lib.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            password=settings.redis_password or None,
            decode_responses=True,
            socket_connect_timeout=1,
        )
        raw = r.get(cache_key)
        if raw:
            return json.loads(raw)
    except Exception:
        pass
    return _insights_cache.get(cache_key)


def set_cached_insights(cache_key: str, data: dict, ttl_seconds: int = 86400) -> None:
    """Store in Redis (if available) and in-memory fallback."""
    _insights_cache[cache_key] = data
    try:
        import redis as redis_lib
        settings = get_settings()
        r = redis_lib.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            password=settings.redis_password or None,
            decode_responses=True,
            socket_connect_timeout=1,
        )
        r.setex(cache_key, ttl_seconds, json.dumps(data))
    except Exception:
        pass


# ── public: generate insights via LiteLLM ─────────────────────

async def generate_insights(
    db: Session, from_date: date, to_date: date,
    use_cache: bool = True,
) -> InsightsResponse:
    settings = get_settings()

    # ── check cache first (Enhancement #6) ──────────────────
    cache_key = f"insights:{to_date}"
    if use_cache:
        cached = get_cached_insights(cache_key)
        if cached:
            return InsightsResponse(**{**cached, "cached": True})

    # ── gather data ──────────────────────────────────────────
    first, last = _month_bounds(to_date)
    total_days  = (last - first).days + 1
    elapsed     = (to_date - first).days + 1

    rc         = compute_reality_check(db, from_date, to_date)
    dew_rows   = _dewatering_daily_rows(db, from_date, to_date)
    dew_mtd    = _dewatering_mtd(db, from_date, to_date)
    prod_rows  = _production_daily_rows(db, from_date, to_date)
    equip      = _equipment_summary(db, from_date, to_date)
    cob_qual   = _cob_quality_mtd(db, from_date, to_date)
    stock      = _stock_snapshot(db)
    desp_split = _despatch_split_mtd(db, from_date, to_date)

    # ── Enhancement #5: revenue projection ──────────────────
    desp_plan_mt = next((r.plan for r in rc.rows if r.kpi == "Despatch"), 0.0)
    rev          = _revenue_projection(desp_split, desp_plan_mt, elapsed, total_days)

    # ── Enhancement #2: alert level from verdicts ────────────
    verdicts = [r.verdict for r in rc.rows]
    if "NOT_FEASIBLE" in verdicts:
        alert_prefix = "⚠️ CRITICAL:"
    elif all(v in ("ACHIEVABLE", "NO_DATA") for v in verdicts):
        alert_prefix = "✅ ON TRACK:"
    else:
        alert_prefix = "⚡ CAUTION:"

    # ── Enhancement #3: 7-day consecutive trend ──────────────
    trend_signal = _build_trend_signal(prod_rows)
    avg_ore = round(sum(p["ore"] for p in prod_rows) / len(prod_rows)) if prod_rows else 0
    avg_ob  = round(sum(p["ob"]  for p in prod_rows) / len(prod_rows)) if prod_rows else 0

    # ── Enhancement #1: today vs yesterday ───────────────────
    shift_cmp = _shift_comparison(prod_rows)

    # ── build context tables ─────────────────────────────────
    rc_table_lines = [
        "| KPI | Plan | MTD Actual | Gap | Run-Rate/Day | Required/Day | Uplift | Verdict |",
        "|-----|------|-----------|-----|-------------|-------------|--------|---------|",
    ]
    for r in rc.rows:
        rc_table_lines.append(
            f"| {r.kpi} ({r.unit}) | {r.plan:,.0f} | {r.actual:,.0f} | "
            f"{r.gap:,.0f} | {r.run_rate_per_day or 'N/A'} | "
            f"{r.required_per_day or 'N/A'} | "
            f"{'%.1fx' % r.uplift if r.uplift is not None else 'N/A'} | {r.verdict} |"
        )

    dew_table_lines = [
        "| Date | Disposal Plan (M³) | Disposal Actual (M³) | Pump Hrs | Closing Stock (M³) |",
        "|------|--------------------|---------------------|----------|-------------------|",
    ]
    for d in dew_rows:
        dew_table_lines.append(
            f"| {d['date']} | {d['disp_plan']:,} | {d['disp_act']:,} | "
            f"{d['pump_act']} | {d['closing_stock']:,} |"
        )

    prod_table_lines = [
        "| Date | Ore (MT) | OB (CuM) | COB (MT) |",
        "|------|----------|----------|----------|",
    ]
    for p in prod_rows:
        prod_table_lines.append(
            f"| {p['date']} | {p['ore']:,} | {p['ob']:,} | {p['cob']:,} |"
        )

    disp_pct = (
        round(dew_mtd["disp_act"] / dew_mtd["disp_plan"] * 100, 1)
        if dew_mtd["disp_plan"] > 0 else 0
    )

    # ── shift comparison block ────────────────────────────────
    if shift_cmp:
        ore_d = shift_cmp["ore_delta"]
        ob_d  = shift_cmp["ob_delta"]
        cob_d = shift_cmp["cob_delta"]
        shift_block = (
            f"TODAY ({shift_cmp['today_date']}):     Ore {shift_cmp['today_ore']:,} MT | "
            f"OB {shift_cmp['today_ob']:,} CuM | COB {shift_cmp['today_cob']:,} MT\n"
            f"YESTERDAY ({shift_cmp['yesterday_date']}): Ore {shift_cmp['yesterday_ore']:,} MT | "
            f"OB {shift_cmp['yesterday_ob']:,} CuM | COB {shift_cmp['yesterday_cob']:,} MT\n"
            f"DELTA: Ore {'+' if ore_d >= 0 else ''}{ore_d:,} MT | "
            f"OB {'+' if ob_d >= 0 else ''}{ob_d:,} CuM | "
            f"COB {'+' if cob_d >= 0 else ''}{cob_d:,} MT"
        )
    else:
        shift_block = "Insufficient daily data for comparison."

    # ── revenue block ─────────────────────────────────────────
    if rev:
        bal_pct = (
            round(desp_split.get("bal", 0) / desp_split.get("total", 1) * 100, 1)
            if desp_split.get("total") else 0
        )
        rev_block = (
            f"At ₹{_ORE_PRICE_PER_MT:,.0f}/MT Chrome Ore:\n"
            f"- MTD Revenue (actual despatch): ₹{rev['mtd_revenue_cr']} Cr\n"
            f"- Projected Month-End Despatch: {rev['projected_mt']:,.0f} MT → ₹{rev['projected_rev_cr']} Cr\n"
            f"- Plan Revenue: ₹{rev['plan_rev_cr']} Cr | Revenue Gap vs Plan: ₹{rev['gap_vs_plan_cr']} Cr "
            f"({rev['gap_vs_plan_mt']:+,.0f} MT vs plan)\n"
            f"- BAL Plant share: {bal_pct}% of total MTD despatch"
        )
    else:
        rev_block = "Revenue projection unavailable — insufficient despatch data."

    context = f"""You are the Mine Manager's operational intelligence assistant at Kaliapani Chromite Mines, Balasore Alloys Limited, Sukinda Valley, Odisha. You are preparing the morning management briefing.

INSTRUCTIONS:
- Use ONLY the data provided below. Do not fabricate numbers.
- Be direct and specific — mention exact figures, dates, and percentages.
- Write as if presenting to the General Manager at the morning review meeting.
- For NOT_FEASIBLE KPIs, suggest concrete operational levers: double-shifting, vendor engagement, equipment redeployment, etc.
- For STRETCH KPIs, highlight what must not slip.
- Use mine terminology where appropriate: OB = Overburden, COB = Concentrate of Beneficiation, MTD = Month-to-Date, run-rate, uplift factor.

---

## SITE CONTEXT
Mine: Kaliapani Chromite Mine, Sukinda Valley, Odisha
Operation: Open-cast chromite mining + beneficiation (COB plant)
Key OB vendors: Dashmesh, DVS, ATWA (contractor agencies for OB excavation)
Month reference plan: {rc.plan_month}{' (FALLBACK — current month plan not entered)' if rc.plan_fallback else ''}
Overall Alert Level: {alert_prefix}

## MONTH-END FEASIBILITY — AS ON {rc.as_on}
Cycle: {rc.days_elapsed} days elapsed · {rc.days_remaining} days remaining · {rc.cycle_pct}% of month gone · Month ends {rc.month_end}

{chr(10).join(rc_table_lines)}

Verdict: ACHIEVABLE ≤1.5× uplift · STRETCH 1.5–3.5× · NOT FEASIBLE >3.5×

## DAILY PRODUCTION TREND (last {len(prod_rows)} days, newest first)
Average over this window: Ore {avg_ore:,} MT/day · OB {avg_ob:,} CuM/day

### 7-DAY CONSECUTIVE TREND ANALYSIS
{trend_signal}

{chr(10).join(prod_table_lines)}

## DEWATERING STATUS (MTD)
- MTD Disposal: {dew_mtd['disp_act']:,.0f} M³ actual vs {dew_mtd['disp_plan']:,.0f} M³ plan ({disp_pct}% compliance)
- MTD Pump Hours: {dew_mtd['pump_act']:.1f} hrs actual vs {dew_mtd['pump_plan']:.1f} hrs plan

## DAILY DEWATERING TREND (last {len(dew_rows)} days, newest first)
{chr(10).join(dew_table_lines)}

## EQUIPMENT — EXCAVATOR FLEET (MTD)
- Fleet: {equip.get('active', 'N/A')} of {equip.get('total', 7)} excavators active in period
- Fleet Availability: {equip.get('fleet_avail_pct', 'N/A')}%  (BD hours: {equip.get('bd_hrs', 0)} hrs across {equip.get('bd_events', 0)} breakdown events)
- Estimated Lost Ore due to Breakdowns: {equip.get('lost_ore_mt', 0):,} MT (at {_FLEET_CAP_MT_PER_HR:.0f} MT/hr benchmark per excavator)
- Note: ACHIEVABLE fleet availability benchmark = >85%; STRETCH = 70–85%; CRITICAL = <70%

## COB PLANT — QUALITY & PERFORMANCE (MTD)
- Feed processed: {cob_qual.get('feed_mt', 0):,} MT | COB produced: {cob_qual.get('cob_mt', 0):,} MT
- Yield: {cob_qual.get('yield_pct', 'N/A')}% | I/O Ratio: {cob_qual.get('io_ratio', 'N/A')}
- Input Cr₂O₃: {cob_qual.get('input_cr2o3', 'N/A')}% | Output Cr₂O₃: {cob_qual.get('output_cr2o3', 'N/A')}%
- Note: Healthy output Cr₂O₃ benchmark = >44%; yield benchmark = >38%

## STOCK POSITION (mine stock, IMOS entry — latest snapshot)
- HG (>52%): {stock.get('HG', 0):,.0f} MT | MG (40-52%): {stock.get('MG', 0):,.0f} MT | LG (<40%): {stock.get('LG', 0):,.0f} MT
- COB Concentrate: {stock.get('COB', 0):,.0f} MT
- Total Mine Stock: {stock.get('total', 0):,.0f} MT

## DESPATCH & REVENUE PROJECTION (MTD)
{rev_block}

## TODAY vs YESTERDAY PRODUCTION
{shift_block}

---

Generate EXACTLY the six sections below. Each must be factual, crisp, and reference specific numbers from above.

### SECTION 1: MONTH-END FEASIBILITY NARRATIVE
Open with EXACTLY one of: "⚠️ CRITICAL:", "✅ ON TRACK:", or "⚡ CAUTION:" matching the Overall Alert Level above — this is the FIRST word(s) of your response.
3-4 sentences for the GM briefing. Cover: overall outlook, which 1-2 KPIs are most at risk with their uplift factor, the rolling 7-day ore trend direction (state if UP/DOWN/mixed and cite consecutive day count and sequence), and the single most important operational action needed. Mention days elapsed and remaining.

### SECTION 2: CRITICAL OBSERVATIONS — DEWATERING
4 numbered bullet points. Each must reference a specific date or number from the dewatering table. Cover: disposal compliance trend, pump hours compliance, closing stock trajectory (rising/falling), and any notable single-day spike or drop.

### SECTION 3: EQUIPMENT & COB PLANT STATUS
4 numbered bullet points covering: excavator fleet availability vs benchmark, breakdown impact in hours AND the estimated lost ore MT figure, COB yield vs 38% benchmark, and Cr₂O₃ output grade vs 44% benchmark. Flag any concerning trend.

### SECTION 4: STOCK, DESPATCH & REVENUE
4 numbered bullet points covering: total mine stock adequacy for remaining despatch plan, grade mix observations (HG/MG/LG balance), BAL vs SUK despatch split and concentration risk, and month-end revenue projection vs plan (cite ₹ Crore figures).

### SECTION 5: KEY RISKS & RECOMMENDED ACTIONS
Exactly 4 items covering the most critical cross-functional risks. Format each as:
RISK: [specific risk with the number that makes it risky] → ACTION: [one concrete operational action]

### SECTION 6: TODAY VS YESTERDAY SNAPSHOT
2-3 sentences comparing today's production to yesterday's. State the absolute numbers for ore, OB, and COB and the delta. Flag if today is >10% below yesterday as a concern; if today is above, note the positive momentum.

Format your response EXACTLY as:
---SECTION1---
[narrative text]
---SECTION2---
[4 numbered bullets]
---SECTION3---
[4 numbered bullets]
---SECTION4---
[4 numbered bullets]
---SECTION5---
[4 RISK/ACTION pairs]
---SECTION6---
[2-3 sentences]
"""

    # ── call LiteLLM ─────────────────────────────────────────
    client = AsyncOpenAI(
        base_url=settings.litellm_base_url + "/v1",
        api_key=settings.litellm_api_key,
        timeout=25.0,
    )

    response = await client.chat.completions.create(
        model=settings.litellm_model,
        messages=[{"role": "user", "content": context}],
        temperature=0.3,
        max_tokens=2400,
    )

    raw = response.choices[0].message.content or ""

    # ── parse sections ────────────────────────────────────────
    def _extract(text: str, marker: str, next_marker: str) -> str:
        start = text.find(marker)
        if start == -1:
            return ""
        start += len(marker)
        end = text.find(next_marker, start)
        return text[start:end].strip() if end != -1 else text[start:].strip()

    narrative  = _extract(raw, "---SECTION1---", "---SECTION2---")
    dewatering = _extract(raw, "---SECTION2---", "---SECTION3---")
    equip_cob  = _extract(raw, "---SECTION3---", "---SECTION4---")
    stock_desp = _extract(raw, "---SECTION4---", "---SECTION5---")
    risks      = _extract(raw, "---SECTION5---", "---SECTION6---")
    shift_snap = _extract(raw, "---SECTION6---", "---END---")

    result = InsightsResponse(
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        model_used=settings.litellm_model,
        reality_check_narrative=narrative or raw,
        dewatering_observations=dewatering,
        equipment_cob_status=equip_cob,
        stock_despatch_summary=stock_desp,
        key_risks_and_actions=risks,
        shift_snapshot=shift_snap,
        cached=False,
    )

    # ── cache the result (Enhancement #6) ────────────────────
    set_cached_insights(cache_key, result.model_dump(mode="json"))

    return result
