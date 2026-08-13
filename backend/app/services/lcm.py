"""
LCM (Lost Cost Matrix) — Kaliapani Mines excavators, plant 1200.

Mirrors the mine's "LCM Summary (Own Equipment)" / "Loss Heads (Own Equipment)"
workbook sheets. Own equipment only.

    Ore Deviation = Plan Ore − Actual Ore                       (MT)
    OB  Deviation = Plan OB  − Actual OB                        (CuM)

    Ore Factor    = Ore Deviation ÷ Σ Ore Production Hour Loss  (MT/hr)
    OB  Factor    = OB  Deviation ÷ Σ OB  Production Hour Loss  (CuM/hr)

    Planned Ore Loss (head) = Ore Hour Loss (head) × Ore Factor
    Planned OB  Loss (head) = OB  Hour Loss (head) × OB  Factor

Because each factor is derived from the same hour total it divides, the Planned
Loss column always sums back to the Deviation exactly. That also means changing
one head's source only reallocates share between heads — it never breaks the total.

Machine split supplied by the mine:
    Ore excavation → TATA-470(7), TATA-470(2)
    OB  excavation → TATA-370(5), TATA-370(4), TATA-220(8)
"""
from __future__ import annotations
from datetime import date
from sqlalchemy import text
from sqlalchemy.orm import Session

# ── Machine groups (own equipment only) ───────────────────────────────────────
ORE_MACHINES = [
    {"name": "TATA-470(7)", "code": "470-7", "sap_eq": "000000000000700086"},
    {"name": "TATA-470(2)", "code": "470-2", "sap_eq": "000000000000700042"},
]
OB_MACHINES = [
    {"name": "TATA-370(5)", "code": "370-5", "sap_eq": "000000000000700064"},
    {"name": "TATA-370(4)", "code": "370-4", "sap_eq": "000000000000700053"},
    {"name": "TATA-220(8)", "code": "220-8", "sap_eq": "000000000000700090"},
]

# Plan / actual sources — identical to the Production and OB sections so the
# LCM denominators always agree with what those pages already display.
ORE_MATERIALS = ("000000000025000002", "000000000025000001", "000000000025000003")
OB_MATERIAL   = "000000000016000009"
PLANT         = "1200"
WORK_CENTRE   = "MINEAUTO"

# ── Costing ──────────────────────────────────────────────────────────────────
# Loss Amount values the planned ore loss at the IBM (Indian Bureau of Mines)
# published rate. The rate is grade-wise, so the single figure applied to the
# loss column is the plan-weighted average across HG/MG/LG:
#
#     Weighted Rate = Σ(Plan Qty[g] × IBM Rate[g]) ÷ Σ Plan Qty[g]
#     Loss Amount   = Planned Ore Loss (MT) × Weighted Rate
#
# The weighting uses the PLAN mix, not the actual mix — the loss being valued is
# ore that was planned and never came out of the ground, so it carries the grade
# mix the plan intended. Being a ratio, the weighting is scale-invariant: it does
# not matter whether HG+MG+LG equals ORE_QTY exactly, only their proportions.
#
# Rates are supplied by the mine today and are to be scraped from the IBM site
# later, behind a user confirmation step — hence the explicit `source` field, so
# the page can always state where the number in use came from.
IBM_RATE_SOURCE = "IBM weighted average price — South Kaliapani Chromite Mines"

# IBM publishes a price per Cr2O3 band, not per the HG/MG/LG buckets the mine
# plans in, so each bucket is mapped to the band that represents it:
#
#   Band      Basis   Rs/WMT     Bucket
#   +54%       54%    28,718     HG
#   52-54%     52%    27,740     HG  <- selected: the band starting at the
#                                       52% HG threshold, so it represents the
#                                       bulk of HG rather than only its top end
#   48-50%     48%    25,785     MG
#   46-48%     46%    24,225     MG  <- selected: basis 46% is the midpoint of
#                                       the 40-52% MG range
#   44-46%     44%    23,171     MG
#   42-44%     42%    22,118     MG
#
# Choosing the representative band, rather than averaging the bands, is
# deliberate: an unweighted average of published bands would assume the mine
# produces equally across them, which nothing in the data supports.
#
# ₹ per MT (WMT). None = not yet determined. While ANY grade carrying plan
# quantity has no rate, the whole Loss Amount column reports null rather than a
# number: dropping the unpriced grade would silently understate every row, which
# is worse than showing nothing.
IBM_RATES: dict[str, float | None] = {
    "HG": 27740.0,   # +52% CHROME ORE            -> IBM 52-54% band
    "MG": 24225.0,   # 40-52% CHROME ORE          -> IBM 46-48% band (midpoint)
    # IBM publishes no band below 42%, so LG has no listed price. Valued at zero
    # by the mine's decision — NOT a missing rate awaiting a number. Note this is
    # conservative: LG is the COB plant's feed material, so it does eventually
    # realise value as concentrate. Costing it at zero therefore understates the
    # true loss whenever a period's plan carries LG tonnage.
    "LG": 0.0,       # LOW GRADE ORE (-40% Cr2O3) -> no IBM band; valued at zero
}

