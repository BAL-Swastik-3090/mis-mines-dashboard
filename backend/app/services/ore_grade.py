"""
Grade-wise weighted average Cr2O3 of ore production.

    Weighted Avg = Σ(Grade Value × Qty) ÷ Σ Qty

Everything comes from ONE table, which is what makes this reliable: the assay
and the tonnage it applies to are on the same row, so there is no join and no
possibility of weighting a result by a quantity that belongs to something else.

    pp_quality_inspection
      PLANT               = '1200'
      STORAGE_LOCATION    = 'ROM1'
      SHORT_TEXT_INS_CHAR = 'Cr2O3'      <- essential, see below
      MATERIAL_NO         -> HG / MG / LG
      RESULT              -> the grade value (%)
      ACTUAL_LOT_QUANTITY -> the weight (TO)
      QLT_START_DATE      -> the date

The Cr2O3 filter is not optional. ROM1 also carries FeO (14-19%), Cr/Fe Ratio
(2.25-3.45) and Moisture rows; without the filter those would be averaged in as
if they were grades and the figure would be badly wrong.

One Cr2O3 result per lot, so there is no sample-averaging step — each row is a
lot, weighted by that lot's own tonnage.

Confidence in the source: ACTUAL_LOT_QUANTITY at ROM1 matches MG production
tonnage from pp_production on 14 of 15 days in Aug 2026 (525, 930, 345, 360,
765, 615, 720, ...), so this is the assay of the ore actually produced, not a
separate sampling programme.

Scope note: ROM1 holds MG throughout, HG only to 15-Jan-2026, and no LG at all —
LG is inspected at DY01. So in a recent period this is effectively the MG grade.
The query still asks for all three materials, so HG or LG appear automatically if
they are ever inspected at ROM1, without a code change.
"""
from datetime import date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text

PLANT            = "1200"
STORAGE_LOCATION = "ROM1"
INSPECTION_CHAR  = "Cr2O3"

# MATERIAL_NO -> grade bucket, in display order.
GRADES = [
    ("HG", "000000000025000002", "HG >52%"),
    ("MG", "000000000025000001", "MG 40–52%"),
    ("LG", "000000000025000003", "LG <40%"),
]


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def get_ore_grade_weighted(db: Session, from_date: date, to_date: date) -> dict:
    """Daily and period weighted-average Cr2O3, plus the per-grade detail."""
    sel = []
    params: dict = {"plant": PLANT, "loc": STORAGE_LOCATION, "ch": INSPECTION_CHAR,
                    "fd": from_date, "td": to_date}
    for key, mat, _label in GRADES:
        k = key.lower()
        params[f"m_{k}"] = mat
        # Numerator and denominator kept separate per grade so the weighted
        # average can be re-derived at any level of aggregation — a period
        # figure is Σnum ÷ Σden, never an average of daily averages.
        sel.append(f"COALESCE(SUM(CASE WHEN MATERIAL_NO = :m_{k} "
                   f"THEN ACTUAL_LOT_QUANTITY END), 0) AS {k}_qty")
        sel.append(f"COALESCE(SUM(CASE WHEN MATERIAL_NO = :m_{k} "
                   f"THEN RESULT * ACTUAL_LOT_QUANTITY END), 0) AS {k}_num")

    rows = db.execute(text(f"""
        SELECT QLT_START_DATE AS dt,
               {', '.join(sel)},
               COALESCE(SUM(ACTUAL_LOT_QUANTITY), 0)          AS tot_qty,
               COALESCE(SUM(RESULT * ACTUAL_LOT_QUANTITY), 0)  AS tot_num,
               COUNT(*)                                        AS lots
        FROM   pp_quality_inspection
        WHERE  PLANT               = :plant
          AND  STORAGE_LOCATION    = :loc
          AND  SHORT_TEXT_INS_CHAR = :ch
          AND  MATERIAL_NO IN (:m_hg, :m_mg, :m_lg)
          -- A zero-quantity lot carries no weight; excluding it also stops a
          -- day made up only of such lots from producing a 0/0 division.
          AND  ACTUAL_LOT_QUANTITY > 0
          AND  QLT_START_DATE BETWEEN :fd AND :td
        GROUP BY QLT_START_DATE
        ORDER BY QLT_START_DATE
    """), params).fetchall()

    by_date = {}
    tot_num = tot_qty = 0.0
    grade_num = {k: 0.0 for k, _, _ in GRADES}
    grade_qty = {k: 0.0 for k, _, _ in GRADES}

    for r in rows:
        m = dict(r._mapping)
        day_qty = _f(m["tot_qty"])
        day_num = _f(m["tot_num"])
        tot_qty += day_qty
        tot_num += day_num

        per_grade = []
        for key, _mat, label in GRADES:
            k = key.lower()
            q, n = _f(m[f"{k}_qty"]), _f(m[f"{k}_num"])
            grade_qty[key] += q
            grade_num[key] += n
            per_grade.append({
                "grade_key":   key,
                "grade_label": label,
                "qty":         round(q, 3),
                "cr2o3":       round(n / q, 3) if q > 0 else None,
            })

        by_date[str(m["dt"])] = {
            "date":        str(m["dt"]),
            "total_qty":   round(day_qty, 3),
            "weighted_cr": round(day_num / day_qty, 3) if day_qty > 0 else None,
            "lots":        int(m["lots"] or 0),
            "grades":      per_grade,
        }

    # Full date spine so the chart's x-axis is calendar-continuous. A day with no
    # inspection is a gap in the line, not a zero — a zero would read as ore
    # assaying at 0% Cr2O3.
    spine = [from_date + timedelta(days=i) for i in range((to_date - from_date).days + 1)]
    daily = [by_date.get(str(d), {
        "date": str(d), "total_qty": 0.0, "weighted_cr": None, "lots": 0,
        "grades": [{"grade_key": k, "grade_label": lb, "qty": 0.0, "cr2o3": None}
                   for k, _m, lb in GRADES],
    }) for d in spine]

    return {
        "from_date": from_date.isoformat(),
        "to_date":   to_date.isoformat(),
        "rows":      daily,
        # Period figure from the summed numerator and denominator, NOT the mean
        # of the daily figures — a heavy day must count for more than a light one.
        "period_weighted_cr": round(tot_num / tot_qty, 3) if tot_qty > 0 else None,
        "period_total_qty":   round(tot_qty, 3),
        "days_with_data":     len(rows),
        "days_in_period":     len(spine),
        "period_grades": [{
            "grade_key":   k,
            "grade_label": lb,
            "qty":         round(grade_qty[k], 3),
            "cr2o3":       round(grade_num[k] / grade_qty[k], 3) if grade_qty[k] > 0 else None,
            "share_pct":   round(grade_qty[k] / tot_qty * 100, 2) if tot_qty > 0 else 0.0,
        } for k, _m, lb in GRADES],
        "source": "SAP quality inspection · ROM1 · Cr₂O₃",
    }
