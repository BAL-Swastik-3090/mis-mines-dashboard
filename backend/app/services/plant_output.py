"""What the ore became — ferrochrome produced, and its analysis.

The last link in the chain the End-to-End Quality page follows: the mine's
assay, then the receiving plant's assay of the same consignment, then this —
the metal that came out of the furnaces.

IT IS A SEPARATE SECTION, NOT MORE COLUMNS, because the grain is different and
there is no join between them. The consignment table is one row per stack per
despatch day; a furnace runs continuously on a blended bunker feed drawn from
many stacks at once, plus outsourced ore. No heat can be attributed to a stack,
and a column claiming otherwise would invent a traceability that does not exist.

    quantity   pp_prod_order_confirmation    WORK_CENTER LIKE 'FURNACE%'
    analysis   qm_inprocess_inspect_result   SHIFT '004', the daily composite

THE PRODUCTION DAY IS IN THE SAMPLE IDENTITY, NOT IN SAMPLEDATE. A composite is
assayed and filed the following morning: F4/COMP/27.09.2026 carries
SAMPLEDATE = 2026-09-28. Joining on SAMPLEDATE would attach every furnace's
analysis to the day after it ran, so the day is parsed out of the identity.

    F4/COMP/27.09.2026  ->  2026-09-27, furnace F4

Two spellings occur. A handful of identities were typed with colons —
F4/COMP/15:07:2026 — which is a keying slip, not a different meaning, so they
are normalised before parsing; that recovers 64 furnace-days that would
otherwise vanish. An older format, M&S/FEC/COMP/F1, carries no date at all and
stopped in June 2025; 480 such rows are left out because there is nothing in
them to date the production by.

WEIGHTED BY YIELD. A period average is weighted by the tonnes each furnace-day
produced, so a furnace that ran two days does not carry the same weight as one
that ran twenty-two.

BLANK MEANS NOT ASSAYED. Chromium and Silicon are measured on nearly every
furnace-day, Phosphorus on most, Carbon and Sulphur on about half. The missing
ones render blank rather than zero, as everywhere else on this page. Jabamoyee
produces metal but files no composite analysis at all, so its rows carry a yield
and no chemistry — shown that way deliberately, because leaving the plant out
would hide a tonne of production.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Iterable

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

# SAP plant codes. 1100 smelts on five furnaces, 1110 on one.
PLANTS: tuple[tuple[str, str], ...] = (
    ("1100", "Balasore"),
    ("1110", "Jabamoyee"),
)
PLANT_LABEL = dict(PLANTS)

# The daily composite. 001/002/003 are the three shifts; 004 is the day's
# composite sample, which is the one that describes what was produced.
COMPOSITE_SHIFT = "004"

# The characteristic as the response names it. Stored upper case, but compared
# through UPPER() so nothing depends on the column's collation. Both spellings
# of phosphorus appear in SAP's master data.
CHARS: dict[str, str] = {
    "CHROMIUM": "cr",
    "SILICON": "si",
    "CARBON": "c",
    "PHOSPHORUS": "p",
    "PHOSPHOROUS": "p",
    "SULPHUR": "s",
}
PARAMS = ("cr", "si", "c", "p", "s")

# The production day, dug out of the identity and tolerant of the colon typo.
_PROD_DAY = (
    "STR_TO_DATE("
    "REPLACE(SUBSTRING_INDEX(SAMPLEIDENTITY, '/COMP/', -1), ':', '.'),"
    " '%d.%m.%Y')"
)

_YIELD_SQL = text("""
    SELECT POSTING_DATE AS d,
           PLANT        AS plant,
           WORK_CENTER  AS work_center,
           SUM(CONFIRMED_YIELD)                              AS yield_t,
           COUNT(CASE WHEN REVERSE_IND IS NULL THEN 1 END)   AS taps
      FROM pp_prod_order_confirmation
     WHERE POSTING_DATE BETWEEN :frm AND :to
       AND WORK_CENTER LIKE 'FURNACE%'
       AND PLANT IN :plants
     GROUP BY POSTING_DATE, PLANT, WORK_CENTER
