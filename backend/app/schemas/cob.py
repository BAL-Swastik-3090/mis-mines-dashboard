from pydantic import BaseModel
from datetime import date
from typing import Optional


class CobDayRow(BaseModel):
    date:             date
    # Actuals (MT)
    feed_actual:      Optional[float] = None
    cob_actual:       Optional[float] = None
    tailings_actual:  Optional[float] = None
    # Derived
    yield_pct:        Optional[float] = None   # cob / feed × 100
    io_ratio:         Optional[float] = None   # feed / cob
    # Quality (Cr₂O₃ %)
    input_cr2o3:      Optional[float] = None
    output_cr2o3:     Optional[float] = None
    tailings_cr2o3:   Optional[float] = None
    # Plans
    feed_plan:        Optional[float] = None
    cob_plan:         Optional[float] = None
    tailings_plan:    Optional[float] = None
    yield_plan:       Optional[float] = None   # Weight_recovery from plan
    running_hr_plan:  Optional[float] = None
    input_cr2o3_plan: Optional[float] = None
    output_cr2o3_plan:Optional[float] = None


class CobSummary(BaseModel):
    from_date:           date
    to_date:             date
    rows:                list[CobDayRow]
    # MTD quantity totals
    mtd_feed_actual:     float = 0.0
    mtd_feed_plan:       float = 0.0
    mtd_cob_actual:      float = 0.0
    mtd_cob_plan:        float = 0.0
    mtd_tailings_actual: float = 0.0
    mtd_tailings_plan:   float = 0.0
    # MTD derived rates
    mtd_yield_pct:       Optional[float] = None
    mtd_yield_plan:      Optional[float] = None
    mtd_io_ratio:        Optional[float] = None
    # MTD average quality
    avg_input_cr2o3:     Optional[float] = None
    avg_output_cr2o3:    Optional[float] = None
    avg_tailings_cr2o3:  Optional[float] = None
