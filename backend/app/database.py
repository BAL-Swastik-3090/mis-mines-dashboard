"""
Database engine and session handling.

The MySQL instance is SHARED across BAL applications and runs close to its limit:
max_connections is 500, Max_used_connections has reached 501, and the server has
already refused 265 connections (Connection_errors_max_connections). wait_timeout
is 28800s, so anything this app leaves idle sits on the server for eight hours
before MySQL reaps it.

That makes idle connections the thing to optimise, not throughput. A plain
QueuePool holds `pool_size` connections open for the life of the process whether
or not the app is doing anything — measured here as three connections idle for
3,618 seconds with no traffic. Two changes address it:

  1. A smaller pool with a short recycle, so the resting footprint is low and
     connections turn over instead of ageing.
  2. An idle reaper that disposes the pool after a period with no checkouts, so
     an idle dashboard holds ZERO connections rather than a permanent handful.

Reconnection is automatic — pool_pre_ping validates on checkout — so disposing
the pool is transparent to the next request.
"""
import asyncio
import logging
import time

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import QueuePool
from sqlalchemy.exc import SQLAlchemyError
from fastapi import HTTPException
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Resting footprint per process. Kept deliberately small: this dashboard serves a
# handful of concurrent users against a server that is refusing connections to
# somebody every day. Burst capacity comes from overflow, which is released back
# rather than retained.
POOL_SIZE      = 2      # what is RETAINED at rest — the number that matters here
# Overflow connections are closed when returned rather than pooled, so headroom
# costs nothing while idle. Kept generous because one dashboard page load fires
# ~15 requests at once and a tight ceiling would turn that into 503s.
MAX_OVERFLOW   = 6      # hard ceiling of 8 concurrent connections per process
POOL_TIMEOUT   = 10     # fail fast rather than queue behind a saturated server
POOL_RECYCLE   = 280    # well under any proxy or wait_timeout; forces turnover

# Dispose the pool after this long with no checkout, closing every idle
# connection. 3 minutes is longer than a user clicking between sections and far
# shorter than the 8-hour server timeout.
IDLE_DISPOSE_SECONDS = 180
IDLE_CHECK_SECONDS   = 60

engine = create_engine(
    settings.database_url,
    poolclass=QueuePool,
    pool_size=POOL_SIZE,
    max_overflow=MAX_OVERFLOW,
    pool_timeout=POOL_TIMEOUT,
    pool_pre_ping=True,        # revalidate on checkout; makes disposal safe
    pool_recycle=POOL_RECYCLE,
    # LIFO hands back the most recently used connection, so surplus connections
    # from a burst stay untouched and are retired by pool_recycle instead of
    # being kept warm by round-robin reuse.
    pool_use_lifo=True,
    echo=False,                # never echo: it logs every statement in full
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Last time a connection was checked out of the pool. Written by the event hook
# below, read by the reaper.
_last_checkout = time.monotonic()


@event.listens_for(engine, "checkout")
def _mark_activity(dbapi_conn, conn_record, conn_proxy):
    global _last_checkout
    _last_checkout = time.monotonic()


class Base(DeclarativeBase):
    pass


def pool_status() -> dict:
    """Snapshot of the pool, for the health endpoint and for logging."""
    p = engine.pool
    return {
        "size":         p.size(),
        "checked_out":  p.checkedout(),
        "checked_in":   p.checkedin(),
        "overflow":     p.overflow(),
        "idle_seconds": round(time.monotonic() - _last_checkout, 1),
    }


async def idle_connection_reaper() -> None:
    """Close pooled connections once the app has been idle for a while.

    SQLAlchemy never proactively closes an idle pooled connection — pool_recycle
    only applies at checkout, so a pool that is never used again keeps its
    connections open until the server times them out. On a shared server at its
    connection limit that is a real cost for no benefit.

    engine.dispose() closes every connection sitting in the pool. Anything
    currently checked out is untouched and closes when it is returned, so this is
    safe to run while requests are in flight.
    """
    while True:
        await asyncio.sleep(IDLE_CHECK_SECONDS)
        try:
            idle_for = time.monotonic() - _last_checkout
            p = engine.pool
            if idle_for >= IDLE_DISPOSE_SECONDS and p.checkedout() == 0 and p.checkedin() > 0:
                freed = p.checkedin()
                engine.dispose()
                logger.info(
                    "DB idle %.0fs — released %d pooled connection(s)", idle_for, freed
                )
        except Exception as exc:                      # never let the reaper die
            logger.warning("idle connection reaper: %s", exc)


def get_db():
    """FastAPI dependency — yields a session and always returns it to the pool."""
    try:
        db = SessionLocal()
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database unavailable. Please try again shortly.")
    try:
        yield db
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database error. Please try again shortly.")
    finally:
        db.close()


def test_connection() -> dict:
    """Test DB connectivity — called on startup."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1")).fetchone()
        return {"status": "connected", "db": settings.db_name, "host": settings.db_host}
    except Exception as e:
        return {"status": "error", "detail": str(e)}
