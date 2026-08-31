"""
LCM for COB — Kaliapani chrome ore beneficiation plant, SAP plant 1210.

The mines LCM distributes a production deviation across LOSS HEADS taken from
the shift log's own columns. The COB plant has no equivalent: there is no
downtime table anywhere in the schema. mines_hand_over_take_over_cobp records
OK / NOT OK per equipment (99.4% "OK", no hours), and SAP breakdown for plant
1210 is effectively unused — five notifications in April 2026, 3.25 hours in
total. A head-by-head hour matrix therefore cannot be built from data that
exists today.

What CAN be built, and what this module does, is attribute the concentrate
deviation to its measurable CAUSES:

    Deviation        = Plan Concentrate - Actual Concentrate           (MT)

    Feed Volume Loss = (Plan Feed - Actual Feed) x Plan Recovery       (MT)
    Recovery Loss    = Actual Feed x (Plan Recovery - Actual Recovery) (MT)

Those two sum to the Deviation identically — by algebra, not by rounding:

    (Pf - Af)Rp + Af(Rp - Ra) = Pf.Rp - Af.Rp + Af.Rp - Af.Ra = Pc - Ac

That is the same self-normalising property the mines LCM gets from deriving its
factor out of the total it divides: changing a source can only reallocate share
between heads, never break the total.

The Recovery loss then splits by WHY recovery missed plan. Feed arriving leaner
than planned caps what the plant can possibly recover, and that ceiling is
derived by chrome balance rather than assumed:

    Achievable Recovery = (Actual Feed Grade / Actual Conc Grade)
                          x Plan Chrome Recovery

    Feed Grade Loss  = Actual Feed x (Plan Recovery - Achievable Recovery)
    Plant Efficiency = Recovery Loss - Feed Grade Loss

Feed Grade + Plant Efficiency sum back to Recovery Loss by construction. Plant
Efficiency goes NEGATIVE when the plant beat the recovery its feed entitled it
to — a genuine gain, rendered green, not a loss to be explained away.

Tailings are deliberately not costed. Chrome reporting to tailings is already
inside the Recovery head; adding it as a third line would double-count the same
lost metal. COB is valued on concentrate alone.
"""
from __future__ import annotations
from datetime import date
from sqlalchemy import text
from sqlalchemy.orm import Session

# Net of SAP reversal documents — see sap_movement.
from app.services.sap_movement import PRODUCTION_QTY, CONSUMPTION_QTY

# ── Plant and materials ──────────────────────────────────────────────────────
# Reused verbatim from the COB Plant section so the two can never disagree on
# what a tonne of feed or concentrate is. Matched on MATERIAL_NO, not the
# description, which is editable in SAP.
PLANT_COB       = "1210"
MAT_LG_ORE      = "000000000025000003"  # LOW GRADE ORE(-40%CR2O3)      -> feed
MAT_CONCENTRATE = "000000000030000001"  # CONCENTRATE WITH STD MOISTURE -> output

# ── Costing ──────────────────────────────────────────────────────────────────
# IBM publishes a CONCENTRATES line separate from the Cr2O3-banded fines
# schedule the mines LCM uses. COB output is concentrate, so it is valued on
# that line — the fines bands are not applicable to a beneficiated product and
# are not consulted here.
#
#   IBM June 2026        Rs/MT
#   CONCENTRATES         24,560
#
# One rate, one product: no weighting is required. That is the whole reason the
# COB costing is simpler than the mines costing, which has to plan-weight across
# HG/MG/LG. Kept as a module constant for the same reason IBM_RATES is — when
# the rate table moves into the database, this is the single place to change.
IBM_RATE_CONCENTRATE = 24560.0
IBM_RATE_SOURCE      = "IBM average sale price, June 2026 - concentrates"


def _f(v) -> float:
    return float(v) if v is not None else 0.0


def _div(a: float, b: float):
    """Ratio, or None when the denominator is absent. Never silently returns 0 —
    a missing ratio and a genuine zero are different facts."""
    return (a / b) if b else None


