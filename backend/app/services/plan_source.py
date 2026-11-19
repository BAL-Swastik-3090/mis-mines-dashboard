"""Where a read of the mine's own plans should go: minehub, on Postgres.

THE PLANS MOVED OFF balcorpdb in migration 127, for the reason migration 126
gives: on 16 November 2026 that shared MySQL server reached 203 threads
running with queries fifteen minutes old, and the Executive Summary returned
503 eleven times against a single 200. Its SAP half never faltered, because
that comes through the OData feed on Postgres. What failed was a few hundred
rows of the mine's own plan sitting on somebody else's busy server.

── WHY A HELPER AND NOT A SECOND PARAMETER ─────────────────────────────────
Twelve call sites across seven services read these two tables, and every one
of them is handed the MySQL session by a caller that is handed it by another.
Threading a Postgres session through all of them would be a diff across every
number-producing screen on the platform, to change which connection twelve
SELECTs run on. This is the same shape sap_source.sap_rows already uses for
the SAP feed, and for the same reason.

── THE COLUMN NAMES DID NOT HAVE TO CHANGE ─────────────────────────────────
The new tables are lower case, as the rest of minehub is, and the queries
spell the columns the way MySQL held them -- Grand_Total_Qty, Plan_date,
Feed_grade_Cr2O3. Postgres folds an UNQUOTED identifier to lower case, so
those resolve to the new columns untouched. Only the table name and the
session move. Nothing resolves by luck: a column that did not match would
raise rather than return something wrong.

Si_no and Plan_month are gone -- see migration 127 -- so a query naming
either of them fails here, loudly, which is the intent.

── NO FALLBACK TO MySQL, DELIBERATELY ──────────────────────────────────────
sap_source falls back to balcorpdb when the feed is cold, because the feed is
a copy and balcorpdb is the original. Here it is the other way round: minehub
holds the plans now and balcorpdb holds a frozen copy that stops being true
the first time somebody files a day. Falling back to it would serve a stale
plan silently, which is worse than a blank panel that says so.
"""
from __future__ import annotations

import contextlib
import logging
from typing import Iterator

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def plan_session() -> Iterator[Session | None]:
    """A minehub session for a plan read, or None when it cannot be opened.

    Never raises. A caller that gets None must behave as it does for a period
    with no plan filed -- which every one of these callers already has to
    handle, because a month the mine has not planned yet is an ordinary thing.
    """
    # EXACTLY ONE yield, and it is not inside the except.
    #
    # The first version opened the session inside the try and yielded again
    # from the except when opening failed. A contextmanager may yield once:
    # when the WITH BODY raises, contextlib throws that exception back in at
    # the yield, the except caught it and yielded a second time, and Python
    # replaced the real error with "generator didn't stop after throw()".
    # Every caller then saw that instead of the query's own failure -- which
    # is how a `FROM minehub.` left on the MySQL session showed up as a
    # generator error rather than "Unknown database 'minehub'".
    #
    # So: open the session first, let opening fail quietly, and yield once.
    pg = None
    try:
        from app.minehub_db import SessionLocal
        if SessionLocal is not None:
            pg = SessionLocal()
    except Exception:                                   # noqa: BLE001
        logger.warning("minehub unavailable for a plan read", exc_info=True)
        pg = None
    try:
        yield pg
    finally:
        if pg is not None:
            try:
                pg.close()
            except Exception:                           # noqa: BLE001
                pass


def plan_rows(sql, params: dict | None = None) -> list:
    """Every row a plan query returns, or [] when minehub cannot be reached."""
    with plan_session() as pg:
        if pg is None:
            return []
        return pg.execute(sql, params or {}).fetchall()


def plan_one(sql, params: dict | None = None):
    """The single row a plan query returns, or None."""
    with plan_session() as pg:
        if pg is None:
            return None
        return pg.execute(sql, params or {}).fetchone()
