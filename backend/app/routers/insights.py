from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date

from ..database import get_db
from ..services import insights as svc
from ..services import whywhy as ww_svc
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
    """AI-generated operational insights via BAL-AI (Qwen). Serves cached result if available."""
    try:
        return await svc.generate_insights(
            db,
            from_date or _mstart(),
            to_date   or _today(),
            use_cache=not force_refresh,
        )
    except Exception as e:
        # Report WHAT failed, not a guess. See classify_llm_error.
        from app.config import get_settings
        cfg = get_settings()
        raise HTTPException(
            status_code=502,
            detail=svc.classify_llm_error(e, cfg.qwen_model, cfg.qwen_base_url),
        )


@router.get("/why-why", tags=["Insights"])
def why_why_analysis(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    """Why-Why analysis points — pure DB computation, no LLM.

    Driven by the dashboard's global date filter like every other section, but
    the register only covers a fixed span, so the service clamps the requested
    range to the data it has and reports in `window` whether it did. A month
    outside the register returns the full extent flagged `fell_back` rather than
    an empty section that looks broken.

    Deliberately separate from the narrative endpoint: this is fast and always
    succeeds, so the charts render even when the LLM gateway is down.
    """
    return ww_svc.compute_whywhy(db, from_date, to_date)


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