# ── Plan side ────────────────────────────────────────────────────────────────
def _plan(db: Session, fd: date, td: date) -> dict:
    """Plan totals for the window.

    Quantities are summed. Grades are QUANTITY-WEIGHTED, not averaged: the plan
    varies day to day and an unweighted mean of daily percentages is only correct
    when every day carries identical tonnage. Recovery and feed rate are then
    DERIVED from the summed quantities rather than read from their own columns,
    so the plan is internally consistent by construction — a stored recovery that
    disagreed with the stored quantities could not produce a decomposition that
    foots.
    """
    sql = text("""
        SELECT
            COALESCE(SUM(Feed_qty),            0) AS feed,
            COALESCE(SUM(Concentrate_qty),     0) AS concentrate,
            COALESCE(SUM(Planned_running_hr),  0) AS running_hr,
            COALESCE(SUM(Shutdown_hr),         0) AS shutdown_hr,
            COALESCE(SUM(Total_avail_hr),      0) AS avail_hr,
            SUM(Feed_qty        * Feed_grade_Cr2O3)        AS feed_grade_num,
            SUM(CASE WHEN Feed_grade_Cr2O3        IS NOT NULL THEN Feed_qty        END) AS feed_grade_den,
            SUM(Concentrate_qty * Concentrate_grade_Cr2O3) AS conc_grade_num,
            SUM(CASE WHEN Concentrate_grade_Cr2O3 IS NOT NULL THEN Concentrate_qty END) AS conc_grade_den,
            COUNT(*) AS plan_days
        FROM mines_cobp_plan
        WHERE Plan_date BETWEEN :fd AND :td
    """)
    r = db.execute(sql, {"fd": fd, "td": td}).fetchone()

    feed = _f(r.feed)
    conc = _f(r.concentrate)
    fg   = _div(_f(r.feed_grade_num), _f(r.feed_grade_den))
    cg   = _div(_f(r.conc_grade_num), _f(r.conc_grade_den))

    return {
        "feed":            feed,
        "concentrate":     conc,
        "running_hours":   _f(r.running_hr),
        "shutdown_hours":  _f(r.shutdown_hr),
        "available_hours": _f(r.avail_hr),
        "plan_days":       int(r.plan_days or 0),
        "feed_grade":      fg,
        "conc_grade":      cg,
        # Weight recovery = concentrate out per tonne of feed in.
        "recovery":        _div(conc, feed),
        # Feed rate the plan implies across the window, in MT/hr. Used to infer
        # running hours from tonnage — see get_cob_lcm.
        "feed_rate":       _div(feed, _f(r.running_hr)),
        # Chrome recovery = Cr2O3 units in concentrate / Cr2O3 units in feed.
        "chrome_recovery": _div(conc * cg, feed * fg) if (cg is not None and fg is not None) else None,
    }


# ── Actual side ──────────────────────────────────────────────────────────────
def _actual_qty(db: Session, fd: date, td: date) -> dict:
    """Feed and concentrate actuals from SAP.

    Movement types and material descriptions are those the COB Plant section
    already uses, so the LCM's denominators match what that page displays.
    """
    sql = text(f"""
        SELECT
            COALESCE(SUM(CASE WHEN MATERIAL_DESC = 'LOW GRADE ORE(-40%CR2O3)'
                              THEN ({CONSUMPTION_QTY}) END), 0) AS feed,
            COALESCE(SUM(CASE WHEN MATERIAL_DESC = 'CONCENTRATE WITH STD MOISTURE'
                              THEN ({PRODUCTION_QTY}) END), 0) AS concentrate,
            COUNT(DISTINCT POSTING_DATE) AS posted_days,
            MAX(POSTING_DATE)            AS last_posted
        FROM pp_production
        WHERE PLANT = :plant
          AND POSTING_DATE BETWEEN :fd AND :td
    """)
    r = db.execute(sql, {"plant": PLANT_COB, "fd": fd, "td": td}).fetchone()
    return {
        "feed":        _f(r.feed),
        "concentrate": _f(r.concentrate),
        "posted_days": int(r.posted_days or 0),
        "last_posted": r.last_posted,
    }


def _actual_grades(db: Session, fd: date, td: date) -> dict:
    """Feed and concentrate Cr2O3 for the window.

    Weighted by ACTUAL_LOT_QUANTITY where it is present, because a lot is a
    sample of a tonnage and a big lot should not count the same as a small one.
    Where that column is null the weighted figure is undefined, so the simple
    mean is returned instead and `weighted` reports which basis was actually
    used — the page states it rather than leaving a reader to guess.
    """
    sql = text("""
        SELECT
            MATERIAL_NO                       AS mat,
            AVG(RESULT)                       AS simple_avg,
            SUM(RESULT * ACTUAL_LOT_QUANTITY) AS num,
            SUM(CASE WHEN RESULT IS NOT NULL THEN ACTUAL_LOT_QUANTITY END) AS den,
            COUNT(*)                          AS lots
        FROM pp_quality_inspection
        WHERE PLANT               = :plant
          AND SHORT_TEXT_INS_CHAR = 'Cr2O3'
          AND MATERIAL_NO        IN (:mat_feed, :mat_conc)
          AND QLT_START_DATE BETWEEN :fd AND :td
        GROUP BY MATERIAL_NO
    """)
    rows = db.execute(sql, {
        "plant": PLANT_COB, "mat_feed": MAT_LG_ORE, "mat_conc": MAT_CONCENTRATE,
        "fd": fd, "td": td,
    }).fetchall()

    out = {"feed_grade": None, "conc_grade": None, "weighted": False, "lots": 0}
    for r in rows:
        wtd = _div(_f(r.num), _f(r.den))
        val = wtd if wtd is not None else (float(r.simple_avg) if r.simple_avg is not None else None)
        key = "feed_grade" if r.mat == MAT_LG_ORE else "conc_grade"
        out[key]     = val
        out["lots"] += int(r.lots or 0)
        if wtd is not None:
            out["weighted"] = True
    return out


