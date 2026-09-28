"""How long a breakdown has lasted — one definition, used everywhere.

THE RULE. A breakdown that SAP has closed lasted from its malfunction start to
its malfunction end. A breakdown that is still open has lasted from its start
until now, and it keeps growing until somebody closes the notification. Before
this module the open ones counted as zero, so a machine that went down on the
3rd and was still down on the 28th contributed nothing at all.

WHY THE EXPRESSION AND NOT THE COLUMN. SAP's own BREAKDOWN_DURAION (the typo is
in SAP's export) is only populated once MALFUNCTION_END exists — an open
notification carries 0.00. For closed events the two agree exactly: checked
across September 2026, SAP's seconds equal
TIMESTAMPDIFF(start, end) on every row with no difference at all, so nothing is
lost by keeping the stored figure for those and computing only the open ones.

    closed   COALESCE(BREAKDOWN_DURAION, 0)          -- seconds, from SAP
    open     start -> LEAST(NOW(), end of window)    -- seconds, computed

WHY IT STOPS AT THE END OF THE WINDOW. An open breakdown counted to NOW would
keep growing inside a month that has already finished — August's figure would
be different every time it was opened, and a breakdown that started on 1 August
and is still open would eventually exceed the hours in the month. Clamping to
the window means the current month reads "until now", which is what was asked
for, and a past month reads "until the month ended", which is the honest answer
to how long the machine was down during it.

WHAT THIS DOES NOT DECIDE. A notification stays open until maintenance closes
it, which is not the same as the machine being down. In September 2026 five of
the seven open notifications were for broken cab glass and an air conditioner,
and IMOS records TATA-470(2) working fourteen shift-days and 1,872 CuM after
its notification opened. The duration below is therefore "how long this
notification has been open", and where notifications are not closed promptly
that is longer than the machine was actually stopped. Nothing here can tell the
two apart — SAP's BREAKDOWN flag is 'X' on all 390 mine notifications — so it
is reported as-is rather than guessed at.
"""
from __future__ import annotations

from datetime import date, datetime, time

# Seconds. Requires a :bd_upto bind parameter — see upto() below.
DURATION_SECONDS = """
        CASE
            WHEN MALFUNCTION_START IS NULL THEN 0
            WHEN MALFUNCTION_END IS NOT NULL THEN COALESCE(BREAKDOWN_DURAION, 0)
            ELSE GREATEST(
                TIMESTAMPDIFF(
                    SECOND,
                    TIMESTAMP(MALFUNCTION_START,
                              COALESCE(MALFUNCTION_START_TIME, '00:00:00')),
                    LEAST(NOW(), :bd_upto)),
                0)
        END"""

# Hours, which is what every caller actually reports.
DURATION_HOURS = f"(({DURATION_SECONDS}) / 3600.0)"

# Still running. MALFUNCTION_END is the only reliable marker: SYSTEM_STATUS can
# read OSNO on a notification that already has an end time, and BREAKDOWN_DURAION
# is 0 both for an open event and for one closed within the same minute.
IS_OPEN = "(MALFUNCTION_START IS NOT NULL AND MALFUNCTION_END IS NULL)"


def upto(to_date: date) -> datetime:
    """The instant an open breakdown is counted up to for this window.

    The last moment of the report's final day. Paired with LEAST(NOW(), ...) in
    the SQL, so a window ending today counts to now and a window that has
    already closed counts to its own end.
    """
    return datetime.combine(to_date, time(23, 59, 59))


def params(to_date: date) -> dict:
    """The bind parameters DURATION_SECONDS needs. Merge into the query's own."""
    return {"bd_upto": upto(to_date)}
