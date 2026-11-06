"""Response shapes for the Mines Executive Summary.

KEEP EVERY FIELD DECLARED. FastAPI's response_model drops any key the model does
not name, silently and with no error — the field simply never reaches the screen,
which then renders an empty column and looks like a data problem.
"""
from pydantic import BaseModel, Field
from typing import Optional

from app.schemas.stock import StockPosition


class GradeRow(BaseModel):
    """One grade line of a production or despatch table.

    Every figure is Optional and none defaults to zero. A blank Cr/Fe means the
    lab filed no such characteristic for those lots; a zero would claim the ore
    assayed nought.
    """
    grade: str
    label: str
    qty:   Optional[float] = None
    cr2o3: Optional[float] = None
    crfe:  Optional[float] = None
    # THE GRADE WAS BORROWED, NOT MEASURED. Despatch rows only: when a
    # consignment has no assay of its own the PO's average stands in, and this
    # is the share of the row's graded tonnage that came that way. None means
    # every tonne shown was tested. The tonnage is carried as well as the share
    # because the share is taken against ASSAYED tonnage, not total, so one
    # cannot be derived from the other.
    estimated_pct: Optional[float] = None
    estimated_qty: Optional[float] = None
    #: Planned tonnage for this grade, and actual against it.
    #: Production and COB rows read mines_daily_excavation_plan and
    #: mines_cobp_plan; despatch rows read mines_despatch_plan, split by
    #: customer. None means no plan row exists for the window — never zero,
    #: which would read as "planned nothing" (June 2026 has no despatch plan
    #: at all). The "Not yet assayed" despatch row carries no plan by nature.
    plan:    Optional[float] = None
    ach_pct: Optional[float] = None
    # WHERE THE TONNAGE CAME FROM: 'sap' | 'manual' | 'mixed'. A DIFFERENT idea
    # from estimated_qty above, which is about a borrowed ASSAY rather than a
    # hand-entered TONNAGE. A row can carry both and they must never be added.
    source:     str = "sap"
    manual_qty: Optional[float] = None
    #: Days of the window the manual figure is standing in for.
    est_days:   Optional[int] = None


class WeightedTotal(BaseModel):
    """The sheet's Weighted Average row: SUMPRODUCT / SUM, never a mean."""
    qty:   Optional[float] = None
    cr2o3: Optional[float] = None
    crfe:  Optional[float] = None
    cr:    Optional[float] = None
    estimated_pct: Optional[float] = None
    estimated_qty: Optional[float] = None
    plan:    Optional[float] = None
    ach_pct: Optional[float] = None
    #: Summed from the rows beneath, so the total says the same thing they do.
    source:     str = "sap"
    manual_qty: Optional[float] = None


class PlantRow(BaseModel):
    plant: str
    qty:   Optional[float] = None
    cr:    Optional[float] = None
    # How much of the tonnage the Cr average actually covers. An average over
    # half the output is a different claim from one over all of it.
    cr_covered_pct: Optional[float] = None


class ExcavationRow(BaseModel):
    """Overburden or De-Silting, plan against actual, in CuM.

    `no_plan` marks a blank the screen can explain instead of leaving the
    reader to guess, and it now covers both rows for two different reasons:

      desilt  permanently — no de-silting plan table exists anywhere
      ob      this month has not been entered into
              mines_daily_excavation_plan yet, which somebody can fix
      shift_* no shifting plan has been uploaded for the month, which
              somebody can fix through "Enter Shifting Plan"

    The second used to report a plan of 0 instead. Through 1-3 November 2026,
    before the month was loaded, the screen showed 0 CuM planned against 966
    CuM moved — which reads as a plan nobody kept rather than a plan nobody
    wrote. A month with no plan is not a plan of nought.
    """
    #: 'ob' | 'desilt' | 'shift_lg' | 'shift_tailings' | 'shift_rehandling'.
    #: A plain string rather than an enum: the three shifting rows are
    #: dropped entirely when minehub cannot be read, and the screen keys
    #: off whatever arrives.
    key:     str
    label:   str
    unit:    str = "CuM"
    plan:    Optional[float] = None
    actual:  Optional[float] = None
    pct:     Optional[float] = None
    no_plan: bool = False
    #: 'sap' | 'manual' | 'mixed' — the mine's own figure stands in for days
    #: SAP has not posted, exactly as it does on the production table.
    source:     str = "sap"
    manual_qty: Optional[float] = None


