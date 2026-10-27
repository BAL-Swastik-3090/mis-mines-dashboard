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
    Cr/Fe before 9 Oct  ROM1 posted Cr2O3 alone until the 9 Oct 2026 lot; from
                        there it carries Cr/Fe Ratio too, so an earlier month
                        shows a dash and this one does not
    LG Cr2O3            LG is received at LGCR, which is not inspected
    Sukinda plant Cr%   Jabamoyee files no daily composite assay

A zero would claim the mine produced none. A blank says nobody recorded it, and
those are different statements.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, NamedTuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import production as prod_svc
from app.services import stock as stock_svc
from app.services.despatch_grade import (
    COB_KEY, GRADE_BANDS, MINES_CUSTOMERS, UNASSAYED_KEY,
    _Acc, _band_of, _despatch_rows, _quality,
)
from app.services.plant_output import _totals as _plant_totals, get_plant_output
from app.services.sap_movement import PRODUCTION_QTY

# The four rows of every grade table on the sheet, in its order.
GRADES: tuple[tuple[str, str], ...] = (
    ("HG", "HG"), ("MG", "MG"), ("LG", "LG"), ("COB", "COB"),
)

# ── Block 2: where each grade's production tonnage comes from ────────────────
#
# THE SAME SOURCE AND THE SAME MOVEMENT RULE AS THE MIS DASHBOARD. Ore is
# pp_production at plant 1200 keyed on MATERIAL_NO; COB is pp_production at
# plant 1210 keyed on MATERIAL_DESC. Both sign the quantity through
# PRODUCTION_QTY, the one definition of the reversal rule, so this screen and
# the Production and COB sections cannot report different tonnages for a day.
#
# NOT from the ROM1 inspection lots. Those cover HG and MG only — LG is received
# at LGCR and never inspected — so a grade table built on inspections would be
# missing a quarter of the mine's output.
#
# NO STORAGE LOCATION OR PER-GRADE MOVEMENT TYPE. An earlier version pinned HG
# and MG to ROM1/101 and LG to LGCR/531, which matched today's postings but
# would silently drop a grade the day SAP posted it anywhere else. The material
# number is what identifies the grade; where it was put away is not part of the
# question this table asks.
#
# REVERSALS ARE NETTED by PRODUCTION_QTY, and goods issue (261/262) is excluded
# as consumption rather than netted. See sap_movement for the proof against SAP.
#
# Cross-checked: September MG from pp_production is 15,519.0 MT and the ROM1
# inspected lots for the same month total 15,519.0 MT. The tonnage and the assay
# are the same ore.
#: Overburden, keyed the way _prod_qty stores it — the last 8 characters of
#: SAP's padded MATERIAL_NO, which is how that function trims every material.
_OB_NO = "16000009"

PROD_MATERIALS: dict[str, str] = {
    "HG": "25000002",   # +52% CHROME ORE
    "MG": "25000001",   # 40-52% CHROME ORE
    "LG": "25000003",   # LOW GRADE ORE(-40%CR2O3)
}
MINE_PLANT = "1200"
COB_PLANT = "1210"
COB_MATERIAL = "CONCENTRATE WITH STD MOISTURE"
ROM_SLOC = "ROM1"       # where HG and MG ore is inspected
COB_SLOC = "COBC"       # where the concentrate is inspected

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
# of the same pass grouped by material. Six scans become one. The ore grades and
# COB share that single pass as well, because they differ only by plant.
#
# Adding an index on (PLANT, POSTING_DATE) would help far more than this and is
# the real fix; it is a change to a shared production database and is not mine
# to make.
#
# POSTING_DATE IS IN THE GROUPING, not just the CASE. It costs nothing — the
# scan is the same one, and a month of days across a handful of materials is
# a few dozen rows — and it is the only way to know WHICH DAYS SAP has posted
# at all. That set is what decides where the mine's hand-entered estimate is
# allowed to stand in; without it the service could only see a monthly total
# and could not tell a day SAP has not reached from a day the mine did not work.
_PROD_QTY_SQL = text(f"""
    SELECT PLANT, MATERIAL_NO, MATERIAL_DESC, POSTING_DATE,
           COALESCE(SUM(CASE WHEN POSTING_DATE = :rd
                             THEN ({PRODUCTION_QTY}) ELSE 0 END), 0) AS td_qty,
           COALESCE(SUM({PRODUCTION_QTY}), 0)                        AS mtd_qty
    FROM pp_production
    WHERE PLANT IN (:plant, :cob_plant)
      AND POSTING_DATE BETWEEN :mf AND :rd
    GROUP BY PLANT, MATERIAL_NO, MATERIAL_DESC, POSTING_DATE
""")