# OB carries no rupee value. It is waste rock moved to expose ore, not a saleable
# product, so there is no IBM rate for it — the OB loss stays a volume in CuM.
# If the mine later wants OB costed at an internal ₹/CuM excavation cost, that is
# a different figure with a different meaning and should be labelled as such.

# Mining Restriction carries no column in mines_tipper_details, and the mine
# enters it by hand rather than by rule — 48.00 hrs/machine in July 2026 but
# 5.00 hrs/machine for 1-11 Aug. It is therefore NOT derivable, and any constant
# here would be invented. Left at 0 until a real source exists; the page footnote
# says so, so the row reads as unsourced rather than as a measured zero.
MINING_RESTRICTION_HRS_PER_MACHINE = 0.0

# sl_no, label, source, loss_type, kam
#   source: a mines_tipper_details column, or 'SAP_BD' / 'SAP_PM' / 'CONST_MR'
LOSS_HEADS: list[tuple] = [
    (1,  "Breakdown",                   "SAP_BD",               "Controllable",     "Amarendra Sarangi"),
    (2,  "Preventive Maintenance",      "SAP_PM",               "Non Controllable", "Amarendra Sarangi"),
    (3,  "LATE START",                  "late_start",           "Controllable",     "Pramod Kumar"),
    (4,  "TIFFIN",                      "tiffin",               "Non Controllable", "Bhabani Shankar"),
    (5,  "H.S.D SHORTAGE",              "hsd_shortage",         "Controllable",     "Bhimsen Barik"),
    (6,  "STRIKE",                      "strike",               "Controllable",     "Bhabani Shankar"),
    (7,  "IDLE REQU BASIC",             "idle_requ_basic",      "Controllable",     "Pramod Kumar"),
    (8,  "SAFETY TALK",                 "safety_talk",          "Non Controllable", "Pramod Kumar"),
    (9,  "DUMP JAM",                    "dump_jam",             "Controllable",     "Pramod Kumar"),
    (10, "LMV UNAVAILIBILITY",          "lmv_availability",     "Controllable",     "Bhabani Shankar"),
    (11, "ILLUMINATION PROBLEM",        "illumination_problem", "Controllable",     "K L Das"),
    (12, "ABSENCE OF OPERATOR",         "absence_operator",     "Controllable",     "Bhabani Shankar"),
    (13, "IDLE (NO WORK)",              "idle",                 "Controllable",     "Pramod Kumar"),
    (14, "TIPPER SHORTAGE",             "tipper_shortage",      "Controllable",     "Amarendra Sarangi"),
    (15, "EARLY CLOSE",                 "early_close",          "Controllable",     "Pramod Kumar"),
    (16, "H.S.D FILLING",               "hsd_filling",          "Non Controllable", "Bhimsen Barik"),
    (17, "NOT IN OPERATION",            "not_operation",        "Controllable",     "Pramod Kumar"),
    (18, "RAIN & SLIPPERY PROBLEM",     "rain_slippery",        "Non Controllable", "Pramod Kumar"),
    (19, "TRANS. TRUCK JAM",            "trains_truck",         "Controllable",     "Maheswar Mohanty"),
    (20, "IMFA BLASTING",               "imfa_blasting",        "Non Controllable", "Pramod Kumar"),
    (21, "FACE PREPARATION",            "face_preparation",     "Non Controllable", "Pramod Kumar"),
    (22, "JOB ALLOCATION",              "job_allocation",       "Controllable",     "Pramod Kumar"),
    (24, "IDLE DUE TO SAFETY CONCERN",  "idle_safety",          "Controllable",     "Pramod Kumar"),
    (25, "OTHER",                       "other",                "Controllable",     "Pramod Kumar"),
    (26, "Mining Restriction",          "CONST_MR",             "Non Controllable", "Pramod Kumar"),
]

SHIFT_COLUMNS = [s for (_, _, s, _, _) in LOSS_HEADS if s not in ("SAP_BD", "SAP_PM", "CONST_MR")]