""").bindparams(bindparam("plants", expanding=True))

_ANALYSIS_SQL = text(f"""
    SELECT PLANT              AS plant,
           SAMPLELOCATION     AS furnace,
           {_PROD_DAY}        AS d,
           UPPER(SHORTTEXTCHARA) AS chara,
           RESULT             AS val
      FROM qm_inprocess_inspect_result
     WHERE SHIFT = :shift
       AND PLANT IN :plants
       AND SAMPLEIDENTITY LIKE '%/COMP/%'
       AND SAMPLELOCATION REGEXP '^F[0-9]+$'
       AND UPPER(SHORTTEXTCHARA) IN :chars
       AND {_PROD_DAY} BETWEEN :frm AND :to
""").bindparams(bindparam("plants", expanding=True),
                bindparam("chars", expanding=True))


def _f(v: Any) -> float | None:
    return None if v is None else float(v)


def _furnace(work_center: str) -> str:
    """FURNACE4 -> F4, which is how the lab names the sample location."""
    return "F" + work_center[len("FURNACE"):]


def _wavg(pairs: Iterable[tuple[float | None, float]]) -> float | None:
    """Yield-weighted mean, or None when nothing in the group carries a value."""
    num = den = 0.0
    for value, qty in pairs:
        if value is not None and qty > 0:
            num += value * qty
            den += qty
    return round(num / den, 3) if den else None


def _totals(rows: list[dict]) -> dict:
    if not rows:
        return {}
    out: dict[str, Any] = {
        "furnace_days": len(rows),
        "taps": sum(r["taps"] for r in rows),
        "yield_t": round(sum(r["yield_t"] for r in rows), 2),
    }
    for p in PARAMS:
        out[p] = _wavg([(r[p], r["yield_t"]) for r in rows])
        # How much of the tonnage the average actually covers. An average over
        # half the output is a different claim from one over all of it, and
        # Carbon and Sulphur are assayed on about half the furnace-days.
        covered = sum(r["yield_t"] for r in rows if r[p] is not None)
        out[f"{p}_covered_pct"] = (round(covered / out["yield_t"] * 100, 1)
                                   if out["yield_t"] else 0.0)
    return out


def get_plant_output(db: Session, frm: date, to: date) -> dict:
    """Ferrochrome produced per furnace per day, with the day's composite assay."""
    plants = [code for code, _ in PLANTS]

    produced = db.execute(_YIELD_SQL, {
        "frm": frm, "to": to, "plants": plants,
    }).fetchall()

    analysis: dict[tuple, dict] = defaultdict(dict)
    for r in db.execute(_ANALYSIS_SQL, {
        "frm": frm, "to": to, "plants": plants,
        "shift": COMPOSITE_SHIFT, "chars": list(CHARS),
    }).fetchall():
        key = (r.plant, r.d, r.furnace)
        analysis[key][CHARS[r.chara]] = _f(r.val)

    rows: list[dict] = []
    for p in produced:
        furnace = _furnace(p.work_center)
        assayed = analysis.get((p.plant, p.d, furnace), {})
        rows.append({
            "date": p.d.isoformat(),
            "plant": p.plant,
            "plant_label": PLANT_LABEL.get(p.plant, p.plant),
            "furnace": furnace,
            # Reversals are stored as their own negative row, so summing every
            # row nets a cancelled tap out on its own. Only the taps themselves
            # are counted, not the reversal entries.
            "yield_t": round(float(p.yield_t or 0), 2),
            "taps": int(p.taps or 0),
            **{k: assayed.get(k) for k in PARAMS},
        })

    rows.sort(key=lambda r: (r["date"], r["plant"], r["furnace"]))
    totals = {code: _totals([r for r in rows if r["plant"] == code])
              for code, _ in PLANTS}
    totals["ALL"] = _totals(rows)
    return {
        "from": frm.isoformat(), "to": to.isoformat(),
        "plants": [{"key": c, "label": lbl} for c, lbl in PLANTS],
        "rows": rows,
        "totals": totals,
    }
