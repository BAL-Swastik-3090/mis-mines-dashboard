from pydantic import BaseModel
from datetime import date
from typing import Optional


# ── Excavator ──────────────────────────────────────────────────

class ExcavatorMachineRow(BaseModel):
    vehicle_desc:   str
    display_name:   str
    sap_name:       str            = ""
    eng_hr_mtd:     float          = 0.0
    bd_hr:          float          = 0.0
    bd_count:       int            = 0
    bd_count_start: int            = 0     # count by MALFUNCTION_START presence
    avail_pct:      Optional[float] = None
    util_pct:       Optional[float] = None
    mttr:           Optional[float] = None
    mtbf:           Optional[float] = None


class ExcavatorSummaryResponse(BaseModel):
    from_date:       date
    to_date:         date
    machines:        list[ExcavatorMachineRow]
    total_eng_hr:    float          = 0.0
    total_bd_hr:     float          = 0.0
    active_count:    int            = 0
    total_count:     int            = 0
    total_bd_count:  int            = 0
    fleet_mttr:      Optional[float] = None
    fleet_mtbf:      Optional[float] = None


class ExcavatorTrendResponse(BaseModel):
    from_date:     date
    to_date:       date
    machine_names: list[str]
    dates:         list[str]                           # "YYYY-MM-DD"
    series:        dict[str, list[Optional[float]]]    # display_name → [hrs per date]


class ExcavatorFuelRow(BaseModel):
    vehicle_desc:  str
    eng_hr_mtd:    float          = 0.0
    fuel_mtd:      float          = 0.0
    lph_avg:       Optional[float] = None


class ExcavatorFuelResponse(BaseModel):
    from_date:    date
    to_date:      date
    machines:     list[ExcavatorFuelRow]
    avg_lph:      Optional[float] = None
    fleet_count:  int             = 0
    oem_lph:      float           = 25.0
    total_fuel:   float           = 0.0


# ── Tipper ─────────────────────────────────────────────────────

class TipperMachineRow(BaseModel):
    vehicle_desc:   str
    sap_name:       str            = ""
    eng_hr_mtd:     float          = 0.0
    bd_hr:          float          = 0.0
    bd_count:       int            = 0
    bd_count_start: int            = 0
    avail_pct:      Optional[float] = None
    util_pct:       Optional[float] = None
    mttr:           Optional[float] = None
    mtbf:           Optional[float] = None


class BreakdownEvent(BaseModel):
    notification_no: str
    start:   Optional[str]   = None
    end:     Optional[str]   = None
    bd_hrs:  Optional[float] = None
    reason:  Optional[str]   = None


class BreakdownDetailsResponse(BaseModel):
    machine:    str
    from_date:  date
    to_date:    date
    events:     list[BreakdownEvent]


class TipperSummaryResponse(BaseModel):
    from_date:       date
    to_date:         date
    machines:        list[TipperMachineRow]
    total_eng_hr:    float          = 0.0
    total_bd_hr:     float          = 0.0
    active_count:    int            = 0
    total_count:     int            = 0
    total_bd_count:  int            = 0
    fleet_mttr:      Optional[float] = None
    fleet_mtbf:      Optional[float] = None


class TipperFuelRow(BaseModel):
    vehicle_desc: str
    eng_hr_mtd:   float          = 0.0
    fuel_mtd:     float          = 0.0
    dist_mtd:     float          = 0.0
    lph_avg:      Optional[float] = None
    kmpl_avg:     Optional[float] = None


class TipperFuelResponse(BaseModel):
    from_date:   date
    to_date:     date
    machines:    list[TipperFuelRow]
    avg_lph:     Optional[float] = None
    avg_kmpl:    Optional[float] = None
    fleet_count: int   = 0
    oem_lph:     float = 8.0


# ── Dumper-wise trip count ────────────────────────────────────
class DumperTripColumn(BaseModel):
    key:   str
    label: str


class DumperTripRow(BaseModel):
    dumper_name: str
    # keyed by the material column name, so the frontend renders whatever
    # columns the service declares rather than hardcoding seven of them
    materials:   dict[str, float] = {}
    total_trips: float = 0.0
    active_days: int = 0
    shift_rows:  int = 0


class DumperTripResponse(BaseModel):
    from_date: str
    to_date:   str
    columns:   list[DumperTripColumn] = []
    rows:      list[DumperTripRow] = []
    totals:    dict[str, float] = {}
    total_trips:    float = 0.0
    dumpers_total:  int = 0
    dumpers_active: int = 0
    # Pre-July 2026 rows naming several machines at once; their trips cannot be
    # attributed to one dumper, so they are excluded and counted here instead.
    unattributed_rows:  int = 0
    unattributed_trips: float = 0.0
