"""
Insights service.

Two responsibilities:
  1. compute_reality_check()  — pure SQL math, no LLM, fast.
  2. generate_insights()      — fetches data, calls LiteLLM Claude, returns narrative.
"""
from datetime import date, datetime
import calendar
from sqlalchemy.orm import Session
from sqlalchemy import text
from openai import AsyncOpenAI

from ..config import get_settings
from ..schemas.insights import RealityCheckRow, RealityCheckResponse, InsightsResponse


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


def _ore_ob_full_month_plan(db: Session, first: date, last: date) -> dict:
    row = db.execute(text("""
        SELECT COALESCE(SUM(ORE_QTY), 0)                          AS ore_plan,
               COALESCE(MAX(CAST(OB_QTY_Cum AS DECIMAL(14,3))), 0) AS ob_plan
        FROM   mines_daily_excavation_plan
        WHERE  Prod_date BETWEEN :f AND :t
    """), {"f": first, "t": last}).fetchone()
    return {"ore": _f(row.ore_plan), "ob": _f(row.ob_plan)}


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
    row = db.execute(text("""
        SELECT
            SUM(CASE WHEN PLANT='1200' AND MATERIAL_DESC IN (
                    'LOW GRADE ORE(-40%CR2O3)',
                    '40-52%        CHROME ORE',
                    '+52% CHROME ORE')     THEN QUANTITY ELSE 0 END) AS ore,
            SUM(CASE WHEN PLANT='1200' AND MATERIAL_DESC='OVERBURDEN'
                                           THEN QUANTITY ELSE 0 END) AS ob,
            SUM(CASE WHEN PLANT='1210' AND MATERIAL_DESC='CONCENTRATE WITH STD MOISTURE'
                                           THEN QUANTITY ELSE 0 END) AS cob
        FROM pp_production
        WHERE POSTING_DATE BETWEEN :f AND :t
    """), {"f": from_date, "t": to_date}).fetchone()
    return {
        "ore": _f(row.ore),
        "ob":  _f(row.ob),
        "cob": _f(row.cob),
    }


