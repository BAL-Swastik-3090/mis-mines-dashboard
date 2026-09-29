"""The four figures a morning meeting actually asks for, on one card.

The page already carries the whole chain — every consignment the mine sent,
what the receiving plant made of it, and what came out of the furnaces. That is
the right level of detail to argue from and the wrong level to open with. The
first question is always the same four numbers:

    what grade did we send, and what did the plant say it was
    what are we producing, and what is it assaying

So: ore despatch across the month and across the last three consignments, mine
against plant, per destination; then ferrochrome for the month and for the last
day that produced any, per plant.

THE LAST THREE CONSIGNMENTS, NOT THE LAST THREE DAYS. A month's average moves
slowly and hides a drift that started on Tuesday; three consignments is what a
foreman can remember loading. Counted per destination, because Balasore and
Jabamoyee are fed from different stacks and averaging them together answers
neither question.

WEIGHTED BY TONNAGE, never a mean of the percentages. A 1,059 t consignment and
a 23 t one are not two equal opinions about grade, and treating them as such is
how a screen disagrees with the weighbridge.

CR/FE FOR FERROCHROME IS DERIVED, AND SAID TO BE. SAP records chromium,
silicon, carbon, phosphorus and sulphur on the daily composite, and no iron at
all — the CR2O3 and FEO on that sample are the slag, not the metal. Iron is
therefore taken as what is left of the hundred, which is the ordinary way to
read a ferrochrome analysis and is still an inference. The response marks it
`derived` so the screen can say so, rather than presenting an arithmetic
convenience as a laboratory result.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Iterable

from sqlalchemy.orm import Session

from app.services.plant_output import get_plant_output
from app.services.quality_e2e import get_quality_e2e

# How many consignments "the last few" means. Three is what somebody remembers
# loading; ten is a month by another name.
RECENT_CONSIGNMENTS = 3

# What is left of the hundred once the recorded elements are taken out. Only
# these five are assayed on the composite, so anything else in the metal lands
# in "iron" — which is why the result is reported as derived.
_METAL_ELEMENTS = ("cr", "si", "c", "p", "s")


def _wavg(pairs: Iterable[tuple[float | None, float]]) -> float | None:
    """A tonnage-weighted average, ignoring what was not measured.

    Rows with no assay are left out of both halves rather than counted as
    zero — an unassayed consignment is a gap, and averaging it in as nought
    would drag the figure toward a number nobody reported.
    """
    num = den = 0.0
    for value, weight in pairs:
        if value is None or not weight:
            continue
        num += float(value) * float(weight)
        den += float(weight)
    return round(num / den, 3) if den else None


def _ore_side(rows: list[dict]) -> dict[str, Any]:
    """Mine against plant for one set of consignments."""
    return {
        "consignments": len(rows),
        "qty": round(sum(float(r["mines"].get("qty") or 0) for r in rows), 2),
        "mines_cr2o3": _wavg((r["mines"].get("cr2o3"), r["mines"].get("qty") or 0)
                             for r in rows),
        "plant_cr2o3": _wavg((r["plant"].get("cr2o3"), r["mines"].get("qty") or 0)
                             for r in rows),
        "mines_cr_fe": _wavg((r["mines"].get("cr_fe"), r["mines"].get("qty") or 0)
                             for r in rows),
        "plant_cr_fe": _wavg((r["plant"].get("cr_fe"), r["mines"].get("qty") or 0)
                             for r in rows),
    }


def _metal_side(rows: list[dict]) -> dict[str, Any]:
    """Chromium, and iron by difference, for one set of furnace-days."""
    yields = [(r.get("yield_t") or 0) for r in rows]
    cr = _wavg((r.get("cr"), r.get("yield_t") or 0) for r in rows)

    # Iron is whatever the assayed elements do not account for. Computed per
    # furnace-day and then weighted, not from the averaged elements: the mean
    # of a ratio is not the ratio of the means, and only days with a full
    # analysis can contribute one.
    ratios: list[tuple[float | None, float]] = []
    for r in rows:
        if r.get("cr") is None:
            continue
        measured = sum(float(r[e]) for e in _METAL_ELEMENTS if r.get(e) is not None)
        iron = 100.0 - measured
        if iron > 0:
            ratios.append((float(r["cr"]) / iron, r.get("yield_t") or 0))
    return {
        "furnace_days": len(rows),
        "yield_t": round(sum(yields), 2),
        "cr": cr,
        "cr_fe": _wavg(ratios),
        # Said plainly, because the screen has to repeat it: no iron is
        # recorded anywhere for this metal.
        "cr_fe_derived": True,
    }


def get_chain_scorecard(db: Session, frm: date, to: date) -> dict:
    """Ore out and metal made, at the level a meeting opens with."""
    ore = get_quality_e2e(db, frm, to)
    metal = get_plant_output(db, frm, to)

    rows = ore.get("rows") or []
    dests = [d["key"] for d in (ore.get("destinations") or [])] or ["BAL"]

    ore_block: dict[str, Any] = {"destinations": ore.get("destinations") or [],
                                 "mtd": {}, "recent": {}}
    for key in dests:
        mine = [r for r in rows if r.get("destination") == key]
        ore_block["mtd"][key] = _ore_side(mine)
        # Newest first: the rows arrive newest-first already, but sorting here
        # means this does not depend on that staying true.
        newest = sorted(mine, key=lambda r: r["date"], reverse=True)
        ore_block["recent"][key] = _ore_side(newest[:RECENT_CONSIGNMENTS])
    ore_block["recent_of"] = RECENT_CONSIGNMENTS

    prod = metal.get("rows") or []
    plants = metal.get("plants") or []

    # The most recent day that was ASSAYED, not merely the most recent day.
    #
    # A composite is sampled on the day and filed the following morning, so the
    # newest production day almost always has a yield and no chemistry —
    # yesterday's column would be blank most mornings, which reads as a
    # stoppage rather than as a laboratory still working. The date travels with
    # the figure so nobody has to assume which day it is.
    assayed = [r["date"] for r in prod if r.get("cr") is not None]
    last_day = max(assayed, default=None) or max(
        (r["date"] for r in prod), default=None)

    metal_block: dict[str, Any] = {"plants": plants, "mtd": {}, "last_day": {},
                                   "last_day_date": last_day}
    for p in plants:
        key = p["key"]
        metal_block["mtd"][key] = _metal_side([r for r in prod if r["plant"] == key])
        metal_block["last_day"][key] = _metal_side(
            [r for r in prod if r["plant"] == key and r["date"] == last_day])

    return {
        "from": frm.isoformat(), "to": to.isoformat(),
        "ore": ore_block,
        "metal": metal_block,
    }
