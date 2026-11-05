"""The day the dashboard reports on, and the window that ends there.

ONE RULE, ONE PLACE. This was written twice — once in
routers/executive_summary.py and once in frontend/src/lib/prevDay.ts — and not
at all in the OEE and LCM endpoints, which is how the Lost Cost Matrix came to
divide a four-day plan by three days of shift log and report a multiplying
factor against a deviation measured over a different window. Every screen that
reports completed work asks here.

── THE RULE ────────────────────────────────────────────────────────────────
The reported day is the most recent day there can be a COMPLETE set of
figures for: the filter's end date, except when the filter runs to today or
beyond, because today has not finished.

    filter ends 30 Sep, today 1 Oct   ->  30 Sep   (the filter's end)
    filter ends  1 Oct, today 1 Oct   ->  30 Sep   (today has not ended)
    filter ends 31 Aug, today 1 Oct   ->  31 Aug   (looking back at August)

It is not "the filter's end minus one". A range already ending in the past has
had the subtraction done by whoever set it, and subtracting again names a day
the mine finished two days ago.

Mirrors reportDay() in frontend/src/lib/prevDay.ts.
"""
from __future__ import annotations

from datetime import date, timedelta


def report_day(to_date: date, today: date | None = None) -> date:
    """The last day that has ENDED, never later than the filter's end."""
    yesterday = (today or date.today()) - timedelta(days=1)
    return to_date if to_date < yesterday else yesterday


def stock_as_on(rd: date, today: date | None = None) -> date:
    """The snapshot showing where `rd` left the mine: the NEXT morning.

    The stock form is filled at the start of a day and dated that day, so the
    position resulting from the 30th's work is the snapshot dated the 1st.
    Never past today — there is no tomorrow to have filed anything.
    """
    return min(rd + timedelta(days=1), today or date.today())


def clamp(from_date: date, to_date: date,
          today: date | None = None) -> tuple[date, date]:
    """A requested window, cut back to the days that have actually ended.

    WHY THE LOWER BOUND IS `from_date` AND NOT THE REPORTED DAY. A filter set
    entirely in the future — next week, say — has no ended day in it at all,
    and clamping its end to yesterday would hand the caller a window running
    backwards. Every span calculation downstream counts `(to - from).days + 1`
    and would go negative, so a rate computed from it would come out negative
    rather than merely empty. Collapsing such a filter to its own first day
    keeps the window well formed; it holds no data either way, which is the
    honest answer to asking about days that have not happened.
    """
    return from_date, max(from_date, min(to_date, report_day(to_date, today)))
