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

── PHASE 1: FOUR STAGES OF SEVEN ──────────────────────────────────────────────
Block Model, ROM, Mines Despatch and Plant Receipt are built. The other three
are declared
here, in chain order, and returned UNAVAILABLE rather than left out, because
the shape of the table is the point — a reader has to see that the chain starts
at the block model even while those cells are empty.

They are empty for reasons, not oversight:

  ROM Stack        the stack tonnage is not held anywhere as a period figure,
                   and the sheet's own ROM row is this stack figure copied
                   across -- see the note above _ROM_SQL.
  Closing Stock    mines_stock_entry now runs to date, but it holds TONNAGE
                   ONLY -- no Cr2O3 and no moisture -- so a stock column could
                   carry a weight and never a Net Chromium, and the chain
                   would step over it anyway. Blocked on an assay, not a date.
  Production + CS  derived from the two above.

Block Model and ROM are the exceptions and read minehub.mines_rom_entry, the
mine's own day-wise analysis -- the two halves of one row, geology's and
production's. BLOCK MODEL CARRIES A GRADE AND NO TONNAGE OF ITS OWN: the model
is Surpac output and has never been loaded here, so the tonnage and moisture
printed in that column are ROM's, which is what its grade was weighted by in
the first place. See _block_model().

ROM's own figures are tonnage, grade and the lab's daily composite moisture.
A characteristic is reported only if EVERY sample in the period carries it, so
one day the lab is silent on keeps the column blank rather than quietly
averaging the days it did reach.

── WHY IT READS get_quality_e2e RATHER THAN THE TABLES ───────────────────────
The despatch and plant figures already exist, assayed and consignment-matched,
behind the End-to-End Quality section. Going back to zsd_outbound_despatch and
qm_quality_control here would mean a second implementation of the same four
filters, and the first time one of them was changed the two screens would quote
different tonnages for the same month with nothing to say which was right.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.quality_e2e import get_quality_e2e

logger = logging.getLogger(__name__)

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

# -- ROM, OFF THE MINE'S OWN DAY-WISE ANALYSIS -------------------------------
# minehub.mines_rom_entry -- one row per sample, filed shift by shift from the
# "ENTRY DAYWISE ROM" screen (migration 132). The period's tonnage is the sum
# of its rows and the grade is the tonnage-weighted mean of them; neither is
# stored, here or anywhere, so no total can disagree with its parts.
#
# -- WHY IT NO LONGER READS SAP ----------------------------------------------
# It used to read PLANT 1200 / STORAGE_LOCATION 'ROM1' in pp_quality_inspection
# -- one inspection lot per day, LOT_QUANTITY as the tonnage and the CR2O3
# characteristic as the grade. That is the LAB's record of what it tested. This
# is the MINE's record of what it dug, shift by shift and face by face, and the
# mine asked for its own.
#
# The two were never the same number, and neither is the workbook's. Summary!D5
# is 'APRIL-26 Details'!F113 and F5 is =AC5 -- the ROM STACK's FSQ -- so the
# sheet's ROM tonnage is the stack tonnage copied across and its Cr2O3 is
# weighted by shift quantity rather than by lot. April 2026 reads 13,265.54 @
# 43.7693 in the sheet against ROM1's 13,976.00 @ 44.0113. Which of the three a
# reader wants is a question for the business; this one answers "what the mine
# filed", and that is a figure somebody owns and can correct on screen.
#
# MOISTURE WILL READ BLANK, AND THAT IS NOT A FAULT. The entry form carries a
# %MOISTURE box and nobody fills it. Null means nobody measured it, which is
# not the same as dry -- so Net Chromium stays blank with it rather than being
# computed off an assumed figure. The day the mine starts entering moisture,
# both fill in on their own and nothing here has to change.
_ROM_SQL = text("""
    SELECT
        COUNT(*)    AS samples,
        SUM(qty_mt) AS ore_qty,
        SUM(CASE WHEN cr2o3_pct    IS NOT NULL THEN 1 ELSE 0 END) AS n_cr2o3,
        SUM(CASE WHEN moisture_pct IS NOT NULL THEN 1 ELSE 0 END) AS n_moisture,
        SUM(CASE WHEN cr2o3_pct IS NOT NULL THEN qty_mt * cr2o3_pct END)
          / NULLIF(SUM(CASE WHEN cr2o3_pct IS NOT NULL THEN qty_mt END), 0)
            AS cr2o3,
        SUM(CASE WHEN moisture_pct IS NOT NULL THEN qty_mt * moisture_pct END)
          / NULLIF(SUM(CASE WHEN moisture_pct IS NOT NULL THEN qty_mt END), 0)
            AS moisture,
        -- THE BLOCK HALF, WEIGHTED BY THE SAME TONNAGE. See _block_model().
        SUM(CASE WHEN block_cr2o3_pct IS NOT NULL THEN 1 ELSE 0 END) AS n_block,
        SUM(CASE WHEN block_cr2o3_pct IS NOT NULL THEN qty_mt * block_cr2o3_pct END)
          / NULLIF(SUM(CASE WHEN block_cr2o3_pct IS NOT NULL THEN qty_mt END), 0)
            AS block_cr2o3
      FROM minehub.mines_rom_entry
     WHERE on_date BETWEEN :frm AND :to
""")


