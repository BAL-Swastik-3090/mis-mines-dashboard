from pydantic import BaseModel
from datetime import date
from typing import Optional


class RealityCheckRow(BaseModel):
    kpi:              str
    unit:             str
    plan:             float
    actual:           float
    gap:              float
    run_rate_per_day: Optional[float]
    required_per_day: Optional[float]
    uplift:           Optional[float]
    verdict:          str   # "ACHIEVABLE" | "STRETCH" | "NOT_FEASIBLE" | "NO_DATA" | "N/A"


class RealityCheckResponse(BaseModel):
    as_on:          date
    from_date:      date
    to_date:        date
    month_end:      date
    days_elapsed:   int
    days_remaining: int
    cycle_pct:      float
    plan_month:     str          # e.g. "Jun 2026" — may differ from to_date month
    plan_fallback:  bool         # True when plan is from a prior month
    rows:           list[RealityCheckRow]


class InsightsResponse(BaseModel):
    generated_at:              str
    model_used:                str
    reality_check_narrative:   str
    dewatering_observations:   str
    equipment_cob_status:      str
    stock_despatch_summary:    str
    key_risks_and_actions:     str
    shift_snapshot:            Optional[str] = ""
    cached:                    bool = False
