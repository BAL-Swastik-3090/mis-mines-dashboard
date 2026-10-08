"""Response shapes for AMIRA accounting.

KEEP EVERY FIELD DECLARED. FastAPI's response_model drops any key the model
does not name, silently and with no error — the field simply never reaches the
screen, which then renders an empty column and looks like a data problem. The
route declares this model, so a key added to the service and forgotten here is
invisible rather than broken.
"""
from pydantic import BaseModel
from typing import Optional


class AmiraStage(BaseModel):
    key:   str
    label: str
    # False for the stages not yet sourced. The row is still returned, so the
    # table keeps the shape of the whole chain instead of hiding the gap.
    available: bool
    ore_qty:   Optional[float] = None
    cr2o3:     Optional[float] = None
    moisture:  Optional[float] = None
    net_chromium: Optional[float] = None
    # Against the stage immediately before this one; None when that stage is
    # itself unavailable.
    chromium_loss:     Optional[float] = None
    contribution_loss: Optional[float] = None


class AmiraTotal(BaseModel):
    """The workbook's Total column — Summary!J9 and J10, the two loss rows.

    Ore Quantity, Cr2O3 and Moisture have no total in the sheet and must not
    gain one here: ore summed along the chain counts the same ore five times
    over, and a row of percentages does not sum to anything.
    """
    chromium_loss:     Optional[float] = None
    contribution_loss: Optional[float] = None


class AmiraResponse(BaseModel):
    from_date: str
    to_date:   str
    stages:    list[AmiraStage]
    total:     AmiraTotal
    cr2o3_to_cr: float
    # The three terms behind Contribution Loss, published rather than reduced to
    # the single factor they currently multiply out to. When NSR moves, the
    # screen has to be able to show which input changed.
    nsr_per_mt_fecr:           float
    variable_cost_per_mt_fecr: float
    contribution_per_mt_fecr:  float
    fecr_cr_content:           float
    pending_stages:    list[str]
    plant_qty_mirrors_despatch: bool
