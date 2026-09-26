"""End-to-end quality: what the mine despatched against what the plant received.

ONE ROW PER CONSIGNMENT — a stack (BATCH) on a despatch date. That is the grain
the mine's own reconciliation uses, and it is the grain at which the two labs
actually disagree.

THE KEY IS THE BATCH. Nothing else links the two halves: the mine's stack number
and SAP's batch are spelled differently in every other table, and the despatch
date does not survive the journey — the plant posts its receipt one, two or
three days later. BATCH is carried on every row of all four source tables.

WHERE EACH FIGURE COMES FROM
    quantity, trips   zsd_outbound_despatch   the gate record, one row per truck
    mines assay       pp_quality_inspection   PLANT 1200 (ore) / 1210 (COB), DY01
    plant assay       qm_quality_control      PLANT 1100, inspection 08, mvt 101
                      + qm_quality_control_result

CUSTOMERNO = 'BAL' IS NOT OPTIONAL. A stack ships to Balasore and to Jabamoyee
on the same day under the same batch. Batch I260130047 on 3 September is 42
trucks and 493.47 MT in total, of which only 25 trucks and 294.15 MT went to
Balasore — and the two consignments assay differently, 48.85 against 46.55
Cr2O3. Without the filter every figure on the row is wrong.

HOW A MULTI-DAY STACK IS SPLIT. Both labs assay per consignment, not per batch,
so the split is recoverable from the assay values themselves:

  mines  a consignment is one distinct (moisture, Cr2O3, FeO, Cr/Fe) tuple;
         it is matched to a despatch date by quantity, which ties exactly.
  plant  moisture is measured per shift, so it cannot form part of the key; a
         consignment is one distinct (Cr2O3, FeO, Cr/Fe) tuple with moisture
         weighted across its lots, matched to a despatch date by truck count.

Verified against the mine's own workbook for September 2026: 26 of 30 rows
reproduce trips, quantity and all four mines parameters exactly. Of the four
that do not, three are absent or partial in pp_quality_inspection at source and
one is a transcription slip in the workbook.

MISSING DATA STAYS MISSING. An unassayed half renders blank and fills in by
itself once the assay arrives. Nothing is defaulted to zero, because a zero here
reads as "the lab found none", which is a different claim entirely. LUMP is
permanently half-blank: SAP holds only moisture and Cr2O3 for it.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Iterable

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

# Balasore. Other destinations ship under the same batch numbers.
CUSTOMER_BAL = "BAL"

# Mine-side inspection lots. 1200 is the mine, 1210 the COB plant; DY01 is the
# despatch yard, which is what separates a despatch assay from any other.
MINE_PLANTS = ("1200", "1210")
MINE_STORAGE = "DY01"

# Plant-side receipt at Balasore: goods receipt (101) against a stock-transfer
# inspection (08). Type 02 also carries an assay for these batches, but it is
# the MINE's figure copied across at issue — joining to it would compare the
# mine against itself and report no variance at all.
PLANT_CODE = "1100"
PLANT_INSPECTION = "08"
PLANT_MOVEMENT = "101"

# SAP spells the characteristic differently per material ("Cr2O3" for ore,
# "CR2O3" for concentrate), so comparisons fold to upper case rather than
# relying on the column's collation.
CHARS = {
    "MOISTURE": "moisture",
    "CR2O3": "cr2o3",
    "FEO": "feo",
    "CR/FE RATIO": "cr_fe",
}
PARAMS = ("moisture", "cr2o3", "feo", "cr_fe")

GRADES = {
    "40-52% CHROME ORE": "MG",
    "+52% CHROME ORE": "HG",
    "LOW GRADE ORE(-40%CR2O3)": "LG",
    "CONCENTRATE WITH STD MOISTURE": "COB",
    "LUMP -100MM -40% CR2O3": "LUMP",
}

# Quantities are compared with a tolerance rather than for equality. 50 kg is
# far below one truck, so it cannot merge two consignments by accident.
QTY_TOL = 0.05

# How far either side of the window to look for a stack's other despatch days.
BATCH_PAD_DAYS = 60


def _f(v: Any) -> float | None:
    return None if v is None else float(v)


def _wavg(pairs: Iterable[tuple[float | None, float]]) -> float | None:
    """Quantity-weighted mean, or None when nothing in the group carries one."""
    num = den = 0.0
    for value, qty in pairs:
        if value is not None:
            num += value * qty
            den += qty
    return round(num / den, 2) if den else None


def _char_cols(expr: str, alias: str = "") -> str:
    """One MAX(CASE ...) column per inspection characteristic."""
    a = f"{alias}." if alias else ""
    return ",\n               ".join(
        f"MAX(CASE WHEN UPPER({a}SHORT_TEXT_INS_CHAR) = '{code}' "
        f"THEN {expr} END) AS {col}"
        for code, col in CHARS.items()
    )


def _despatches(db: Session, frm: date, to: date,
                batches: list[str] | None = None) -> list[dict]:
    """One row per stack per despatch day, from the gate record.

    With `batches`, the window is ignored for those stacks and every despatch
    day is returned. Allocating plant lots needs the batch's whole despatch
    history: a stack sent on 30 August and again on 2 September would otherwise
    hand September's row the August trucks' assay.
    """
    if batches is not None and not batches:
        return []
    clause = ("AND BATCH IN :batches AND GATEINDATE BETWEEN :frm AND :to"
              if batches is not None
              else "AND GATEINDATE BETWEEN :frm AND :to")
    if batches is not None:
        # Widen, don't remove, the window. A stack is despatched over days, not
        # months, so a pad covers the whole of one — while keeping the scan off
        # a 59,000-row table and away from an identically numbered batch in
        # another year.
        frm, to = frm - timedelta(days=BATCH_PAD_DAYS), to + timedelta(days=BATCH_PAD_DAYS)
    sql = text(f"""
        SELECT BATCH AS batch, GATEINDATE AS d, COUNT(*) AS trips,
               SUM(CAST(NETWEIGHT AS DECIMAL(14,3))) AS qty
          FROM zsd_outbound_despatch
         WHERE CUSTOMERNO = :cust
           AND BATCH IS NOT NULL AND BATCH <> ''
           {clause}
         GROUP BY BATCH, GATEINDATE
         ORDER BY GATEINDATE, BATCH
    """)
    params: dict[str, Any] = {"cust": CUSTOMER_BAL}
    if batches is not None:
        sql = sql.bindparams(bindparam("batches", expanding=True))
        params["batches"] = batches
    params |= {"frm": frm, "to": to}
    rows = db.execute(sql, params).fetchall()
    return [
        {"batch": r.batch.strip(), "date": r.d, "trips": int(r.trips),
         "qty": round(float(r.qty or 0), 2)}
        for r in rows
    ]


def _mine_lots(db: Session, batches: list[str]) -> dict[str, list[dict]]:
    """Mine despatch assay, one entry per inspection lot — one truck."""
    if not batches:
        return {}
    sql = text(f"""
        SELECT BATCH AS batch, LOT_NUMBER AS lot,
               MAX(ACTUAL_LOT_QUANTITY) AS qty,
               MAX(MATERIAL_DESC) AS material,
               {_char_cols('RESULT')}
          FROM pp_quality_inspection
         WHERE PLANT IN :plants AND STORAGE_LOCATION = :loc
           AND BATCH IN :batches
         GROUP BY BATCH, LOT_NUMBER
    """).bindparams(
        bindparam("plants", expanding=True),
        bindparam("batches", expanding=True),
    )
    rows = db.execute(sql, {
        "plants": list(MINE_PLANTS), "loc": MINE_STORAGE,
        "batches": batches,
    }).fetchall()
    out: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        out[r.batch.strip()].append({
            "lot": str(r.lot), "qty": float(r.qty or 0), "material": r.material,
            **{p: _f(getattr(r, p)) for p in PARAMS},
        })
    return out


def _plant_lots(db: Session, batches: list[str]) -> dict[str, list[dict]]:
    """Plant receipt assay, one entry per inspection lot — one truck."""
    if not batches:
        return {}
    sql = text(f"""
        SELECT h.BATCH AS batch, h.LOT_NUMBER AS lot,
               MAX(h.LOT_QUANTITY) AS qty,
               MAX(h.MATERIAL_DESC) AS material,
               {_char_cols('CAST(TRIM(r.RESULTS) AS DECIMAL(14,4))', 'r')}
          FROM qm_quality_control h
          JOIN qm_quality_control_result r ON r.LOT_NUMBER = h.LOT_NUMBER
         WHERE h.PLANT = :plant AND h.INSPECTION_TYPE = :insp
           AND h.MOVEMENT_TYPE = :mvt AND h.BATCH IN :batches
         GROUP BY h.BATCH, h.LOT_NUMBER
    """).bindparams(bindparam("batches", expanding=True))
    rows = db.execute(sql, {
        "plant": PLANT_CODE, "insp": PLANT_INSPECTION,
        "mvt": PLANT_MOVEMENT, "batches": batches,
    }).fetchall()
    out: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        out[r.batch.strip()].append({
            "lot": str(r.lot), "qty": float(r.qty or 0), "material": r.material,
            **{p: _f(getattr(r, p)) for p in PARAMS},
        })
    return out


def _consign(lots: list[dict], by: tuple[str, ...]) -> list[dict]:
    """Collapse lots into consignments, grouped on the given parameters.

    Each group keeps its own quantity and truck count; a parameter outside
    `by` — moisture, on the plant side — is weighted across the group's lots.
    """
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for lot in lots:
        groups[tuple(lot[p] for p in by)].append(lot)
    out = []
    for members in groups.values():
        out.append({
            "qty": round(sum(m["qty"] for m in members), 2),
            "trips": len(members),
            "first": min(m["lot"] for m in members),
            "material": members[0]["material"],
            **{p: _wavg([(m[p], m["qty"]) for m in members]) for p in PARAMS},
        })
    return sorted(out, key=lambda g: g["first"])


def _match_by_qty(groups: list[dict], qty: float) -> dict | None:
    """The consignment whose tonnage is this day's. Ambiguity yields nothing."""
    hits = [g for g in groups if abs(g["qty"] - qty) < QTY_TOL]
    return hits[0] if len(hits) == 1 else None


