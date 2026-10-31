"""Where a SAP read should go: the OData feed if it is usable, balcorpdb if not.

SAP writes this platform's Postgres database directly, through an OData
pipeline, into the schema sap_odata_api. That schema is not a copy of the
MySQL tables -- it is a superset of them: for the mine's own plants it holds
52,938 quality rows balcorpdb never received, and balcorpdb holds none it does
not.

It is also indexable. The MySQL tables are SAP's own, in a database twenty-five
applications share, and four of the five carry no index on a date -- so
get_daily_actuals, ONE query behind the Production screen, read 336,701 rows to
find the mine's 3,381 and took 1,978 ms.

── WHY THIS IS A SESSION AND NOT A SECOND PARAMETER ────────────────────────
The OData tables carry the SAP table names and the SAP column names. The
quality feed is the one exception and migration 089 gives it a view under the
names the code already uses. So a query reading the feed IS the query that read
balcorpdb, and the only thing that changes at a call site is which session it
runs on:

    with sap_session(db) as sap:
        rows = sap.execute(sql, params).fetchall()

Threading a second session through seventeen files and every caller above them
would be a diff across every number-producing screen on the platform, and a
diff that size is one nobody can review honestly.

── IT FALLS BACK, AND THAT IS THE POINT ────────────────────────────────────
If Postgres is unreachable, or the feed has not been populated, this yields the
MySQL session that was passed in and the query runs against balcorpdb exactly
as before -- slower, and correct. A screen must not go blank because a feed is
cold.

── WHAT DOES NOT COME THROUGH HERE ─────────────────────────────────────────
scm_zmm_stock_mb5b. The OData feed holds 299 of the 2,160 fuel rows Fuel
Management reads, so routing it here would empty that screen. It keeps its own
mirror (migration 081) until the feed carries the whole of matgroup 1046.
"""
from __future__ import annotations

import contextlib
import logging
import time
from typing import Iterator

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# The SAP tables the OData feed carries for us, with the history the screens
# need. A query touching anything else must not be wrapped in sap_session.
AVAILABLE: frozenset[str] = frozenset({
    "pp_production",
    "pp_quality_inspection",          # the view from migration 089
    "pp_prod_order_confirmation",
    "zpm_iw29_notifications",
    "mm_plant_maint_calibration",
})

# Whether the feed is usable, re-checked occasionally rather than per query: a
# dashboard page fires a dozen SAP reads, and asking twelve times whether the
# database is alive is a cost this exists to avoid.
_READY: bool | None = None
_CHECKED_AT: float = 0.0
_TTL = 60.0


def invalidate() -> None:
    """Forget the readiness answer."""
    global _CHECKED_AT
    _CHECKED_AT = 0.0


def _ready(pg: Session) -> bool:
    """Is the feed there and populated?

    Both halves are checked, because they fail differently and only one is
    obvious. A missing schema raises; a schema present but empty returns
    quietly, and would turn every production figure into a zero that looks
    exactly like a quiet day at the mine.
    """
    global _READY, _CHECKED_AT
    now = time.monotonic()
    if _READY is not None and (now - _CHECKED_AT) < _TTL:
        return _READY
    try:
        _READY = bool(pg.execute(text(
            "SELECT EXISTS (SELECT 1 FROM sap_odata_api.pp_production)")).scalar())
        if not _READY:
            logger.warning("SAP OData feed is present but empty; "
                           "reads will go to balcorpdb")
    except Exception:                                   # noqa: BLE001
        logger.info("SAP OData feed not reachable; reads will go to balcorpdb")
        _READY = False
    _CHECKED_AT = now
    return _READY


# ── THE FEED MUST WIN FOR SAP NAMES, AND ONLY FOR THEM ──────────────────────
#
# The platform's own search_path puts minehub first on purpose: minehub is our
# data and must never be shadowed by a table SAP happens to name the same way.
# But the SAP names exist in BOTH schemas -- the old balcorpdb mirror put
# pp_production, zpm_iw29_notifications, mm_plant_maint_calibration and
# pp_prod_order_confirmation into minehub -- and an unqualified name resolves
# against the first schema that has it. So with the default path, a read
# wrapped in sap_session reaches the stale mirror rather than the live feed,
# silently, with no error and plausible-looking numbers.
#
# That is not hypothetical: it is what the first comparison actually measured.
# 26 October read 0 MT of ore through the "feed" while balcorpdb read 1,422,
# and TATA-470(2) showed 482 breakdown hours against 62 -- all of it the mirror
# answering, while pp_production itself was identical row for row on both
# sides.
#
# Reversing the path HERE, for the one session a SAP read runs on, fixes it
# without touching how the rest of the platform resolves anything. SET LOCAL
# rather than SET: it lives inside this session's transaction and is undone the
# moment the session returns to the pool, so a pooled connection can never
# carry the reversed path into a minehub query.
#
# This does not make dropping the mirror optional -- migration 090 still does
# that, and until it runs the mirror is dead weight that two schemas have to
# keep telling apart. It makes the code correct while the mirror is still
# standing, and correct afterwards too.
_SAP_FIRST = text("SET LOCAL search_path TO sap_odata_api, minehub, public")


def sap_rows(db: Session, sql, params: dict | None = None) -> list:
    """One SAP read, on the feed if it is there. Returns the rows.

    The same thing as `with sap_session(db) as sap: sap.execute(...)`, in a
    form that replaces a `db.execute(...).fetchall()` without moving the lines
    around it. That matters at the scale this is being applied: forty-odd call
    sites across a dozen services, where re-indenting each one into a `with`
    block is forty chances to put a line in the wrong place.

    ONLY FOR A QUERY THAT TOUCHES SAP TABLES ALONE. The feed holds no
    mines_* table, so a query joining pp_production to, say,
    mines_daily_excavation_plan will fail there rather than fall back -- the
    fallback chooses the session before the query runs, not after it fails.
    That failure is loud and happens in testing, which is the intent: a
    cross-database join should be found by a person, not papered over.
    """
    with sap_session(db) as sap:
        return sap.execute(sql, params or {}).fetchall()


def is_postgres(db: Session) -> bool:
    """Whether a SAP read from this session would land on the feed.

    For the handful of queries that cannot be written once for both engines --
    a regular-expression match, say, where MySQL spells it REGEXP and Postgres
    spells it ~ -- the SQL has to know which it is about to run on. Asking
    sap_session() the same question it is about to answer keeps the two in
    step: if the feed is unreachable this returns False and the MySQL spelling
    is used, which is exactly where the query will then run.
    """
    # The cached answer first, WITHOUT opening a connection. _ready() returns
    # the cache when it is fresh, but only after it has been handed a session
    # -- and this is called once per query, so checking out a Postgres
    # connection merely to read a boolean that is already known is a round
    # trip per call on the pool.
    if _READY is not None and (time.monotonic() - _CHECKED_AT) < _TTL:
        return _READY
    try:
        from app.minehub_db import SessionLocal as PgSession
        if PgSession is None:
            return False
        pg = PgSession()
        try:
            return _ready(pg)
        finally:
            pg.close()
    except Exception:                                   # noqa: BLE001
        return False


def sap_one(db: Session, sql, params: dict | None = None):
    """The first row of a SAP read, or None. Same rules as sap_rows()."""
    with sap_session(db) as sap:
        return sap.execute(sql, params or {}).fetchone()


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
            pg.execute(_SAP_FIRST)
            yield pg
        else:
            yield db
    finally:
        try:
            pg.close()
        except Exception:                               # noqa: BLE001
            pass
