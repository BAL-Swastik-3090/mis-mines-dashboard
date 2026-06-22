from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date

from ..database import get_db
from ..services import insights as svc
from ..schemas.insights import RealityCheckResponse, InsightsResponse

router = APIRouter(tags=["Insights"])


def _today() -> date:
    return date.today()


def _mstart() -> date:
    return _today().replace(day=1)


@router.get("/reality-check", response_model=RealityCheckResponse)
def reality_check(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    """Month-end feasibility table — pure DB math, no LLM."""
    return svc.compute_reality_check(
        db,
        from_date or _mstart(),
        to_date   or _today(),
    )


@router.get("/generate", response_model=InsightsResponse)
async def generate_insights(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    """AI-generated operational insights via LiteLLM Claude."""
    try:
        return await svc.generate_insights(
            db,
            from_date or _mstart(),
            to_date   or _today(),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {str(e)}")
