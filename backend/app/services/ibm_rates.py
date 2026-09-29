"""The IBM rate the planned ore loss is valued at — read, never typed.

The three rates used to be constants in services/lcm.py, copied by hand from the
IBM monthly bulletin. They were June 2026's. By the time anybody noticed, July's
had been published and collected — 28,461 / 24,321 / 11,173 against the 28,436 /
23,551 / 11,294 still on the screen. A costing screen quietly a month behind is
worse than one that says it does not know.

The collector already writes every issue into minehub.mineral_price, so this
reads from there and the loss value follows the bulletin on its own.

WHICH ISSUE IS USED. The latest one published on or before the month the report
ends in. A September report uses September's rates the day they land and July's
until then; a report run over a past month keeps that month's rates however long
ago it was, so a figure quoted in a meeting can be reproduced afterwards.

ALL THREE COME FROM THE SAME ISSUE. The query takes the newest period that
carries all three Fines bands rather than the newest price per band separately.
Mixing a July HG with an April LG would produce a weighted rate that appears in
no bulletin and could not be checked against one.

FINES, NOT LUMPS. The plan carries only HG/MG/LG and does not split lump from
fines, so every planned tonne is valued as fines — as the old constants also
were. mineral_price holds Lumps and CONCENTRATES bands too; they are deliberately
not read here. If the mine ever plans lump separately it needs its own band.

WHEN MINEHUB IS UNREACHABLE. The last successfully read issue is served and
marked stale, because rates change monthly and a fifteen-minute-old copy is
still the right number. If none has ever been read, the rates come back as None
— which the existing "rate_missing" path in lcm.py already handles by reporting
no Loss Amount at all. Nothing is hard-coded as a fallback: a wrong rupee figure
on a costing screen is worse than a blank one, and the blank says why.
"""
from __future__ import annotations

import logging
import time
from datetime import date

from sqlalchemy import bindparam, text

from app import minehub_db

logger = logging.getLogger(__name__)

MINERAL = "Chromite"
STATE = "ODISHA"

# The bulletin's own wording, verbatim. mineral_price keeps the grade exactly as
# published rather than tidied into a code, so these must match it character for
# character — including the space before the % in the MG band.
BANDS: dict[str, str] = {
    "HG": "52% And Above Cr2O3,Fines",
    "MG": "40% To Below 52 % Cr2O3,Fines",
    "LG": "Below 40% Cr2O3,Fines",
}

# The COB plant is costed off IBM's own CONCENTRATES line, which is published
# alongside the Cr2O3-banded fines and is a different number entirely.
CONCENTRATE_BAND = "CONCENTRATES"

GRADES = ("HG", "MG", "LG")
MONTHS = ("January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December")

# A new bulletin appears monthly, so re-reading every request buys nothing and
# costs a round trip to another database on every page load.
CACHE_TTL = 15 * 60.0

# Keyed by the month asked for, because a report over August must not be served
# September's rates out of a cache warmed by the live page.
_cache: dict[date, tuple[dict, float]] = {}

_SQL = text("""
    WITH latest AS (
        SELECT period
          FROM mineral_price
         WHERE mineral = :mineral AND state = :state
           AND grade IN :bands AND period <= :upto
         GROUP BY period
        HAVING COUNT(DISTINCT grade) = :want
         ORDER BY period DESC
         LIMIT 1
    )
    SELECT p.grade, p.price, p.period, p.is_flagged
      FROM mineral_price p
      JOIN latest l ON l.period = p.period
     WHERE p.mineral = :mineral AND p.state = :state
       AND p.grade IN :bands
""").bindparams(bindparam("bands", expanding=True))


_ONE_SQL = text("""
    SELECT price, period, is_flagged
      FROM mineral_price
     WHERE mineral = :mineral AND state = :state
       AND grade = :band AND period <= :upto
     ORDER BY period DESC
     LIMIT 1
""")


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _describe(period: date | None) -> str:
    if period is None:
        return "IBM rate unavailable — minehub could not be read"
    return (f"IBM average sale price, {MONTHS[period.month - 1]} "
            f"{period.year} — chrome ore fines")


