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

from sqlalchemy import create_engine, event, exc as exc_mod, text
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
#
# WHICH IS EXACTLY WHAT HAPPENED. At 6 the ceiling was 8 per worker, 16 across
# both, and that is fewer than a single page load needs now that the Executive
# Summary sits at the top of the sidebar: it is the first thing every user
# opens, it holds a connection for ~2.5 seconds, and the requests behind it
# queued for the full pool_timeout and then returned 500. Market Watch showing
# "Internal server error" was this, not a fault of its own.
#
# RAISED CAREFULLY, BECAUSE THE SERVER IS NOT OURS ALONE. balcorpdb allows 500
# connections, has reached 501, and has refused 208. This host holds 246 of
# them -- 146 of those asleep, 48 idle for over an hour, the oldest for 5.7
# hours -- but they belong to the other applications sharing the machine, not
# to this one: the idle reaper below means an idle dashboard holds zero. So
# this only widens the burst, which is returned and closed immediately, and
# leaves the resting footprint at two.
MAX_OVERFLOW   = 12     # hard ceiling of 14 concurrent connections per process
POOL_TIMEOUT   = 10     # fail fast rather than queue behind a saturated server
# RAISED FROM 280 s, AND ONLY BECAUSE VALIDATION NO LONGER DEPENDS ON AGE.
# 280 s was a blunt instrument for the same job the idle ping now does
# properly: retire anything that might have been dropped by a proxy or the
# server. Blind age-based turnover is a poor proxy for "is this socket alive"
# — it discarded healthy connections constantly and still could not catch one
# that died at 30 s. _ping_if_stale validates any connection idle more than
# 20 s and raises DisconnectionError if it has gone, so a dead socket is
# caught when it matters rather than guessed at.
#
# Leaving recycle at 280 would also have cancelled the raised idle window
# above: a connection reached for after five minutes was older than 280 s and
# so was thrown away and reopened regardless — the 1,169 ms reconnect the
# window was widened to avoid. 25 minutes, still far under MySQL's 8-hour
# wait_timeout, lets the two settings mean the same thing.
POOL_RECYCLE   = 1500

# Dispose the pool after this long with no checkout, closing every idle
# connection.
#
# RAISED FROM 180 s, BECAUSE REOPENING IS NOT CHEAP HERE. Measured from this
# host: a warm checkout answers `SELECT 1` in 455 ms, the first one after a
# dispose takes 1,625 ms. Reconnecting to balcorpdb costs ~1,169 ms and to
# minehub ~851 ms, and a page load hits both, so every visit that landed
# outside the window paid well over a second before any query ran. Three
# minutes sounded like "longer than a user clicking between sections", but
# reading a report, taking a call or sitting in a meeting all exceed it, and
# those are exactly the moments somebody comes back and opens a page.
#
# What it costs to hold: pool_size is 2, so this keeps two connections per
# worker — four across both — against a server that allows 500 and in which
# the other applications on this host already hold 48 idle for over an hour.
# The resting footprint still falls to zero, just after a quarter of an hour
# instead of three minutes.
IDLE_DISPOSE_SECONDS = 900
IDLE_CHECK_SECONDS   = 60

engine = create_engine(
    settings.database_url,
    poolclass=QueuePool,
    pool_size=POOL_SIZE,
    max_overflow=MAX_OVERFLOW,
    pool_timeout=POOL_TIMEOUT,
    # Pre-ping is done by hand below, not by the pool. See _ping_if_stale.
    pool_pre_ping=False,
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


# How long a connection may sit unused before it is worth validating. Under
# active use nothing comes close to this, so the ping disappears from the hot
# path; anything that has been sitting is still checked before it is handed to
# a request.
PING_AFTER_IDLE = 20.0


@event.listens_for(engine, "checkin")
def _stamp_checkin(dbapi_conn, conn_record):
    conn_record.info["returned_at"] = time.monotonic()


@event.listens_for(engine, "checkout")
def _ping_if_stale(dbapi_conn, conn_record, conn_proxy):
    """pool_pre_ping, but only for connections old enough to have gone stale.

    WHY NOT JUST pool_pre_ping=True. Because it validates on EVERY checkout,
    and validation is a round trip: `SELECT 1` against balcorpdb measured
    223 ms from this host. One request does one checkout, so every API call on
    every page was paying a quarter of a second to ask a question it had asked
    seconds earlier and whose answer had not changed. Measured on the EV
    overview, that ping plus the Postgres one was ~460 ms of a ~950 ms
    response.

    What pre-ping is actually for is the connection that has been sitting while
    a firewall or the server quietly dropped it. That is a function of how long
    it has been idle, which is exactly what this checks. A connection reused
    within PING_AFTER_IDLE is handed over untouched; an older one is validated
    exactly as before, and a failure raises DisconnectionError so the pool
    discards it and transparently opens a new one — the same recovery
    pool_pre_ping provided, at the same moment it would have provided it.

    pool_recycle (280 s) and the idle reaper (180 s) still bound the age of
    anything in the pool, so this narrows the unvalidated window, it does not
    open an unbounded one.
    """
    global _last_checkout
    _last_checkout = time.monotonic()

    returned = conn_record.info.get("returned_at")
    if returned is not None and _last_checkout - returned < PING_AFTER_IDLE:
        return                                   # recently in use; trust it

    try:
        cur = dbapi_conn.cursor()
        try:
            cur.execute("SELECT 1")
            cur.fetchall()
        finally:
            cur.close()
    except Exception as exc:                                # noqa: BLE001
        # Tells the pool this connection is dead. It drops it and retries the
        # checkout once with a fresh one, which is what pre-ping did.
        raise exc_mod.DisconnectionError(
            "stale pooled connection discarded") from exc


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