# The assay of what was produced, weighted by the lot's own tonnage, for both
# periods and every material at one storage location in a single pass.
#
# ONE ROW PER CHARACTERISTIC in this table, so each characteristic is selected
# explicitly and the tonnage comes from a DISTINCT sub-select. Without the
# first, FeO (14-19) and Cr/Fe Ratio (2.25-3.45) would be averaged in as though
# they were grades; without the second, every lot would be counted once per
# characteristic it carries.
#
# The characteristic name is cased differently by location — 'CR2O3' at DY01,
# 'Cr2O3' at ROM1 and COBC — so it is matched upper-cased.
_ASSAY_SQL = text("""
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
           AND UPPER(SHORT_TEXT_INS_CHAR) = :char
           AND QLT_START_DATE BETWEEN :mf AND :rd
         GROUP BY LOT_NUMBER
    ) c ON c.LOT_NUMBER = l.LOT_NUMBER
    GROUP BY l.material
""")


def _f(v) -> float | None:
    return None if v is None else float(v)


def _r(v, places: int = 2) -> float | None:
    return None if v is None else round(float(v), places)


# -- Block 2 -----------------------------------------------------------------
def _assay(db, plant: str, sloc: str, char: str, mf: date, rd: date) -> dict:
    """{material: (td, mtd)} for one characteristic at one storage location."""
    out: dict[str, tuple[float | None, float | None]] = {}
    for r in db.execute(_ASSAY_SQL, {"plant": plant, "sloc": sloc,
                                     "char": char, "mf": mf, "rd": rd}):
        out[str(r.material)[-8:]] = (
            float(r.td_num) / float(r.td_den) if r.td_den else None,
            float(r.mtd_num) / float(r.mtd_den) if r.mtd_den else None,
        )
    return out


class _Qty(NamedTuple):
    """One pass of pp_production, read four ways."""
    ore:      dict[str, tuple[float, float]]   # material -> (td, mtd)
    cob:      tuple[float, float]
    ore_days: set[date]    # days SAP has posted ORE for, whatever the value
    cob_days: set[date]    # days SAP has posted CONCENTRATE for
    ob_days:  set[date]    # days SAP has posted OVERBURDEN for


def _prod_qty(db: Session, mf: date, rd: date) -> _Qty:
    """The one pp_production scan, as (by material at the mine, COB concentrate).

    Lifted out of _production_both so the overburden figure can be read from
    the SAME pass instead of a second one. OB is already in this result — the
    query groups every material at plant 1200 — and fetching it again through
    production.get_mtd_totals cost 9.3 seconds, 45% of the page, for rows that
    were sitting here unused.
    """
    ore: dict[str, tuple[float, float]] = {}
    cob_qty = (0.0, 0.0)
    ore_days: set[date] = set()
    cob_days: set[date] = set()
    ob_days: set[date] = set()
    for r in db.execute(_PROD_QTY_SQL, {"plant": MINE_PLANT, "cob_plant": COB_PLANT,
                                        "mf": mf, "rd": rd}):
        td, mtd = float(r.td_qty or 0), float(r.mtd_qty or 0)
        day = r.POSTING_DATE
        if str(r.PLANT) == COB_PLANT:
            # COB is identified by description, not material number -- the mine
            # never asked SAP for a material split, and the plant also posts
            # tailings against this plant.
            if str(r.MATERIAL_DESC or "") == COB_MATERIAL:
                cob_qty = (cob_qty[0] + td, cob_qty[1] + mtd)
                cob_days.add(day)
        else:
            k = str(r.MATERIAL_NO)[-8:]
            prev = ore.get(k, (0.0, 0.0))
            ore[k] = (prev[0] + td, prev[1] + mtd)
            # PRESENCE, NOT A NON-ZERO VALUE. A day SAP has posted and that
            # nets to nought -- a shift reversed, or genuinely no work -- is a
            # day SAP has answered for. Testing the value instead would let the
            # estimate overwrite a real zero.
            if k in PROD_MATERIALS.values():
                ore_days.add(day)
            elif k == _OB_NO:
                ob_days.add(day)
    return _Qty(ore, cob_qty, ore_days, cob_days, ob_days)


