"""Where a SAP read should go: the mirror if it is ready, balcorpdb if not.

WHY THIS EXISTS RATHER THAN A SECOND PARAMETER. Thirty-eight queries across
seventeen files read SAP tables, and most sit inside functions that also read
the mine's own tables from MySQL in the same breath. Threading a second session
through all of them, and through every caller and router above them, is a large
diff across every number-producing screen on the platform -- and a diff that
large is one nobody can review honestly.

The mirror carries the SAP table names and the SAP column names unchanged (see
migration 086), so a query that reads it is the query that read balcorpdb. The
only thing that has to change at a call site is which session it runs on, and
that is what this returns.

    with sap_session(db) as sap:
        rows = sap.execute(sql, params).fetchall()

IT FALLS BACK, AND THAT IS THE POINT. If MineHub is unreachable, or the mirror
has not been filled yet, this yields the MySQL session that was passed in and
the query runs against balcorpdb exactly as before -- slower, and correct. A
screen must not go blank because a mirror is cold; the mirror is an
optimisation, not a new source of truth.

WHAT A CALLER MUST STILL DO. Postgres folds unquoted identifiers to lower case,
so a result read as `row.POSTING_DATE` works on MySQL and fails on the mirror.
Those sites alias the column explicitly -- SELECT POSTING_DATE AS posting_date
-- which reads the same on both. Nothing here can fix that for them, because
nothing here sees the SQL.
"""
from __future__ import annotations

import contextlib
import logging
import time
from typing import Iterator

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# The tables migration 086 mirrors. A query touching anything else must not be
# sent to the mirror, so callers only wrap the ones that read these.
MIRRORED: frozenset[str] = frozenset({
    "pp_production",
    "pp_quality_inspection",
    "pp_prod_order_confirmation",
    "zpm_iw29_notifications",
    "mm_plant_maint_calibration",
})

# Whether the mirror is usable, re-checked occasionally rather than per query.
# A dashboard page fires a dozen SAP reads; asking the platform database twelve
# times whether it is alive is a cost the mirror exists to avoid.
_READY: bool | None = None
_CHECKED_AT: float = 0.0
_TTL = 60.0


def invalidate() -> None:
    """Forget the readiness answer — called after a sync fills an empty mirror."""
    global _CHECKED_AT
    _CHECKED_AT = 0.0


def _ready(pg: Session) -> bool:
    """Is the mirror filled? An empty one is not an answer, it is a gap.

    Checked on pp_production because it is the smallest of the five and the one
    every production figure depends on; a mirror that has it has had a pass.
    """
    global _READY, _CHECKED_AT
    now = time.monotonic()
    if _READY is not None and (now - _CHECKED_AT) < _TTL:
        return _READY
    try:
        _READY = bool(pg.execute(text(
            "SELECT EXISTS (SELECT 1 FROM pp_production)")).scalar())
    except Exception:                                   # noqa: BLE001
        logger.info("SAP mirror not usable; reads will go to balcorpdb")
        _READY = False
    _CHECKED_AT = now
    return _READY


@contextlib.contextmanager
def sap_session(db: Session) -> Iterator[Session]:
    """A session to run a SAP read on. Never raises; never yields None."""
    pg = None
    try:
        from app.minehub_db import SessionLocal
        if SessionLocal is not None:
            pg = SessionLocal()
    except Exception:                                   # noqa: BLE001
        pg = None

    if pg is None:
        yield db
        return

    try:
        if _ready(pg):
            yield pg
        else:
            yield db
    finally:
        try:
            pg.close()
        except Exception:                               # noqa: BLE001
            pass
