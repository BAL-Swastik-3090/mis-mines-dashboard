from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import date, timedelta
from typing import Optional

from ..schemas.dewatering import (
    DewateringSummaryResponse,
    DewateringTodayKpi,
    DewateringMtdKpi,
    DewateringDayRow,
)

# ── KPI ID constants ──────────────────────────────────────────
KPI_RAIN_MM         = 27
KPI_PUMP_CAPACITY   = 28
KPI_OPEN_STOCK      = 29
KPI_SEEPAGE         = 30
KPI_RAIN_WATER      = 31
KPI_PUMP_PLAN_HR    = 32
KPI_DISPOSAL_PLAN   = 33
KPI_PUMP_ACT_HR     = 34
KPI_DISPOSAL_ACT    = 35
KPI_VARIANCE        = 36
KPI_CLOSING_STOCK   = 37
KPI_PLAN_COMPLIANCE = 38
KPI_EDDY_DAY        = 50


def _f(val) -> Optional[float]:
    return float(val) if val is not None else None


def _date_spine(from_date: date, to_date: date) -> list:
    n = (to_date - from_date).days + 1
    return [from_date + timedelta(days=i) for i in range(n)]


def get_summary(db: Session, from_date: date, to_date: date) -> DewateringSummaryResponse:
    # ── 1. Daily pivot ────────────────────────────────────────
    daily_sql = text("""
        SELECT
            d.date,
            MAX(CASE WHEN d.kpi_id = :open_stock    THEN d.calculation_value END) AS open_stock,
            MAX(CASE WHEN d.kpi_id = :rain_water     THEN d.calculation_value END) AS rain_added,
            MAX(CASE WHEN d.kpi_id = :pump_plan_hr   THEN d.calculation_value END) AS pump_plan_hr,
            MAX(CASE WHEN d.kpi_id = :pump_act_hr    THEN d.calculation_value END) AS pump_act_hr,
            MAX(CASE WHEN d.kpi_id = :disposal_plan  THEN d.calculation_value END) AS disposal_plan,
            MAX(CASE WHEN d.kpi_id = :disposal_act   THEN d.calculation_value END) AS disposal_act,
            MAX(CASE WHEN d.kpi_id = :variance       THEN d.calculation_value END) AS variance,
            MAX(CASE WHEN d.kpi_id = :closing_stock  THEN d.calculation_value END) AS closing_stock
        FROM mines_dewatering_daily_data d
        WHERE d.date BETWEEN :from_date AND :to_date
        GROUP BY d.date
        ORDER BY d.date ASC
    """)

    raw_rows = db.execute(daily_sql, {
        "open_stock":   KPI_OPEN_STOCK,
        "rain_water":   KPI_RAIN_WATER,
        "pump_plan_hr": KPI_PUMP_PLAN_HR,
        "pump_act_hr":  KPI_PUMP_ACT_HR,
        "disposal_plan":KPI_DISPOSAL_PLAN,
        "disposal_act": KPI_DISPOSAL_ACT,
        "variance":     KPI_VARIANCE,
        "closing_stock":KPI_CLOSING_STOCK,
        "from_date":    from_date,
        "to_date":      to_date,
    }).fetchall()

    # Rows that actually have data (used for "Today" KPI and MTD counts)
    data_rows = [
        DewateringDayRow(
            date=str(r.date),
            open_stock=_f(r.open_stock),
            rain_added=_f(r.rain_added),
            pump_plan_hr=_f(r.pump_plan_hr),
            pump_act_hr=_f(r.pump_act_hr),
            disposal_plan=_f(r.disposal_plan),
            disposal_act=_f(r.disposal_act),
            variance=_f(r.variance),
            closing_stock=_f(r.closing_stock),
        )
        for r in raw_rows
    ]

    # Full date spine — all dates appear in the table even if no data yet
    data_by_date = {r.date: r for r in data_rows}
    rows = [
        data_by_date.get(str(dt), DewateringDayRow(
            date=str(dt),
            open_stock=None, rain_added=None, pump_plan_hr=None,
            pump_act_hr=None, disposal_plan=None, disposal_act=None,
            variance=None, closing_stock=None,
        ))
        for dt in _date_spine(from_date, to_date)
    ]

    # ── 2. Today KPIs (latest row that has actual data) ───────
    latest_row = data_rows[-1] if data_rows else None

    # Previous day closing stock (for delta)
    prev_close: Optional[float] = data_rows[-2].closing_stock if len(data_rows) >= 2 else None

    # Pump capacity & eddy pump — fetch separately (static / daily input)
    extra_sql = text("""
        SELECT kpi_id, MAX(calculation_value) AS val
        FROM mines_dewatering_daily_data
        WHERE date = (
            SELECT MAX(date) FROM mines_dewatering_daily_data
            WHERE date BETWEEN :from_date AND :to_date
        )
        AND kpi_id IN (:cap, :eddy)
        GROUP BY kpi_id
    """)
    extra = {
        r.kpi_id: _f(r.val)
        for r in db.execute(extra_sql, {
            "from_date": from_date,
            "to_date":   to_date,
            "cap":       KPI_PUMP_CAPACITY,
            "eddy":      KPI_EDDY_DAY,
        }).fetchall()
    }

    if latest_row:
        d_actual  = latest_row.disposal_act
        d_plan    = latest_row.disposal_plan
        d_var     = latest_row.variance
        d_pct     = round(d_actual / d_plan * 100, 2) if (d_plan and d_actual is not None) else None
        p_actual  = latest_row.pump_act_hr
        p_plan    = latest_row.pump_plan_hr
        p_pct     = round(p_actual / p_plan * 100, 2) if (p_plan and p_actual is not None) else None
        close     = latest_row.closing_stock
        delta     = round(close - prev_close, 1) if (close is not None and prev_close is not None) else None
        lat_date  = latest_row.date
        day_num   = int(lat_date.split("-")[2]) if lat_date else 1
    else:
        d_actual = d_plan = d_var = d_pct = None
        p_actual = p_plan = p_pct = None
        close = delta = None
        lat_date = str(to_date)
        day_num = to_date.day

    today = DewateringTodayKpi(
        latest_date=lat_date,
        day_num=day_num,
        disposal_actual=d_actual,
        disposal_plan=d_plan,
        disposal_variance=d_var,
        disposal_pct=d_pct,
        pump_actual_hr=p_actual,
        pump_plan_hr=p_plan,
        pump_pct=p_pct,
        closing_stock=close,
        prev_closing_stock=prev_close,
        stock_delta=delta,
        pump_capacity=extra.get(KPI_PUMP_CAPACITY),
        eddy_pump_mins=extra.get(KPI_EDDY_DAY),
    )

    # ── 3. MTD aggregates ─────────────────────────────────────
    mtd_sql = text("""
        SELECT
            SUM(CASE WHEN kpi_id = :disposal_plan  THEN calculation_value END) AS mtd_disp_plan,
            SUM(CASE WHEN kpi_id = :disposal_act   THEN calculation_value END) AS mtd_disp_act,
            SUM(CASE WHEN kpi_id = :pump_plan_hr   THEN calculation_value END) AS mtd_pump_plan,
            SUM(CASE WHEN kpi_id = :pump_act_hr    THEN calculation_value END) AS mtd_pump_act,
            SUM(CASE WHEN kpi_id = :rain_water      THEN calculation_value END) AS mtd_rain
        FROM mines_dewatering_daily_data
        WHERE date BETWEEN :from_date AND :to_date
          AND kpi_id IN (:disposal_plan, :disposal_act, :pump_plan_hr, :pump_act_hr, :rain_water)
    """)
    m = db.execute(mtd_sql, {
        "disposal_plan": KPI_DISPOSAL_PLAN,
        "disposal_act":  KPI_DISPOSAL_ACT,
        "pump_plan_hr":  KPI_PUMP_PLAN_HR,
        "pump_act_hr":   KPI_PUMP_ACT_HR,
        "rain_water":    KPI_RAIN_WATER,
        "from_date":     from_date,
        "to_date":       to_date,
    }).fetchone()

    mtd_d_plan = _f(m.mtd_disp_plan) or 0.0
    mtd_d_act  = _f(m.mtd_disp_act)  or 0.0
    mtd_p_plan = _f(m.mtd_pump_plan) or 0.0
    mtd_p_act  = _f(m.mtd_pump_act)  or 0.0
    mtd_rain   = _f(m.mtd_rain)      or 0.0

    d1_open  = data_rows[0].open_stock     if data_rows else None
    d_last_c = data_rows[-1].closing_stock if data_rows else None
    net_chg  = round(d_last_c - d1_open, 1) if (d_last_c is not None and d1_open is not None) else None

    mtd = DewateringMtdKpi(
        days=len(data_rows),
        mtd_disposal_actual=mtd_d_act,
        mtd_disposal_plan=mtd_d_plan,
        mtd_disposal_pct=round(mtd_d_act / mtd_d_plan * 100, 1) if mtd_d_plan else None,
        mtd_pump_actual_hr=mtd_p_act,
        mtd_pump_plan_hr=mtd_p_plan,
        mtd_pump_pct=round(mtd_p_act / mtd_p_plan * 100, 1) if mtd_p_plan else None,
        mtd_rain_inflow=mtd_rain,
        net_stock_change=net_chg,
        d1_open_stock=d1_open,
        d_last_close_stock=d_last_c,
    )

    return DewateringSummaryResponse(
        from_date=str(from_date),
        to_date=str(to_date),
        today=today,
        mtd=mtd,
        rows=rows,
    )