def _production_both(db: Session, mf: date, rd: date,
                     qty: tuple | None = None) -> dict[str, list[dict]]:
    """Mines production by grade for TD and MTD, from one pass per table."""
    q = qty if qty is not None else _prod_qty(db, mf, rd)
    ore, cob_qty = q.ore, q.cob

    # BOTH characteristics are asked for at BOTH locations, and each row shows
    # whatever the lab actually filed for the lots in its window.
    #
    # ROM1 DID NOT ALWAYS CARRY CR/FE. The ore inspection posted Cr2O3 alone
    # until 9 Oct 2026; from that lot on it carries Cr/Fe Ratio, FeO and
    # Moisture as well. Hard-coding the ore rows to None -- which is what this
    # service did -- was right on the day it was written and wrong a week later,
    # and it would have gone on printing a dash over a figure the lab was
    # filing. Nothing here decides in advance what a location reports.
    ore_cr = _assay(db, MINE_PLANT, ROM_SLOC, "CR2O3", mf, rd)
    ore_fe = _assay(db, MINE_PLANT, ROM_SLOC, "CR/FE RATIO", mf, rd)
    cob_cr = _assay(db, COB_PLANT, COB_SLOC, "CR2O3", mf, rd)
    cob_fe = _assay(db, COB_PLANT, COB_SLOC, "CR/FE RATIO", mf, rd)

    def one(d: dict) -> tuple[float | None, float | None]:
        """COBC inspects concentrate and nothing else, so there is one entry.

        If a second material ever appears there the location has stopped being
        concentrate-only; averaging the two would hide that, so report nothing
        rather than a figure that is quietly about something else.
        """
        return list(d.values())[0] if len(d) == 1 else (None, None)

    # The ore estimate, spread by the day's plan. Computed once, before the
    # loop, because the fallback needs the month's SAP mix across all grades.
    sap_mix = {g: ore.get(PROD_MATERIALS[g], (0.0, 0.0))[1]
               for g in ("HG", "MG", "LG")}
    split, est_days, split_basis = _ore_split(db, mf, rd, q.ore_days, sap_mix)
    gplan = _grade_plan(db, mf, rd)

    out: dict[str, list[dict]] = {"td": [], "mtd": []}
    for key, label in GRADES:
        if key == "COB":
            cr = one(cob_cr)
            fe = one(cob_fe)
            # COB is one material, not a grade split, so the estimate can stand
            # in on this row itself. The ore grades cannot — see below.
            c_td, c_mtd, _ = _estimates(db, mf, rd, q.cob_days, "COB")
            for i, (per, est) in enumerate(zip(("td", "mtd"), (c_td, c_mtd))):
                pl = gplan[per].get(key, 0.0)
                out[per].append({"grade": key, "label": label,
                                 "plan": _r(pl) or None,
                                 "qty": _r(cob_qty[i] + est),
                                 "ach_pct": prod_svc._pct(cob_qty[i] + est, pl),
                                 "cr2o3": _r(cr[i], 3), "crfe": _r(fe[i], 3),
                                 "source": _source(cob_qty[i], est),
                                 "manual_qty": _r(est) or None})
            continue

        qg = ore.get(PROD_MATERIALS[key], (0.0, 0.0))
        # LGCR is not an inspection location, so LG has no entry in either of
        # these -- which is the honest answer, not a zero. Nor is a Cr/Fe
        # weighted over the lots that carry it the same as one weighted over
        # every lot: _assay divides by its own denominator, so a month that is
        # half assayed reports the half that was measured rather than diluting
        # it with tonnage nobody tested.
        a = ore_cr.get(PROD_MATERIALS[key], (None, None))
        f = ore_fe.get(PROD_MATERIALS[key], (None, None))
        # The mine's own ore figure for days SAP has not posted, spread across
        # the grades by that day's plan -- see _ore_split. Added INTO the grade
        # row rather than shown beside it, which is what the mine asked for:
        # the row is the day's production, however it is known.
        est_g = split.get(key, (0.0, 0.0))
        for i, per in enumerate(("td", "mtd")):
            pl = gplan[per].get(key, 0.0)
            out[per].append({
                "grade": key, "label": label,
                "plan": _r(pl) or None,
                "qty": _r(qg[i] + est_g[i]),
                "ach_pct": prod_svc._pct(qg[i] + est_g[i], pl),
                # NO ASSAY ON THE ESTIMATED PART. The Cr2O3 and Cr/Fe shown are
                # weighted over the lots the lab actually filed, so they
                # describe the SAP tonnage and nothing else; the estimate adds
                # tonnes, never grade.
                "cr2o3": _r(a[i], 3),
                "crfe": _r(f[i], 3),
                "source": _source(qg[i], est_g[i]),
                "manual_qty": _r(est_g[i]) or None,
                "est_days": est_days if est_g[i] else None,
            })

    # The ore estimate no longer gets a row of its own: the mine asked for the
    # grade rows themselves to fill, so _ore_split spreads it across them
    # above. Where a day has no basis to split by -- no plan grades and no SAP
    # mix -- its tonnage is simply not shown, which is reported rather than
    # guessed at; split_basis says which basis was used.
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
        est = False
        if q is None or q["cr"] is None:
            # TIER 2 -- the grade is the PO's average across its OTHER batches,
            # not a test of this consignment. Kept, because it is the best
            # statement available and dropping it would empty tonnage out of the
            # grade rows on exactly the recent days this screen is read; marked,
            # because a borrowed figure printed beside measured ones is
            # indistinguishable from a lab result. Same rule, same tiers and the
            # same helpers as Grade-wise Despatch.
            q = by_po.get(t.po)
            est = q is not None and q["cr"] is not None
        if q is None or q["cr"] is None:
            q, est = None, False
        cr = q["cr"] if q else None
        fe = q["fe"] if q else None
        band = COB_KEY if (po_is_cob.get(t.po, False) and cr is not None) else _band_of(cr)
        wt = float(t.wt or 0)
        acc["mtd"][t.customer][band].add(wt, cr, fe, est)
        if t.dt == rd:
            acc["td"][t.customer][band].add(wt, cr, fe, est)

    out: dict[str, dict[str, list[dict]]] = {}
    for per, bycust in acc.items():
        out[per] = {}
        for cust, bands in bycust.items():
            rows = [{"grade": k, "label": lbl,
                     "qty": _r((bands.get(k) or _Acc()).tonnage),
                     "cr2o3": (bands.get(k) or _Acc()).cr,
                     "crfe": (bands.get(k) or _Acc()).fe,
                     # Share of this row's graded tonnage that was borrowed
                     # rather than tested, and the tonnage itself. BOTH, because
                     # the share's denominator is the row's ASSAYED tonnage, not
                     # its total -- so the Weighted Average row cannot recover
                     # the tonnage from the percentage and must sum it directly.
                     "estimated_pct": (bands.get(k) or _Acc()).estimated_pct or None,
                     "estimated_qty": _r((bands.get(k) or _Acc()).est_tonnage) or None}
                    for k, lbl in GRADES]
            # UNASSAYED IS A ROW, NOT A ROUNDING. Tonnage that left with no
            # assay yet has no grade to sit in, and folding it into one would
            # move real tonnes into a band they were never measured for.
            u = bands[UNASSAYED_KEY]
            if u.tonnage > 0:
                rows.append({"grade": "UNASSAYED", "label": "Not yet assayed",
                             "qty": _r(u.tonnage), "cr2o3": None, "crfe": None,
                             "estimated_pct": None, "estimated_qty": None})
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

    # Estimated tonnage is SUMMED from the rows and its share taken against the
    # tonnage that carries a grade -- the same denominator each row used, so the
    # total agrees with its own lines instead of being a fourth kind of average.
    est = sum((r.get("estimated_qty") or 0) for r in rows)
    graded = sum((r.get(qty_key) or 0) for r in rows if r.get("cr2o3") is not None)

    # MANUAL TONNAGE IS A SEPARATE IDEA FROM A BORROWED ASSAY, and keeping them
    # in one key would have been the cheap mistake here. `estimated_qty` means
    # "this grade came from the purchase order's average because the lab has
    # not filed yet" and drives the amber footnote about assays; `manual_qty`
    # means "SAP has not posted this day, so the mine's own figure is standing
    # in". A row can carry both, and they must never be added together.
    manual = sum((r.get("manual_qty") or 0) for r in rows)

    # Plan SUMMED from the rows and achievement taken once on the totals, not
    # averaged across them: a grade planned at 100 MT and missed counts for its
    # tonnage, not equally with one planned at 20,000.
    plan = sum((r.get("plan") or 0) for r in rows)
    return {"qty": _r(tot), "cr2o3": w("cr2o3"), "crfe": w("crfe"), "cr": w("cr"),
            "plan": _r(plan) or None,
            "ach_pct": prod_svc._pct(tot, plan),
            "manual_qty": _r(manual) or None,
            "source": _source(tot - manual, manual),
            "estimated_qty": _r(est) or None,
            "estimated_pct": round(est / graded * 100, 1) if (graded and est) else None}