def _n(v) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _machine_filter(machines: list[dict]) -> str:
    """equipment_name switched from a CSV of excavator + tippers (pre-July 2026)
    to a single full name. Both forms must match."""
    return " OR ".join(
        f"(FIND_IN_SET(:c{i}, equipment_name) > 0 OR equipment_name = :n{i})"
        for i in range(len(machines))
    )


def _shift_hours(db: Session, machines: list[dict], fd: date, td: date) -> dict:
    """Per-head hour totals from the IMOS shift log for one machine group."""
    sums = ", ".join(
        f"SUM(COALESCE(CAST(NULLIF({c},'') AS DECIMAL(14,2)),0)) AS s_{c}" for c in SHIFT_COLUMNS
    )
    params: dict = {"fd": fd, "td": td}
    for i, m in enumerate(machines):
        params[f"c{i}"] = m["code"]
        params[f"n{i}"] = m["name"]

    row = db.execute(text(f"""
        SELECT COUNT(*) AS n_rows,
               COUNT(DISTINCT Prod_date) AS n_days,
               {sums}
        FROM mines_tipper_details
        WHERE Prod_date BETWEEN :fd AND :td AND ({_machine_filter(machines)})
    """), params).fetchone()

    m = dict(row._mapping) if row else {}
    out = {c: _n(m.get(f"s_{c}")) for c in SHIFT_COLUMNS}
    out["_rows"] = int(m.get("n_rows") or 0)
    out["_days"] = int(m.get("n_days") or 0)
    return out


def _sap_breakdown(db: Session, machines: list[dict], fd: date, td: date) -> float:
    """SAP M2 notification hours. BREAKDOWN_DURAION is stored in SECONDS."""
    ph = ", ".join(f":e{i}" for i in range(len(machines)))
    params: dict = {"fd": fd, "td": td, "plant": PLANT, "wc": WORK_CENTRE}
    for i, m in enumerate(machines):
        params[f"e{i}"] = m["sap_eq"]
    row = db.execute(text(f"""
        SELECT COALESCE(SUM(BREAKDOWN_DURAION), 0) / 3600.0 AS hrs
        FROM zpm_iw29_notifications
        WHERE MAINTENANCE_PLANT = :plant AND NOTIFICATION_TYPE = 'M2'
          AND MAIN_WORK_CENTER = :wc AND EQUIPMENT IN ({ph})
          AND MALFUNCTION_START BETWEEN :fd AND :td
    """), params).fetchone()
    return _n(row.hrs) if row else 0.0


def _sap_pm(db: Session, machines: list[dict], fd: date, td: date) -> float:
    """SAP BA03 order hours. WORK_HOURS is the only usable duration column —
    DATEDIFF(completion, start) is 0 because orders open and close same-day."""
    ph = ", ".join(f":e{i}" for i in range(len(machines)))
    params: dict = {"fd": fd, "td": td, "plant": PLANT, "wc": WORK_CENTRE}
    for i, m in enumerate(machines):
        params[f"e{i}"] = m["sap_eq"]
    row = db.execute(text(f"""
        SELECT COALESCE(SUM(WORK_HOURS), 0) AS hrs
        FROM mm_plant_maint_calibration
        WHERE ORDER_TYPE = 'BA03' AND PLANT = :plant AND MAIN_WORK_CTR = :wc
          AND EQUIPMENT_NO IN ({ph}) AND BASIC_START_DATE BETWEEN :fd AND :td
    """), params).fetchone()
    return _n(row.hrs) if row else 0.0


def _plan_actual(db: Session, fd: date, td: date) -> dict:
    """Plan from IMOS, actual from SAP — the same expressions the Production and
    OB sections use, so LCM never disagrees with those pages."""
    ore_plan = db.execute(text("""
        SELECT COALESCE(SUM(ORE_QTY), 0) AS q FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :fd AND :td
    """), {"fd": fd, "td": td}).fetchone()

    # OB_QTY_Cum is NOT cumulative despite the name — the table is one row per
    # shift per location per face, and the value repeats identically across
    # shifts A/B/C for a given face (e.g. 2026-08-04 loc 26 reads 446.5 three
    # times). It is a per-shift-per-face plan quantity, the same grain as
    # ORE_QTY, so it sums the same way. MAX-per-date discards every row but one
    # and understates the OB plan roughly fivefold.
    ob_plan = db.execute(text("""
        SELECT COALESCE(SUM(CAST(NULLIF(OB_QTY_Cum,'') AS DECIMAL(16,3))), 0) AS q
        FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :fd AND :td
    """), {"fd": fd, "td": td}).fetchone()

    ph = ", ".join(f":m{i}" for i in range(len(ORE_MATERIALS)))
    p = {"fd": fd, "td": td, "plant": PLANT}
    for i, mat in enumerate(ORE_MATERIALS):
        p[f"m{i}"] = mat
    ore_act = db.execute(text(f"""
        SELECT COALESCE(SUM(QUANTITY), 0) AS q FROM pp_production
        WHERE PLANT = :plant AND MATERIAL_NO IN ({ph})
          AND POSTING_DATE BETWEEN :fd AND :td
    """), p).fetchone()

    ob_act = db.execute(text("""
        SELECT COALESCE(SUM(QUANTITY), 0) AS q FROM pp_production
        WHERE PLANT = :plant AND MATERIAL_NO = :mat
          AND POSTING_DATE BETWEEN :fd AND :td
    """), {"plant": PLANT, "mat": OB_MATERIAL, "fd": fd, "td": td}).fetchone()

    return {
        "ore_plan":   _n(ore_plan.q),
        "ob_plan":    _n(ob_plan.q),
        "ore_actual": _n(ore_act.q),
        "ob_actual":  _n(ob_act.q),
    }