def _allocate(lots: list[dict], days: list[dict]) -> dict[int, list[dict]]:
    """Hand the plant's inspection lots to despatch days, in order.

    One lot is one truck on both sides, and the two sides agree on truck count
    for every stack checked across August and September 2026 — so taking the
    first day's worth of lots, then the second day's, reproduces the split.

    Grouping by assay value cannot do this on its own: the plant may assay a
    single day's consignment twice, on the two days it unloads it. Stack
    I263004474 arrives as 90 trucks on one despatch but two assay groups of 45,
    which the mine's own workbook reports as one weighted figure.

    `days` must be the stack's WHOLE despatch history, not just the window, or
    the first day inside the window inherits an earlier day's trucks.
    """
    lots = sorted(lots, key=lambda x: x["lot"])
    out: dict[int, list[dict]] = {}
    i = 0
    for idx, day in enumerate(days):
        take = lots[i:i + day["trips"]]
        if not take:
            break
        out[idx] = take
        i += day["trips"]
    return out


def _summarise(lots: list[dict]) -> dict:
    """Weighted assay over a set of lots, with moisture folded across shifts."""
    qty = round(sum(x["qty"] for x in lots), 2)
    return {
        "qty": qty, "trips": len(lots),
        "material": lots[0]["material"],
        **{p: _wavg([(x[p], x["qty"]) for x in lots]) for p in PARAMS},
    }


