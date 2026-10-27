from pydantic import BaseModel
from datetime import date
from typing import Optional


class OEEMachineRow(BaseModel):
    machine:        str
    ideal_cap:      float
    # 'old' | 'new' — which table this row belongs to. See NEW_EXCAVATORS in
    # services/oee.py; the mine names the new machines, nothing derives it.
    generation:     str = "old"
    # KEEP THESE DECLARED. FastAPI's response_model silently drops any key the
    # model does not name — no error, the field simply never reaches the screen.
    bd_source:      str = "sap"   # 'sap' | 'imos'
    hired:          bool = False
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
    # What the buckets carried. ore+ob+other always re-add to actual_cum.
    ore_cum:   float = 0.0
    ob_cum:    float = 0.0
    other_cum: float = 0.0
    material:     Optional[str] = None    # ORE | OB | OTHER | MIXED
    material_pct: Optional[float] = None
    ore_pct:      Optional[float] = None
    ob_pct:       Optional[float] = None
    other_pct:    Optional[float] = None
    # running_hours / (god - breakdown), capped at 100 — the MIS Equipment
    # section's formula with the shift log in place of the GPS feed.
    utilisation:  Optional[float] = None
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
    # What the buckets carried. ore+ob+other always re-add to actual_cum.
    ore_cum:   float = 0.0
    ob_cum:    float = 0.0
    other_cum: float = 0.0
    material:     Optional[str] = None    # ORE | OB | OTHER | MIXED
    material_pct: Optional[float] = None
    ore_pct:      Optional[float] = None
    ob_pct:       Optional[float] = None
    other_pct:    Optional[float] = None
    # running_hours / (god - breakdown), capped at 100 — the MIS Equipment
    # section's formula with the shift log in place of the GPS feed.
    utilisation:  Optional[float] = None
    ideal_cum:     float
    availability:  float
    performance:   float
    quality:       float
    oee:           float
    deviation_hrs: float
    running_hrs:   float = 0.0
    shift_hours:   float
    deviation_pct: Optional[float] = None
    machine_count: int
    # Excavators on the roster with no shift rows in this period — see the
    # service for why they are omitted rather than shown as zeros.
    absent_machines: list[str] = []


class OEEResponse(BaseModel):
    from_date: date
    to_date:   date
    machines:  list[OEEMachineRow]
    fleet:     OEEFleet
    # The same roll-up restricted to each generation, so both tables get an
    # OVERALL row weighted by the service rather than averaged in the browser.
    fleet_old: OEEFleet
    fleet_new: OEEFleet


# ── Tipper OEE — the old (MAN) and new (PRIMA) tables ────────────────────────
# Availability and Utilisation carry the same meaning as above; Yield replaces
# Performance because a tipper is measured in trips, not volume against
# capacity. Nothing here is capped — see services/tipper_oee.py.
class TipperOEERow(BaseModel):
    machine:       str
    generation:    str            # 'old' | 'new'
    god_hours:     float
    engine_hrs:    float
    bd_hours:      float
    available_hrs: float
    ideal_trip:    float
    actual_trip:   float
    # None rather than 0 wherever the denominator makes the question empty:
    # a machine down for the whole period has no Utilisation, and one with no
    # Ideal Trip has no Yield.
    availability:  Optional[float] = None
    utilisation:   Optional[float] = None
    yield_pct:     Optional[float] = None
    oee:           Optional[float] = None
    # Which system each figure came from, because the two tables do not share
    # sources: 'telematics' | 'shift_log' for hours, 'sap' | 'shift_log' for BD.
    engine_source: str = "telematics"
    bd_source:     str = "sap"
    #: Days in the window this truck appears in the shift log at all.
    days_logged:   int = 0


class TipperOEEFleet(BaseModel):
    generation:    str
    god_hours:     float
    engine_hrs:    float
    bd_hours:      float
    available_hrs: float
    ideal_trip:    float
    actual_trip:   float
    availability:  Optional[float] = None
    utilisation:   Optional[float] = None
    yield_pct:     Optional[float] = None
    oee:           Optional[float] = None
    machine_count: int
    #: Roster trucks the shift log never mentions in this window.
    unlogged:      list[str] = []


class TipperOEEResponse(BaseModel):
    from_date:    date
    to_date:      date
    old_machines: list[TipperOEERow]
    new_machines: list[TipperOEERow]
    old_fleet:    TipperOEEFleet
    new_fleet:    TipperOEEFleet
