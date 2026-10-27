"""Response shapes for the Mines Executive Summary.

KEEP EVERY FIELD DECLARED. FastAPI's response_model drops any key the model does
not name, silently and with no error — the field simply never reaches the screen,
which then renders an empty column and looks like a data problem.
"""
from pydantic import BaseModel
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
    #: Planned tonnage for this grade, and actual against it. Production rows
    #: only — despatch has its own plan table and does not use these.
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

    `plan` and `pct` are None on De-Silting because no plan table exists for it
    — see _excavation() in services/executive_summary.py. `no_plan` says that
    is by nature rather than a figure that has not arrived yet, so the screen
    can explain the blank instead of leaving the reader to guess.
    """
    key:     str                       # 'ob' | 'desilt'
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
    production:       list[GradeRow]
    production_total: WeightedTotal
    despatch:         dict[str, list[GradeRow]]
    despatch_total:   dict[str, WeightedTotal]
    plant:            list[PlantRow]
    plant_total:      WeightedTotal
    # KEEP DECLARED — response_model drops any key this class does not name.
    excavation:       list[ExcavationRow] = []


class ExecutiveSummaryResponse(BaseModel):
    # Two as-on dates, a day apart on purpose: stock is counted at the start of
    # a day, performance is a completed day. See the service for why.
    report_day:  str
    stock_as_on: str
    mtd_from:    str
    stock: StockPosition
    td:    PeriodBlock
    mtd:   PeriodBlock
