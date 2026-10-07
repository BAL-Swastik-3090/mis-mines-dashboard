"""How long a machine was broken down — one definition, used everywhere.

THE RULE. Downtime is wall-clock time between a notification's malfunction
start and its malfunction end, clipped to the window being reported, and
MERGED PER MACHINE so that time is never counted twice. A notification with no
end is still running and is counted to now, or to the window's end if that is
sooner.

── THREE THINGS THIS GETS RIGHT THAT THE PREVIOUS VERSION DID NOT ───────────

1. A BREAKDOWN THAT STARTED BEFORE THE WINDOW STILL COUNTS INSIDE IT.
   The old filter was `MALFUNCTION_START BETWEEN :from AND :to`, which selects
   on the start date alone. A machine that went down on 10 September and is
   still down contributed NOTHING to an October report — so the longer a
   machine had been broken, the more certain its column was to read 0.00.
   TATA-470(7) (notification 20002435, open since 10 Sep) and TATA-370(4)
   (20002456, open since 21 Sep) both showed 0.00 hours for 1-7 October while
   SAP had them down for all 156.9 of them.

   Selection is now by OVERLAP — the event starts before the window ends and
   ends after the window begins — and each interval is clipped to the window.

2. SIMULTANEOUS NOTIFICATIONS ARE NOT ADDED UP.
   A machine can only be broken once at a time, but the mine raises one
   notification per fault. TATA-370(5) had five touching 1-7 October, three
   open at once; summing them gave 597.58 hours of downtime inside a 156.90
   hour week. A `min(hours, god_hours)` guard clamped that to exactly the
   window, which is why the cell read 168.00 — the overcount was not visible,
   it was disguised as "down 100% of the time". There are 282 overlapping
   pairs on mine equipment, so this is routine, not an oddity.

   Intervals are now merged per machine before being summed. Across machines
   they are NOT merged: two different excavators down at the same time really
   is two machine-hours lost.

3. SAP's OWN DURATION COLUMN IS NO LONGER TRUSTED, BECAUSE IT IS NOT CONSISTENT.
   BREAKDOWN_DURAION (SAP's typo) reports unit 'H' on all 1,544 mine rows, but
   of the 1,519 closed ones 1,369 only reconcile with the clock if the value is
   SECONDS and 151 only if it is HOURS. Reading every row as seconds — which is
   what the old code did — turned a 42-day outage on MAN-49 (27 May to 9 July,
   1,028 hours) into 0.29 hours. The timestamps carry no such ambiguity, and
   they are also the only thing that can be clipped to a window, so duration is
   computed from them and that column is not read at all.

── WHAT THIS STILL CANNOT DECIDE ────────────────────────────────────────────
A notification stays open until maintenance closes it, which is not the same as
the machine being down. TATA-370(5) has "DOOR GLASS BROKEN" open since 11
September while the machine kept digging. The figure here is therefore "how
long this notification has been open", and where notifications are not closed
promptly that is longer than the machine was actually stopped. SAP's BREAKDOWN
flag is 'X' on every mine notification, so nothing here can tell the two apart;
it is reported as-is rather than guessed at.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any, Iterable, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

TABLE = "zpm_iw29_notifications"

# An event belongs to the window if it OVERLAPS it, not if it starts in it.
# Compared on the DATE columns so the comparison can use their index; the
# precise clipping happens in Python against the full timestamps.
OVERLAP_WHERE = """
    MALFUNCTION_START IS NOT NULL
    AND MALFUNCTION_START <= :bd_to_d
    AND (MALFUNCTION_END IS NULL OR MALFUNCTION_END >= :bd_from_d)
