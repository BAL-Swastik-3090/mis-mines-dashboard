"""MineHub platform database — PostgreSQL.

Separate from database.py deliberately. That module talks to the shared MySQL
instance, which is a *source*: it is at its connection ceiling, refuses
connections most days, and is read by every other BAL application. This one
talks to the database the platform owns, where it is the only writer.

The two engines have opposite tuning for that reason. The MySQL pool is kept
deliberately tiny and reaped when idle because every connection held there is
one denied to another application. This pool can behave normally.

TWO WAYS IN. This machine reaches the server differently depending on which
network it is on: directly on the office LAN, and through an SSH tunnel over
the VPN, because the VPN address is one pg_hba will only admit encrypted and
the server offers no TLS. Neither route works from the other network. So both
are configured and whichever answers is used — a developer who undocks should
not have to edit a config file and restart to keep working.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

engine = None
SessionLocal = None


def _reachable(url) -> bool:
    """Whether this address will actually give us a session.

    The first version of this opened a socket and called that reachable, which
    is not the same question and got the VPN case exactly wrong: over the VPN
    the server accepts the TCP connection and then refuses the login, because
    pg_hba admits that address only encrypted and the server offers no TLS. So
    the probe said yes, the fallback never fired, and every screen showed a
    database error while a working tunnel sat unused on localhost.

    A real connection is the only honest test. The socket is still checked
    first, because a connection attempt to an address nothing answers on takes
    twenty seconds to fail on Windows and this runs at start-up.
    """
    import socket

    probe = socket.socket()
    probe.settimeout(2)
    try:
        probe.connect((url.host, url.port or 5432))
    except OSError:
        return False
    finally:
        probe.close()

    # It is listening. Now find out whether it will let us in.
    try:
        import psycopg
        with psycopg.connect(
            host=url.host, port=url.port or 5432, dbname=url.database,
            user=url.username, password=url.password,
            sslmode=url.query.get("sslmode", "prefer"),
            connect_timeout=5,
        ) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception as exc:                          # noqa: BLE001
        logger.info("%s:%s is listening but refused a session (%s)",
                    url.host, url.port, str(exc).splitlines()[0][:120])
        return False


def _choose_url():
    """The address that answers, preferring the one that was configured first."""
    primary = settings.minehub_url
    fallback = settings.minehub_fallback_url
    if not fallback or _reachable(primary):
        return primary
    if _reachable(fallback):
        logger.warning(
            "MineHub database not answering on %s:%s — using %s:%s instead. "
            "This is the LAN/VPN switch, not a fault.",
            primary.host, primary.port, fallback.host, fallback.port)
        return fallback
    # Neither answers. Return the primary anyway so the error the application
    # reports names the address somebody actually configured.
    return primary


if settings.minehub_enabled:
    engine = create_engine(
        _choose_url(),
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,      # revalidate on checkout; survives a network blip
        pool_recycle=1800,
        echo=False,              # never echo: it would log every statement in full
        # Every session works inside the platform schema, so no query has to
        # qualify a table name and moving the schema is a config change rather
        # than a rewrite.
        #
        # Set as a libpq connection option rather than by issuing SET on connect.
        # A SET issued in the "connect" event runs inside the first, uncommitted
        # transaction, so the first rollback — including the implicit one when a
        # session returns to the pool — silently reverts it, and every later
        # query fails with "relation does not exist". As a connection option it
        # is part of the session itself and no rollback can undo it.
        connect_args={"options": f"-csearch_path={settings.pg_schema},public"},
    )

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
else:
    logger.warning(
        "MineHub database is not configured (PG_HOST / PG_DATABASE / PG_USER). "
        "MineHub endpoints will report unavailable; the dashboard is unaffected."
    )


def get_minehub_db():
    """FastAPI dependency. 503 rather than 500 when the platform DB is absent,
    so a missing configuration reads as 'not available' rather than 'broken'."""
    if SessionLocal is None:
        raise HTTPException(
            status_code=503,
            detail="MineHub platform database is not configured on this server.",
        )
    try:
        db = SessionLocal()
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="MineHub database unavailable.")
    try:
        yield db
    except SQLAlchemyError as exc:
        # Only OUR failures. This except sits around the yield, so it sees
        # every SQLAlchemyError raised anywhere downstream in the request —
        # and most endpoints here also hold a MySQL session. A MySQL dropout
        # was being reported as "MineHub database error", which sends whoever
        # is debugging it at the wrong database entirely.
        #
        # The drivers are the tell: psycopg raises for Postgres, mysql-
        # connector for MySQL. Anything that is not ours is re-raised
        # untouched so it surfaces as what it actually is.
        orig = getattr(exc, "orig", None)
        ours = orig is None or type(orig).__module__.split(".")[0] == "psycopg"
        if not ours:
            raise
        logger.error("MineHub query failed: %s", exc)
        raise HTTPException(status_code=503, detail="MineHub database error.")
    finally:
        db.close()


def test_connection() -> dict:
    """Connectivity and migration state, for the health endpoint."""
    if engine is None:
        return {"status": "not_configured"}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1")).fetchone()
            applied = conn.execute(text(
                "SELECT count(*) FROM schema_migration")).scalar()
            latest = conn.execute(text(
                "SELECT migration_id FROM schema_migration "
                "ORDER BY applied_at DESC LIMIT 1")).scalar()
        return {
            "status": "connected",
            "db": settings.pg_database,
            "host": f"{engine.url.host}:{engine.url.port}",
            "schema": settings.pg_schema,
            "migrations_applied": applied,
            "latest_migration": latest,
        }
    except Exception as exc:
        return {"status": "error", "detail": str(exc)[:200]}
