"""MineHub platform database — PostgreSQL.

Separate from database.py deliberately. That module talks to the shared MySQL
instance, which is a *source*: it is at its connection ceiling, refuses
connections most days, and is read by every other BAL application. This one
talks to the database the platform owns, where it is the only writer.

The two engines have opposite tuning for that reason. The MySQL pool is kept
deliberately tiny and reaped when idle because every connection held there is
one denied to another application. This pool can behave normally.
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

if settings.minehub_enabled:
    engine = create_engine(
        settings.minehub_url,
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
            "host": settings.pg_host,
            "schema": settings.pg_schema,
            "migrations_applied": applied,
            "latest_migration": latest,
        }
    except Exception as exc:
        return {"status": "error", "detail": str(exc)[:200]}
