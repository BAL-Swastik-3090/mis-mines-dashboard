"""Data health — how current the data behind each screen is.

READ-ONLY, and open to anyone signed in. Deliberately not behind a permission:
the alert tells a reader that the figure in front of them is three days old,
and withholding that from the people acting on the figure would defeat the
point. It discloses table names and dates, nothing operational.

ONE ENDPOINT FOR THREE PLACEMENTS. The page banner, the sidebar dot and the
Data Health page all read this, so they cannot disagree about whether a feed is
late. The whole report is small, so it is returned entire and the client picks
out the section it needs rather than the server serving three shapes of the
same fact.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.data_health import get_data_health

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data-health", tags=["Data Health"])


def _minehub() -> Session | None:
    """A MineHub session, or None if the platform database is not reachable.

    Imported inside the function and never allowed to raise: the probe covers
    two databases, and a VPN blip on the PostgreSQL side must leave the four
    MineHub feeds "unknown" rather than taking the health of every SAP feed
    down with it.
    """
    try:
        from app.minehub_db import SessionLocal
    except Exception:
        return None
    if SessionLocal is None:
        return None
    try:
        return SessionLocal()
    except Exception:
        logger.warning("MineHub unreachable for the freshness probe")
        return None


#: Ten minutes. The probe is MAX() over columns none of which is indexed — a
#: full scan of pp_production's 390,000 rows on its own — and the whole report
#: costs about three seconds. Every page in the application asks for this, so
#: uncached it would add three seconds to every navigation to answer a question
#: whose answer changes a handful of times a day.
_TTL = 600
_KEY = "mines:data-health:v1"


@router.get("")
def data_health(refresh: bool = False,
                db: Session = Depends(get_db)) -> dict[str, Any]:
    """Latest date held by every monitored feed, and a per-section roll-up.

    `refresh=true` skips the cache, for the Data Health page's own reload
    button — somebody who has just chased an entry wants to see it land, not
    wait out a ten-minute window and conclude the fix did not work.
    """
    import json

    from app.cache import get_redis

    r = None
    try:
        r = get_redis()
        if not refresh:
            hit = r.get(_KEY)
            if hit:
                out = json.loads(hit)
                out["cached"] = True
                return out
    except Exception:
        r = None          # Redis down is not an outage for this; just probe.

    mh = _minehub()
    try:
        out = get_data_health(db, mh)
    finally:
        if mh is not None:
            mh.close()

    out["cached"] = False
    if r is not None:
        try:
            r.setex(_KEY, _TTL, json.dumps(out, default=str))
        except Exception:
            pass
    return out
