from pydantic import BaseModel
from datetime import date
from typing import Optional


# ── Single KPI value ─────────────────────────────────────────
class KpiCard(BaseModel):
    today_actual:   Optional[float] = None
    today_plan:     Optional[float] = None
    today_pct:      Optional[float] = None   # actual/plan × 100
    mtd_actual:     Optional[float] = None
    mtd_plan:       Optional[float] = None
    mtd_pct:        Optional[float] = None
    unit:           str
    # Grade breakdown — only populated for the Ore card
    hg_actual:      Optional[float] = None
    mg_actual:      Optional[float] = None
    lg_actual:      Optional[float] = None


# ── Production summary (all KPIs in one response) ─────────────
class ProductionSummary(BaseModel):
    as_on:      date
    from_date:  date
    to_date:    date
    ore:        KpiCard
    ob:         KpiCard
    cob:        KpiCard
    de_silt:    KpiCard   # will be null until table info provided


# ── Day-wise row (for charts + summary table) ────────────────
class ProductionDayRow(BaseModel):
    date:           date
    # Ore
    ore_actual:     Optional[float] = None
    ore_plan:       Optional[float] = None
    ore_hg:         Optional[float] = None
    ore_mg:         Optional[float] = None
    ore_lg:         Optional[float] = None
    # OB
    ob_actual:      Optional[float] = None
    ob_plan:        Optional[float] = None
    # COB
    cob_actual:     Optional[float] = None
    cob_plan:       Optional[float] = None
    # De-silt (pending)
    silt_actual:    Optional[float] = None
    silt_plan:      Optional[float] = None


# ── Day-wise response wrapper ────────────────────────────────
class ProductionDaywise(BaseModel):
    from_date:  date
    to_date:    date
    rows:       list[ProductionDayRow]
    # MTD totals — default 0.0 so empty date ranges never crash
    mtd_ore_actual: float = 0.0
    mtd_ore_plan:   float = 0.0
    mtd_ob_actual:  float = 0.0
    mtd_ob_plan:    float = 0.0
    mtd_cob_actual: float = 0.0
    mtd_cob_plan:   float = 0.0
    # Grade MTD
    mtd_hg:         float = 0.0
    mtd_mg:         float = 0.0
    mtd_lg:         float = 0.0


# ── Grade breakdown for charts ────────────────────────────────
class GradeDayRow(BaseModel):
    date:       date
    hg_actual:  Optional[float] = None
    mg_actual:  Optional[float] = None
    lg_actual:  Optional[float] = None
    hg_plan:    Optional[float] = None
    mg_plan:    Optional[float] = None
    lg_plan:    Optional[float] = None
    total:      Optional[float] = None


class GradeBreakdown(BaseModel):
    from_date:  date
    to_date:    date
    rows:       list[GradeDayRow]
    mtd_hg:     float = 0.0
    mtd_mg:     float = 0.0
    mtd_lg:     float = 0.0
    mtd_total:  float = 0.0


# ── Re-handling excavation (pp_prod_order_confirmation · MINE_EXV) ──
class RehandlingDayRow(BaseModel):
    date:     date
    total_m3: Optional[float] = None


class RehandlingDaywise(BaseModel):
    from_date:  date
    to_date:    date
    rows:       list[RehandlingDayRow]
    mtd_total:  float = 0.0