#: Where a figure on this page came from. The chip the screen prints.
SRC_SAP, SRC_MANUAL, SRC_MIXED = "sap", "manual", "mixed"


#: How far back to look for a figure that has just changed hands. Long enough
#: that a Monday morning still carries Friday's arrival, short enough that the
#: bell does not become a list nobody reads.
SAP_ARRIVAL_DAYS = 3

#: What the mine enters, and the SAP material it is eventually replaced by.
_ARRIVAL_MATERIALS = (
    ("ORE", "Ore", "MT"),
    ("OB", "Overburden", "CuM"),
    ("COB", "COB concentrate", "MT"),
)


def sap_arrivals(db: Session, today: date,
                 days: int = SAP_ARRIVAL_DAYS) -> list[dict]:
    """Days whose figure has just stopped being the mine's and started being SAP's.

    The Executive Summary shows the mine's hand-entered figure until SAP posts,
    then shows SAP's instead — silently, because the table carries no
    provenance any more. Silent is right on the page and wrong everywhere
    else: the number somebody quoted in the morning meeting changes under them
    with nothing to say it did. This is what tells them.

    NOTHING IS STORED TO WORK THIS OUT. The estimate stays in
    mines_prev_day_actual after SAP posts, so "what it was" and "what it is"
    are both still on disk and the transition is simply the two being present
    for the same day. No new table, no flag to set, nothing to go stale, and
    it reads the same whoever asks and whenever.

    Only days inside the window are reported, so an arrival ages off the bell
    by itself rather than needing to be cleared.
    """
    frm = today - timedelta(days=days)

    est: dict[tuple[date, str], float] = {}
    for r in db.execute(text("""
            SELECT `Date` AS d, Material AS m, Est_Actual AS q
            FROM mines_prev_day_actual
            WHERE `Date` BETWEEN :f AND :t
              AND Material IN ('ORE', 'OB', 'COB')
        """), {"f": frm, "t": today}):
        est[(r.d, str(r.m))] = float(r.q or 0)
    if not est:
        return []

    # What SAP now holds for those same days. One scan, both plants, grouped by
    # day — the ore grades are summed back together because the mine entered
    # one ore figure and the comparison has to be like for like.
    sap: dict[tuple[date, str], float] = {}
    for r in db.execute(text(f"""
            SELECT POSTING_DATE AS d,
                   SUM(CASE WHEN PLANT = :mine AND MATERIAL_NO IN
                            (:hg, :mg, :lg) THEN ({PRODUCTION_QTY}) ELSE 0 END) AS ore,
                   SUM(CASE WHEN PLANT = :mine AND MATERIAL_NO = :ob
                            THEN ({PRODUCTION_QTY}) ELSE 0 END) AS ob,
                   SUM(CASE WHEN PLANT = :cob_plant AND MATERIAL_DESC = :cob
                            THEN ({PRODUCTION_QTY}) ELSE 0 END) AS cob
            FROM pp_production
            WHERE PLANT IN (:mine, :cob_plant)
              AND POSTING_DATE BETWEEN :f AND :t
            GROUP BY POSTING_DATE
        """), {"mine": MINE_PLANT, "cob_plant": COB_PLANT,
               "hg": f"0000000000{PROD_MATERIALS['HG']}",
               "mg": f"0000000000{PROD_MATERIALS['MG']}",
               "lg": f"0000000000{PROD_MATERIALS['LG']}",
               "ob": f"0000000000{_OB_NO}", "cob": COB_MATERIAL,
               "f": frm, "t": today}):
        for key, val in (("ORE", r.ore), ("OB", r.ob), ("COB", r.cob)):
            # PRESENCE of a posting, not a non-zero value — the same test the
            # page uses to decide the estimate should stand down.
            if val is not None:
                sap[(r.d, key)] = float(val or 0)

    out = []
    for (day, mat), was in sorted(est.items()):
        now = sap.get((day, mat))
        if now is None:
            continue                      # SAP still silent — nothing changed
        # SAP agreeing with the entry to the kilo is not news. The screen shows
        # the same number it showed yesterday, so there is nothing to tell
        # anyone, and saying "70 -> 70" three times a day is how a bell gets
        # ignored. It happens often: the mine's COB and OB figures come off the
        # same shift sheet SAP is later posted from.
        if abs(now - was) < 0.005:
            continue
        label, unit = next((l, u) for m, l, u in _ARRIVAL_MATERIALS if m == mat)
        out.append({
            "day": day, "material": mat, "label": label, "unit": unit,
            "was": round(was, 2), "now": round(now, 2),
            "delta": round(now - was, 2),
        })
    return out


