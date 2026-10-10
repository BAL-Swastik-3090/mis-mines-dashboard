"""Mines Executive Summary — the mine's daily report, on one screen.

Reproduces "Mines Daily Report": stock position, production, despatch to each
plant, and ferrochrome output, each as TD (the reported day) and MTD.

── IT COMPOSES, IT DOES NOT RE-QUERY ────────────────────────────────────────
Every block is built from the service that already owns that figure, and the
despatch block imports the banding helpers from despatch_grade rather than
copying them. A second implementation of any of these would mean two screens
quoting different numbers for the same day with nothing to say which is right —
and the one most likely to drift is despatch, where the mines filter is a
weighbridge OR a hauler name and the trips have to be de-duplicated by delivery.

── TWO AS-ON DATES, AND WHY THEY DIFFER BY A DAY ────────────────────────────
The mine's own sheet is headed "Stock Position as on 6 Oct" and "Performance as
on 5 Oct", which looks like an error and is not. Stock is counted at the START
of a day, so the snapshot dated the 6th is what the 5th's work left behind.
Performance is a completed day. The two headings describe the same day's work
from either end, so the screen keeps the offset instead of forcing one date.

    report_day = the last day that has ENDED, never later than the filter
    stock_as_on = report_day + 1   (the morning after), never past today
    MTD         = 1st of report_day's month .. report_day

This mirrors reportDay() and stockAsOn() in frontend/src/lib/prevDay.ts, which
the MIS dashboard already uses, so the Executive Summary and the sections it
summarises can never name different days.

── CELLS THAT ARE BLANK TODAY AND FILL THEMSELVES LATER ─────────────────────
Nothing here is hard-coded to None. Each of the following is an ordinary query
that currently returns nothing, so the day the data starts arriving it appears
with no code change:

    HG production       the mine is not producing HG; last ROM1 lot 26 Jan 2026
    Cr/Fe on production SAP's production entry does not post the characteristic;
                        only DY01 (despatch) carries Cr/Fe and moisture
    LG Cr2O3            LG is received at LGCR, which is not inspected
    Sukinda plant Cr%   Jabamoyee files no daily composite assay

A zero would claim the mine produced none. A blank says nobody recorded it, and
those are different statements.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import stock as stock_svc
from app.services.despatch_grade import (
    COB_KEY, GRADE_BANDS, MINES_CUSTOMERS, UNASSAYED_KEY,
    _Acc, _band_of, _despatch_rows, _quality,
)
from app.services.plant_output import _totals as _plant_totals, get_plant_output

# The four rows of every grade table on the sheet, in its order.
GRADES: tuple[tuple[str, str], ...] = (
    ("HG", "HG"), ("MG", "MG"), ("LG", "LG"), ("COB", "COB"),
)

# ── Block 2: where each grade's production tonnage comes from ────────────────
#
# NOT from the ROM1 inspection lots. Those cover HG and MG only — LG is received
# at LGCR and never inspected — so a grade table built on inspections would be
# missing a quarter of the mine's output. pp_production has all of it.
#
# THE MOVEMENT TYPE IS NOT THE SAME FOR EVERY GRADE. Ore is a goods receipt
# against the production order (101); low grade arrives as a by-product receipt
# (531). Using 101 everywhere returns zero for LG and looks like the mine
# stopped producing it.
#
# REVERSALS MUST BE NETTED. LGCR carries 4,490 MT of 532 and ROM1 3,435 MT of
# 102 across 2026; counting receipts alone overstates production by that much.
# The 261/262 pairs are consumption and cancel exactly, so they are excluded
# rather than netted.
#
# Cross-checked: September MG from pp_production is 15,519.0 MT and the ROM1
# inspected lots for the same month total 15,519.0 MT. The tonnage and the assay
# are the same ore.
PROD_SOURCES: dict[str, dict[str, Any]] = {
    "HG": {"material": "25000002", "sloc": "ROM1", "receipt": "101", "reversal": "102"},
    "MG": {"material": "25000001", "sloc": "ROM1", "receipt": "101", "reversal": "102"},
    "LG": {"material": "25000003", "sloc": "LGCR", "receipt": "531", "reversal": "532"},
}
MINE_PLANT = "1200"

# ── ONE SCAN PER TABLE, NOT ONE PER GRADE PER PERIOD ────────────────────────
# pp_production holds 387,079 rows and is indexed on MATERIAL_DOCUMENT,
# MAT_DOC_ITEM and ORDER_NUMBER only — nothing on PLANT, MATERIAL_NO,
# STORAGE_LOCATION or POSTING_DATE. Every query against it is therefore a full
# table scan, and the first version of this service ran six of them (three
# grades x two periods) plus six more against pp_quality_inspection. That cost
# 6.8 seconds of a 13.8-second page.
#
# TD IS A SUBSET OF MTD — the same month, ending on the same day — so both
# periods come out of ONE pass with a conditional sum, and the grades come out
# of the same pass grouped by material. Six scans become one.
#
# Adding an index on (PLANT, POSTING_DATE) would help far more than this and is
# the real fix; it is a change to a shared production database and is not mine
# to make.
_PROD_QTY_SQL = text("""
    SELECT MATERIAL_NO, STORAGE_LOCATION, MOVEMENT_TYPE,
           COALESCE(SUM(CASE WHEN POSTING_DATE = :rd THEN QUANTITY END), 0) AS td_qty,
           COALESCE(SUM(QUANTITY), 0)                                       AS mtd_qty
    FROM pp_production
    WHERE PLANT = :plant
      AND POSTING_DATE BETWEEN :mf AND :rd
      AND MOVEMENT_TYPE IN ('101', '102', '531', '532')
    GROUP BY MATERIAL_NO, STORAGE_LOCATION, MOVEMENT_TYPE
