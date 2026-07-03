from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..services.fuel_management import get_fuel_overview

router = APIRouter(prefix="/api/fuel-management", tags=["Fuel Management"])


@router.get("")
def fuel_management_overview(db: Session = Depends(get_db)):
    return get_fuel_overview(db)
