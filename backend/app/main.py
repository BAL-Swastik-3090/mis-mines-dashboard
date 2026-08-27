from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import asyncio
import logging
import sys
from datetime import datetime, time, timedelta, date

from app.config import get_settings
from app.database import test_connection, idle_connection_reaper, engine, pool_status

settings = get_settings()
logger = logging.getLogger("mines_dashboard")


async def _daily_insights_digest():
    """
    Enhancement #6: Pre-generate AI Insights at 07:00 AM daily so the GM's
    8 AM review sees an instant result instead of a 25-second LLM wait.
    """
    from app.database import SessionLocal
    from app.services.insights import generate_insights

    while True:
        now  = datetime.now()
        next_7am = datetime.combine(
            now.date() if now.hour < 7 else (now + timedelta(days=1)).date(),
            time(7, 0),
        )
        wait_secs = (next_7am - now).total_seconds()
        logger.info(f"Insights digest scheduler: next run at {next_7am.strftime('%Y-%m-%d 07:00')}")
        await asyncio.sleep(wait_secs)

        try:
            today = date.today()
            # Context manager rather than try/finally: the previous form assigned
            # db inside the try, so a failure in SessionLocal() left db undefined
            # and the cleanup raised NameError instead of releasing anything.
            with SessionLocal() as db:
                result = await generate_insights(
                    db,
                    today.replace(day=1),
                    today,
                    use_cache=False,  # always regenerate at 7 AM
                )
            logger.info(f"✅ 7AM digest generated for {today} (model: {result.model_used})")
        except Exception as exc:
            logger.error(f"❌ 7AM digest failed: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup — retry up to 5 times for transient errors (e.g. too many connections) ──
    db_status = {"status": "error"}
    for attempt in range(1, 6):
        db_status = test_connection()
        if db_status["status"] == "connected":
            logger.info(f"✅ Database connected: {db_status['db']} @ {db_status['host']}")
            break
        logger.warning(f"⚠️  DB connect attempt {attempt}/5 failed: {db_status.get('detail')} — retrying in 5s")
        await asyncio.sleep(5)
    else:
        logger.critical(f"❌ Database connection failed after 5 attempts — aborting startup")
        sys.exit(1)

    # Start 7AM digest scheduler as a background task
    digest_task = asyncio.create_task(_daily_insights_digest())
    # Release pooled connections when the app goes quiet. The MySQL instance is
    # shared and has been refusing connections, so holding idle ones costs
    # somebody else their connection.
    reaper_task = asyncio.create_task(idle_connection_reaper())

    yield

    # ── Shutdown ─────────────────────────────────────────────
    digest_task.cancel()
    reaper_task.cancel()
    # Close every pooled connection rather than leaving the server to time them
    # out eight hours later.
    engine.dispose()
    logger.info("Shutting down Mines Dashboard API — connection pool disposed")


app = FastAPI(
    title="Kaliapani Mines — Operational Dashboard API",
    description="Backend API for Balasore Alloys Limited — Kaliapani Chromite Mines Dashboard",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


# ── Global exception handler (prevents raw tracebacks leaking) ──
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.method} {request.url.path}", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please try again later."},
    )


# ── Health Check ─────────────────────────────────────────────
@app.get("/api/health", tags=["System"])
def health_check():
    db_status = test_connection()
    return {
        "status": "ok",
        "app": "Mines Dashboard API",
        "version": "1.0.0",
        "environment": settings.app_env,
        "database": db_status,
        # Live pool state. checked_in is what this process is holding idle; it
        # should fall to 0 a few minutes after the last request.
        "pool": pool_status(),
    }


# ── Routers ───────────────────────────────────────────────────
from app.routers import production, stock, cob, plant, ob, despatch, equipment, dewatering, insights, live_tracking, fuel_management, ev_tracking, auth, oee
app.include_router(production.router,      prefix="/api/production",    tags=["Production"])
app.include_router(stock.router,           prefix="/api/stock",         tags=["Stock"])
app.include_router(cob.router,             prefix="/api/cob",           tags=["COB Plant"])
app.include_router(plant.router,           prefix="/api/plant",         tags=["Plant Performance"])
app.include_router(ob.router,              prefix="/api/ob",            tags=["OB Excavation"])
app.include_router(despatch.router,        prefix="/api/despatch",      tags=["Despatch"])
app.include_router(equipment.router,       prefix="/api/equipment",     tags=["Equipment"])
app.include_router(dewatering.router,      prefix="/api/dewatering",    tags=["Dewatering"])
app.include_router(insights.router,        prefix="/api/insights",      tags=["Insights"])
app.include_router(live_tracking.router)
app.include_router(fuel_management.router)
app.include_router(ev_tracking.router)
app.include_router(auth.router)
app.include_router(oee.router)