""")

# The assay of the ore produced, weighted by the lot's own tonnage, for both
# periods and every ROM1 material in one pass.
#
# ONE ROW PER CHARACTERISTIC in this table, so Cr2O3 is selected explicitly and
# the tonnage comes from a DISTINCT sub-select. Without the first, FeO (14-19)
# and Cr/Fe Ratio (2.25-3.45) would be averaged in as though they were grades;
# without the second, every lot would be counted once per characteristic it
# carries.
_PROD_ASSAY_SQL = text("""
    SELECT l.material AS material,
           SUM(CASE WHEN l.d = :rd THEN l.qty * c.v END) AS td_num,
           SUM(CASE WHEN l.d = :rd THEN l.qty END)       AS td_den,
           SUM(l.qty * c.v)                              AS mtd_num,
           SUM(l.qty)                                    AS mtd_den
    FROM (
        SELECT DISTINCT LOT_NUMBER, MATERIAL_NO AS material,
               QLT_START_DATE AS d, LOT_QUANTITY AS qty
          FROM pp_quality_inspection
         WHERE PLANT = :plant AND STORAGE_LOCATION = :sloc
           AND QLT_START_DATE BETWEEN :mf AND :rd
           AND LOT_QUANTITY IS NOT NULL
    ) l
    JOIN (
        SELECT LOT_NUMBER, MAX(CAST(NULLIF(RESULT,'') AS DECIMAL(16,6))) AS v
          FROM pp_quality_inspection
         WHERE PLANT = :plant AND STORAGE_LOCATION = :sloc
           AND UPPER(SHORT_TEXT_INS_CHAR) = 'CR2O3'
           AND QLT_START_DATE BETWEEN :mf AND :rd
         GROUP BY LOT_NUMBER
    ) c ON c.LOT_NUMBER = l.LOT_NUMBER
    GROUP BY l.material
""")

# COB is produced and assayed on the mine's own form, not in SAP, and it is the
# one grade carrying Cr/Fe — the Ratio column — because the mine enters it.
_COB_SQL = text("""
    SELECT
      COALESCE(SUM(CASE WHEN Prod_date = :rd THEN Qty END), 0)        AS td_qty,
      SUM(CASE WHEN Prod_date = :rd THEN Qty * Cr2O3 END)             AS td_cr_num,
      SUM(CASE WHEN Prod_date = :rd AND Cr2O3 IS NOT NULL THEN Qty END) AS td_cr_den,
      SUM(CASE WHEN Prod_date = :rd THEN Qty * Ratio END)             AS td_fe_num,
      SUM(CASE WHEN Prod_date = :rd AND Ratio IS NOT NULL THEN Qty END) AS td_fe_den,
      COALESCE(SUM(Qty), 0)                                           AS mtd_qty,
      SUM(Qty * Cr2O3)                                                AS mtd_cr_num,
      SUM(CASE WHEN Cr2O3 IS NOT NULL THEN Qty END)                   AS mtd_cr_den,
      SUM(Qty * Ratio)                                                AS mtd_fe_num,
      SUM(CASE WHEN Ratio IS NOT NULL THEN Qty END)                   AS mtd_fe_den
    FROM mines_cob_production_despatch
    WHERE Prod_date BETWEEN :mf AND :rd
