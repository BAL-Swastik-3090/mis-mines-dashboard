from fastapi import APIRouter, Depends, HTTPException, Query
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
    from_date:     date = None,
    to_date:       date = None,
    force_refresh: bool = Query(default=False, description="Bypass cache and regenerate"),
    db: Session = Depends(get_db),
):
    """AI-generated operational insights via LiteLLM. Serves cached result if available."""
    try:
        return await svc.generate_insights(
            db,
            from_date or _mstart(),
            to_date   or _today(),
            use_cache=not force_refresh,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {str(e)}")


@router.post("/cache/invalidate", tags=["Insights"])
def invalidate_insights_cache(target_date: date = None):
    """Clear the cached insights for a given date (defaults to today)."""
    key = f"insights:{target_date or _today()}"
    svc._insights_cache.pop(key, None)
    try:
        import redis as redis_lib
        from ..config import get_settings
        s = get_settings()
        r = redis_lib.Redis(
            host=s.redis_host, port=s.redis_port,
            password=s.redis_password or None,
            socket_connect_timeout=1,
        )
        r.delete(key)
    except Exception:
        pass
    return {"invalidated": key}
