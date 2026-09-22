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

    Driven by the dashboard's global date filter and nothing else. Where the
    filter overlaps the register the overlap is returned and `window.clamped`
    says so; where it does not overlap at all the response is empty with
    `window.no_overlap`, and the UI names the register's range. The section
    never substitutes a different period for the one that was asked for.

    Deliberately separate from the narrative endpoint: this is fast and always
    succeeds, so the charts render even when the LLM gateway is down.
    """
    return ww_svc.compute_whywhy(db, from_date, to_date)


@router.get("/why-why/register", tags=["Insights"])
def why_why_register(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    """Every breakdown in the window with its Why-Why ladder and recorded cause.

    Its own endpoint rather than part of /why-why: the analysis payload is
    refetched on every date change and must stay small, while this is ~143 KB
    for 345 records and is only wanted once somebody opens the register.
    Filtering is done in the browser after it loads.
    """
    return ww_svc.breakdown_register(db, from_date, to_date)


@router.get("/why-why/narrative", tags=["Insights"])
async def why_why_narrative(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    """BAL-AI's reading of the Why-Why figures, returned with the figures.

    Deliberately a second request rather than part of /why-why: this one takes
    ~9 seconds and depends on a gateway that can be down, while the charts must
    render immediately and always. The facts travel back with the prose so any
    claim can be checked against the numbers that produced it.
    """
    try:
        return await ww_svc.generate_narrative(db, from_date, to_date)
    except Exception as e:
        from app.config import get_settings
        cfg = get_settings()
        raise HTTPException(
            status_code=502,
            detail=svc.classify_llm_error(e, cfg.qwen_model, cfg.qwen_base_url),
        )


@router.get("/why-why/training", tags=["Insights"])
async def why_why_training(
    from_date: date = None,
    to_date:   date = None,
    db: Session = Depends(get_db),
):
    """Training topics derived from the operating-error breakdowns themselves.

    A different question for a different reader than /narrative: that one tells
    a manager what the fleet is doing, this tells a supervisor what to teach.
    The model is instructed not to name or rank operators - the incidents are
    the evidence, not the people present at them.
    """
    try:
        return await ww_svc.generate_training(db, from_date, to_date)
    except Exception as e:
        from app.config import get_settings
        cfg = get_settings()
        raise HTTPException(
            status_code=502,
            detail=svc.classify_llm_error(e, cfg.qwen_model, cfg.qwen_base_url),
        )


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
