from pydantic import BaseModel
from datetime import date
from typing import Optional


class OEEMachineRow(BaseModel):
    machine:        str
    ideal_cap:      float
    god_hours:      float
    holiday_hrs:    float
    no_plan_hrs:    float
    planned_sd_hrs: float
    loss_hrs:       float
    ideal_time:     float
    bd_hours:       float
    pm_hours:       float
    operating_hrs:  float
    actual_cum:     float
    ideal_cum:      float
    availability:   float
    performance:    float
    quality:        float
    oee:            float
    # reporting only — feeds no OEE formula
    deviation_hrs:  float
    running_hrs:    float
    shift_hours:    float
    deviation_pct:  Optional[float] = None


class OEEFleet(BaseModel):
    """Weighted roll-up. Percentages are recomputed from summed hours and volume,
    never averaged across machines."""
    god_hours:     float
    loss_hrs:      float
    ideal_time:    float
    bd_hours:      float
    pm_hours:      float
    operating_hrs: float
    actual_cum:    float
    ideal_cum:     float
    availability:  float
    performance:   float
    quality:       float
    oee:           float
    deviation_hrs: float
    shift_hours:   float
    deviation_pct: Optional[float] = None
    machine_count: int


class OEEResponse(BaseModel):
    from_date: date
    to_date:   date
    machines:  list[OEEMachineRow]
    fleet:     OEEFleet
