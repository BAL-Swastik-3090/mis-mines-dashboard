"""
Plant Performance (Ferro Chrome) service.
Table : pp_prod_order_confirmation
BAL   : PLANT='1100', WORK_CENTER IN (FURNACE1..5)
SUK   : PLANT='1110', WORK_CENTER='FURNACE1'
Actuals only — no plan data.
"""
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import text


def get_plant_performance(db: Session, from_date: date, to_date: date) -> dict:

    sql = text("""
        SELECT
            PLANT,
            ROUND(SUM(CONFIRMED_YIELD), 2)     AS total,
            COUNT(DISTINCT POSTING_DATE)        AS days
        FROM pp_prod_order_confirmation
        WHERE POSTING_DATE BETWEEN :from_date AND :to_date
          AND (
              (PLANT = '1100' AND WORK_CENTER IN ('FURNACE1','FURNACE2','FURNACE3','FURNACE4','FURNACE5'))
              OR
              (PLANT = '1110' AND WORK_CENTER = 'FURNACE1')
          )
        GROUP BY PLANT
    """)

    rows = db.execute(sql, {"from_date": from_date, "to_date": to_date}).fetchall()

    bal_total = 0.0
    suk_total = 0.0
    bal_days  = 0
    suk_days  = 0

    for r in rows:
        if r.PLANT == "1100":
            bal_total = float(r.total or 0)
            bal_days  = int(r.days or 0)
        elif r.PLANT == "1110":
            suk_total = float(r.total or 0)
            suk_days  = int(r.days or 0)

    # Use the maximum distinct days across both plants for consistent MT/day
    days = max(bal_days, suk_days, 1)

    combined_total   = round(bal_total + suk_total, 2)
    combined_per_day = round(combined_total / days, 1)
    bal_per_day      = round(bal_total / max(bal_days, 1), 1)
    suk_per_day      = round(suk_total / max(suk_days, 1), 1)
    bal_share        = round(bal_total / combined_total * 100, 1) if combined_total else 0.0
    suk_share        = round(suk_total / combined_total * 100, 1) if combined_total else 0.0

    return {
        "from_date":        from_date,
        "to_date":          to_date,
        "days":             days,
        "combined_total":   combined_total,
        "combined_per_day": combined_per_day,
        "bal": {
            "total":     round(bal_total, 2),
            "per_day":   bal_per_day,
            "share_pct": bal_share,
        },
        "suk": {
            "total":     round(suk_total, 2),
            "per_day":   suk_per_day,
            "share_pct": suk_share,
        },
    }