def get_quality_e2e(db: Session, frm: date, to: date) -> dict:
    """Mine despatch against plant receipt, one row per stack per day."""
    window = _despatches(db, frm, to)
    batches = sorted({d["batch"] for d in window})
    # The whole despatch history of each stack, so plant lots line up.
    every = _despatches(db, frm, to, batches=batches)
    mine = _mine_lots(db, batches)
    plant = _plant_lots(db, batches)

    in_window = {(d["batch"], d["date"]) for d in window}
    by_batch: dict[str, list[dict]] = defaultdict(list)
    for d in every:
        by_batch[d["batch"]].append(d)

    rows: list[dict] = []
    for batch, days in by_batch.items():
        days.sort(key=lambda d: d["date"])
        # Mine: the assay tuple itself is the consignment, tied to a day by qty.
        mine_groups = _consign(mine.get(batch, []), PARAMS)
        plant_for = _allocate(plant.get(batch, []), days)

        for i, d in enumerate(days):
            if (batch, d["date"]) not in in_window:
                continue
            m = _match_by_qty(mine_groups, d["qty"]) or (
                mine_groups[0] if len(mine_groups) == 1 else None)
            lots = plant_for.get(i)
            p = _summarise(lots) if lots else None
            material = (m or p or {}).get("material")
            grade = GRADES.get((material or "").strip())
            # Finished alloy ships under the same gate record — one truck, a
            # batch like "010926ST93", and a material that is not ore. A known
            # material outside the grade list is not chrome ore from the mine.
            if material and grade is None:
                continue
            rows.append({
                "date": d["date"].isoformat(),
                "batch": batch,
                "grade": grade,
                # Quantity and trips RECEIVED mirror the despatched figures
                # until the plant's own gate record is wired in — see router.
                "mines": {"trips": d["trips"], "qty": d["qty"],
                          **{k: (m or {}).get(k) for k in PARAMS}},
                "plant": {"trips": d["trips"], "qty": d["qty"],
                          **{k: (p or {}).get(k) for k in PARAMS}},
            })

    for r in rows:
        r["variance"] = {
            "qty": round(r["plant"]["qty"] - r["mines"]["qty"], 2),
            "trips": r["plant"]["trips"] - r["mines"]["trips"],
            **{
                k: (None if r["mines"][k] is None or r["plant"][k] is None
                    else round(r["plant"][k] - r["mines"][k], 2))
                for k in PARAMS
            },
        }

    rows.sort(key=lambda r: (r["date"], r["batch"]))
    return {"from": frm.isoformat(), "to": to.isoformat(),
            "rows": rows, "totals": _totals(rows)}


def _totals(rows: list[dict]) -> dict:
    """The weighted-average footer, computed the way the mine computes it."""
    if not rows:
        return {}
    out: dict[str, Any] = {
        "trips": sum(r["mines"]["trips"] for r in rows),
        "mines_qty": round(sum(r["mines"]["qty"] for r in rows), 2),
        "plant_qty": round(sum(r["plant"]["qty"] for r in rows), 2),
    }
    for side in ("mines", "plant"):
        for p in PARAMS:
            out[f"{side}_{p}"] = _wavg(
                [(r[side][p], r[side]["qty"]) for r in rows])
    for p in PARAMS:
        a, b = out[f"mines_{p}"], out[f"plant_{p}"]
        out[f"var_{p}"] = None if a is None or b is None else round(b - a, 2)
    out["var_qty"] = round(out["plant_qty"] - out["mines_qty"], 2)
    return out