def _grade_plan(db: Session, fd: date, td: date) -> dict[str, float]:
    """Grade-wise planned ore (MT) from IMOS.

    HG_QTY / MG_QTY / LG_QTY sit on mines_daily_excavation_plan at the same
    shift x location x face grain as ORE_QTY, so they sum the same way.
    """
    r = db.execute(text("""
        SELECT COALESCE(SUM(HG_QTY), 0) AS hg,
               COALESCE(SUM(MG_QTY), 0) AS mg,
               COALESCE(SUM(LG_QTY), 0) AS lg
        FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :fd AND :td
    """), {"fd": fd, "td": td}).fetchone()
    return {"HG": _n(r.hg), "MG": _n(r.mg), "LG": _n(r.lg)}


def _weighted_rate(grade_qty: dict[str, float]) -> dict:
    """Plan-weighted average IBM rate across the grades.

    Returns the rate plus the full per-grade working, so the page can show how
    the number was arrived at instead of asking anyone to trust a bare figure.
    """
    total_qty = sum(grade_qty.values())
    missing   = [g for g, q in grade_qty.items() if q > 0 and IBM_RATES.get(g) is None]

    breakdown = [{
        "grade":  g,
        "qty":    round(grade_qty.get(g, 0.0), 3),
        "rate":   IBM_RATES.get(g),
        "share":  round(grade_qty.get(g, 0.0) / total_qty * 100, 2) if total_qty > 0 else 0.0,
        "value":  round(grade_qty.get(g, 0.0) * IBM_RATES[g], 2) if IBM_RATES.get(g) is not None else None,
    } for g in ("HG", "MG", "LG")]

    if total_qty <= 0:
        status, rate = "no_plan_qty", None
    elif missing:
        status, rate = "rate_missing", None
    else:
        # Only grades actually carrying plan quantity contribute. A grade with
        # zero qty is skipped outright rather than multiplied by its rate — it
        # adds nothing to either side of the ratio, and skipping it means an
        # unpriced-but-unplanned grade cannot break the calculation.
        rate = sum(q * IBM_RATES[g] for g, q in grade_qty.items() if q > 0) / total_qty
        status = "ok"

    return {
        "weighted_rate":   round(rate, 2) if rate is not None else None,
        "status":          status,
        "missing_grades":  missing,
        "total_plan_qty":  round(total_qty, 3),
        "source":          IBM_RATE_SOURCE,
        "breakdown":       breakdown,
    }