"""

# Midnight when the time component is missing, which is the conservative end of
# the day for a start.
_START = ("TIMESTAMP(MALFUNCTION_START, "
          "COALESCE(MALFUNCTION_START_TIME, '00:00:00'))")
_END = ("CASE WHEN MALFUNCTION_END IS NULL THEN NULL ELSE "
        "TIMESTAMP(MALFUNCTION_END, COALESCE(MALFUNCTION_END_TIME, '00:00:00')) "
        "END")

# Still running. MALFUNCTION_END is the only reliable marker: SYSTEM_STATUS can
# read OSNO on a notification that already has an end time.
IS_OPEN = "(MALFUNCTION_START IS NOT NULL AND MALFUNCTION_END IS NULL)"


def window(from_date: date, to_date: date) -> tuple[datetime, datetime]:
    """The reporting window as instants, with the end never in the future.

    An open breakdown counted to NOW would keep growing inside a month that has
    already finished — August's figure would differ every time it was opened.
    Clamping to the window means the current period reads "until now" and a
    past one reads "until it ended", which is the honest answer to how long the
    machine was down DURING it.
    """
    start = datetime.combine(from_date, time(0, 0, 0))
    end = min(datetime.now(), datetime.combine(to_date, time(23, 59, 59)))
    return start, end


def params(from_date: date, to_date: date) -> dict[str, Any]:
    """Bind parameters OVERLAP_WHERE needs. Merge into the query's own."""
    return {"bd_from_d": from_date, "bd_to_d": to_date}


def _merge(spans: Iterable[tuple[datetime, datetime]]) -> float:
    """Total hours covered by a set of possibly overlapping intervals."""
    ordered = sorted(spans)
    total = 0.0
    cur_a: datetime | None = None
    cur_b: datetime | None = None
    for a, b in ordered:
        if cur_b is not None and a <= cur_b:
            if b > cur_b:
                cur_b = b
        else:
            if cur_a is not None and cur_b is not None:
                total += (cur_b - cur_a).total_seconds()
            cur_a, cur_b = a, b
    if cur_a is not None and cur_b is not None:
        total += (cur_b - cur_a).total_seconds()
    return total / 3600.0


def spans_by(
    db: Session,
    *,
    key: str,
    from_date: date,
    to_date: date,
    where: str = "",
    bind: dict[str, Any] | None = None,
) -> dict[Any, list[tuple[datetime, datetime]]]:
    """Window-clipped downtime intervals, grouped by `key`.

    `key` is a SQL expression (a column, usually EQUIPMENT or
    DESC_TECH_OBJECT); `where` is the caller's own filter, ANDed on.
    """
    w_start, w_end = window(from_date, to_date)
    sql = text(f"""
        SELECT {key} AS bd_key, {_START} AS bd_s, {_END} AS bd_e
        FROM {TABLE}
        WHERE {OVERLAP_WHERE}
        {("AND " + where) if where else ""}
    """)
    out: dict[Any, list[tuple[datetime, datetime]]] = defaultdict(list)
    for r in db.execute(sql, {**params(from_date, to_date), **(bind or {})}):
        start = r.bd_s
        if start is None:
            continue
        # An open event runs to the window's end. A closed one that SAP never
        # gave an end time for is handled the same way by the SQL above.
        end = r.bd_e or w_end
        a, b = max(start, w_start), min(end, w_end)
        if b > a:
            out[r.bd_key].append((a, b))
    return dict(out)


def hours_by(
    db: Session,
    *,
    key: str,
    from_date: date,
    to_date: date,
    where: str = "",
    bind: dict[str, Any] | None = None,
) -> dict[Any, float]:
    """Merged downtime hours per `key`. The number every screen reports."""
    return {k: _merge(v)
            for k, v in spans_by(db, key=key, from_date=from_date,
                                 to_date=to_date, where=where, bind=bind).items()}


def total_hours(
    db: Session,
    *,
    key: str,
    from_date: date,
    to_date: date,
    where: str = "",
    bind: dict[str, Any] | None = None,
) -> float:
    """One figure across several machines.

    Merged WITHIN each machine and then added ACROSS them: two excavators down
    at the same time is two machine-hours lost, while one excavator with two
    open notifications is not.
    """
    return sum(hours_by(db, key=key, from_date=from_date, to_date=to_date,
                        where=where, bind=bind).values())