def _mine_entry(frm: date, to: date) -> dict[str, dict[str, float | None]]:
    """The two stages the mine files itself: {"block_model": .., "rom": ..}.

    ONE QUERY FOR BOTH. They are two halves of one row -- production files the
    left, geology the right -- so reading them separately would mean two
    sessions and two scans of the same rows to produce figures that must agree
    about which rows exist. A stage with nothing to show is an empty dict.

    Below, for the ROM half:

    A CHARACTERISTIC IS REPORTED ONLY IF EVERY SAMPLE CARRIES IT. Weighting
    across whichever rows happen to have been measured, and presenting that as
    the period's figure, is how a grade quietly becomes a sample of itself.
    Moisture is the live case and reads blank for exactly that reason.

    IT OPENS ITS OWN SESSION rather than using the one it was handed. That one
    is MySQL, and this table exists only in minehub with no MySQL counterpart
    to fall back to -- so there is nothing for sap_source to route. An
    unreachable minehub means the ROM stage is unsourced, which is what the
    empty dict says, and the table keeps the shape of the chain regardless.
    """
    try:
        from app.minehub_db import SessionLocal
        if SessionLocal is None:
            return {}
        pg = SessionLocal()
    except Exception:                                       # noqa: BLE001
        logger.warning("minehub unavailable for the mine's own stages",
                       exc_info=True)
        return {}
    try:
        r = pg.execute(_ROM_SQL, {"frm": frm, "to": to}).first()
    except Exception:                                       # noqa: BLE001
        logger.warning("the mine's own stages could not be read", exc_info=True)
        return {}
    finally:
        pg.close()

    if not r or not r.samples:
        return {}
    full = lambda n: n is not None and int(n) == int(r.samples)  # noqa: E731
    rom = {
        "ore_qty": float(r.ore_qty) if r.ore_qty is not None else None,
        "cr2o3": float(r.cr2o3) if full(r.n_cr2o3) and r.cr2o3 is not None else None,
        "moisture": (float(r.moisture)
                     if full(r.n_moisture) and r.moisture is not None else None),
    }
    return {"block_model": _block_model(r, full, rom), "rom": rom}


