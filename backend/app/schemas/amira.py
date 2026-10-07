"""Response shapes for AMIRA accounting.

KEEP EVERY FIELD DECLARED. FastAPI's response_model drops any key the model
does not name, silently and with no error — the field simply never reaches the
screen, which then renders an empty column and looks like a data problem.
"""
from pydantic import BaseModel
from typing import Optional


class AmiraStage(BaseModel):
    key:   str
    label: str
    # False for the five stages not yet sourced. The row is still returned, so
    # the table keeps the shape of the whole chain instead of hiding the gap.
    available: bool
    ore_qty:   Optional[float] = None
    cr2o3:     Optional[float] = None
    moisture:  Optional[float] = None
    net_chromium: Optional[float] = None
    # Against the stage immediately before this one; None when that stage is
    # itself unavailable.
    chromium_loss:     Optional[float] = None
    contribution_loss: Optional[float] = None


class AmiraResponse(BaseModel):
    from_date: str
    to_date:   str
    stages:    list[AmiraStage]
    cr2o3_to_cr:       float
    contribution_rate: float
    pending_stages:    list[str]
    plant_qty_mirrors_despatch: bool