def _empty() -> dict:
    return {
        "rates": dict.fromkeys(GRADES, None),
        "period": None,
        "source": _describe(None),
        "available": False,
        "stale": False,
        "flagged": [],
    }


def _load(upto: date) -> dict:
    """Read the newest issue on or before `upto`. Raises if minehub is down."""
    factory = minehub_db.SessionLocal
    if factory is None:
        raise RuntimeError("MineHub platform database is not configured.")
    by_band = {v: k for k, v in BANDS.items()}
    with factory() as pg:
        rows = pg.execute(_SQL, {
            "mineral": MINERAL, "state": STATE,
            "bands": list(BANDS.values()),
            "want": len(BANDS), "upto": upto,
        }).fetchall()
    if not rows:
        return _empty()

    rates: dict[str, float | None] = dict.fromkeys(GRADES, None)
    flagged: list[str] = []
    period = rows[0].period
    for r in rows:
        grade = by_band.get(r.grade)
        if grade is None:
            continue
        rates[grade] = float(r.price)
        # Shown and marked rather than dropped — a hidden row is one nobody
        # checks, and the collector flags a parse that produced a wild number.
        if r.is_flagged:
            flagged.append(grade)
    return {
        "rates": rates,
        "period": period.isoformat(),
        "source": _describe(period),
        "available": all(rates[g] is not None for g in GRADES),
        "stale": False,
        "flagged": flagged,
    }


def rates_for(as_of: date) -> dict:
    """The IBM rates to value a report ending on `as_of`.

    Never raises. A minehub outage yields the last known issue marked stale, or
    empty rates if none was ever read.
    """
    key = _month_start(as_of)
    now = time.monotonic()

    hit = _cache.get(key)
    if hit and (now - hit[1]) < CACHE_TTL:
        return hit[0]

    try:
        payload = _load(key)
        _cache[key] = (payload, now)
        return payload
    except Exception as exc:
        if hit:
            logger.warning("IBM rates refresh failed, serving %s: %s",
                           hit[0].get("period"), exc)
            stale = {**hit[0], "stale": True,
                     "source": hit[0]["source"] + " (last known — minehub unreachable)"}
            # Retry sooner than a full TTL rather than sitting on a stale copy.
            _cache[key] = (hit[0], now - (CACHE_TTL / 2))
            return stale
        logger.error("IBM rates unavailable and nothing cached: %s", exc)
        return _empty()


# ── the CONCENTRATES line, for the COB plant ─────────────────────────────────

_conc_cache: dict[date, tuple[dict, float]] = {}


def _empty_concentrate() -> dict:
    return {"rate": None, "period": None, "source": _describe(None),
            "available": False, "stale": False, "flagged": False}


def _load_concentrate(upto: date) -> dict:
    factory = minehub_db.SessionLocal
    if factory is None:
        raise RuntimeError("MineHub platform database is not configured.")
    with factory() as pg:
        row = pg.execute(_ONE_SQL, {
            "mineral": MINERAL, "state": STATE,
            "band": CONCENTRATE_BAND, "upto": upto,
        }).fetchone()
    if row is None:
        return _empty_concentrate()
    return {
        "rate": float(row.price),
        "period": row.period.isoformat(),
        "source": (_describe(row.period).replace("chrome ore fines", "concentrates")),
        "available": True,
        "stale": False,
        "flagged": bool(row.is_flagged),
    }


def concentrate_for(as_of: date) -> dict:
    """IBM's CONCENTRATES rate for a report ending on `as_of`. Never raises."""
    key = _month_start(as_of)
    now = time.monotonic()

    hit = _conc_cache.get(key)
    if hit and (now - hit[1]) < CACHE_TTL:
        return hit[0]

    try:
        payload = _load_concentrate(key)
        _conc_cache[key] = (payload, now)
        return payload
    except Exception as exc:
        if hit:
            logger.warning("IBM concentrates rate refresh failed, serving %s: %s",
                           hit[0].get("period"), exc)
            _conc_cache[key] = (hit[0], now - (CACHE_TTL / 2))
            return {**hit[0], "stale": True,
                    "source": hit[0]["source"] + " (last known — minehub unreachable)"}
        logger.error("IBM concentrates rate unavailable and nothing cached: %s", exc)
        return _empty_concentrate()