def _block_model(r, full, rom: dict) -> dict[str, float | None]:
    """The block model's grade for the period, on ROM's tonnage and moisture.

    ── THE TONNAGE AND MOISTURE SHOWN HERE ARE ROM'S, AND SAY SO ────────────
    The block model is Surpac output and carries no tonnage into this platform
    -- mines_geology_block_sample_analysis holds grade and nothing else, and
    the model itself has never been loaded. What the mine files against a ROM
    sample is the block's GRADE for the ground that sample came out of, not a
    reserve figure.

    So the tonnage in this column is not the model's. It is the ROM tonnage
    the grade was already weighted by, four paragraphs down, and the moisture
    is the ROM moisture that tonnage was measured with. They are PRINTED, at
    the mine's instruction (24 Nov 2026), because the Net Chromium below them
    is computed from them and a reader cannot check a figure against cells
    that are blank. The footnote carries the warning the blank cells used to:
    this is not a reserve, and the model has not been reconciled against
    production.

    MOISTURE IS ROM'S, AND MUST BE. The (1 - moisture) term converts a WET
    weighbridge tonnage to a dry one, because every assay in this chain is
    dry-basis. The tonnage here IS ROM's wet tonnage, so it needs ROM's
    moisture taken off it. Treating the model as dry and passing 0 does not
    describe an in-situ reserve -- it leaves November's 11.35% of water in the
    tonnage and prints 416 MT of it as chromium, which then shows up as a
    369 MT "loss" that is entirely water. The model having no moisture of its
    own is not a reason to apply none.

    ── WHAT THE RESULTING LOSS MEANS, AND WHAT IT DOES NOT ──────────────────
    Both sides carry the same tonnage and the same moisture, so everything
    cancels but the grade: this is a GRADE variance, the thing the entry
    screen already prints as "Block model 42.74 vs ROM 33.55". It is NOT the
    mine workbook's Block Model loss, which also carries whatever tonnage the
    model promised and the mine did not dig. Back-solving the April sheet
    (Block Model 4,353.1 against ROM 3,566.1 on 13,265.54 MT @ 43.7693) needs
    either a block grade of 47.96% or a block tonnage near 16,193 MT, and
    nothing here can say which. So this figure is the grade half only, and it
    will move -- probably a long way -- the day Surpac tonnage is loaded.

    ── WHY THE ROM TONNAGE IS STILL THE WEIGHT ──────────────────────────────
    A grade on its own cannot be averaged across a period: 51.80% won off 120
    MT and 43.39% won off 710 MT are not two equal opinions about November. The
    only tonnage that exists for the ground each block figure describes is the
    ROM that came out of it, so that is the weight -- the same weight, row for
    row, that produces the ROM column's own Cr2O3. The two columns are then
    comparable by construction, and the difference between them is the thing a
    reader is here to see: what the model said the ground held against what
    came off it.

    ── AND IT IS REPORTED ONLY IF EVERY SAMPLE CARRIES IT ───────────────────
    The block half is filled by geology, after the fact and separately, so a
    period part-filled is the normal state rather than an error. Weighting
    across whichever rows geology has reached, and printing that as the
    month's block grade, would move the figure every time somebody filed one
    more row -- and move it most while the sample is smallest. The same rule
    that keeps a half-measured moisture out of the ROM column keeps a
    half-filled block model out of this one.
    """
    if not full(r.n_block) or r.block_cr2o3 is None:
        return {}
    grade = float(r.block_cr2o3)
    return {
        # ROM's, both of them -- see above. Shown rather than blank so that the
        # Net Chromium under them can be checked against the cells that made
        # it, which is the rule every other stage in this table already keeps.
        "ore_qty": rom.get("ore_qty"),
        "cr2o3": grade,
        "moisture": rom.get("moisture"),
    }


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
BUILT = ("block_model", "rom", "mine_despatch", "plant_receipt")


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
        **_mine_entry(frm, to),
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
    prev_label: str | None = None

    for key, label in STAGES:
        available = key in BUILT and bool(figures.get(key))
        f = figures.get(key, {}) if available else {}
        ore, cr, moist = f.get("ore_qty"), f.get("cr2o3"), f.get("moisture")
        # EVERY stage computes from the three cells a reader can see. Block
        # Model was the one exception until 24 Nov 2026, when its borrowed
        # tonnage and moisture started being printed; there is now no stage
        # whose Net Chromium cannot be reproduced from the column above it.
        net = _net_chromium(ore, cr, moist)

        # LOSS IS AGAINST THE LAST STAGE THAT CARRIES A FIGURE, which while
        # the chain is part-sourced is not always the stage immediately to the
        # left. At the mine's instruction (24 Nov 2026), so that Mines Despatch
        # shows a loss now rather than waiting for the stock stages.
        #
        # READ THE RESULT WITH ITS LABEL, NOT ALONE. `loss_against` names the
        # stage each figure was actually measured against, and the screen
        # prints it, because a gap that spans skipped stages contains whatever
        # happened in them. Mines Despatch is the live example: it despatched
        # 1,639 MT MORE than ROM mined, having drawn the difference out of
        # stock, so its "loss" comes out NEGATIVE — around (520) MT — and that
        # is stock movement, not metal found. It is a real arithmetic
        # difference between two real figures; it is not a mining gain, and it
        # stops being a stock artefact only when ROM Stack and Closing Stock
        # are sourced and the skip disappears on its own.
        loss = (None if prev_net is None or net is None
                else prev_net - net)
        loss_against = prev_label if loss is not None else None

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
            "loss_against": loss_against,
        })
        # Only a stage that HAS a figure becomes the next one's baseline. An
        # unsourced stage is stepped over rather than resetting the chain.
        if net is not None:
            prev_net, prev_label = net, label

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
