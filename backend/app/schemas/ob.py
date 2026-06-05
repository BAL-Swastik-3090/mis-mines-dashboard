from pydantic import BaseModel
from datetime import date
from typing import Optional


class ObDayRow(BaseModel):
    date:      date
    bal_actual: Optional[float] = None
    ob_plan:    Optional[float] = None


class ObVendorDayRow(BaseModel):
    date:   date
    actual: Optional[float] = None


class ObVendorData(BaseModel):
    agency_id:   str
    agency_desc: str          # e.g. "DASHMESH", "DVS", "ATWA"
    rows:        list[ObVendorDayRow]
    mtd_actual:  float = 0.0


class ObSummary(BaseModel):
    from_date:       date
    to_date:         date
    # BAL OWN (always present)
    rows:            list[ObDayRow]
    mtd_bal_actual:  float = 0.0
    mtd_ob_plan:     float = 0.0
    mtd_bal_pct:     Optional[float] = None
    # Dynamic vendors — only those with data in the period
    vendors:         list[ObVendorData]
    vendor_names:    list[str]   # e.g. ["DASHMESH", "DVS"] — for section title
