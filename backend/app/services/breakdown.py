"""How long a machine was broken down — one definition, used everywhere.

THE RULE. A breakdown belongs to the window IT STARTED IN. Downtime is
wall-clock time from that malfunction start to its malfunction end, clipped to
the window being reported, and MERGED PER MACHINE so that time is never counted
twice. A notification with no end is still running and is counted to now, or to
the window's end if that is sooner.

── SELECTION IS BY START DATE, AND THAT IS A DELIBERATE CHOICE ──────────────

Asked for by the mine on 26 October 2026, after the tipper table showed
breakdown hours larger than the hours in the month: "it should show the
breakdown hours for the selected date range only, it should not show all the
breakdowns."

It was the OVERLAP rule that put them there. Under overlap, a notification
raised on 2 OCTOBER 2024 and never closed was still clipped into every window
since, so MAN-18 (20000795, SILENCER DAMAGE, open 754 days) and MAN-80
(20000853, HYDRAULIC HOSE, open 748 days) each charged 612.94 hours to a 624
hour October — while MAN-80's Technoton box recorded 326.17 engine hours in the
same month. Six tippers read exactly the window length for this reason, and 13
of 27 reported engine + breakdown hours greater than the calendar itself.

WHAT THIS COSTS, STATED PLAINLY. A machine that went down on 25 September and
is still down now contributes NOTHING to an October report. That is the bug the
overlap rule was introduced to fix — TATA-470(7) and TATA-370(4) both read 0.00
for 1-7 October while SAP had them down for all 156.9 of those hours — and
choosing a start-date rule brings it back. The mine has chosen the error it
prefers: a carried-over outage reads low, which is visible beside the running
hours, rather than a stale notification reading impossibly high, which is not.

Measured over September 2026 (a month that has closed) the rule is exact:
970.68 fleet hours against 5,259.74 under overlap, and NOT ONE tipper reporting
more hours than the month holds.

   For the current month this is necessary but NOT sufficient — see
   "WHAT THIS STILL CANNOT DECIDE" below.

── TWO THINGS THIS STILL GETS RIGHT THAT THE OLDEST VERSION DID NOT ─────────

1. SIMULTANEOUS NOTIFICATIONS ARE NOT ADDED UP.
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

2. SAP's OWN DURATION COLUMN IS NO LONGER TRUSTED, BECAUSE IT IS NOT CONSISTENT.
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

THE START-DATE RULE DOES NOT FIX THAT, AND WAS NEVER GOING TO. A fault raised
INSIDE the window and left open still runs to the window's end: on 26 October
2026, 42 notifications stood open on the MAN fleet, including every tyre
puncture logged since the 6th. MAN-77's puncture (20002501, raised 6 October)
alone still reports 556.16 hours of a 624 hour month, and the fleet reads
6,760.96 hours rather than 10,119.83. Eleven tippers still show engine +
breakdown hours beyond the calendar.

Only closing the notification, or an independent witness, can settle those.
Technoton is that witness and disagrees flatly — MAN-55 is "down" on 23 days of
October and recorded running hours on all 23 — but using it would change what
the column MEANS, from "this fault is not yet closed" to "this machine did not
work", and that is the mine's decision to make, not this module's.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any, Iterable, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

TABLE = "zpm_iw29_notifications"

# An event belongs to the window IT STARTED IN. A breakdown raised in October
# 2024 is October 2024's, however long its notification stays open afterwards.
#
# Compared on the DATE column so the comparison can use its index; the precise
# clipping happens in Python against the full timestamps. MALFUNCTION_START is
# a DATE, so BETWEEN takes both end days whole — a fault raised late on the
# closing day is selected here and then clipped to nothing by `window()`, which
# clamps the end to now. It appears once time has actually passed, which is the
# right answer rather than a missing row.
IN_WINDOW_WHERE = """
    MALFUNCTION_START IS NOT NULL
    AND MALFUNCTION_START BETWEEN :bd_from_d AND :bd_to_d
