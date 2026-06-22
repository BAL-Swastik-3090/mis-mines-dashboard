from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import QueuePool
from sqlalchemy.exc import SQLAlchemyError
from fastapi import HTTPException
from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,       # auto-reconnect on stale connections
    pool_recycle=3600,        # recycle connections every hour
    echo=settings.app_env == "development",
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency — yields a DB session and closes it after use."""
    try:
        db = SessionLocal()
    except SQLAlchemyError as e:
        raise HTTPException(status_code=503, detail="Database unavailable. Please try again shortly.")
    try:
        yield db
    except SQLAlchemyError as e:
        raise HTTPException(status_code=503, detail="Database error. Please try again shortly.")
    finally:
        db.close()


def test_connection() -> dict:
    """Test DB connectivity — called on startup."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            result.fetchone()
        return {"status": "connected", "db": settings.db_name, "host": settings.db_host}
    except Exception as e:
        return {"status": "error", "detail": str(e)}
