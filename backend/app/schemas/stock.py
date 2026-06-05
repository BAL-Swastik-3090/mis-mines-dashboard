from pydantic import BaseModel
from typing import Optional


class StockLocation(BaseModel):
    store_loc:      str
    store_loc_desc: str
    stock:          float = 0.0
    value:          Optional[float] = None


class StockGrade(BaseModel):
    grade_key:   str            # "HG" | "MG" | "LG" | "LUMP_H" | "LUMP_L"
    grade_label: str            # "High Grade >52%"
    total_stock: float = 0.0
    total_value: Optional[float] = None
    locations:   list[StockLocation] = []


class AllLocations(BaseModel):
    mines_total: float = 0.0   # PLANT=1200 ore + COB at CST1
    bal_plant:   float = 0.0   # PLANT=1100, MATERIAL_TYPE=ZORE
    suk_plant:   float = 0.0   # PLANT=1110, MATERIAL_TYPE=ZORE
    grand_total: float = 0.0   # mines + BAL + SUK


class StockPosition(BaseModel):
    items:         list[StockGrade]
    grand_total:   float = 0.0
    by_location:   list[StockLocation]
    all_locations: AllLocations
    note:          str = "Current inventory snapshot — date filter not applicable"