def _grade_plan(db: Session, mf: date, rd: date) -> dict[str, dict[str, float]]:
    """The planned tonnage per grade, TD and MTD.

    TWO TABLES, because the mine plans them separately: HG/MG/LG come from
    mines_daily_excavation_plan (per shift x location x face, so SUMmed, and
    its grade columns add back to its own ORE_QTY exactly), and COB from
    mines_cobp_plan's Concentrate_qty. These are the same two sources the MIS
    plan-vs-actual charts use, so the two screens plan against one target.

    Both periods out of one pass each, by the conditional-sum trick used
    throughout this service. Neither table is large.
    """
    out = {"td": {}, "mtd": {}}

    r = db.execute(text("""
        SELECT COALESCE(SUM(CASE WHEN Prod_date = :rd THEN HG_QTY END), 0) hg_td,
               COALESCE(SUM(CASE WHEN Prod_date = :rd THEN MG_QTY END), 0) mg_td,
               COALESCE(SUM(CASE WHEN Prod_date = :rd THEN LG_QTY END), 0) lg_td,
               COALESCE(SUM(HG_QTY), 0) hg, COALESCE(SUM(MG_QTY), 0) mg,
               COALESCE(SUM(LG_QTY), 0) lg
        FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :mf AND :rd
    """), {"mf": mf, "rd": rd}).fetchone()
    for g, td, mtd in (("HG", r.hg_td, r.hg), ("MG", r.mg_td, r.mg),
                       ("LG", r.lg_td, r.lg)):
        out["td"][g] = _f(td) or 0.0
        out["mtd"][g] = _f(mtd) or 0.0

    c = db.execute(text("""
        SELECT COALESCE(SUM(CASE WHEN Plan_date = :rd
                                 THEN Concentrate_qty END), 0) AS td,
               COALESCE(SUM(Concentrate_qty), 0)               AS mtd
        FROM mines_cobp_plan
        WHERE Plan_date BETWEEN :mf AND :rd
    """), {"mf": mf, "rd": rd}).fetchone()
    out["td"]["COB"] = _f(c.td) or 0.0
    out["mtd"]["COB"] = _f(c.mtd) or 0.0
    return out


