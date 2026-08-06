from pydantic import BaseModel
from datetime import date


class OEEMachineRow(BaseModel):
    machine:        str
    ideal_cap:      float
    god_hours:      float
    holiday_hrs:    float
    no_plan_hrs:    float
    planned_sd_hrs: float
    bd_hours:       float
    pm_hours:       float
    operating_hrs:  float
    actual_cum:     float
    ideal_cum:      float
    availability:   float
    performance:    float
    quality:        float
    oee:            float


class OEEResponse(BaseModel):
    from_date: date
    to_date:   date
    machines:  list[OEEMachineRow]
