from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
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


async def _market_collector():
    """Fetch prices and news on each source's own schedule.

    Every hour it asks which sources are due and runs those; the cadence
    belongs to the source row, so changing how often IBM is checked is an
    UPDATE rather than a release. A failing source is recorded against itself
    and never stops the others — government sites go down, and three working
    collectors are better than none.

    The first pass waits two minutes so startup is not competing with it.
    """
    from app.minehub_db import SessionLocal as MineHubSession
    from app.services import market as market_svc
    await asyncio.sleep(120)
    while True:
        try:
            if MineHubSession is not None:
                db = MineHubSession()
                try:
                    ran = market_svc.run_all(db)
                    if ran:
                        ok = sum(1 for r in ran if r.get("ok"))
                        logger.info("market collectors: %d of %d answered", ok, len(ran))
                finally:
                    db.close()
        except Exception as exc:
            logger.warning("market collector pass failed: %s", exc)
        await asyncio.sleep(3600)


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
    market_task = asyncio.create_task(_market_collector())
    # Release pooled connections when the app goes quiet. The MySQL instance is
    # shared and has been refusing connections, so holding idle ones costs
    # somebody else their connection.
    reaper_task = asyncio.create_task(idle_connection_reaper())

    yield

    # ── Shutdown ─────────────────────────────────────────────
    digest_task.cancel()
    market_task.cancel()
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


# ── Authentication gate ───────────────────────────────────────
# Every /api route requires a valid intranet session except the handshake itself,
# the health probe and the API docs. This is the only thing standing between the
# data and anyone who can reach the host, so it is enforced here rather than per
# router — a new router is protected the moment it is added.
_AUTH_EXEMPT = ("/api/auth/", "/api/health", "/api/docs", "/api/redoc", "/api/openapi.json")

# The permission a path prefix requires. Permissions rather than role names, so
# a new role created in the UI can be given exactly these without any code
# change — which is the whole point of roles being data.
#
# Page access is separate and data-driven: a page maps to a dashboard.* code,
# resolved through PREFIX_PAGE in services/auth.py.
_PERMISSION_RULES: tuple[tuple[str, str], ...] = (
    ("/api/access",  "access.users.view"),   # finer checks are inside the router
    ("/api/roles",   "access.users.manage"),
    ("/api/minehub", "platform.registry.view"),
    # The competency dimensions and handover checks. Reading them is reading
    # the platform's vocabulary, which migration 038 established every register
    # needs — an operator registrar cannot assess anybody without it. Changing
    # them is gated per kind inside the router.
    ("/api/checklists", "platform.registry.view"),
    # The attendance register reads the gate readers and joins them to the
    # manpower register, so it needs what the manpower register needs. Nothing
    # here writes anything.
    # Reading the attendance register needs what the manpower register needs.
    # Raising and approving corrections are checked per action inside the
    # router, because they are held by different people on purpose.
    ("/api/attendance", "platform.operators.view"),
    # Operator profiles hold dates of birth, medical expiry and photographs, so
    # the view permission is deliberately not part of a dashboard role.
    ("/api/operators", "platform.operators.view"),
    # The shift board shows who is on which machine, so it sits behind its own
    # permission rather than inside a dashboard role.
    ("/api/ops", "ops.shift.view"),
    # The roster says where people will be on days they have not worked yet, so
    # it sits behind its own permission rather than the shift board's.
    ("/api/workforce", "ops.roster.view"),
    # Notes are readable by anybody who can open the platform at all — writing
    # is what carries a permission, checked inside the router.
)

# A page is reachable with the matching dashboard permission.
_PAGE_PERMISSION = {
    "mis": "dashboard.mis",
    "oee": "dashboard.oee",
    "intelligence": "dashboard.intelligence",
    "fuel-management": "dashboard.fuel",
    "ev-tracking": "dashboard.ev",
}
# The session-touch throttle now lives in services/auth.py (touch_due), keyed on
# when we last wrote rather than on the cached row's last_active_at — which is
# frozen at the moment it was cached and would make the throttle fire every time.


