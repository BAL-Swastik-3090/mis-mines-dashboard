"""AMIRA accounting — chromium followed along the chain, stage by stage.

WHAT THIS ANSWERS. Ore is weighed four or five times between the block model
and the furnace, and every weighing disagrees slightly with the one before it.
A tonne is not the unit that matters, though: what the business sells is the
chromium inside the tonne, so the reconciliation is done on CONTAINED CHROMIUM
and the gap between two stages is read as metal lost rather than tonnes lost.

    Net Chromium (MT) = Ore Qty x (1 - Moisture%) x Cr2O3% x 104/152

The 104/152 converts Cr2O3 to Cr: two chromium atoms at 52 against the whole
molecule at 2x52 + 3x16. It is chemistry, not a tuning factor, and must not be
"calibrated". Moisture comes off first because every assay in this chain is
reported on a dry basis while every weighbridge figure is wet.

    Chromium Loss  = Net Chromium at the previous stage - at this one
    Contribution   = Chromium Loss x CONTRIBUTION_RATE

Reproduces the mine's own workbook to the decimal. On its April 2026 sheet:
Block Model 4,353 / ROM 3,566 / ROM Stack 3,639 / Despatch 3,604 / Plant 3,572,
and this formula returns 4,353.1 / 3,566.1 / 3,639.5 / 3,604.1 / 3,572.1.

── PHASE 1: TWO STAGES OF SEVEN ──────────────────────────────────────────────
Only Mines Despatch and Plant Receipt are built. The other five are declared
here, in chain order, and returned UNAVAILABLE rather than left out, because
the shape of the table is the point — a reader has to see that the chain starts
at the block model even while those cells are empty.

They are empty for reasons, not oversight:

  Block Model      mines_geology_block_sample_analysis holds grade and no
                   tonnage at all, 83 rows, and stops in January 2026. The
                   block model itself is Surpac output and has never been
                   loaded.
  ROM              mines_daywise_rom_entry has Qty and Cr2O3 and is current to
                   October 2026, but carries NO MOISTURE, and moisture is a
                   term in the formula above. The mine's sheet uses one assumed
                   figure (10.24) at three stages; that assumption has to come
                   from the mine, not from here.
  ROM Stack        same moisture problem, and the stack tonnage is not held
                   anywhere as a period figure.
  Closing Stock    mines_stock spans 17 Aug - 25 Sep 2026 and mines_stock_entry
                   begins later still. There is no stock history to read.
  Production + CS  derived from the two above.

── WHY IT READS get_quality_e2e RATHER THAN THE TABLES ───────────────────────
The despatch and plant figures already exist, assayed and consignment-matched,
behind the End-to-End Quality section. Going back to zsd_outbound_despatch and
qm_quality_control here would mean a second implementation of the same four
filters, and the first time one of them was changed the two screens would quote
different tonnages for the same month with nothing to say which was right.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.services.quality_e2e import get_quality_e2e

# Cr2O3 -> Cr. Stoichiometric: (2 x 52.00) / (2 x 52.00 + 3 x 16.00).
CR2O3_TO_CR = 104.0 / 152.0

# ── CONTRIBUTION, AS THE WORKBOOK COMPUTES IT ────────────────────────────────
# Summary!D10 is  =(D9/0.6) * Contribution!$E$3 / 10^5 , and Contribution!E3 is
# =E1-E2, NSR minus variable cost. So the chain is NOT a rate per MT of
# chromium; it goes through the ferrochrome that chromium would have become:
#
#     chromium lost (MT)
#       / 0.60                 -> MT of ferrochrome not produced (HC FeCr is
#                                 60% Cr, so a tonne of metal needs 0.6 t of Cr)
#       x 45,000 Rs/MT         -> contribution forgone on that metal
#       / 100,000              -> expressed in Rs. Lacs
#
# It happens to reduce to "chromium loss x 0.75", and an earlier version of this
# file was written that way. That number is right and tells you nothing: the
# moment NSR moves it is wrong, and nobody reading 0.75 could see which of the
# three inputs had changed. Kept as the workbook's own three terms.
#
# HARD-CODED FOR NOW, AT THE MINE'S INSTRUCTION, and named so the day they move
# is a one-line change here rather than a hunt for a magic number. NSR is a
# market price and will eventually want a source of its own, the way the IBM
# rate got one in services/ibm_rates.py.
NSR_PER_MT_FECR = 115_000.0           # Contribution!E1
VARIABLE_COST_PER_MT_FECR = 70_000.0  # Contribution!E2
CONTRIBUTION_PER_MT_FECR = NSR_PER_MT_FECR - VARIABLE_COST_PER_MT_FECR  # E3 = 45,000

# Chromium content of high-carbon ferrochrome. The 0.6 divisor in the workbook.
FECR_CR_CONTENT = 0.60

# Rs -> Rs. Lacs, the 10^5 in the formula.
LAKH = 100_000.0

# The chain, in the order ore physically moves through it. Order is load-bearing
# twice over: the loss at each stage is measured against the one before it, and
# the table is read left to right as a journey.
STAGES: tuple[tuple[str, str], ...] = (
    ("block_model",    "Block Model"),
    ("rom",            "ROM"),
    ("rom_stack",      "ROM Stack"),
    ("closing_stock",  "Mines Closing Stock"),
    ("prod_plus_cs",   "Total Mines Production + Closing Stock"),
    ("mine_despatch",  "Mines Despatch"),
    ("plant_receipt",  "Plant Receipt"),
)

# Built in phase 1. Everything else returns available=False.
BUILT = ("mine_despatch", "plant_receipt")


def _net_chromium(ore_qty: float | None,
                  cr2o3: float | None,
                  moisture: float | None) -> float | None:
    """Contained chromium, MT. None if any term is missing.

    All three terms are required and none is defaulted. A missing moisture
    silently treated as zero would overstate the metal by a tenth and the error
    would then propagate into the loss at the NEXT stage as well, where it would
    look like a real loss rather than a missing input.
    """
    if ore_qty is None or cr2o3 is None or moisture is None:
        return None
    return ore_qty * (1.0 - moisture / 100.0) * (cr2o3 / 100.0) * CR2O3_TO_CR


def _contribution(cr_loss: float | None) -> float | None:
    """Rs. Lacs of contribution forgone on `cr_loss` MT of chromium.

    Summary!D10 verbatim: (loss / 0.6) x 45,000 / 10^5. Sign is carried through,
    so a stage that GAINED chromium shows a negative contribution loss rather
    than being clamped at zero — the workbook prints that as (55.07) and the
    Total column depends on it being signed.
    """
    if cr_loss is None:
        return None
    return (cr_loss / FECR_CR_CONTENT) * CONTRIBUTION_PER_MT_FECR / LAKH


def _round(v: float | None, places: int = 2) -> float | None:
    return None if v is None else round(v, places)


def get_amira_accounting(db: Session, frm: date, to: date) -> dict[str, Any]:
    """The chain as a list of stages, oldest first, with the losses between."""
    e2e = get_quality_e2e(db, frm, to)
    tot = e2e["totals"].get("ALL") or {}

    # Both destinations together: AMIRA accounts for what left the mine, not for
    # where it went. The per-plant split is the End-to-End Quality section's job.
    figures: dict[str, dict[str, float | None]] = {
        "mine_despatch": {
            "ore_qty":  tot.get("mines_qty"),
            "cr2o3":    tot.get("mines_cr2o3"),
            "moisture": tot.get("mines_moisture"),
        },
        "plant_receipt": {
            "ore_qty":  tot.get("plant_qty"),
            "cr2o3":    tot.get("plant_cr2o3"),
            "moisture": tot.get("plant_moisture"),
        },
    }

    stages: list[dict[str, Any]] = []
    prev_net: float | None = None
    prev_available = False

    for key, label in STAGES:
        available = key in BUILT and bool(figures.get(key))
        f = figures.get(key, {}) if available else {}
        ore, cr, moist = f.get("ore_qty"), f.get("cr2o3"), f.get("moisture")
        net = _net_chromium(ore, cr, moist)

        # LOSS IS AGAINST THE STAGE IMMEDIATELY BEFORE, NOT THE LAST ONE WE
        # HAPPEN TO HAVE. Mines Despatch therefore shows no loss in phase 1:
        # its predecessor is ROM Stack, which is blank. Reaching further back to
        # whatever is populated would print the drop from ROM — or from the
        # block model — under the Despatch heading, which is a different and
        # much larger number wearing the wrong label.
        loss = (None if not (prev_available and available)
                or prev_net is None or net is None
                else prev_net - net)

        stages.append({
            "key": key,
            "label": label,
            "available": available,
            "ore_qty":  _round(ore),
            "cr2o3":    _round(cr),
            "moisture": _round(moist),
            "net_chromium": _round(net),
            "chromium_loss": _round(loss),
            "contribution_loss": _round(_contribution(loss)),
        })
        prev_net, prev_available = net, available

    # ── THE TOTAL COLUMN ────────────────────────────────────────────────────
    # Summary!J9 is =SUM(C9:I9) and J10 is =SUM(C10:I10): the losses only. The
    # other four rows have no total in the workbook and must not grow one here —
    # summing Ore Quantity along the chain adds the same ore up five times over,
    # and a row of percentages does not sum to anything.
    #
    # A SIGNED SUM, deliberately. April gains 73.43 MT between ROM and ROM Stack
    # and the workbook's 781.10 is net of it; summing absolute values would read
    # 927.96 and describe a mine that lost chromium it still has.
    losses = [x["chromium_loss"] for x in stages if x["chromium_loss"] is not None]
    contribs = [x["contribution_loss"] for x in stages
                if x["contribution_loss"] is not None]

    return {
        "total": {
            "chromium_loss": _round(sum(losses)) if losses else None,
            "contribution_loss": _round(sum(contribs)) if contribs else None,
        },
        # NAMED from_date/to_date, NOT from/to. `from` is a Python keyword, so
        # the short form can never be a field on a Pydantic model and the
        # response model would drop it — which is how this shipped returning one
        # pair of names while the schema and the screen read the other.
        "from_date": frm.isoformat(),
        "to_date": to.isoformat(),
        "stages": stages,
        "cr2o3_to_cr": round(CR2O3_TO_CR, 5),
        # Published so the screen can show what the money is built from, and so
        # a changed NSR is visible rather than buried.
        "nsr_per_mt_fecr": NSR_PER_MT_FECR,
        "variable_cost_per_mt_fecr": VARIABLE_COST_PER_MT_FECR,
        "contribution_per_mt_fecr": CONTRIBUTION_PER_MT_FECR,
        "fecr_cr_content": FECR_CR_CONTENT,
        "pending_stages": [lbl for k, lbl in STAGES if k not in BUILT],
        # The plant tonnage is currently the despatched tonnage, by the mine's
        # instruction, until the plant-side gate record is identified. Stated
        # here so the screen can say so rather than implying the plant
        # independently weighed what it received.
        "plant_qty_mirrors_despatch": True,
    }