def _ore_split(db: Session, mf: date, rd: date, covered: set[date],
               fallback_mix: dict[str, float]
               ) -> tuple[dict[str, tuple[float, float]], int, str]:
    """The ore estimate, spread across HG / MG / LG so the grade rows can fill.

    THE ESTIMATE HAS NO GRADE SPLIT OF ITS OWN. mines_prev_day_actual stores
    one ORE figure per day, full stop. The mine wants the grade rows filled
    rather than a separate line, so the split has to come from somewhere, and
    there is exactly one dated, per-day statement of which grades were being
    worked: THAT DAY'S OWN EXCAVATION PLAN, which carries HG_QTY, MG_QTY and
    LG_QTY. The plan's ore total is ignored -- only its ratio is used, applied
    to the figure the mine actually entered.

    It is a derived split and the rows say so. The plan ran 65.7% MG / 34.3% LG
    over October while SAP posted 81.5% / 18.5%, so the shape is right and the
    proportions are approximate; this is a figure for a morning meeting that
    SAP replaces within a day or two, not a measurement.

    FALLS BACK to the month's SAP actual mix where a day's plan carries no
    grade quantities, and reports which basis it used so the screen can say.
    Returns ({grade: (td, mtd)}, days_filled, basis).
    """
    est = db.execute(text("""
        SELECT `Date` AS d, Est_Actual AS q FROM mines_prev_day_actual
        WHERE Material = 'ORE' AND `Date` BETWEEN :mf AND :rd
    """), {"mf": mf, "rd": rd}).fetchall()
    pending = [(r.d, float(r.q or 0)) for r in est
               if r.d not in covered and float(r.q or 0)]
    if not pending:
        return {}, 0, ""

    plan: dict[date, dict[str, float]] = {}
    for r in db.execute(text("""
            SELECT Prod_date AS d,
                   COALESCE(SUM(HG_QTY), 0) AS hg,
                   COALESCE(SUM(MG_QTY), 0) AS mg,
                   COALESCE(SUM(LG_QTY), 0) AS lg
            FROM mines_daily_excavation_plan
            WHERE Prod_date BETWEEN :mf AND :rd
            GROUP BY Prod_date
        """), {"mf": mf, "rd": rd}):
        plan[r.d] = {"HG": float(r.hg or 0), "MG": float(r.mg or 0),
                     "LG": float(r.lg or 0)}

    out: dict[str, tuple[float, float]] = {}
    basis = ""
    for day, qty in pending:
        shares = plan.get(day, {})
        if sum(shares.values()) <= 0:
            # No grade split planned for that day. The month's SAP mix is the
            # only other dated basis; where even that is empty the day is left
            # unallocated and the caller reports it rather than guessing.
            shares = fallback_mix
            basis = basis or "sap-mix"
        else:
            basis = basis or "plan"
        total = sum(shares.values())
        if total <= 0:
            continue
        for g, part in shares.items():
            if not part:
                continue
            add = qty * part / total
            td, mtd = out.get(g, (0.0, 0.0))
            out[g] = (td + (add if day == rd else 0.0), mtd + add)
    return out, len(pending), basis


