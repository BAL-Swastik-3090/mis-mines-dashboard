from pydantic import BaseModel
from datetime import date
from typing import Optional


class DespatchDayRow(BaseModel):
    date:           date
    # Plan
    total_plan:     float = 0.0
    bal_plan:       float = 0.0
    suk_plan:       float = 0.0
    # Actuals (hybrid: synced via delivery table + unsynced via transporter)
    total_actual:   Optional[float] = None
    bal_actual:     Optional[float] = None
    suk_actual:     Optional[float] = None
    unsynced_count: int = 0


class DespatchSummary(BaseModel):
    from_date:          date
    to_date:            date
    # MTD Plan
    mtd_total_plan:     float = 0.0
    mtd_bal_plan:       float = 0.0
    mtd_suk_plan:       float = 0.0
    # TD Plan
    td_total_plan:      Optional[float] = None
    td_bal_plan:        Optional[float] = None
    td_suk_plan:        Optional[float] = None
    # MTD Actuals
    mtd_total_actual:   Optional[float] = None
    mtd_bal_actual:     Optional[float] = None
    mtd_suk_actual:     Optional[float] = None
    mtd_unsynced_count: int = 0
    # TD Actuals
    td_total_actual:    Optional[float] = None
    td_bal_actual:      Optional[float] = None
    td_suk_actual:      Optional[float] = None
    td_unsynced_count:  int = 0


class DespatchDaywise(BaseModel):
    from_date:          date
    to_date:            date
    rows:               list[DespatchDayRow]
    # MTD Plan
    mtd_total_plan:     float = 0.0
    mtd_bal_plan:       float = 0.0
    mtd_suk_plan:       float = 0.0
    # MTD Actuals
    mtd_total_actual:   Optional[float] = None
    mtd_bal_actual:     Optional[float] = None
    mtd_suk_actual:     Optional[float] = None
    mtd_unsynced_count: int = 0