def _check_auth(sid: str | None, path: str) -> tuple[dict | None, str | None, set | None]:
    """Session + permission check. Returns (session, denial_reason).

    Both databases are remote — MySQL about 100ms away, Postgres about 50ms —
    so the cost here is dominated by round trips, not by work. The common case
    is therefore answered entirely from cache with no connection opened at all.
    Before that, every API call re-asked a question whose answer cannot change
    between two requests made milliseconds apart, and one dashboard page firing
    fifteen calls paid for it fifteen times.
    """
    from app.database import SessionLocal
    from app.services import access as access_svc
    from app.services import auth as auth_svc

    s = auth_svc.peek_session(sid)
    perms = access_svc.peek_permissions(s["emp_id"]) if s else None

    if s is None or perms is None:
        # Cold: ask the databases, and cache the answers for the next caller.
        with SessionLocal() as db:
            s = auth_svc.get_session(db, sid)
            if not s:
                return None, None, None
            perms = access_svc.permissions_for(db, s["emp_id"])
            if auth_svc.touch_due(sid):
                auth_svc.touch(db, sid)
    elif auth_svc.touch_due(sid):
        # Warm, but the activity timestamp is stale enough to be worth a write.
        # Without this an active user would idle out while still working.
        with SessionLocal() as db:
            auth_svc.touch(db, sid)

    # Invite-only, checked on every request rather than only at login, so
    # revoking someone takes effect at once instead of when their session
    # eventually expires. No permissions at all means no access.
    if not perms:
        return s, "revoked", perms

    need = next((c for pre, c in _PERMISSION_RULES if path.startswith(pre)), None)
    if need and need not in perms:
        return s, need, perms

    # Page access, enforced on the API prefix behind each page — hiding the
    # sidebar entry alone would leave the data reachable to anyone who knows
    # the URL.
    page = auth_svc.page_for_path(path)
    if page and _PAGE_PERMISSION.get(page) not in perms:
        return s, f"page:{page}", perms
    return s, None, perms


@app.middleware("http")
async def require_auth(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api") and not any(path.startswith(e) for e in _AUTH_EXEMPT):
        sid = request.cookies.get("mines_session")
        # The check is blocking DB I/O over the WAN. Run it off the event loop so
        # it cannot stall every other in-flight request behind it.
        session, role_error, perms = await run_in_threadpool(_check_auth, sid, path)
        if not session:
            return JSONResponse({"detail": "Not authenticated."}, status_code=401)
        if role_error:
            if role_error == "revoked":
                detail = ("Your access to the Mines Dashboard has been removed. "
                          "Please contact Mr. Sudip Hajra (PPIC) if this is unexpected.")
            elif role_error.startswith("page:"):
                detail = f"You do not have access to the {role_error[5:]} page."
            else:
                detail = ("You do not have permission for this "
                          f"({role_error}). Ask an Access Manager to add it to your role.")
            # code lets the frontend distinguish "you have been removed" (sign
            # out) from "you cannot open that page" (stay signed in).
            body = {"detail": detail}
            if role_error == "revoked":
                body["code"] = "access_revoked"
            return JSONResponse(body, status_code=403)
        request.state.emp_id = session["emp_id"]
        # Routers that make finer distinctions than a path prefix can read these
        # rather than asking the database a question already answered here.
        request.state.permissions = perms or set()
    return await call_next(request)


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
from app.routers import attendance as attendance_router
from app.routers import attendance_corrections
from app.routers import market
from app.routers import checklists, operators_analytics
from app.routers import prev_day_actual
from app.routers import stock_entry
from app.routers import production, stock, cob, plant, ob, despatch, equipment, dewatering, insights, live_tracking, fuel_management, ev_tracking, auth, oee, roles, minehub, access, operators, operations, workforce, comments
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
# Before operators.router, whose "/{operator_id}" would otherwise match
# "/analytics" and fail trying to read it as a number.
# Before attendance_router: nothing clashes today, but "/corrections"
# living in a second module is exactly how a path collision appears later.
app.include_router(attendance_corrections.router)
app.include_router(market.router)
app.include_router(attendance_router.router)
app.include_router(checklists.router)
app.include_router(operators_analytics.router)
app.include_router(operators.router)
app.include_router(operations.router)
app.include_router(workforce.router)
app.include_router(comments.router)
app.include_router(roles.router)
app.include_router(minehub.router)
app.include_router(prev_day_actual.router)
app.include_router(stock_entry.router)
app.include_router(access.router)