def _estimates(db: Session, mf: date, rd: date,
               covered: set[date], material: str) -> tuple[float, float, int]:
    """The mine's own figure for the days SAP has not posted yet.

    WHY THIS EXISTS. SAP's goods movements land a day or more after the fact —
    routers/prev_day_actual.py records the morning of 24 September, when the
    23rd still read zero ore against a plan of 207 MT. The mine already types
    yesterday's real figure into the MIS variance form before that meeting, so
    the number exists; it was simply never shown on this page, which meant the
    management review opened on a production row of 0.00 for the day everyone
    had just finished discussing.

    ONLY WHERE SAP IS SILENT. `covered` is the set of days SAP has posted, so a
    day it has answered for is never second-guessed by a hand-typed figure —
    the estimate stands in, it does not compete. Over 23 September to 25
    October the two differ by 26% on average and by as much as 65% on a single
    day, which is exactly why the estimate must give way the moment SAP speaks
    rather than being blended with it.

    Returns (td, mtd, days_filled).
    """
    rows = db.execute(text("""
        SELECT `Date` AS d, Est_Actual AS q
        FROM mines_prev_day_actual
        WHERE Material = :m AND `Date` BETWEEN :mf AND :rd
    """), {"m": material, "mf": mf, "rd": rd}).fetchall()

    td = mtd = 0.0
    filled = 0
    for r in rows:
        if r.d in covered:
            continue                      # SAP has spoken for this day
        q = float(r.q or 0)
        mtd += q
        filled += 1
        if r.d == rd:
            td = q
    return td, mtd, filled


def _source(sap_qty: float, est_qty: float) -> str:
    """Which label a figure earns. Recomputed every request, so it follows the
    data: the moment SAP posts a day, that day stops being counted as manual
    and the chip changes with no intervention."""
    if est_qty and sap_qty:
        return SRC_MIXED
    if est_qty:
        return SRC_MANUAL
    return SRC_SAP


