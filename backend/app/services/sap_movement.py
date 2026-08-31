"""
SAP movement-type handling for pp_production.

Every quantity in pp_production is stored POSITIVE, including reversals. A
reversal is a separate document with its own movement type, so summing QUANTITY
without regard to movement type adds the correction to the mistake instead of
cancelling it.

    531  Receipt by-product        101  GR goods receipt      261  GI for order
    532  RE by-product             102  GR for PO reversal    262  RE for order

Production is the receipt movements NET of their reversals. Goods issue (261) is
consumption, not production, and is excluded from production entirely.

    Production  = SUM(101, 531) - SUM(102, 532)
    Consumption = SUM(261)      - SUM(262)

This was proved against SAP rather than assumed. For plant 1200 ore materials,
1-28 Aug 2026 — the window the mine queried:

    sum of every movement type      19,397.02   <- what the dashboard showed
    filter to 101 and 531 only      17,383.01   <- still wrong
    (101 - 102) + (531 - 532)       15,957.00   <- SAP, to the paisa

Filtering to the receipt movements is NOT sufficient on its own: it keeps the
mistaken posting and discards its correction, leaving the figure 1,426 MT high.
The reversals have to be subtracted.

Safety of netting inside a window: every reversal in the table is posted on the
SAME DATE as the document it reverses, and for the same quantity — 18 Aug '102'
MG 450 against '101' MG 450; 23 Aug '262' LG 294 against '261' LG 294. So
netting cannot over-subtract at either daily or period grain.

The one case this cannot handle: pp_production has no reference-document column,
so nothing links a 102 back to the 101 it reverses. A reversal posted in a later
month than its original would over-subtract from that later month. No such row
exists today. `reversal_summary()` below exists so the condition can be
inspected rather than assumed away.

WHY THIS IS A MODULE and not a filter in each query: the rule was previously
absent from some queries, half-applied in others (COB filtered to 101/531 but
never netted), and duplicated across nine places that could each drift on their
own. There is now exactly one definition. Add a movement type here and every
consumer picks it up.
"""
from __future__ import annotations
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

RECEIPT_TYPES     = ("101", "531")
RECEIPT_REVERSALS = ("102", "532")
ISSUE_TYPE        = "261"
ISSUE_REVERSAL    = "262"

# Signed production quantity for one row. Substituted into a SUM(CASE WHEN
# <material/plant condition> THEN (PRODUCTION_QTY) ELSE 0 END) so the movement
# rule and the material rule stay independent of each other.
PRODUCTION_QTY = """
        CASE WHEN MOVEMENT_TYPE IN ('101','531') THEN QUANTITY
             WHEN MOVEMENT_TYPE IN ('102','532') THEN -QUANTITY
             ELSE 0 END
"""

# Signed consumption quantity — goods issue to a production order, net of its
# reversal. Used for COB feed, which is LG ore consumed by the plant.
CONSUMPTION_QTY = """
        CASE WHEN MOVEMENT_TYPE = '261' THEN QUANTITY
             WHEN MOVEMENT_TYPE = '262' THEN -QUANTITY
             ELSE 0 END
"""

# Bare SQL predicate for callers that only need to exclude non-production rows
# rather than sign them (none today; kept because a COUNT or a MAX cannot use a
# signed CASE and would otherwise reinvent the list).
PRODUCTION_MOVEMENTS_IN = "MOVEMENT_TYPE IN ('101','531','102','532')"


def reversal_summary(db: Session, from_date: date, to_date: date,
                     plant: str | None = None) -> dict:
    """Reversal documents in the window, for diagnostics.

    Not surfaced on any page — the mine asked for the correction to be silent.
    It exists so the cross-month case described above can be checked from a
    console instead of being taken on trust, and so a future spike in
    corrections is findable.
    """
    where = "POSTING_DATE BETWEEN :f AND :t"
    params: dict = {"f": from_date, "t": to_date}
    if plant:
        where += " AND PLANT = :plant"
        params["plant"] = plant

    rows = db.execute(text(f"""
        SELECT PLANT, MOVEMENT_TYPE, MATERIAL_NO, MATERIAL_DESC,
               COUNT(*) AS docs, SUM(QUANTITY) AS qty
        FROM pp_production
        WHERE {where}
          AND MOVEMENT_TYPE IN ('102','532','262')
        GROUP BY PLANT, MOVEMENT_TYPE, MATERIAL_NO, MATERIAL_DESC
        ORDER BY qty DESC
    """), params).fetchall()

    return {
        "documents": sum(int(r.docs) for r in rows),
        "quantity":  round(sum(float(r.qty or 0) for r in rows), 3),
        "rows": [{
            "plant":         r.PLANT,
            "movement_type": r.MOVEMENT_TYPE,
            "material_no":   r.MATERIAL_NO,
            "material_desc": r.MATERIAL_DESC,
            "documents":     int(r.docs),
            "quantity":      float(r.qty or 0),
        } for r in rows],
    }