""")


def _f(v) -> float | None:
    return None if v is None else float(v)


def _r(v, places: int = 2) -> float | None:
    return None if v is None else round(float(v), places)


# -- Block 2 -----------------------------------------------------------------
def _production_both(db: Session, mf: date, rd: date) -> dict[str, list[dict]]:
    """Mines production by grade for TD and MTD, from one pass per table."""
    qty: dict[tuple[str, str, str], tuple[float, float]] = {}
    for r in db.execute(_PROD_QTY_SQL, {"plant": MINE_PLANT, "mf": mf, "rd": rd}):
        key = (str(r.MATERIAL_NO)[-8:], str(r.STORAGE_LOCATION), str(r.MOVEMENT_TYPE))
        qty[key] = (float(r.td_qty or 0), float(r.mtd_qty or 0))

    assay: dict[str, tuple[float | None, float | None]] = {}
    for r in db.execute(_PROD_ASSAY_SQL,
                        {"plant": MINE_PLANT, "sloc": "ROM1", "mf": mf, "rd": rd}):
        td = float(r.td_num) / float(r.td_den) if r.td_den else None
        mtd = float(r.mtd_num) / float(r.mtd_den) if r.mtd_den else None
        assay[str(r.material)[-8:]] = (td, mtd)

    c = db.execute(_COB_SQL, {"mf": mf, "rd": rd}).fetchone()

    def div(n, d):
        return (float(n) / float(d)) if (n is not None and d) else None

    out: dict[str, list[dict]] = {"td": [], "mtd": []}
    for key, label in GRADES:
        if key == "COB":
            vals = ({"td": (c.td_qty, div(c.td_cr_num, c.td_cr_den),
                            div(c.td_fe_num, c.td_fe_den)),
                     "mtd": (c.mtd_qty, div(c.mtd_cr_num, c.mtd_cr_den),
                             div(c.mtd_fe_num, c.mtd_fe_den))}
                    if c else {"td": (0, None, None), "mtd": (0, None, None)})
            for per in ("td", "mtd"):
                q, cr, fe = vals[per]
                out[per].append({"grade": key, "label": label, "qty": _r(q),
                                 "cr2o3": _r(cr, 3), "crfe": _r(fe, 3)})
            continue

        src = PROD_SOURCES[key]
        rcpt = qty.get((src["material"], src["sloc"], src["receipt"]), (0.0, 0.0))
        rev = qty.get((src["material"], src["sloc"], src["reversal"]), (0.0, 0.0))
        a = assay.get(src["material"], (None, None))
        for i, per in enumerate(("td", "mtd")):
            out[per].append({
                "grade": key, "label": label,
                "qty": _r(rcpt[i] - rev[i]),
                # LGCR is not an inspection location, so LG has no entry here --
                # which is the honest answer, not a zero.
                "cr2o3": _r(a[i], 3),
                # SAP's production entry posts no Cr/Fe for ore at any grade.
                "crfe": None,
            })
    return out


# -- Blocks 3 and 4 ----------------------------------------------------------
def _despatch_both(db: Session, mf: date, rd: date) -> dict[str, dict[str, list[dict]]]:
    """Despatch by grade and receiving plant, for TD and MTD, from one fetch.

    Uses despatch_grade's own helpers -- the same trip filter, the same PO+BATCH
    assay match, the same band boundaries -- so this table and the Grade-wise
    Despatch section cannot disagree. What is added is the split by customer
    WITH the assay: that service keeps per-customer tonnage but weights Cr2O3
    across a customer's whole despatch, and the sheet wants it per grade within
    each plant.

    TRIPS AND ASSAYS ARE FETCHED ONCE, for the MTD window, and TD is the subset
    whose gate date is the report day. _quality() is the expensive half -- it is
    scoped by PO, not by date, because an assay can be raised days after the
    truck leaves -- so running it twice doubled the cost of the block for no new
    information.
    """
    trips = _despatch_rows(db, mf, rd)
    pos = sorted({t.po for t in trips if t.po})
    by_batch, by_po, _mat, _mat_po, po_is_cob = _quality(db, pos)

    def fresh() -> dict[str, dict[str, _Acc]]:
        a = {c: {k: _Acc() for k, *_ in GRADE_BANDS} for c in MINES_CUSTOMERS}
        for c in a:
            a[c][COB_KEY] = _Acc()
            a[c][UNASSAYED_KEY] = _Acc()
        return a

    acc = {"td": fresh(), "mtd": fresh()}
    for t in trips:
        if t.customer not in acc["mtd"]:
            continue
        q = by_batch.get((t.po, t.batch))
        if q is None or q["cr"] is None:
            q = by_po.get(t.po)
        if q is None or q["cr"] is None:
            q = None
        cr = q["cr"] if q else None
        fe = q["fe"] if q else None
        band = COB_KEY if (po_is_cob.get(t.po, False) and cr is not None) else _band_of(cr)
        wt = float(t.wt or 0)
        acc["mtd"][t.customer][band].add(wt, cr, fe)
        if t.dt == rd:
            acc["td"][t.customer][band].add(wt, cr, fe)

    out: dict[str, dict[str, list[dict]]] = {}
    for per, bycust in acc.items():
        out[per] = {}
        for cust, bands in bycust.items():
            rows = [{"grade": k, "label": lbl,
                     "qty": _r((bands.get(k) or _Acc()).tonnage),
                     "cr2o3": (bands.get(k) or _Acc()).cr,
                     "crfe": (bands.get(k) or _Acc()).fe}
                    for k, lbl in GRADES]
            # UNASSAYED IS A ROW, NOT A ROUNDING. Tonnage that left with no
            # assay yet has no grade to sit in, and folding it into one would
            # move real tonnes into a band they were never measured for.
            u = bands[UNASSAYED_KEY]
            if u.tonnage > 0:
                rows.append({"grade": "UNASSAYED", "label": "Not yet assayed",
                             "qty": _r(u.tonnage), "cr2o3": None, "crfe": None})
            out[per][cust] = rows
    return out


# -- Block 5 -----------------------------------------------------------------
def _plant_both(db: Session, mf: date, rd: date) -> dict[str, list[dict]]:
    """Ferrochrome per plant for TD and MTD, from one call to plant_output.

    That service already weights Cr by tonnage and reports how much of the
    tonnage the average covers, so its own _totals is reused rather than the
    rows being re-summed here -- a second summation is a second chance to weight
    it differently. TD is the subset of its rows dated the report day.
    """
    data = get_plant_output(db, mf, rd)
    rows_all = data.get("rows", [])
    iso = rd.isoformat()
    subsets = {"mtd": rows_all, "td": [r for r in rows_all if r["date"] == iso]}

    out: dict[str, list[dict]] = {}
    for per, rows in subsets.items():
        out[per] = []
        for p in data.get("plants", []):
            t = _plant_totals([r for r in rows if r["plant"] == p["key"]]) or {}
            out[per].append({
                "plant": p["label"],
                "qty": _r(t.get("yield_t") or 0),
                # Jabamoyee files no daily composite, so this is None there
                # today. It is the service's own figure, so it appears the
                # moment they start filing one.
                "cr": _r(t.get("cr"), 3),
                "cr_covered_pct": t.get("cr_covered_pct"),
            })
    return out


def _weighted(rows: list[dict], qty_key: str = "qty") -> dict:
    """The sheet's Weighted Average row: SUMPRODUCT / SUM, never a mean."""
    tot = sum((r.get(qty_key) or 0) for r in rows)
    def w(field: str):
        num = sum((r.get(qty_key) or 0) * r[field] for r in rows if r.get(field) is not None)
        den = sum((r.get(qty_key) or 0) for r in rows if r.get(field) is not None)
        return round(num / den, 3) if den else None
    return {"qty": _r(tot), "cr2o3": w("cr2o3"), "crfe": w("crfe"), "cr": w("cr")}