def _excavation(db: Session, mf: date, rd: date,
                ob_actual: tuple[float, float],
                ob_days: set[date]) -> dict[str, list[dict]]:
    """Overburden and De-Silting, plan against actual, TD and MTD.

    THE SAME FIGURES THE MIS DASHBOARD REPORTS, and a test asserts that against
    production.get_mtd_totals and get_desilt_actual on every change. It does not
    CALL those functions: each re-scans pp_production, and doing it twice more
    added 9.3 seconds to a 20.7-second page for a number this service had
    already fetched. `ob_actual` is (td, mtd) lifted out of the single scan in
    _prod_qty, where overburden sits beside the ore grades at plant 1200.

    DE-SILTING HAS NO PLAN, AND THAT IS NOT AN OMISSION HERE. There is no plan
    table for it anywhere in the database — services/production.py returns
    `"silt_plan": None` with that same note, and the MIS KPI card passes
    today_plan=None and mtd_plan=None. Its actual is reported and its plan
    column stays empty, which is what MIS shows. Inventing a target, or reusing
    the OB plan, would be worse than a blank.

    OB is CuM, not MT. The ore tables above it are tonnes, so the unit travels
    with the row rather than sitting in a column heading somewhere.
    """
    ob_td, ob_mtd = ob_actual

    # The mine's own OB figure for days SAP has not posted, on the same rule
    # as production above. Overburden is one material with no grade split, so
    # it needs no apportioning -- the entered figure goes straight onto the row.
    e_td, e_mtd, ob_est_days = _estimates(db, mf, rd, ob_days, "OB")
    ob_td += e_td
    ob_mtd += e_mtd

    # Both periods out of one pass each, the same conditional-sum trick the
    # production query above uses. These two tables are small — the plan is one
    # row per shift x location x face, de-silting one row per day — so this is
    # two cheap reads, not the full scans pp_production forces.
    plan = db.execute(text("""
        SELECT COALESCE(SUM(CASE WHEN Prod_date = :rd
                   THEN CAST(NULLIF(OB_QTY_Cum,'') AS DECIMAL(16,3)) END), 0) AS td_plan,
               COALESCE(SUM(CAST(NULLIF(OB_QTY_Cum,'') AS DECIMAL(16,3))), 0) AS mtd_plan
        FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :mf AND :rd
    """), {"mf": mf, "rd": rd}).fetchone()

    # Variant '4' is de-silting, and Qty is VARCHAR here — the same filter and
    # cast services/production.py uses, so the two screens cannot disagree.
    silt = db.execute(text("""
        SELECT SUM(CASE WHEN Prod_date = :rd
                   THEN CAST(Qty AS DECIMAL(13,3)) END)  AS td_silt,
               SUM(CAST(Qty AS DECIMAL(13,3)))           AS mtd_silt
        FROM mines_day_wise_excavation
        WHERE Variant = '4' AND Prod_date BETWEEN :mf AND :rd
    """), {"mf": mf, "rd": rd}).fetchone()

    def rows(ob_act: float, ob_plan: float, silt_act: float | None,
             manual: float = 0.0) -> list[dict]:
        return [
            {"key": "ob", "label": "Overburden", "unit": "CuM",
             "plan": _r(ob_plan), "actual": _r(ob_act),
             "pct": prod_svc._pct(ob_act, ob_plan),
             "source": _source(ob_act - manual, manual),
             "manual_qty": _r(manual) or None},
            # get_desilt_actual reports nothing rather than nought when there
            # was none; matched here so the two screens read alike.
            {"key": "desilt", "label": "De-Silting", "unit": "CuM",
             "plan": None, "actual": _r(silt_act) if silt_act else None,
             "pct": None, "no_plan": True,
             "source": SRC_SAP, "manual_qty": None},
        ]

    return {
        "td":  rows(ob_td,  _f(plan.td_plan)  or 0.0, _f(silt.td_silt),  e_td),
        "mtd": rows(ob_mtd, _f(plan.mtd_plan) or 0.0, _f(silt.mtd_silt), e_mtd),
    }


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
    qty = _prod_qty(db, mtd_from, report_day)
    prod = _production_both(db, mtd_from, report_day, qty)
    # Overburden comes out of the scan `qty` already did — see _excavation.
    exca = _excavation(db, mtd_from, report_day,
                       qty.ore.get(_OB_NO, (0.0, 0.0)), qty.ob_days)
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
            # OB and De-Silting, the same figures the MIS dashboard reports.
            "excavation": exca[per],
        }

    return {
        "report_day": report_day.isoformat(),
        "stock_as_on": stock_as_on.isoformat(),
        "mtd_from": mtd_from.isoformat(),
        "stock": stock_svc.get_stock_position(db, stock_as_on),
        "td": block("td"),
        "mtd": block("mtd"),
    }
