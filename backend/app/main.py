from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager
import logging

from app.config import get_settings
from app.database import test_connection

settings = get_settings()
logger = logging.getLogger("mines_dashboard")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────
    db_status = test_connection()
    if db_status["status"] == "connected":
        logger.info(f"✅ Database connected: {db_status['db']} @ {db_status['host']}")
    else:
        logger.error(f"❌ Database connection failed: {db_status['detail']}")

    yield

    # ── Shutdown ─────────────────────────────────────────────
    logger.info("Shutting down Mines Dashboard API")


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
    }


# ── Routers ───────────────────────────────────────────────────
from app.routers import production, stock, cob, plant, ob, despatch, equipment, dewatering, insights
app.include_router(production.router,  prefix="/api/production",  tags=["Production"])
app.include_router(stock.router,       prefix="/api/stock",       tags=["Stock"])
app.include_router(cob.router,         prefix="/api/cob",         tags=["COB Plant"])
app.include_router(plant.router,       prefix="/api/plant",       tags=["Plant Performance"])
app.include_router(ob.router,          prefix="/api/ob",          tags=["OB Excavation"])
app.include_router(despatch.router,    prefix="/api/despatch",    tags=["Despatch"])
app.include_router(equipment.router,   prefix="/api/equipment",   tags=["Equipment"])
app.include_router(dewatering.router,  prefix="/api/dewatering",  tags=["Dewatering"])
app.include_router(insights.router,    prefix="/api/insights",    tags=["Insights"])