"""

# Midnight when the time component is missing, which is the conservative end of
# the day for a start.
# ── THE SAME INSTANT, IN TWO DIALECTS ───────────────────────────────────────
#
# SAP keeps the malfunction date and its time in separate columns, so they have
# to be combined before anything can be measured. MySQL does that with
# TIMESTAMP(date, time). Postgres has no such function -- it adds a date and a
# time directly -- and the SAP OData feed is Postgres.
#
# This is the one place the migration was not a drop-in. The table names and
# the column names are identical on both sides, so a SELECT list needs no
# change; anything that CALLS a function does.
_START_MY = ("TIMESTAMP(MALFUNCTION_START, "
             "COALESCE(MALFUNCTION_START_TIME, '00:00:00'))")
_END_MY = ("CASE WHEN MALFUNCTION_END IS NULL THEN NULL ELSE "
           "TIMESTAMP(MALFUNCTION_END, COALESCE(MALFUNCTION_END_TIME, '00:00:00')) "
           "END")

# In the feed MALFUNCTION_START is a date and the time is text, so the time is
# cast before it is added. A missing time is midnight, as it is on MySQL.
_START_PG = ("(MALFUNCTION_START + "
             "COALESCE(NULLIF(MALFUNCTION_START_TIME, ''), '00:00:00')::time)")
_END_PG = ("CASE WHEN MALFUNCTION_END IS NULL THEN NULL ELSE "
           "(MALFUNCTION_END + "
           "COALESCE(NULLIF(MALFUNCTION_END_TIME, ''), '00:00:00')::time) END")


def _stamps(db: Session) -> tuple[str, str]:
    """(start, end) expressions for the database this session is on."""
    name = ""
    try:
        name = db.bind.dialect.name
    except Exception:                                   # noqa: BLE001
        pass
    if name == "postgresql":
        return _START_PG, _END_PG
    return _START_MY, _END_MY

# Still running. MALFUNCTION_END is the only reliable marker: SYSTEM_STATUS can
# read OSNO on a notification that already has an end time.
IS_OPEN = "(MALFUNCTION_START IS NOT NULL AND MALFUNCTION_END IS NULL)"


def db_now(db: Session) -> datetime:
    """Now, according to the database that stamped the timestamps.

    NOT datetime.now(). An open breakdown is measured from its MALFUNCTION_START
    to the present, and those timestamps are SAP's, written in IST by a MySQL
    server running in IST. The application's own clock is a different machine's,
    and in the production container it is UTC with no TZ set:

        container python now : 2026-10-07 11:01:20
        MySQL NOW()          : 2026-10-07 16:31:46

    Five and a half hours. Every open breakdown was cut short by exactly that,
    so the same window read 160.45 hours on a developer's machine in IST and
    154.54 in production, and a notification opened within the last five hours
    vanished entirely — its start was "in the future" and the clipped interval
    came out empty. TATA-470(2) read 3.26 hours locally and 0.00 in production
    for that reason.

    One clock, and it is the one the data is on.

    RETURNED NAIVE, WHICHEVER DATABASE ANSWERED. MySQL's NOW() comes back
    without a timezone; Postgres's now() is timestamptz and comes back with
    one. The rest of this module builds window edges with datetime.combine(),
    which is naive, and comparing the two raises:

        TypeError: can't compare offset-naive and offset-aware datetimes

    That is not hypothetical -- it is what every OEE window did the moment the
    breakdown read moved to the SAP OData feed. The timezone is dropped rather
    than applied to the other side, because the SAP timestamps this is compared
    against carry no zone either: they are IST wall-clock, written by a server
    in IST, and the only correct reading of them is as local time on that
    server. Attaching a zone here would make the arithmetic look rigorous while
    changing what the numbers mean.
    """
    value = db.execute(text("SELECT NOW()")).scalar()
    return value.replace(tzinfo=None) if value and value.tzinfo else value


def window(from_date: date, to_date: date,
           now: datetime | None = None) -> tuple[datetime, datetime]:
    """The reporting window as instants, with the end never in the future.

    An open breakdown counted to NOW would keep growing inside a month that has
    already finished — August's figure would differ every time it was opened.
    Clamping to the window means the current period reads "until now" and a
    past one reads "until it ended", which is the honest answer to how long the
    machine was down DURING it.

    `now` should come from db_now(). It falls back to the local clock only so
    that the function stays usable without a session; every caller here passes
    the database's.
    """
    start = datetime.combine(from_date, time(0, 0, 0))
    end = min(now or datetime.now(), datetime.combine(to_date, time(23, 59, 59)))
    return start, end


def params(from_date: date, to_date: date) -> dict[str, Any]:
    """Bind parameters IN_WINDOW_WHERE needs. Merge into the query's own."""
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
    w_start, w_end = window(from_date, to_date, now=db_now(db))
    _start, _end = _stamps(db)
    sql = text(f"""
        SELECT {key} AS bd_key, {_start} AS bd_s, {_end} AS bd_e
        FROM {TABLE}
        WHERE {IN_WINDOW_WHERE}
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
    """Notification counts per `key`, on the same start-date basis as the hours.

    Counted where it STARTED, so the count and the hours always describe the
    same set of events. A breakdown that began in September and ran into
    October is September's on both columns — if the two rules differed, a
    machine could show hours with no breakdowns, or breakdowns with no hours.

    This is also what MTBF already assumed: "breakdowns started in period".
    """
    sql = text(f"""
        SELECT {key} AS bd_key,
               COUNT(*) AS n_all,
               COUNT(CASE WHEN MALFUNCTION_END IS NOT NULL THEN 1 END) AS n_closed,
               COUNT(CASE WHEN {IS_OPEN} THEN 1 END)                   AS n_open
        FROM {TABLE}
        WHERE {IN_WINDOW_WHERE}
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
    """One row per notification RAISED in the window, each clipped to it.

    Same selection as the hours beside it, so the detail a user opens always
    accounts for the figure they clicked — a list that showed a carried-over
    fault the total did not count would read as a bug in the total.

    For a LIST of events, not for a total. Where notifications overlap these
    rows add up to more than the machine's merged downtime, which is correct
    for a list — each is a real fault — and wrong for a sum. Callers wanting a
    total must use hours_by or total_hours.
    """
    w_start, w_end = window(from_date, to_date, now=db_now(db))
    _start, _end = _stamps(db)
    cols = ("".join(f", {e}" for e in extra)) if extra else ""
    sql = text(f"""
        SELECT {_start} AS bd_s, {_end} AS bd_e,
               {IS_OPEN} AS bd_open{cols}
        FROM {TABLE}
        WHERE {IN_WINDOW_WHERE}
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
    "IS_OPEN", "IN_WINDOW_WHERE", "TABLE",
    "window", "params", "spans_by", "hours_by", "total_hours",
    "counts_by", "event_rows",
]