def _despatch_mtd_actual(db: Session, from_date: date, to_date: date) -> float | None:
    """
    MTD despatch actual using the same hybrid query as the despatch service.
    Deduplicates zsd_outbound_despatch by DELIVERYNO (sync log inserts a new row
    every 15 min), then filters to Balasore Alloys deliveries only.
    """
    try:
        row = db.execute(text("""
            SELECT COALESCE(SUM(z.NETWEIGHT), 0) AS actual
            FROM (
                SELECT DELIVERYNO, MAX(GATEINDATE) AS GATEINDATE,
                       MAX(NETWEIGHT) AS NETWEIGHT, MAX(TRANSPORTER) AS TRANSPORTER
                FROM   zsd_outbound_despatch
                WHERE  DATE(GATEINDATE) BETWEEN :f AND :t
                GROUP  BY DELIVERYNO
            ) z
            LEFT JOIN sd_outbound_delivery s
                   ON CONCAT('0', z.DELIVERYNO) = s.DELIVERY_NO
            WHERE (
                (s.DELIVERY_NO IS NOT NULL AND s.SHIP_PARTY_NAME = 'Balasore Alloys Limited')
             OR (s.DELIVERY_NO IS NULL     AND z.TRANSPORTER     = 'SHREE GANESH LOGISTICS')
            )
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

    # Check if plan data exists for current month; fall back to latest available
    trial        = _ore_ob_full_month_plan(db, first, last)
    if trial["ore"] == 0 and trial["ob"] == 0:
        plan_first, plan_last = _latest_plan_month(db)
        plan_fallback = (plan_first.month != first.month or plan_first.year != first.year)
    else:
        plan_first, plan_last = first, last
        plan_fallback = False

    plans   = _ore_ob_full_month_plan(db, plan_first, plan_last)
    actuals = _production_mtd(db, from_date, to_date)
    dew     = _dewatering_mtd(db, from_date, to_date)

    cob_plan      = _cob_full_month_plan(db, plan_first, plan_last)
    desp_plan     = _despatch_full_month_plan(db, plan_first, plan_last)
    desp_act      = _despatch_mtd_actual(db, from_date, to_date)

    plan_month_label = plan_first.strftime("%b %Y")

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
        make_row("Water Disposal",   "M³",  dew["disp_plan"], dew["disp_act"]),
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
    rows = db.execute(text("""
        SELECT
            POSTING_DATE                                                          AS dt,
            SUM(CASE WHEN PLANT='1200' AND MATERIAL_DESC IN (
                    'LOW GRADE ORE(-40%CR2O3)',
                    '40-52%        CHROME ORE',
                    '+52% CHROME ORE')        THEN QUANTITY ELSE 0 END)          AS ore,
            SUM(CASE WHEN PLANT='1200' AND MATERIAL_DESC='OVERBURDEN'
                                               THEN QUANTITY ELSE 0 END)          AS ob,
            SUM(CASE WHEN PLANT='1210' AND MATERIAL_DESC='CONCENTRATE WITH STD MOISTURE'
                                               THEN QUANTITY ELSE 0 END)          AS cob
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
    """Excavator fleet BD hours and active count."""
    try:
        days = (to_date - from_date).days + 1
        period_hrs = days * 24.0
        total_excavators = 7

        bd_row = db.execute(text("""
            SELECT ROUND(SUM(BREAKDOWN_DURAION), 1) AS total_bd_hrs,
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

        sensor_row = db.execute(text("""
            SELECT COUNT(DISTINCT vehicle_desc) AS active
            FROM mines_technoton_rest_equipment_utilization
            WHERE report_date BETWEEN :f AND :t
              AND vehicle_desc LIKE '%Z AXIS%'
              AND TIME_TO_SEC(engine_hours) / 3600.0 > 0
        """), {"f": from_date, "t": to_date}).fetchone()
        active_count = int(sensor_row.active or 0) if sensor_row else 0

        return {
            "total": total_excavators,
            "active": active_count,
            "bd_hrs": total_bd_hrs,
            "bd_events": bd_events,
            "fleet_avail_pct": fleet_avail,
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

        p_row = db.execute(text("""
            SELECT
                SUM(CASE WHEN MATERIAL_DESC = 'LOW GRADE ORE(-40%CR2O3)'
                          AND MOVEMENT_TYPE = '261' THEN QUANTITY ELSE 0 END) AS feed,
                SUM(CASE WHEN MATERIAL_DESC = 'CONCENTRATE WITH STD MOISTURE'
                          AND MOVEMENT_TYPE = '101' THEN QUANTITY ELSE 0 END) AS cob
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
    """Current ore + COB stock by grade from mm_mb52_inventory_new."""
    try:
        rows = db.execute(text("""
            SELECT
                CASE
                    WHEN MATERIAL_DESC = '+52% CHROME ORE'          THEN 'HG'
                    WHEN MATERIAL_DESC LIKE '40-52%%'                THEN 'MG'
                    WHEN MATERIAL_DESC = 'LOW GRADE ORE(-40%CR2O3)' THEN 'LG'
                    WHEN MATERIAL_DESC LIKE '%LUMP%'                 THEN 'LUMP'
                    WHEN MATERIAL_DESC = 'CONCENTRATE WITH STD MOISTURE' THEN 'COB'
                    ELSE 'OTHER'
                END AS grade,
                ROUND(SUM(UNRESTRICTED_STOCK), 2) AS stock
            FROM mm_mb52_inventory_new
            WHERE PLANT IN ('1200', '1210')
              AND MATERIAL_TYPE IN ('ZORE', 'ZCON')
               OR (PLANT = '1210' AND MATERIAL_DESC = 'CONCENTRATE WITH STD MOISTURE')
            GROUP BY 1
        """)).fetchall()
        result = {r.grade: float(r.stock or 0) for r in rows if r.grade != 'OTHER'}
        result["total"] = round(sum(v for k, v in result.items()), 2)
        return result
    except Exception:
        return {}


def _despatch_split_mtd(db: Session, from_date: date, to_date: date) -> dict:
    """MTD despatch BAL vs SUK split."""
    try:
        row = db.execute(text("""
            SELECT
                COALESCE(SUM(CASE WHEN s.SHIP_PARTY_NAME = 'Balasore Alloys Limited'
                                  THEN z.NETWEIGHT ELSE 0 END), 0) AS bal,
                COALESCE(SUM(CASE WHEN s.DELIVERY_NO IS NULL
                                   AND z.TRANSPORTER = 'SHREE GANESH LOGISTICS'
                                  THEN z.NETWEIGHT ELSE 0 END), 0) AS suk,
                COALESCE(SUM(z.NETWEIGHT), 0)                       AS total
            FROM (
                SELECT DELIVERYNO, MAX(GATEINDATE) AS GATEINDATE,
                       MAX(NETWEIGHT) AS NETWEIGHT, MAX(TRANSPORTER) AS TRANSPORTER
                FROM zsd_outbound_despatch
                WHERE DATE(GATEINDATE) BETWEEN :f AND :t
                GROUP BY DELIVERYNO
            ) z
            LEFT JOIN sd_outbound_delivery s ON CONCAT('0', z.DELIVERYNO) = s.DELIVERY_NO
            WHERE (
                (s.DELIVERY_NO IS NOT NULL AND s.SHIP_PARTY_NAME = 'Balasore Alloys Limited')
             OR (s.DELIVERY_NO IS NULL     AND z.TRANSPORTER     = 'SHREE GANESH LOGISTICS')
            )
        """), {"f": from_date, "t": to_date}).fetchone()
        return {
            "bal":   round(float(row.bal   or 0), 1),
            "suk":   round(float(row.suk   or 0), 1),
            "total": round(float(row.total or 0), 1),
        }
    except Exception:
        return {}


# ── public: generate insights via LiteLLM ─────────────────────

async def generate_insights(
    db: Session, from_date: date, to_date: date
) -> InsightsResponse:
    settings = get_settings()

    # ── gather data ──────────────────────────────────────────
    rc         = compute_reality_check(db, from_date, to_date)
    dew_rows   = _dewatering_daily_rows(db, from_date, to_date)
    dew_mtd    = _dewatering_mtd(db, from_date, to_date)
    prod_rows  = _production_daily_rows(db, from_date, to_date)
    equip      = _equipment_summary(db, from_date, to_date)
    cob_qual   = _cob_quality_mtd(db, from_date, to_date)
    stock      = _stock_snapshot(db)
    desp_split = _despatch_split_mtd(db, from_date, to_date)

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

    # Compute simple day-over-day trend signal for prompt enrichment
    avg_ore = round(sum(p["ore"] for p in prod_rows) / len(prod_rows)) if prod_rows else 0
    avg_ob  = round(sum(p["ob"]  for p in prod_rows) / len(prod_rows)) if prod_rows else 0
    last3_ore = [p["ore"] for p in prod_rows[:3]]
    trend_signal = ""
    if len(last3_ore) == 3:
        if last3_ore[0] > last3_ore[2]:
            trend_signal = f"Ore production is trending UP over last 3 days ({last3_ore[2]} → {last3_ore[1]} → {last3_ore[0]} MT)."
        elif last3_ore[0] < last3_ore[2]:
            trend_signal = f"Ore production is trending DOWN over last 3 days ({last3_ore[2]} → {last3_ore[1]} → {last3_ore[0]} MT)."
        else:
            trend_signal = f"Ore production is flat over last 3 days (~{last3_ore[0]} MT/day)."

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

## MONTH-END FEASIBILITY — AS ON {rc.as_on}
Cycle: {rc.days_elapsed} days elapsed · {rc.days_remaining} days remaining · {rc.cycle_pct}% of month gone · Month ends {rc.month_end}

{chr(10).join(rc_table_lines)}

Verdict: ACHIEVABLE ≤1.5× uplift · STRETCH 1.5–3.5× · NOT FEASIBLE >3.5×

## DAILY PRODUCTION TREND (last {len(prod_rows)} days, newest first)
Average over this window: Ore {avg_ore:,} MT/day · OB {avg_ob:,} CuM/day
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
- Note: ACHIEVABLE fleet availability benchmark = >85%; STRETCH = 70–85%; CRITICAL = <70%

## COB PLANT — QUALITY & PERFORMANCE (MTD)
- Feed processed: {cob_qual.get('feed_mt', 0):,} MT | COB produced: {cob_qual.get('cob_mt', 0):,} MT
- Yield: {cob_qual.get('yield_pct', 'N/A')}% | I/O Ratio: {cob_qual.get('io_ratio', 'N/A')}
- Input Cr₂O₃: {cob_qual.get('input_cr2o3', 'N/A')}% | Output Cr₂O₃: {cob_qual.get('output_cr2o3', 'N/A')}%
- Note: Healthy output Cr₂O₃ benchmark = >44%; yield benchmark = >38%

## STOCK POSITION (live snapshot)
- HG (>52%): {stock.get('HG', 0):,.0f} MT | MG (40-52%): {stock.get('MG', 0):,.0f} MT | LG (<40%): {stock.get('LG', 0):,.0f} MT
- COB Concentrate: {stock.get('COB', 0):,.0f} MT | Lump: {stock.get('LUMP', 0):,.0f} MT
- Total Mine Stock: {stock.get('total', 0):,.0f} MT

## DESPATCH SPLIT (MTD)
- BAL Plant (Balasore Alloys): {desp_split.get('bal', 0):,.1f} MT ({round(desp_split.get('bal',0)/desp_split.get('total',1)*100,1) if desp_split.get('total') else 0}% of total)
- Sukinda/Others: {desp_split.get('suk', 0):,.1f} MT
- Total MTD Despatch: {desp_split.get('total', 0):,.1f} MT

---

Generate EXACTLY the five sections below. Each must be factual, crisp, and reference specific numbers from above.

### SECTION 1: MONTH-END FEASIBILITY NARRATIVE
3-4 sentences for the GM briefing. Cover: overall outlook (optimistic/cautious/critical), which 1-2 KPIs are most at risk with their uplift factor, and the single most important operational action needed to close the gap. Mention days elapsed and remaining.

### SECTION 2: CRITICAL OBSERVATIONS — DEWATERING
4 numbered bullet points. Each must reference a specific date or number from the dewatering table. Cover: disposal compliance trend, pump hours compliance, closing stock trajectory (rising/falling), and any notable single-day spike or drop.

### SECTION 3: EQUIPMENT & COB PLANT STATUS
4 numbered bullet points covering: excavator fleet availability vs benchmark, most significant breakdown impact, COB yield vs 38% benchmark, and Cr₂O₃ output grade vs 44% benchmark. Flag any concerning trend.

### SECTION 4: STOCK & DESPATCH SUMMARY
3 numbered bullet points covering: total mine stock adequacy for remaining despatch plan, grade mix observations (HG/MG/LG balance), and BAL vs SUK despatch split with any concern about concentration risk.

### SECTION 5: KEY RISKS & RECOMMENDED ACTIONS
Exactly 4 items covering the most critical cross-functional risks. Format each as:
RISK: [specific risk with the number that makes it risky] → ACTION: [one concrete operational action]

Format your response EXACTLY as:
---SECTION1---
[narrative text]
---SECTION2---
[4 numbered bullets]
---SECTION3---
[4 numbered bullets]
---SECTION4---
[3 numbered bullets]
---SECTION5---
[4 RISK/ACTION pairs]
"""

    # ── call LiteLLM ─────────────────────────────────────────
    client = AsyncOpenAI(
        base_url=settings.litellm_base_url + "/v1",
        api_key=settings.litellm_api_key,
        timeout=25.0,   # fail fast before the 30s frontend axios timeout
    )

    response = await client.chat.completions.create(
        model=settings.litellm_model,
        messages=[{"role": "user", "content": context}],
        temperature=0.3,
        max_tokens=2000,
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

    narrative    = _extract(raw, "---SECTION1---", "---SECTION2---")
    dewatering   = _extract(raw, "---SECTION2---", "---SECTION3---")
    equip_cob    = _extract(raw, "---SECTION3---", "---SECTION4---")
    stock_desp   = _extract(raw, "---SECTION4---", "---SECTION5---")
    risks        = _extract(raw, "---SECTION5---", "---END---")

    return InsightsResponse(
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        model_used=settings.litellm_model,
        reality_check_narrative=narrative or raw,
        dewatering_observations=dewatering,
        equipment_cob_status=equip_cob,
        stock_despatch_summary=stock_desp,
        key_risks_and_actions=risks,
    )
