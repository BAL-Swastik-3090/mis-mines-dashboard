from pydantic import BaseModel
from datetime import date
from typing import Optional


class StockGradeRow(BaseModel):
    """Mine stock for one grade — Section B read down its grade column."""
    grade_key:   str            # "HG" | "MG" | "LG" | "COB"
    grade_label: str            # "High Grade"
    mines:       float = 0.0


class StockStatusRow(BaseModel):
    """One Section B row — a clearance status."""
    label: str
    qty:   float = 0.0


class StockLocations(BaseModel):
    mines:      float = 0.0
    bal_plant:  float = 0.0
    suk_plant:  float = 0.0
    lg_for_cob: float = 0.0
    total:      float = 0.0     # mines + bal + suk + lg_for_cob


class StockPosition(BaseModel):
    # Entry is not daily, so the snapshot shown may predate the requested date.
    snapshot_date:  Optional[date] = None
    requested_date: Optional[date] = None
    days_stale:     Optional[int]  = None
    is_stale:       bool = False
    has_data:       bool = False

    # Section B, the four status rows summed across HG+MG+LG+COB. Also the
    # Mines location figure — same quantity, reported in both places.
    total_stock: float = 0.0

    grades:    list[StockGradeRow]  = []
    statuses:  list[StockStatusRow] = []
    locations: StockLocations       = StockLocations()