def get_lcm(db: Session, from_date: date, to_date: date) -> dict:
    days = (to_date - from_date).days + 1

    pa = _plan_actual(db, from_date, to_date)
    # Clamp at 0 — a period where actual beats plan has no production loss to
    # distribute, and a negative factor would render every row as a negative loss.
    ore_dev = max(pa["ore_plan"] - pa["ore_actual"], 0.0)
    ob_dev  = max(pa["ob_plan"]  - pa["ob_actual"],  0.0)

    ore_shift = _shift_hours(db, ORE_MACHINES, from_date, to_date)
    ob_shift  = _shift_hours(db, OB_MACHINES,  from_date, to_date)

    ore_bd = _sap_breakdown(db, ORE_MACHINES, from_date, to_date)
    ob_bd  = _sap_breakdown(db, OB_MACHINES,  from_date, to_date)
    ore_pm = _sap_pm(db, ORE_MACHINES, from_date, to_date)
    ob_pm  = _sap_pm(db, OB_MACHINES,  from_date, to_date)

    ore_mr = MINING_RESTRICTION_HRS_PER_MACHINE * len(ORE_MACHINES)
    ob_mr  = MINING_RESTRICTION_HRS_PER_MACHINE * len(OB_MACHINES)

    def hours(source: str) -> tuple[float, float]:
        if source == "SAP_BD":   return ore_bd, ob_bd
        if source == "SAP_PM":   return ore_pm, ob_pm
        if source == "CONST_MR": return ore_mr, ob_mr
        return ore_shift.get(source, 0.0), ob_shift.get(source, 0.0)

    raw = [(sl, label, *hours(src), lt, kam) for (sl, label, src, lt, kam) in LOSS_HEADS]

    tot_ore_hrs = sum(r[2] for r in raw)
    tot_ob_hrs  = sum(r[3] for r in raw)

    ore_factor = (ore_dev / tot_ore_hrs) if tot_ore_hrs > 0 else 0.0
    ob_factor  = (ob_dev  / tot_ob_hrs)  if tot_ob_hrs  > 0 else 0.0

    grade_qty = _grade_plan(db, from_date, to_date)
    costing   = _weighted_rate(grade_qty)
    rate      = costing["weighted_rate"]

    def amount(ore_loss_mt: float) -> float | None:
        return round(ore_loss_mt * rate, 2) if rate is not None else None

    rows = [{
        "sl_no":            sl,
        "loss_description": label,
        "ore_hours":        round(oh, 2),
        "planned_ore_loss": round(oh * ore_factor, 1),
        "ob_hours":         round(bh, 2),
        "planned_ob_loss":  round(bh * ob_factor, 0),
        "loss_amount":      amount(oh * ore_factor),
        "loss_type":        lt,
        "kam":              kam,
    } for (sl, label, oh, bh, lt, kam) in raw]

    controllable = [r for r in rows if r["loss_type"] == "Controllable"]

    return {
        "from_date": from_date.isoformat(),
        "to_date":   to_date.isoformat(),
        "basis": {
            "days":       days,
            "ore_plan":   round(pa["ore_plan"], 2),
            "ore_actual": round(pa["ore_actual"], 2),
            "ore_deviation": round(ore_dev, 2),
            "ob_plan":    round(pa["ob_plan"], 2),
            "ob_actual":  round(pa["ob_actual"], 2),
            "ob_deviation":  round(ob_dev, 2),
            "total_ore_loss_hours": round(tot_ore_hrs, 2),
            "total_ob_loss_hours":  round(tot_ob_hrs, 2),
            "ore_factor": round(ore_factor, 4),
            "ob_factor":  round(ob_factor, 4),
            "ore_machines": [m["name"] for m in ORE_MACHINES],
            "ob_machines":  [m["name"] for m in OB_MACHINES],
        },
        # Grade-wise plan feeding the weighted IBM rate. ore_plan is carried
        # alongside grade_plan_total so a mismatch between ORE_QTY and
        # HG+MG+LG is visible rather than silently absorbed — it does not
        # affect the rate (a ratio) but it does signal incomplete grade entry.
        "costing": {
            **costing,
            "ore_plan":         round(pa["ore_plan"], 2),
            "grade_plan_total": costing["total_plan_qty"],
            "grade_plan_matches_ore_plan":
                abs(costing["total_plan_qty"] - pa["ore_plan"]) < 0.5,
            "ob_costed": False,
        },
        # Shift-log completeness. A thin month understates every hour figure, so
        # the page surfaces this rather than reporting a low total as fact.
        "coverage": {
            "days_in_period":   days,
            "ore_days_present": ore_shift["_days"],
            "ob_days_present":  ob_shift["_days"],
            "ore_rows":         ore_shift["_rows"],
            "ob_rows":          ob_shift["_rows"],
        },
        "rows": rows,
        "totals": {
            "ore_hours":        round(tot_ore_hrs, 2),
            "planned_ore_loss": round(sum(r["planned_ore_loss"] for r in rows), 1),
            "ob_hours":         round(tot_ob_hrs, 2),
            "planned_ob_loss":  round(sum(r["planned_ob_loss"] for r in rows), 0),
            "controllable_ore_loss":     round(sum(r["planned_ore_loss"] for r in controllable), 1),
            "controllable_ob_loss":      round(sum(r["planned_ob_loss"] for r in controllable), 0),
            "controllable_ore_hours":    round(sum(r["ore_hours"] for r in controllable), 2),
            "controllable_ob_hours":     round(sum(r["ob_hours"] for r in controllable), 2),
            "loss_amount":               amount(sum(r["planned_ore_loss"] for r in rows)),
            "controllable_loss_amount":  amount(sum(r["planned_ore_loss"] for r in controllable)),
        },
    }
