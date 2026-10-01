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


class ColumnHead(BaseModel):
    """A column of one of the two tables: its key and what it is called."""
    key:   str
    label: str


class StockClearanceRow(BaseModel):
    """Mines Clearance Status: one status, read across the grades."""
    label:    str
    key:      str
    uom:      str = "MT"
    by_grade: dict[str, float] = {}
    total:    float = 0.0
    is_total: bool = False      # the Total Stock row, summed from the others


class StockLocationRow(BaseModel):
    """Location wise & Grade wise: one grade, read across the locations."""
    label:    str
    key:      str
    uom:      str = "MT"
    cells:    dict[str, float] = {}
    total:    float = 0.0
    is_total: bool = False      # the foot row


class StockClearanceTable(BaseModel):
    grades: list[ColumnHead] = []
    rows:   list[StockClearanceRow] = []


class StockLocationTable(BaseModel):
    columns: list[ColumnHead] = []
    rows:    list[StockLocationRow] = []


class ProposedDespatch(BaseModel):
    """What the mine proposed to send on the snapshot day, split by plant.

    Not a stock figure — an intention for the day, kept apart so it can never be
    summed into the position. `total` is SKD + BLS, computed, never stored.
    """
    total:          float = 0.0
    by_destination: dict[str, float] = {}
    labels:         dict[str, str] = {}
    has_data:       bool = False


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

    # The two tables shown side by side — one grade x bucket grid read along
    # two axes. They MUST be declared here: this model is the response_model,
    # so anything it does not name is dropped from the response and the page
    # renders headers with nothing under them.
    clearance:     StockClearanceTable = StockClearanceTable()
    location_grid: StockLocationTable  = StockLocationTable()
    proposed_despatch: ProposedDespatch = ProposedDespatch()