class PeriodBlock(BaseModel):
    """One column of the report — TD or MTD — across all three performance
    blocks. Despatch is keyed by CUSTOMERNO (BAL, JABAMOYEE)."""
    #: HG, MG and LG only. COB is concentrate from plant 1210, not ore raised
    #: at the mine, and is reported in its own block below so the two are not
    #: averaged together — see ORE_GRADES in services/executive_summary.py.
    production:       list[GradeRow]
    production_total: WeightedTotal
    cob:              list[GradeRow] = []
    cob_total:        WeightedTotal = WeightedTotal()
    despatch:         dict[str, list[GradeRow]]
    despatch_total:   dict[str, WeightedTotal]
    plant:            list[PlantRow]
    plant_total:      WeightedTotal
    # KEEP DECLARED — response_model drops any key this class does not name.
    excavation:       list[ExcavationRow] = []


class DewateringLine(BaseModel):
    """One measure of the dewatering block, for one period."""
    key:    str
    label:  str
    uom:    str
    dp:     int = 0
    plan:   Optional[float] = None
    actual: Optional[float] = None
    pct:    Optional[float] = None
    #: No plan exists for this measure and none ever will — inflow is seepage
    #: and weather. Different from a plan nobody has filed yet.
    no_plan: bool = False
    #: Beating this plan means coming in BELOW it — closing stock is the one
    #: such measure. `pct` is then the signed VARIANCE against plan, not an
    #: achievement, and below plan is the good direction.
    inverse: bool = False


class DewateringPeriod(BaseModel):
    rows: list[DewateringLine] = []
    date: Optional[str] = None          # the day column
    entered: Optional[bool] = None      # was that day filed at all
    from_: Optional[str] = Field(None, alias="from")
    to: Optional[str] = None

    model_config = {"populate_by_name": True}


class DewateringKpi(BaseModel):
    disposal_actual:  Optional[float] = None
    disposal_plan:    Optional[float] = None
    disposal_pct:     Optional[float] = None
    pump_actual_hr:   Optional[float] = None
    pump_plan_hr:     Optional[float] = None
    pump_pct:         Optional[float] = None
    avg_pump_hr:      Optional[float] = None
    avg_plan_hr:      Optional[float] = None
    #: Hours a day the pumps must run merely to match the water arriving.
    offset_hr:        Optional[float] = None
    opening_stock:    Optional[float] = None
    closing_stock:    Optional[float] = None
    #: Opening + seepage + rain water − PLAN disposal: where the sump would
    #: have been left had the plan been pumped against the water that really
    #: arrived.
    plan_closing_stock: Optional[float] = None
    stock_change_pct: Optional[float] = None
    net_drawdown:     Optional[float] = None
    days_to_clear:    Optional[float] = None
    completeness_pct: Optional[float] = None


class DewateringBlock(BaseModel):
    """Dewatering, on its own window.

    THE DAYS ENTERED ARE NOT THE DAYS ASKED FOR, which is the whole reason
    this block reports both. `entered` of `window_days` days carry figures;
    everything else here covers those days only, and `gap_from`..`gap_to`
    names the stretch that does not.
    """
    available:   bool = True
    entered:     int = 0
    window_days: int = 0
    data_to:     Optional[str] = None
    gap_from:    Optional[str] = None
    gap_to:      Optional[str] = None
    td:   Optional[DewateringPeriod] = None
    mtd:  Optional[DewateringPeriod] = None
    kpi:  Optional[DewateringKpi] = None
    #: 'ok' | 'watch' | 'critical' — how complete the data is, not how well
    #: the mine pumped.
    status: str = "critical"


class ExecutiveSummaryResponse(BaseModel):
    # Two as-on dates, a day apart on purpose: stock is counted at the start of
    # a day, performance is a completed day. See the service for why.
    report_day:  str
    stock_as_on: str
    mtd_from:    str
    stock: StockPosition
    td:    PeriodBlock
    mtd:   PeriodBlock
    # KEEP DECLARED — response_model drops any key this class does not name,
    # silently. None means the platform database could not be read, which is
    # not the same as a mine that pumped nothing.
    dewatering: Optional[DewateringBlock] = None
