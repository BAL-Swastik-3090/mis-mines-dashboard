from pydantic import BaseModel
from typing import Optional


class DewateringDayRow(BaseModel):
    date:           str
    open_stock:     Optional[float]
    rain_added:     Optional[float]
    seepage:        Optional[float]
    pump_plan_hr:   Optional[float]
    pump_act_hr:    Optional[float]
    disposal_plan:  Optional[float]
    disposal_act:   Optional[float]
    variance:       Optional[float]
    closing_stock:  Optional[float]
    # kpi_id 42, "Reason for Variances in Dewatering" — free text, so it lives in
    # text_value rather than calculation_value like every other KPI here.
    variance_reason: Optional[str] = None


class DewateringTodayKpi(BaseModel):
    latest_date:          str
    day_num:              int
    disposal_actual:      Optional[float]
    disposal_plan:        Optional[float]
    disposal_variance:    Optional[float]
    disposal_pct:         Optional[float]
    pump_actual_hr:       Optional[float]
    pump_plan_hr:         Optional[float]
    pump_pct:             Optional[float]
    closing_stock:        Optional[float]
    prev_closing_stock:   Optional[float]
    stock_delta:          Optional[float]
    pump_capacity:        Optional[float]
    eddy_pump_mins:       Optional[float]


class DewateringMtdKpi(BaseModel):
    days:                   int
    mtd_disposal_actual:    float
    mtd_disposal_plan:      float
    mtd_disposal_pct:       Optional[float]
    mtd_pump_actual_hr:     float
    mtd_pump_plan_hr:       float
    mtd_pump_pct:           Optional[float]
    mtd_rain_inflow:        float
    net_stock_change:       Optional[float]
    d1_open_stock:          Optional[float]
    d_last_close_stock:     Optional[float]


class DewateringSummaryResponse(BaseModel):
    from_date:  str
    to_date:    str
    today:      DewateringTodayKpi
    mtd:        DewateringMtdKpi
    rows:       list[DewateringDayRow]