# ── Main ─────────────────────────────────────────────────────────────────────
def get_cob_lcm(db: Session, from_date: date, to_date: date) -> dict:
    plan = _plan(db, from_date, to_date)
    aq   = _actual_qty(db, from_date, to_date)
    ag   = _actual_grades(db, from_date, to_date)

    plan_feed = plan["feed"]
    plan_conc = plan["concentrate"]
    act_feed  = aq["feed"]
    act_conc  = aq["concentrate"]

    plan_rec = plan["recovery"]          # concentrate per tonne of feed, planned
    act_rec  = _div(act_conc, act_feed)  # ...achieved

    # Deviation is NOT clamped at zero the way the mines LCM clamps its factor.
    # There the clamp protects a division; here the decomposition is a plain
    # identity, so a period where the plant beat plan produces a negative
    # deviation that stays meaningful and renders green.
    #
    # A window with no plan rows is different: "deviation from plan" has no
    # meaning without a plan, and plan_conc would default to 0, reporting the
    # entire actual production as a negative deviation. That is a fabricated
    # number, so it reports null instead. mines_cobp_plan starts in April 2026,
    # so any window before that hits this branch.
    deviation = (plan_conc - act_conc) if plan["plan_days"] > 0 else None

    # ── Level 1 ──────────────────────────────────────────────────────────────
    feed_volume_loss = (plan_feed - act_feed) * plan_rec if plan_rec is not None else None
    recovery_loss = (
        act_feed * (plan_rec - act_rec)
        if (plan_rec is not None and act_rec is not None) else None
    )

    # ── Level 2 — why recovery missed ────────────────────────────────────────
    # Leaner feed lowers the recovery that is metallurgically available before
    # the plant does anything at all. Splitting that out separates what the mine
    # sent from what the plant did with it.
    achievable_rec = None
    if ag["feed_grade"] and ag["conc_grade"] and plan["chrome_recovery"] is not None:
        achievable_rec = (ag["feed_grade"] / ag["conc_grade"]) * plan["chrome_recovery"]

    feed_grade_loss = (
        act_feed * (plan_rec - achievable_rec)
        if (plan_rec is not None and achievable_rec is not None) else None
    )
    efficiency_loss = (
        recovery_loss - feed_grade_loss
        if (recovery_loss is not None and feed_grade_loss is not None) else None
    )

    # ── Rows ─────────────────────────────────────────────────────────────────
    # Loss Amount is costed off the ROUNDED MT — the figure the page prints — so
    # every row is reproducible by hand from what is on screen and the column
    # foots to its own total. Same rule as the mines costing card, for the same
    # reason: precision that breaks visible arithmetic is worth nothing.
    def row(sl, label, level, parent, mt):
        mt_r = round(mt, 1) if mt is not None else None
        return {
            "sl_no":            sl,
            "loss_description": label,
            "level":            level,
            "parent":           parent,
            "loss_mt":          mt_r,
            "loss_amount":      round(mt_r * IBM_RATE_CONCENTRATE, 2) if mt_r is not None else None,
            "loss_share_pct":   None,   # filled below, once the total is known
        }

    rows = [
        row(1, "Feed volume",      1, None,               feed_volume_loss),
        row(2, "Recovery / yield", 1, None,               recovery_loss),
        row(3, "Feed grade",       2, "Recovery / yield", feed_grade_loss),
        row(4, "Plant efficiency", 2, "Recovery / yield", efficiency_loss),
    ]

    # Total is the SUM OF THE PRINTED LEVEL-1 ROWS, not a separately computed
    # deviation. Level 2 is excluded — it is a breakdown of row 2, and including
    # it would count the recovery loss twice.
    lvl1         = [r for r in rows if r["level"] == 1 and r["loss_mt"] is not None]
    total_mt     = round(sum(r["loss_mt"] for r in lvl1), 1) if lvl1 else None
    total_amount = round(sum(r["loss_amount"] for r in lvl1), 2) if lvl1 else None

    # Share is on the rupee basis, one decimal — at two, independently rounded
    # shares drift past 100%. A period that matched plan has a zero total, making
    # share 0/0: undefined, not zero, so it stays None and the page shows a dash.
    shares_valid = total_amount not in (None, 0)
    for r in rows:
        if shares_valid and r["loss_amount"] is not None:
            r["loss_share_pct"] = round(r["loss_amount"] / total_amount * 100, 1)

    # ── Hours ────────────────────────────────────────────────────────────────
    # INFERRED, never measured. There is no actual-running-hours source for the
    # plant, so hours are backed out of tonnage at the planned feed rate. That
    # assumes the plant ran at rate whenever it ran, which makes this an upper
    # bound on hours lost. The page says so; it is not presented as measured.
    implied_hours = _div(act_feed, plan["feed_rate"]) if plan["feed_rate"] else None
    hours_lost    = (plan["running_hours"] - implied_hours) if implied_hours is not None else None

    def r2(v, n=2):
        return round(v, n) if v is not None else None

    act_chrome_rec = (
        (act_conc * ag["conc_grade"]) / (act_feed * ag["feed_grade"]) * 100
        if (act_feed and ag["feed_grade"] and ag["conc_grade"]) else None
    )

    return {
        "from_date": from_date,
        "to_date":   to_date,
        "days":      (to_date - from_date).days + 1,

        "plan": {
            "feed":                r2(plan_feed),
            "concentrate":         r2(plan_conc),
            "recovery_pct":        r2(plan_rec * 100) if plan_rec is not None else None,
            "feed_grade":          r2(plan["feed_grade"], 3),
            "conc_grade":          r2(plan["conc_grade"], 3),
            "chrome_recovery_pct": r2(plan["chrome_recovery"] * 100) if plan["chrome_recovery"] is not None else None,
            "running_hours":       r2(plan["running_hours"]),
            "shutdown_hours":      r2(plan["shutdown_hours"]),
            "available_hours":     r2(plan["available_hours"]),
            "feed_rate":           r2(plan["feed_rate"]),
            "plan_days":           plan["plan_days"],
        },
        "actual": {
            "feed":                    r2(act_feed),
            "concentrate":             r2(act_conc),
            "recovery_pct":            r2(act_rec * 100) if act_rec is not None else None,
            "feed_grade":              r2(ag["feed_grade"], 3),
            "conc_grade":              r2(ag["conc_grade"], 3),
            "chrome_recovery_pct":     r2(act_chrome_rec),
            "achievable_recovery_pct": r2(achievable_rec * 100) if achievable_rec is not None else None,
            "posted_days":             aq["posted_days"],
            "grade_weighted":          ag["weighted"],
            "grade_lots":              ag["lots"],
        },

        # SAP posts a day or two behind. When the window runs past the last
        # posted date, the plan for those trailing days has no actual to be
        # compared against and lands in Feed Volume as loss that has not
        # happened yet. The page warns rather than quietly overstating: on the
        # default month-to-date window this was worth 222 MT / Rs 54 lakh.
        "posting": {
            "last_posted_date": aq["last_posted"],
            "unposted_days": (
                (to_date - aq["last_posted"]).days
                if aq["last_posted"] is not None and to_date > aq["last_posted"] else 0
            ),
        },

        "deviation_mt":  r2(deviation, 1),
        "has_plan":      plan["plan_days"] > 0,

        # Achievement against plan, on concentrate — the output the plant is
        # judged on, not feed. Deliberately NOT capped at 100%: a month that
        # beat plan should say so, and capping would hide it.
        #
        #     % Achieved = Actual Concentrate / Plan Concentrate x 100
        #
        # This is the same pair of numbers the deviation is built from, so the
        # two can never tell different stories.
        "achieved_pct": r2(_div(act_conc, plan_conc) * 100) if _div(act_conc, plan_conc) is not None else None,
        "rows":         rows,
        "totals": {
            "loss_mt":        total_mt,
            "loss_amount":    total_amount,
            "loss_share_pct": 100.0 if shares_valid else None,
        },

        "hours": {
            "planned":  r2(plan["running_hours"]),
            "implied":  r2(implied_hours),
            "lost":     r2(hours_lost),
            "inferred": True,
        },

        "costing": {
            "rate":   IBM_RATE_CONCENTRATE,
            "source": IBM_RATE_SOURCE,
            "basis":  "CONCENTRATES",
        },
    }