def counts_by(
    db: Session,
    *,
    key: str,
    from_date: date,
    to_date: date,
    where: str = "",
    bind: dict[str, Any] | None = None,
) -> dict[Any, dict[str, int]]:
    """Notification counts per `key`, on the same overlap basis as the hours.

    An event that began in September and is still running is counted in an
    October window, because it is a breakdown October suffered. Counting it
    only in September would leave the hours and the count telling different
    stories about the same machine.
    """
    sql = text(f"""
        SELECT {key} AS bd_key,
               COUNT(*) AS n_all,
               COUNT(CASE WHEN MALFUNCTION_END IS NOT NULL THEN 1 END) AS n_closed,
               COUNT(CASE WHEN {IS_OPEN} THEN 1 END)                   AS n_open
        FROM {TABLE}
        WHERE {OVERLAP_WHERE}
        {("AND " + where) if where else ""}
        GROUP BY {key}
    """)
    return {
        r.bd_key: {"events": int(r.n_all or 0),
                   "closed": int(r.n_closed or 0),
                   "open": int(r.n_open or 0)}
        for r in db.execute(sql, {**params(from_date, to_date), **(bind or {})})
    }


def event_rows(
    db: Session,
    *,
    from_date: date,
    to_date: date,
    where: str = "",
    bind: dict[str, Any] | None = None,
    order: str = "MALFUNCTION_START DESC, MALFUNCTION_START_TIME DESC",
    extra: Sequence[str] = (),
) -> list[dict[str, Any]]:
    """One row per notification overlapping the window, each clipped to it.

    For a LIST of events, not for a total. Where notifications overlap these
    rows add up to more than the machine's merged downtime, which is correct
    for a list — each is a real fault — and wrong for a sum. Callers wanting a
    total must use hours_by or total_hours.
    """
    w_start, w_end = window(from_date, to_date)
    cols = ("".join(f", {e}" for e in extra)) if extra else ""
    sql = text(f"""
        SELECT {_START} AS bd_s, {_END} AS bd_e,
               {IS_OPEN} AS bd_open{cols}
        FROM {TABLE}
        WHERE {OVERLAP_WHERE}
        {("AND " + where) if where else ""}
        ORDER BY {order}
    """)
    out: list[dict[str, Any]] = []
    for r in db.execute(sql, {**params(from_date, to_date), **(bind or {})}):
        m = dict(r._mapping)
        start, end = m.pop("bd_s"), m.pop("bd_e")
        if start is None:
            continue
        eff_end = end or w_end
        a, b = max(start, w_start), min(eff_end, w_end)
        m["start_at"] = start
        m["end_at"] = end
        m["is_open"] = bool(m.pop("bd_open"))
        m["hours"] = round(max((b - a).total_seconds(), 0) / 3600.0, 2)
        out.append(m)
    return out


# ── Deprecated ───────────────────────────────────────────────────────────────
# The old SQL-fragment interface. It could not clip to a window and could not
# merge overlaps, which is what this module exists to do. Left only so an
# import that still references it fails loudly here rather than silently
# producing the figures described at the top of this file.
def DURATION_SECONDS(*_a, **_k):  # noqa: N802
    raise NotImplementedError(
        "breakdown.DURATION_SECONDS has been removed — it summed overlapping "
        "notifications and dropped events starting before the window. "
        "Use breakdown.hours_by / total_hours instead.")


def upto(_to_date: date) -> datetime:
    raise NotImplementedError(
        "breakdown.upto has been removed — use breakdown.window(from, to).")


__all__ = [
    "IS_OPEN", "OVERLAP_WHERE", "TABLE",
    "window", "params", "spans_by", "hours_by", "total_hours",
    "counts_by", "event_rows",
]
