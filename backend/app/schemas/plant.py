from pydantic import BaseModel
from datetime import date
from typing import Optional


class PlantUnit(BaseModel):
    total:     float = 0.0   # TON
    per_day:   float = 0.0   # TON/day
    share_pct: float = 0.0   # % of combined


class PlantPerformance(BaseModel):
    from_date:       date
    to_date:         date
    days:            int     # distinct production days in range
    combined_total:  float = 0.0
    combined_per_day:float = 0.0
    bal:             PlantUnit
    suk:             PlantUnit
