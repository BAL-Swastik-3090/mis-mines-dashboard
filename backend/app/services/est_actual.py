"""The mine's own figure, for the days SAP has not answered for yet.

SAP posts production in arrears. Until it does, the only number that exists
for yesterday is the one the mine typed into mines_prev_day_actual, and a
screen built on SAP alone opens on a zero for the day everybody has just
finished discussing. The Executive Summary has stood the estimate in for that
gap since September; this module is the same rule, extracted, so the Lost Cost
Matrix and the COB matrix can follow it without each inventing their own.

── THE ESTIMATE STANDS IN, IT DOES NOT COMPETE ──────────────────────────────
A day is one source or the other, never a blend. PRESENCE of a posting is the
test, not a non-zero value: SAP having answered a day with zero is still SAP
answering, and a hand-typed figure must not argue with it.

── NOTHING IS STORED TO WORK THIS OUT ───────────────────────────────────────
The estimate stays in the table after SAP posts, so "what it was" and "what it
is" are both still on disk and the handover is simply the two being present
for one day. No flag to set, nothing to go stale, and it reads the same
whoever asks and whenever.

── IT IS AN ESTIMATE, AND THE DIFFERENCE IS LARGE ───────────────────────────
Over the 41 days to 15 November 2026 where both exist, the two differ by 37%
on the average day and by 100% on the worst, and the estimate runs 19% LOW
across the span as a whole. In the LCM a low actual means a BIGGER deviation,
so a window still waiting on SAP overstates the loss and settles downward when
SAP speaks. That is why every caller reports which source it used rather than
printing one number as though it were the same thing either way.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

# What the mine types, and what each row means in the matrices that read it.
MAT_ORE = "ORE"
MAT_OB = "OB"
MAT_COB = "COB"            # concentrate OUT of the plant, not the feed in

SRC_SAP, SRC_MANUAL, SRC_MIXED = "sap", "manual", "mixed"


def posted_days(db: Session, sql: str, params: dict) -> set[date]:
    """The days a SAP query returned a row for.

    The caller supplies the query because the filter differs -- plant and
    material are not the same for ore, overburden and concentrate -- but the
    test never does: one row for a day means SAP has answered it.
    """
    return {r[0] for r in db.execute(text(sql), params) if r[0] is not None}


def estimate(db: Session, fd: date, td: date, material: str,
             covered: set[date]) -> dict:
    """The mine's figure for the days inside the window that SAP has not posted.

    Returns the tonnage to ADD to the SAP figure, how many days it came from,
    and the last day it covers -- which is what a screen needs to say "filled
    to the 15th" rather than leaving a reader to guess how much is estimated.
    """
    rows = db.execute(text("""
        SELECT `Date` AS d, Est_Actual AS q
        FROM mines_prev_day_actual
        WHERE Material = :m AND `Date` BETWEEN :f AND :t
    """), {"m": material, "f": fd, "t": td}).fetchall()

    qty = 0.0
    days: list[date] = []
    for r in rows:
        if r.d in covered:
            continue                      # SAP has spoken for this day
        qty += float(r.q or 0)
        days.append(r.d)
    return {
        "qty": round(qty, 2),
        "days": len(days),
        "last_day": max(days) if days else None,
    }


def source_of(sap_qty: float, est_qty: float) -> str:
    """Which label a figure has earned.

    Recomputed every request, so it follows the data: the moment SAP posts the
    last outstanding day, the figure becomes `sap` with nothing to intervene.
    """
    if est_qty and sap_qty:
        return SRC_MIXED
    if est_qty:
        return SRC_MANUAL
    return SRC_SAP