def get_executive_summary(db: Session, report_day: date,
                          stock_as_on: date) -> dict[str, Any]:
    """The whole report: stock at one date, performance TD and MTD at another.

    TD AND MTD ARE BUILT TOGETHER, not by calling the same code twice with
    different dates. TD is the last day of the MTD window, so every row it needs
    is already in the MTD fetch; asking the database for it again doubled the
    page's cost and could, if a row landed between the two calls, return a TD
    that was not a subset of its own month.
    """
    mtd_from = report_day.replace(day=1)
    prod = _production_both(db, mtd_from, report_day)
    desp = _despatch_both(db, mtd_from, report_day)
    plant = _plant_both(db, mtd_from, report_day)

    def block(per: str) -> dict:
        return {
            "production": prod[per],
            "production_total": _weighted(prod[per]),
            "despatch": {c: desp[per].get(c, []) for c in MINES_CUSTOMERS},
            "despatch_total": {c: _weighted(desp[per].get(c, []))
                               for c in MINES_CUSTOMERS},
            "plant": plant[per],
            "plant_total": _weighted(plant[per]),
        }

    return {
        "report_day": report_day.isoformat(),
        "stock_as_on": stock_as_on.isoformat(),
        "mtd_from": mtd_from.isoformat(),
        "stock": stock_svc.get_stock_position(db, stock_as_on),
        "td": block("td"),
        "mtd": block("mtd"),
    }
