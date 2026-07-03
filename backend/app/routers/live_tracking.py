from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..services.live_tracking import get_live_tracking

router = APIRouter(prefix="/api/live-tracking", tags=["live-tracking"])


@router.get("")
def live_tracking(db: Session = Depends(get_db)):
    return get_live_tracking(db)
